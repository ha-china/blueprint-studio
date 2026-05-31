/** SFTP.JS | Purpose: * Provides SFTP connection management and remote file browsing/editing. */

import { state } from './state.js';
import { getFileIcon, formatBytes, isTextFile } from './utils.js';
import { t } from './translations.js';
import { enableLongPressContextMenu } from './utils.js';
import { eventBus } from './event-bus.js';
import { API_BASE, STREAM_BASE, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from './constants.js';
import { fetchWithAuth, getAuthToken, urlWithToken } from './api.js';
import {
  showToast,
  showConfirmDialog,
  showModal as showInputModal
} from './ui.js';
import { updateSshDropdown } from './terminal.js';

// ─── Visibility ───────────────────────────────────────────────────────────────

/** Show or hide the entire SFTP sidebar icon based on the integration toggle. */
export function applySftpVisibility() {
  const enabled = state.sftpIntegrationEnabled;
  const activitySftp = document.getElementById('activity-sftp');
  
  if (activitySftp) {
    activitySftp.style.display = enabled ? 'flex' : 'none';
    activitySftp.classList.toggle('hidden', !enabled);
  }
  
  // If disabling while SFTP view is active, switch to explorer
  if (!enabled) {
    const viewSftp = document.getElementById('view-sftp');
    if (viewSftp && viewSftp.style.display !== 'none') {
      eventBus.emit('ui:switch-sidebar-view', 'explorer');
    }
    state.activeSftp.connectionId = null;
    state.activeSftp.loading = false;
  }
}

// ─── Path Helpers ─────────────────────────────────────────────────────────────

/** true if path is an SFTP virtual path. */
export function isSftpPath(path) {
  return typeof path === 'string' && path.startsWith('sftp://');
}

/**
 * Parse an SFTP virtual path.
 * @param {string} path  e.g. "sftp://my-conn-id/remote/path/file.yaml"
 * @returns {{ connId: string, remotePath: string }}
 */
export function parseSftpPath(path) {
  const withoutScheme = path.slice('sftp://'.length);
  const slashIdx = withoutScheme.indexOf('/');
  if (slashIdx === -1) return { connId: withoutScheme, remotePath: '/' };
  return {
    connId: withoutScheme.slice(0, slashIdx),
    remotePath: withoutScheme.slice(slashIdx),
  };
}

function buildSftpPath(connId, remotePath) {
  return `sftp://${connId}${remotePath}`;
}

function findConnection(connId) {
  return state.sftpConnections.find(c => c.id === connId) || null;
}

/**
 * Get connection details for multipart upload (avoids exposing buildAuth globally).
 * Returns {host, port, username, auth} or null.
 */
export function getSftpConnectionDetails(connId) {
  const conn = findConnection(connId);
  if (!conn) return null;
  return {
    host: conn.host,
    port: conn.port || 22,
    username: conn.username,
    auth: buildAuth(conn),
  };
}

function buildAuth(conn) {
  if (conn.authType === 'key') {
    return { type: 'key', private_key: conn.privateKey || '', passphrase: conn.privateKeyPassphrase || '' };
  }
  return { type: 'password', password: conn.password || '' };
}

function _escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function joinRemotePath(dir, name) {
  const base = dir === '/' ? '' : dir.replace(/\/$/, '');
  return base + '/' + name;
}

/** Call an SFTP action on the backend. */
async function callSftpApi(action, conn, extra = {}) {
  return fetchWithAuth(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      show_hidden: state.showHidden,
      connection: {
        host: conn.host,
        port: conn.port || 22,
        username: conn.username,
        auth: buildAuth(conn),
      },
      ...extra,
    }),
  });
}

/**
 * Stream a file from SFTP as raw bytes and return a blob URL.
 * Uses the sftp_serve_file action which returns binary (not JSON).
 */
export async function sftpStreamFile(connId, remotePath) {
  const conn = findConnection(connId);
  if (!conn) throw new Error("SFTP connection not found");

  const token = await getAuthToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(API_BASE, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({
      action: "sftp_serve_file",
      connection: {
        host: conn.host,
        port: conn.port || 22,
        username: conn.username,
        auth: buildAuth(conn),
      },
      path: remotePath,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`SFTP stream failed: HTTP ${response.status} ${text}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Prepare a direct GET streaming URL for SFTP media.
 * The URL contains only an opaque short-lived stream id plus the HA auth token;
 * SFTP credentials stay server-side.
 */
export async function sftpStreamUrl(connId, remotePath) {
  const conn = findConnection(connId);
  if (!conn) throw new Error("SFTP connection not found");

  const result = await callSftpApi("sftp_prepare_stream", conn, { path: remotePath });
  if (!result?.success || !result.stream_id) {
    throw new Error(result?.message || "Failed to prepare SFTP stream");
  }

  return await urlWithToken(
    `${STREAM_BASE}?action=sftp_serve_file&stream_id=${encodeURIComponent(result.stream_id)}&_t=${Date.now()}`
  );
}

async function sftpFolderZipUrl(connId, remotePath) {
  const conn = findConnection(connId);
  if (!conn) throw new Error("SFTP connection not found");

  const result = await callSftpApi("sftp_prepare_stream", conn, {
    path: remotePath,
    stream_type: "folder_zip",
  });
  if (!result?.success || !result.stream_id) {
    throw new Error(result?.message || "Failed to prepare SFTP folder download");
  }

  return await urlWithToken(
    `${STREAM_BASE}?action=sftp_serve_file&stream_id=${encodeURIComponent(result.stream_id)}&_t=${Date.now()}`
  );
}

function isSftpItemSelected(virtualPath) {
  if (state.selectedItems.has(virtualPath)) return true;
  for (const selectedPath of state.selectedItems) {
    if (selectedPath.startsWith("sftp://") && virtualPath.startsWith(`${selectedPath.replace(/\/+$/, "")}/`)) {
      return true;
    }
  }
  return false;
}

// ─── Panel Rendering ──────────────────────────────────────────────────────────

export function renderSftpPanel() {
  const selectorContainer = document.getElementById('sftp-connection-selector-container');
  const headerActions = document.querySelector('#view-sftp .sidebar-header-actions');
  const breadcrumbEl = document.getElementById('sftp-breadcrumb');
  const treeEl   = document.getElementById('sftp-file-tree');
  const panelBody = document.getElementById('sftp-panel-body');

  if (!selectorContainer) return;

  if (panelBody) {
    panelBody.style.display = 'flex';
    panelBody.style.height = 'auto';
    panelBody.style.flex = '1';
  }

  // ── Connections dropdown in header ──────────────────────────────────────────
  selectorContainer.innerHTML = '';
  
  if (state.sftpConnections.length === 0) {
    selectorContainer.innerHTML = `<span>SFTP</span>`;
  } else {
    const select = document.createElement('select');
    select.className = 'sftp-header-select';
    
    // Default option
    const defaultOpt = document.createElement('option');
    defaultOpt.value = "";
    defaultOpt.textContent = "SFTP";
    select.appendChild(defaultOpt);
    
    state.sftpConnections.forEach(conn => {
      const opt = document.createElement('option');
      opt.value = conn.id;
      opt.textContent = conn.name;
      if (state.activeSftp.connectionId === conn.id) opt.selected = true;
      select.appendChild(opt);
    });
    
    select.onchange = (e) => {
      _updateDynamicButtons(e.target.value || null);
      if (e.target.value) connectToServer(e.target.value);
    };
    
    selectorContainer.appendChild(select);
  }

  // Update header actions (Edit/Delete buttons)
  if (headerActions) {
    // Remove existing dynamic buttons (edit/delete) but keep add/refresh
    headerActions.querySelectorAll('.sftp-dynamic-btn').forEach(btn => btn.remove());
  }

  function _updateDynamicButtons(connId) {
    if (!headerActions) return;
    headerActions.querySelectorAll('.sftp-dynamic-btn').forEach(btn => btn.remove());
    if (!connId) return;

    const editBtn = document.createElement('button');
    editBtn.className = 'sidebar-header-btn sftp-dynamic-btn';
    editBtn.title = t("common.edit") || "Edit connection";
    editBtn.innerHTML = '<span class="material-icons">edit</span>';
    editBtn.onclick = () => showEditConnectionDialog(connId);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'sidebar-header-btn sftp-dynamic-btn';
    deleteBtn.title = t("common.delete") || "Remove connection";
    deleteBtn.innerHTML = '<span class="material-icons">delete_outline</span>';
    deleteBtn.onclick = () => deleteConnection(connId);

    const refreshBtn = document.getElementById('btn-sftp-refresh');
    if (refreshBtn) {
      headerActions.insertBefore(editBtn, refreshBtn);
      headerActions.insertBefore(deleteBtn, refreshBtn);
    } else {
      headerActions.appendChild(editBtn);
      headerActions.appendChild(deleteBtn);
    }
  }

  // Show edit/delete for whichever connection is selected (active or just highlighted)
  const selectedConnId = state.activeSftp.connectionId ||
    (state.sftpConnections.length === 1 ? state.sftpConnections[0].id : null);
  _updateDynamicButtons(selectedConnId);

  // ── File tree (only when a connection is active) ──────────────────────────
  const { connectionId, currentPath, folders, files, loading } = state.activeSftp;
  if (!connectionId) {
    if (breadcrumbEl) breadcrumbEl.style.display = 'none';
    if (treeEl) { treeEl.style.display = 'none'; treeEl.innerHTML = ''; }
    return;
  }

  // TREE MODE
  if (state.treeCollapsableMode) {
    if (breadcrumbEl) breadcrumbEl.style.display = 'none';
    if (!treeEl) return;
    treeEl.style.display = '';
    
    if (loading && state.activeSftp.loadedDirectories.size === 0) {
      treeEl.innerHTML = '<div class="tree-item" style="--depth:0;color:var(--text-secondary)"><div class="tree-icon default"><span class="material-icons loading-spinner">sync</span></div><span class="tree-name">Loading...</span></div>';
      return;
    }
    
    treeEl.innerHTML = '';
    if (state.activeSftp.loadedDirectories.has('/')) {
      _renderSftpTreeLevel(treeEl, connectionId, '/', 0);
    } else if (state.activeSftp.loading) {
       treeEl.innerHTML = '<div class="tree-item" style="--depth:0;color:var(--text-secondary)"><div class="tree-icon default"><span class="material-icons loading-spinner">sync</span></div><span class="tree-name">Loading...</span></div>';
    }
    return;
  }

  // NAVIGATION MODE
  if (breadcrumbEl) {
    breadcrumbEl.style.display = 'flex';
    _renderBreadcrumb(breadcrumbEl, connectionId, currentPath);
  }

  if (!treeEl) return;
  treeEl.style.display = '';
  if (loading) {
    treeEl.innerHTML = '<div class="tree-item" style="--depth:0;color:var(--text-secondary)"><div class="tree-icon default"><span class="material-icons loading-spinner">sync</span></div><span class="tree-name">Loading...</span></div>';
    return;
  }

  treeEl.innerHTML = '';

  if (currentPath && currentPath !== '/') {
    const backItem = document.createElement('div');
    backItem.className = 'tree-item';
    backItem.style.setProperty('--depth', 0);
    backItem.innerHTML = `
      <div class="tree-icon folder"><span class="material-icons">arrow_back</span></div>
      <span class="tree-name">..</span>`;
    backItem.addEventListener('click', () => {
      const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
      navigateSftp(connectionId, parent);
    });
    treeEl.appendChild(backItem);
  }

  folders.forEach(folder => {
    if (!state.showHidden && folder.name.startsWith('.')) return;
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.style.setProperty('--depth', 0);
    el.dataset.path = folder.path;
    
    const virtualPath = buildSftpPath(connectionId, folder.path);
    
    // Checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tree-item-checkbox";
    if (state.selectionMode) {
      checkbox.classList.add("visible");
      checkbox.checked = isSftpItemSelected(virtualPath);
    }
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      eventBus.emit('ui:selection-change', { path: virtualPath, checked: e.target.checked });
    });
    el.appendChild(checkbox);

    const icon = document.createElement('div');
    icon.className = 'tree-icon folder';
    icon.innerHTML = `<span class="material-icons">folder</span>`;
    el.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tree-name';
    label.textContent = folder.name;
    el.appendChild(label);

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tree-item-checkbox')) return;
      navigateSftp(connectionId, folder.path);
    });
    
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _showItemContextMenu(e.clientX, e.clientY, connectionId, folder.path, true);
    });
    enableLongPressContextMenu(el);

    _setupItemDropHandler(el, connectionId, folder.path);
    treeEl.appendChild(el);
  });

  files.forEach(file => {
    if (!state.showHidden && file.name.startsWith('.')) return;
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.style.setProperty('--depth', 0);
    el.dataset.path = file.path;
    
    const virtualPath = buildSftpPath(connectionId, file.path);
    const canOpen = file.is_text !== false || file.is_binary || isTextFile(file.name);
    
    if (state.activeTab && state.activeTab.path === virtualPath) el.classList.add('active');
    const tab = state.openTabs.find(t => t.path === virtualPath);
    if (tab && tab.modified) el.classList.add('modified');
    if (!canOpen) el.style.opacity = '0.55';

    // Checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tree-item-checkbox";
    if (state.selectionMode) {
      checkbox.classList.add("visible");
      checkbox.checked = isSftpItemSelected(virtualPath);
    }
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      eventBus.emit('ui:selection-change', { path: virtualPath, checked: e.target.checked });
    });
    el.appendChild(checkbox);

    const fileIcon = getFileIcon(file.name);
    const iconEl = document.createElement('div');
    iconEl.className = `tree-icon ${fileIcon.class}`;
    iconEl.innerHTML = `<span class="material-icons">${fileIcon.icon}</span>`;
    el.appendChild(iconEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'tree-name';
    nameEl.textContent = file.name;
    el.appendChild(nameEl);

    if (typeof file.size === 'number') {
      const sizeEl = document.createElement('span');
      sizeEl.className = 'tree-file-size';
      sizeEl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-left:8px;flex-shrink:0';
      sizeEl.textContent = formatBytes(file.size, 0);
      el.appendChild(sizeEl);
    }
    
    if (canOpen) {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.tree-item-checkbox')) return;
        openSftpFile(connectionId, file.path);
      });
    }
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _showItemContextMenu(e.clientX, e.clientY, connectionId, file.path, false);
    });
    enableLongPressContextMenu(el);

    // Drop on a file uploads to its parent folder
    const parentPath = file.path.includes('/') ? file.path.replace(/\/[^/]+$/, '') || '/' : '/';
    _setupItemDropHandler(el, connectionId, parentPath);
    treeEl.appendChild(el);
  });

  if (folders.length === 0 && files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tree-item';
    empty.style.cssText = '--depth:0;color:var(--text-secondary)';
    empty.innerHTML = '<span class="tree-name" style="font-style:italic">(empty directory)</span>';
    treeEl.appendChild(empty);
  }
}

function _setupItemDropHandler(el, connId, remotePath) {
  el.ondragover = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
  };
  el.ondragleave = () => el.classList.remove('drag-over');
  el.ondrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');
    
    const virtualTarget = buildSftpPath(connId, remotePath);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const itemsArray = Array.from(e.dataTransfer.items).map(item => item.webkitGetAsEntry());
      let hasFolders = false;
      for (const entry of itemsArray) {
        if (entry && entry.isDirectory) { hasFolders = true; break; }
      }

      if (hasFolders) {
        const { processFolderDrop } = await import('./downloads-uploads.js');
        await processFolderDrop(itemsArray, virtualTarget);
      } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        eventBus.emit("ui:process-uploads", { files: e.dataTransfer.files, target: virtualTarget });
      }
    }
  };
}

function _renderBreadcrumb(el, connId, remotePath) {
  const conn = findConnection(connId);
  const connName = conn ? conn.name : connId;
  const parts = remotePath.split('/').filter(Boolean);
  
  el.innerHTML = '';
  const rootCrumb = document.createElement('span');
  rootCrumb.className = 'sftp-crumb';
  rootCrumb.textContent = connName;
  rootCrumb.onclick = () => navigateSftp(connId, '/');
  _setupItemDropHandler(rootCrumb, connId, '/');
  el.appendChild(rootCrumb);

  let built = '';
  parts.forEach(part => {
    built += '/' + part;
    const p = built;
    const sep = document.createElement('span');
    sep.className = 'material-icons';
    sep.style.fontSize = '12px';
    sep.textContent = 'chevron_right';
    el.appendChild(sep);
    
    const crumb = document.createElement('span');
    crumb.className = 'sftp-crumb';
    crumb.textContent = part;
    crumb.onclick = () => navigateSftp(connId, p);
    _setupItemDropHandler(crumb, connId, p);
    el.appendChild(crumb);
  });
}

async function _loadSftpDirectory(connId, path) {
  const { loadedDirectories, loadingDirectories } = state.activeSftp;
  
  if (loadingDirectories.has(path) || loadedDirectories.has(path)) return;
  
  loadingDirectories.add(path);
  renderSftpPanel();
  
  const conn = findConnection(connId);
  if (conn) {
    try {
      const result = await callSftpApi('sftp_list', conn, { path });
      if (result.success) {
        loadedDirectories.set(path, { folders: result.folders || [], files: result.files || [] });
      }
    } catch (e) {
      console.error(`[SFTP] Failed to load directory ${path}:`, e);
      // Optional: showToast(t("toast.sftp_load_fail", { path }), 'error');
    }
  }
  
  loadingDirectories.delete(path);
  renderSftpPanel();
}

async function _toggleSftpFolder(connId, path) {
  const { expandedFolders, loadedDirectories } = state.activeSftp;
  if (expandedFolders.has(path)) {
    expandedFolders.delete(path);
    renderSftpPanel();
    eventBus.emit('settings:save');
  } else {
    expandedFolders.add(path);
    eventBus.emit('settings:save');
    if (!loadedDirectories.has(path)) {
      await _loadSftpDirectory(connId, path);
    } else {
      renderSftpPanel();
    }
  }
}

function _renderSftpTreeLevel(container, connId, path, depth) {
  const { expandedFolders, loadedDirectories, loadingDirectories } = state.activeSftp;
  const data = loadedDirectories.get(path);
  if (!data) {
    // If it's expanded but not loaded, trigger load
    if (expandedFolders.has(path)) {
      _loadSftpDirectory(connId, path);
    }
    return;
  }

  data.folders.forEach(folder => {
    if (!state.showHidden && folder.name.startsWith('.')) return;
    const isExpanded = expandedFolders.has(folder.path);
    const virtualPath = buildSftpPath(connId, folder.path);
    
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.style.setProperty('--depth', depth);
    el.dataset.path = folder.path;
    el.dataset.isFolder = 'true';

    // Checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tree-item-checkbox";
    if (state.selectionMode) {
      checkbox.classList.add("visible");
      checkbox.checked = isSftpItemSelected(virtualPath);
    }
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      eventBus.emit('ui:selection-change', { path: virtualPath, checked: e.target.checked });
    });
    el.appendChild(checkbox);

    const chevron = document.createElement('div');
    chevron.className = `tree-chevron ${isExpanded ? "expanded" : ""}`;
    chevron.innerHTML = '<span class="material-icons">chevron_right</span>';
    chevron.onclick = (e) => { e.stopPropagation(); _toggleSftpFolder(connId, folder.path); };
    el.appendChild(chevron);

    const icon = document.createElement('div');
    icon.className = 'tree-icon folder';
    icon.innerHTML = `<span class="material-icons">${isExpanded ? "folder_open" : "folder"}</span>`;
    el.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tree-name';
    label.textContent = folder.name;
    el.appendChild(label);

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tree-item-checkbox')) return;
      _toggleSftpFolder(connId, folder.path);
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _showItemContextMenu(e.clientX, e.clientY, connId, folder.path, true);
    });
    enableLongPressContextMenu(el);
    _setupItemDropHandler(el, connId, folder.path);
    container.appendChild(el);
    
    if (isExpanded) {
      if (loadedDirectories.has(folder.path)) {
        _renderSftpTreeLevel(container, connId, folder.path, depth + 1);
      } else {
        // Trigger load for the subfolder if it's expanded but data is missing
        _loadSftpDirectory(connId, folder.path);
        
        const loadingItem = document.createElement('div');
        loadingItem.className = 'tree-item loading-item';
        loadingItem.style.setProperty('--depth', depth + 1);
        loadingItem.innerHTML = `<div class="tree-icon default"><span class="material-icons loading-spinner">sync</span></div><span class="tree-name">Loading...</span>`;
        container.appendChild(loadingItem);
      }
    }
  });

  data.files.forEach(file => {
    if (!state.showHidden && file.name.startsWith('.')) return;
    const virtualPath = buildSftpPath(connId, file.path);
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.style.setProperty('--depth', depth);
    
    const canOpen = file.is_text !== false || file.is_binary || isTextFile(file.name);
    if (state.activeTab && state.activeTab.path === virtualPath) el.classList.add('active');
    const tab = state.openTabs.find(t => t.path === virtualPath);
    if (tab && tab.modified) el.classList.add('modified');
    if (!canOpen) el.style.opacity = '0.55';

    // Checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tree-item-checkbox";
    if (state.selectionMode) {
      checkbox.classList.add("visible");
      checkbox.checked = isSftpItemSelected(virtualPath);
    }
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      eventBus.emit('ui:selection-change', { path: virtualPath, checked: e.target.checked });
    });
    el.appendChild(checkbox);

    const spacer = document.createElement('div');
    spacer.className = 'tree-chevron hidden';
    el.appendChild(spacer);

    const fileIcon = getFileIcon(file.name);
    const icon = document.createElement('div');
    icon.className = `tree-icon ${fileIcon.class}`;
    icon.innerHTML = `<span class="material-icons">${fileIcon.icon}</span>`;
    el.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tree-name';
    label.textContent = file.name;
    el.appendChild(label);

    if (typeof file.size === 'number') {
      const sizeLabel = document.createElement("span");
      sizeLabel.className = "tree-file-size";
      sizeLabel.textContent = formatBytes(file.size, 0);
      sizeLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-left:8px;flex-shrink:0";
      el.appendChild(sizeLabel);
    }

    if (canOpen) {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.tree-item-checkbox')) return;
        openSftpFile(connId, file.path);
      });
    }
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _showItemContextMenu(e.clientX, e.clientY, connId, file.path, false);
    });
    enableLongPressContextMenu(el);

    // Drop on a file uploads to its parent folder
    const parentPath = file.path.includes('/') ? file.path.replace(/\/[^/]+$/, '') || '/' : '/';
    _setupItemDropHandler(el, connId, parentPath);
    container.appendChild(el);
  });

  if (data.folders.length === 0 && data.files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tree-item';
    empty.style.setProperty('--depth', depth);
    empty.style.color = 'var(--text-secondary)';
    empty.innerHTML = '<div class="tree-chevron hidden"></div><span class="tree-name" style="font-style:italic">(empty)</span>';
    container.appendChild(empty);
  }
}

// ─── Connection Actions ───────────────────────────────────────────────────────

export async function connectToServer(connId) {
  const conn = findConnection(connId);
  if (!conn) return;
  if (!sessionStorage.getItem('sftpWarningShown')) {
    showToast(t("toast.sftp_security_notice"), 'info');
    sessionStorage.setItem('sftpWarningShown', '1');
  }
  state.activeSftp.connectionId = connId;
  state.activeSftp.currentPath = '/';
  state.activeSftp.navigationHistory = [];
  state.activeSftp.loading = true;
  renderSftpPanel();
  try {
    const result = await callSftpApi('sftp_list', conn, { path: '/' });
    if (result.success) {
      state.activeSftp.folders = result.folders || [];
      state.activeSftp.files   = result.files   || [];
      if (state.activeSftp.loadedDirectories) {
        state.activeSftp.loadedDirectories.set('/', { folders: result.folders || [], files: result.files || [] });
      }
    } else {
      showToast(t("toast.sftp_error", { error: result.message }), 'error');
      state.activeSftp.connectionId = null;
    }
  } catch (err) {
    showToast(t("toast.sftp_error", { error: err.message }), 'error');
    state.activeSftp.connectionId = null;
  } finally {
    state.activeSftp.loading = false;
    renderSftpPanel();
  }
}

export async function navigateSftp(connId, path) {
  const conn = findConnection(connId);
  if (!conn) return;
  state.activeSftp.navigationHistory.push(state.activeSftp.currentPath);
  state.activeSftp.currentPath = path;
  state.activeSftp.loading = true;
  renderSftpPanel();
  try {
    const result = await callSftpApi('sftp_list', conn, { path });
    if (result.success) {
      state.activeSftp.folders = result.folders || [];
      state.activeSftp.files   = result.files   || [];
    } else {
      showToast(t("toast.sftp_error", { error: result.message }), 'error');
      state.activeSftp.currentPath = state.activeSftp.navigationHistory.pop() || '/';
    }
  } catch (err) {
    showToast(t("toast.sftp_error", { error: err.message }), 'error');
    state.activeSftp.currentPath = state.activeSftp.navigationHistory.pop() || '/';
  } finally {
    state.activeSftp.loading = false;
    renderSftpPanel();
  }
}

export async function openSftpFile(connId, remotePath, noActivate = false) {
  const conn = findConnection(connId);
  if (!conn) return;
  const virtualPath = buildSftpPath(connId, remotePath);
  const fileName = remotePath.split('/').pop();
  const existingTab = state.openTabs.find(t => t.path === virtualPath);
  if (existingTab) {
    eventBus.emit("tab:open", { tab: existingTab, noActivate: noActivate });
    return;
  }

  const ext = fileName.split('.').pop().toLowerCase();
  const isVideo = VIDEO_EXTENSIONS.has(ext);
  const isAudio = AUDIO_EXTENSIONS.has(ext);

  // Video/audio: use a direct stream URL so the browser can issue Range requests.
  if (isVideo || isAudio) {
    showToast(t("toast.sftp_opening", { name: fileName }), 'info');
    try {
      const streamUrl = await sftpStreamUrl(connId, remotePath);
      const mimePrefix = isVideo ? "video" : "audio";
      const mimeMap = {
        mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
        avi: "video/x-msvideo", mkv: "video/x-matroska", flv: "video/x-flv",
        wmv: "video/x-ms-wmv", m4v: "video/x-m4v",
        mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
        flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4",
        wma: "audio/x-ms-wma", opus: "audio/opus",
      };
      const tab = {
        path: virtualPath,
        name: fileName,
        content: null,
        originalContent: null,
        modified: false,
        cursor: null,
        scroll: null,
        isBinary: true,
        isImage: false,
        isPdf: false,
        isVideo,
        isAudio,
        mimeType: mimeMap[ext] || `${mimePrefix}/${ext}`,
        streamUrl,
        mtime: null,
      };
      eventBus.emit("tab:open", { tab: tab, noActivate: noActivate });
    } catch (err) {
      showToast(t("toast.sftp_error", { error: err.message }), 'error');
    }
    return;
  }

  showToast(t("toast.sftp_opening", { name: fileName }), 'info');
  try {
    const result = await callSftpApi('sftp_read', conn, { path: remotePath });
    if (!result.success) {
      showToast(t("toast.sftp_read_fail", { error: result.message }), 'error');
      return;
    }
    const content = result.content || '';
    const tab = {
      path: virtualPath,
      name: fileName,
      content,
      originalContent: content,
      modified: false,
      cursor: null,
      scroll: null,
      isBinary: result.is_base64 && !isTextFile(fileName),
      isImage: IMAGE_EXTENSIONS.has(ext),
      isPdf: ext === "pdf",
      isVideo: false,
      isAudio: false,
      mimeType: result.mime_type,
      mtime: result.mtime
    };
    eventBus.emit("tab:open", { tab: tab, noActivate: noActivate });
  } catch (err) {
    showToast(t("toast.sftp_error", { error: err.message }), 'error');
  }
}

export async function saveSftpFile(tab, content) {
  const { connId, remotePath } = parseSftpPath(tab.path);
  const conn = findConnection(connId);
  if (!conn) { showToast(t("toast.sftp_conn_not_found"), 'error'); return false; }
  try {
    const result = await callSftpApi('sftp_write', conn, { path: remotePath, content });
    if (result.success) {
      showToast(t("toast.sftp_saved", { name: tab.name }), 'success');
      tab.modified = false;
      tab.originalContent = content;
      await _refreshCurrentDir(connId);
      return true;
    } else {
      showToast(t("toast.sftp_save_fail", { error: result.message }), 'error');
      return false;
    }
  } catch (err) {
    showToast(t("toast.sftp_error", { error: err.message }), 'error');
    return false;
  }
}

export async function uploadSftpFile(connId, remotePath, content, overwrite = false, is_base64 = false) {
  const conn = findConnection(connId);
  if (!conn) return { success: false, message: "Connection not found" };
  try {
    return await callSftpApi('sftp_create', conn, { 
      path: remotePath, 
      content, 
      overwrite,
      is_base64
    });
  } catch (e) {
    console.error("SFTP upload error", e);
    return { success: false, message: e.message };
  }
}

export async function uploadSftpFolder(connId, remotePath, zipData, mode = "merge", overwrite = false) {
  const conn = findConnection(connId);
  if (!conn) return { success: false, message: "Connection not found" };
  try {
    return await callSftpApi('sftp_upload_folder', conn, { 
      path: remotePath, 
      zip_data: zipData,
      mode,
      overwrite
    });
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

let _ctxMenu = null;

function _dismissCtxMenu() {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
  document.removeEventListener('click', _dismissCtxMenu, true);
  document.removeEventListener('contextmenu', _dismissCtxMenu, true);
  document.removeEventListener('touchstart', _dismissCtxMenu, true);
}

function _positionMenu(menu, x, y) {
  document.body.appendChild(menu);
  const rect  = menu.getBoundingClientRect();
  const winW  = window.innerWidth;
  const winH  = window.innerHeight;
  menu.style.left = `${Math.min(x, winW - rect.width  - 8)}px`;
  menu.style.top  = `${Math.min(y, winH - rect.height - 8)}px`;
  setTimeout(() => {
    document.addEventListener('click',       _dismissCtxMenu, true);
    document.addEventListener('contextmenu', _dismissCtxMenu, true);
    document.addEventListener('touchstart',  _dismissCtxMenu, true);
  }, 50);
}

function _makeMenu(items) {
  _dismissCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu visible';
  menu.id = 'sftp-ctx-menu';
  menu.style.cssText = 'position:fixed;z-index:9999;';
  items.forEach(item => {
    if (item === 'divider') {
      const d = document.createElement('div');
      d.className = 'context-menu-divider';
      menu.appendChild(d);
      return;
    }
    const el = document.createElement('div');
    el.className = `context-menu-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = `<span class="material-icons">${item.icon}</span>${_escapeHtml(item.label)}`;
    el.addEventListener('click', () => { _dismissCtxMenu(); item.action(); });
    menu.appendChild(el);
  });
  _ctxMenu = menu;
  return menu;
}

function _showItemContextMenu(x, y, connId, remotePath, isFolder) {
  const name = remotePath.split('/').pop();
  const parentDir = remotePath.replace(/\/[^/]+$/, '') || '/';
  const items = [];
  const virtualPath = buildSftpPath(connId, remotePath);

  if (isFolder) {
    items.push({ icon: 'note_add', label: t("menu.new_file") || 'New File', action: () => _promptNewFile(connId, remotePath) });
    items.push({ icon: 'create_new_folder', label: t("menu.new_folder") || 'New Folder', action: () => _promptNewFolder(connId, remotePath) });
    items.push({ icon: 'upload', label: t("menu.upload") || 'Upload File', action: () => { state._nextUploadTarget = virtualPath; eventBus.emit("ui:trigger-upload"); }});
    items.push({ icon: 'drive_folder_upload', label: t("menu.upload_folder") || 'Upload Folder', action: () => { state._nextFolderUploadTarget = virtualPath; eventBus.emit("ui:trigger-folder-upload"); }});
    items.push({ icon: 'download', label: (t("menu.download") || 'Download') + ' Folder (ZIP)', action: () => _downloadFolder(connId, remotePath) });
    items.push('divider');
  } else {
    items.push({ icon: 'note_add', label: t("menu.new_file") || 'New File', action: () => _promptNewFile(connId, parentDir) });
    items.push({ icon: 'create_new_folder', label: t("menu.new_folder") || 'New Folder', action: () => _promptNewFolder(connId, parentDir) });
    items.push({ icon: 'upload', label: t("menu.upload") || 'Upload File', action: () => { state._nextUploadTarget = buildSftpPath(connId, parentDir); eventBus.emit("ui:trigger-upload"); }});
    items.push({ icon: 'drive_folder_upload', label: t("menu.upload_folder") || 'Upload Folder', action: () => { state._nextFolderUploadTarget = buildSftpPath(connId, parentDir); eventBus.emit("ui:trigger-folder-upload"); }});
    items.push('divider');
    items.push({ icon: 'download', label: t("menu.download") || 'Download', action: () => _downloadFile(connId, remotePath) });
    items.push('divider');
  }

  items.push({ icon: 'drive_file_rename_outline', label: t("menu.rename") || 'Rename', action: () => _promptRename(connId, remotePath, name) });
  items.push({ icon: 'content_copy', label: t("menu.duplicate") || 'Duplicate', action: () => _duplicateItem(connId, remotePath, isFolder) });
  items.push({ icon: 'drive_file_move', label: t("menu.move") || 'Move', action: () => _promptMove(connId, remotePath, isFolder) });
  items.push('divider');
  items.push({ icon: 'link', label: t("menu.copy_path") || 'Copy Path', action: () => { navigator.clipboard.writeText(remotePath); showToast(t("toast.path_copied"), 'success'); }});
  items.push({ icon: 'terminal', label: 'Copy Virtual Path', action: () => { navigator.clipboard.writeText(virtualPath); showToast('Virtual path copied', 'success'); }});
  const isPinned = state.favoriteFiles.includes(virtualPath);
  items.push({ icon: 'push_pin', label: isPinned ? 'Unpin' : 'Pin to top', action: () => eventBus.emit('file:toggle-favorite', { path: virtualPath }) });
  if (state.terminalIntegrationEnabled) {
    items.push({ icon: 'terminal', label: t("menu.run_terminal") || 'Run in Terminal', action: () => eventBus.emit('terminal:run', { path: remotePath, isSftp: true, connId: connId }) });
  }
  items.push('divider');
  items.push({ icon: 'delete', label: t("menu.delete") || 'Delete', danger: true, action: () => _promptDelete(connId, remotePath, isFolder) });
  _positionMenu(_makeMenu(items), x, y);
}

function _showDirContextMenu(x, y, connId, dirPath) {
  const virtualPath = buildSftpPath(connId, dirPath);
  const items = [
    { icon: 'note_add', label: t("menu.new_file") || 'New File', action: () => _promptNewFile(connId, dirPath) },
    { icon: 'create_new_folder', label: t("menu.new_folder") || 'New Folder', action: () => _promptNewFolder(connId, dirPath) },
    { icon: 'upload', label: t("menu.upload") || 'Upload File', action: () => { state._nextUploadTarget = virtualPath; eventBus.emit("ui:trigger-upload"); }},
    { icon: 'drive_folder_upload', label: t("menu.upload_folder") || 'Upload Folder', action: () => { state._nextFolderUploadTarget = virtualPath; eventBus.emit("ui:trigger-folder-upload"); }},
  ];
  _positionMenu(_makeMenu(items), x, y);
}

// ─── File Operations ──────────────────────────────────────────────────────────

async function _promptNewFile(connId, dirPath) {
  const conn = findConnection(connId);
  if (!conn) return;
  const defaultValue = dirPath === '/' ? '/' : dirPath + '/';
  const result = await showInputModal({ title: "New Remote File", placeholder: "filename.yaml", value: defaultValue, hint: "Enter full remote path" });
  if (!result || !result.trim() || result === defaultValue) return;
  let remotePath = result.trim();
  if (!remotePath.split('/').pop().includes('.')) remotePath += ".yaml";
  if (state.activeSftp.files.some(f => f.path === remotePath)) {
    const confirm = await showConfirmDialog({ title: t("modal.file_exists_title"), message: t("modal.file_exists_message", { name: remotePath.split('/').pop() }), confirmText: t("modal.overwrite"), cancelText: t("modal.cancel_button"), isDanger: true });
    if (!confirm) return;
  }
  const res = await callSftpApi('sftp_create', conn, { path: remotePath, content: '', overwrite: true });
  if (res.success) { showToast(t("toast.sftp_create_success", { name: remotePath.split('/').pop() }), 'success'); await _refreshCurrentDir(connId); await openSftpFile(connId, remotePath); }
  else showToast(t("toast.sftp_create_fail", { error: res.message }), 'error');
}

async function _promptNewFolder(connId, dirPath) {
  const conn = findConnection(connId);
  if (!conn) return;
  const defaultValue = dirPath === '/' ? '/' : dirPath + '/';
  const result = await showInputModal({ title: t("menu.new_folder"), placeholder: "folder_name", value: defaultValue, hint: t("modal.new_folder_hint") });
  if (!result || !result.trim() || result === defaultValue) return;
  const remotePath = result.trim();
  const res = await callSftpApi('sftp_mkdir', conn, { path: remotePath });
  if (res.success) { showToast(t("toast.sftp_mkdir_success", { name: remotePath.split('/').pop() }), 'success'); await _refreshCurrentDir(connId); }
  else showToast(t("toast.sftp_mkdir_fail", { error: res.message }), 'error');
}

async function _promptRename(connId, remotePath, oldName) {
  const conn = findConnection(connId);
  if (!conn) return;
  const result = await showInputModal({ title: t("menu.rename"), placeholder: t("modal.rename_hint"), value: oldName, hint: `${t("menu.rename")} ${oldName}` });
  if (!result || !result.trim() || result.trim() === oldName) return;
  const newName = result.trim();
  const dest = joinRemotePath(remotePath.replace(/\/[^/]+$/, '') || '/', newName);
  const exists = state.activeSftp.files.some(f => f.path === dest) || state.activeSftp.folders.some(f => f.path === dest);
  if (exists) {
    const confirm = await showConfirmDialog({ title: t("menu.rename"), message: t("modal.file_exists_message", { name: newName }), confirmText: t("modal.overwrite"), cancelText: t("modal.cancel_button"), isDanger: true });
    if (!confirm) return;
  }
  const res = await callSftpApi('sftp_rename', conn, { source: remotePath, destination: dest, overwrite: true });
  if (res.success) {
    showToast(t("toast.sftp_rename_success", { name: newName }), 'success');
    const oldTab = state.openTabs.find(t => t.path === buildSftpPath(connId, remotePath));
    if (oldTab) { oldTab.path = buildSftpPath(connId, dest); oldTab.name = newName; }
    await _refreshCurrentDir(connId);
  } else showToast(t("toast.sftp_rename_fail", { error: res.message }), 'error');
}

async function _promptMove(connId, remotePath, isFolder) {
  const conn = findConnection(connId);
  if (!conn) return;
  const result = await showInputModal({ title: t("menu.move"), placeholder: t("modal.move_hint"), value: remotePath, hint: `${t("menu.move")} ${remotePath.split('/').pop()}` });
  if (!result || !result.trim() || result.trim() === remotePath) return;
  const newPath = result.trim();
  const exists = state.activeSftp.files.some(f => f.path === newPath) || state.activeSftp.folders.some(f => f.path === newPath);
  if (exists) {
    const confirm = await showConfirmDialog({ title: t("menu.move"), message: t("modal.file_exists_message", { name: newPath.split('/').pop() }), confirmText: t("modal.overwrite"), cancelText: t("modal.cancel_button"), isDanger: true });
    if (!confirm) return;
  }
  const res = await callSftpApi('sftp_rename', conn, { source: remotePath, destination: newPath, overwrite: true });
  if (res.success) {
    showToast(t("toast.sftp_move_success", { path: newPath }), 'success');
    const oldTab = state.openTabs.find(t => t.path === buildSftpPath(connId, remotePath));
    if (oldTab) { oldTab.path = buildSftpPath(connId, newPath); oldTab.name = newPath.split('/').pop(); }
    await _refreshCurrentDir(connId);
  } else showToast(t("toast.sftp_move_fail", { error: res.message }), 'error');
}

async function _duplicateItem(connId, remotePath, isFolder) {
  const conn = findConnection(connId);
  if (!conn) return;
  const fileName = remotePath.split('/').pop();
  let baseName = fileName, ext = "";
  if (!isFolder && fileName.includes(".")) { const p = fileName.split("."); ext = "." + p.pop(); baseName = p.join("."); }
  const result = await showInputModal({ title: t("menu.duplicate"), placeholder: t("modal.rename_hint"), value: `${baseName}_copy${ext}`, hint: `${t("menu.duplicate")} ${fileName}` });
  if (!result || !result.trim()) return;
  const newName = result.trim();
  const dest = joinRemotePath(remotePath.replace(/\/[^/]+$/, '') || '/', newName);
  if (state.activeSftp.files.some(f => f.path === dest) || state.activeSftp.folders.some(f => f.path === dest)) {
    const confirm = await showConfirmDialog({ title: t("menu.duplicate"), message: t("modal.file_exists_message", { name: newName }), confirmText: t("modal.overwrite"), cancelText: t("modal.cancel_button"), isDanger: true });
    if (!confirm) return;
  }
  const res = await callSftpApi('sftp_copy', conn, { source: remotePath, destination: dest, overwrite: true });
  if (res.success) { showToast(t("toast.sftp_duplicate_success", { name: newName }), 'success'); await _refreshCurrentDir(connId); }
  else showToast(t("toast.sftp_duplicate_fail", { error: res.message }), 'error');
}

async function _promptDelete(connId, remotePath, isFolder) {
  const name = remotePath.split('/').pop();
  const confirmed = await showConfirmDialog({ title: isFolder ? t("modal.delete_folder_title") : t("modal.delete_file_title"), message: isFolder ? t("modal.delete_folder_message", { name }) : t("modal.delete_message", { name }), confirmText: t("modal.delete_button"), cancelText: t("modal.cancel_button"), isDanger: true });
  if (!confirmed) return;
  const conn = findConnection(connId);
  if (!conn) return;
  const result = await callSftpApi('sftp_delete', conn, { path: remotePath });
  if (result.success) {
    showToast(t("toast.sftp_delete_success", { name }), 'success');
    const virtualPath = buildSftpPath(connId, remotePath);

    // Close open tabs: exact match for files, prefix match for folders
    if (isFolder) {
      const folderPrefix = virtualPath.endsWith('/') ? virtualPath : virtualPath + '/';
      const tabsToClose = state.openTabs.filter(t => t.path === virtualPath || t.path.startsWith(folderPrefix));
      tabsToClose.forEach(tab => eventBus.emit('tab:close', { tab, force: true }));
    } else {
      const tab = state.openTabs.find(t => t.path === virtualPath);
      if (tab) eventBus.emit('tab:close', { tab, force: true });
    }

    // Remove from expanded folders if it was a folder
    if (isFolder) {
      state.activeSftp.expandedFolders.delete(remotePath);
      if (state.activeSftp.loadedDirectories) {
        state.activeSftp.loadedDirectories.delete(remotePath);
      }
    }

    await _refreshCurrentDir(connId);
  } else showToast(t("toast.sftp_delete_fail", { error: result.message }), 'error');
}

function _attachDialogEvents(editingConn = null) {
  const overlay = document.getElementById('sftp-dialog-overlay'), authTypeSelect = document.getElementById('sftp-input-auth-type'), passwordSection = document.getElementById('sftp-password-section'), keySection = document.getElementById('sftp-key-section');
  authTypeSelect.addEventListener('change', () => { const v = authTypeSelect.value; passwordSection.style.display = v === 'password' ? '' : 'none'; keySection.style.display = v === 'key' ? '' : 'none'; });
  document.getElementById('sftp-dialog-close').addEventListener('click', () => overlay.remove());
  document.getElementById('sftp-dialog-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('sftp-dialog-save').addEventListener('click', async () => {
    const name = document.getElementById('sftp-input-name').value.trim(), host = document.getElementById('sftp-input-host').value.trim(), port = parseInt(document.getElementById('sftp-input-port').value) || 22, username = document.getElementById('sftp-input-username').value.trim(), authType = authTypeSelect.value, password = document.getElementById('sftp-input-password').value, privateKey = document.getElementById('sftp-input-private-key').value.trim(), privateKeyPassphrase = document.getElementById('sftp-input-key-passphrase').value;
    if (!name || !host || !username) { showToast(t("toast.sftp_fill_required"), 'error'); return; }
    const conn = { id: editingConn ? editingConn.id : _generateId(), name, host, port, username, authType, password, privateKey, privateKeyPassphrase };
    const saveBtn = document.getElementById('sftp-dialog-save');
    saveBtn.disabled = true; saveBtn.textContent = t("modal.confirm") + '…';
    const result = await callSftpApi('sftp_test', conn);
    saveBtn.disabled = false; saveBtn.textContent = editingConn ? t("auth.save") : t("modal.confirm_button");
    if (!result.success) { showToast(t("toast.sftp_conn_fail", { error: result.message }), 'error'); return; }
    showToast(t("toast.sftp_conn_success", { error: result.message }), 'success');
    if (editingConn) { const idx = state.sftpConnections.findIndex(c => c.id === conn.id); if (idx >= 0) state.sftpConnections[idx] = conn; }
    else state.sftpConnections.push(conn);
    // Keep sshHosts alias in sync (may have been replaced by filter elsewhere)
    state.sshHosts = state.sftpConnections;
    updateSshDropdown();
    eventBus.emit("settings:save"); overlay.remove(); renderSftpPanel();
  });
}

async function _downloadFile(connId, remotePath) {
  const conn = findConnection(connId);
  if (!conn) return;
  const fileName = remotePath.split('/').pop();
  showToast(t("toast.sftp_downloading", { name: fileName }), 'info');
  try {
    const result = await callSftpApi('sftp_read', conn, { path: remotePath });
    if (!result.success) {
      showToast(t("toast.sftp_download_fail", { error: result.message }), 'error');
      return;
    }
    const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t("toast.sftp_download_success", { name: fileName }), 'success');
  } catch (err) {
    showToast(t("toast.sftp_download_fail", { error: err.message }), 'error');
  }
}

async function _downloadFolder(connId, remotePath) {
  const conn = findConnection(connId);
  if (!conn) return;
  const folderName = remotePath.split('/').filter(Boolean).pop() || "download";
  showToast("Preparing remote folder download...", 'info');
  try {
    const url = await sftpFolderZipUrl(connId, remotePath);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${folderName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(t("toast.download_success"), "success");
  } catch (err) {
    showToast(t("toast.download_items_fail", { error: err.message }), 'error');
  }
}

async function _refreshCurrentDir(connId) {
  const conn = findConnection(connId);
  if (!conn || state.activeSftp.connectionId !== connId) return;
  const currentPath = state.activeSftp.currentPath;
  state.activeSftp.loading = true;
  renderSftpPanel();
  try {
    // Always refresh the current directory
    const result = await callSftpApi('sftp_list', conn, { path: currentPath });
    if (result.success) {
      state.activeSftp.folders = result.folders || [];
      state.activeSftp.files   = result.files   || [];
      if (state.activeSftp.loadedDirectories) {
        state.activeSftp.loadedDirectories.set(currentPath, {
          folders: result.folders || [],
          files: result.files || []
        });
      }
    }

    // In tree mode, also refresh all expanded subdirectories so the tree stays current.
    // Refresh sequentially to avoid SSH connection storms (MaxStartups rejection).
    if (state.treeCollapsableMode && state.activeSftp.expandedFolders.size > 0) {
      const expandedPaths = Array.from(state.activeSftp.expandedFolders).filter(p => p !== currentPath);
      let removedStale = false;
      for (const path of expandedPaths) {
        try {
          const dirResult = await callSftpApi('sftp_list', conn, { path });
          if (dirResult.success && state.activeSftp.loadedDirectories) {
            state.activeSftp.loadedDirectories.set(path, {
              folders: dirResult.folders || [],
              files: dirResult.files || []
            });
          } else if (!dirResult.success) {
            // Path no longer exists — remove from expanded set
            state.activeSftp.expandedFolders.delete(path);
            if (state.activeSftp.loadedDirectories) {
              state.activeSftp.loadedDirectories.delete(path);
            }
            removedStale = true;
          }
        } catch (_) {
          // Connection error or path gone — remove stale entry
          state.activeSftp.expandedFolders.delete(path);
          removedStale = true;
        }
      }
      // Persist the cleanup so stale paths don't come back on reload
      if (removedStale) {
        eventBus.emit('settings:save');
      }
    }
  } catch (_) { /* ignore */ }
  state.activeSftp.loading = false;
  renderSftpPanel();
}

export async function refreshSftp() { if (state.activeSftp.connectionId) await _refreshCurrentDir(state.activeSftp.connectionId); }

/** Update static UI strings in the SFTP panel (for language changes) */
export function refreshSftpStrings() {
  const viewSftp = document.getElementById('view-sftp');
  if (!viewSftp) return;

  const headerTitle = viewSftp.querySelector('.sidebar-header span');
  if (headerTitle) headerTitle.textContent = t("sftp.panel_title") || "SFTP Connections";

  const addBtn = document.getElementById('btn-sftp-add');
  if (addBtn) addBtn.title = t("sftp.add_connection") || "Add Connection";

  const refreshBtn = document.getElementById('btn-sftp-refresh');
  if (refreshBtn) refreshBtn.title = t("common.refresh") || "Refresh SFTP";

  // Re-render the panel to update "No connections" or other dynamic text
  renderSftpPanel();
}

export function initSftpPanelButtons() {
  const addBtn = document.getElementById('btn-sftp-add'), 
        refreshBtn = document.getElementById('btn-sftp-refresh'),
        panelBody = document.getElementById('sftp-panel-body'), 
        treeEl = document.getElementById('sftp-file-tree');
        
  if (addBtn) addBtn.addEventListener('click', () => showAddConnectionDialog());
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshSftp());
  
  const setupDropZone = (el) => {
    if (!el) return;
    el.addEventListener('dragover', e => {
      if (!state.activeSftp.connectionId) return;
      // Only show root highlight when hovering empty space (not on tree items)
      if (e.target.closest('.tree-item')) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drag-over-root');
    });
    el.addEventListener('dragleave', e => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over-root');
    });
    el.addEventListener('drop', async e => {
      if (!state.activeSftp.connectionId) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over-root');
      // Tree items handle their own drops — this only catches empty-space drops
      if (e.target.closest('.tree-item')) return;

      const connId = state.activeSftp.connectionId;
      const targetPath = state.treeCollapsableMode ? '/' : state.activeSftp.currentPath;
      const virtualTarget = buildSftpPath(connId, targetPath);

      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        const itemsArray = Array.from(e.dataTransfer.items).map(item => item.webkitGetAsEntry());
        let hasFolders = false;
        for (const entry of itemsArray) { if (entry && entry.isDirectory) { hasFolders = true; break; } }
        if (hasFolders) { 
          const { processFolderDrop } = await import('./downloads-uploads.js'); 
          await processFolderDrop(itemsArray, virtualTarget); 
        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { 
          eventBus.emit("ui:process-uploads", { files: e.dataTransfer.files, target: virtualTarget }); 
        }
      }
    });
  };
  
  setupDropZone(panelBody);

  if (panelBody) {
    panelBody.addEventListener('contextmenu', e => {
      if (!state.activeSftp.connectionId || e.target.closest('#sftp-connections-list') || e.target.closest('#sftp-breadcrumb') || e.target.closest('.tree-item')) return;
      e.preventDefault(); _showDirContextMenu(e.clientX, e.clientY, state.activeSftp.connectionId, state.activeSftp.currentPath);
    });
  }
}

export async function deleteConnection(connId) {
  const conn = state.sftpConnections.find(c => c.id === connId);
  const connName = conn ? conn.name : "this connection";

  const confirmed = await showConfirmDialog({
    title: t("sftp.delete_title") || "Remove SFTP Connection?",
    message: t("sftp.delete_confirm", { name: connName }) || `Are you sure you want to remove '${connName}'? This will disconnect any active session.`,
    confirmText: t("common.delete") || "Delete",
    cancelText: t("common.cancel") || "Cancel",
    isDanger: true
  });

  if (!confirmed) return;

  // Remove from the unified sshHosts array (sftpConnections is an alias to the same array)
  const idx = state.sshHosts.findIndex(c => c.id === connId);
  if (idx >= 0) state.sshHosts.splice(idx, 1);
  // Keep the alias in sync in case it was replaced elsewhere
  state.sftpConnections = state.sshHosts;
  updateSshDropdown();
  if (state.activeSftp.connectionId === connId) {
    state.activeSftp.connectionId    = null;
    state.activeSftp.folders         = [];
    state.activeSftp.files           = [];
    state.activeSftp.currentPath     = '/';
    state.activeSftp.navigationHistory = [];
    state.activeSftp.expandedFolders.clear();
  }
  eventBus.emit("settings:save");
  renderSftpPanel();
}

function _generateId() {
  return 'host-' + Math.random().toString(36).slice(2, 10);
}

export function showAddConnectionDialog() {
  const existing = document.getElementById('sftp-dialog-overlay');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', _buildDialogHtml());
  _attachDialogEvents(null);
}

export function showEditConnectionDialog(connId) {
  const conn = findConnection(connId);
  if (!conn) return;
  const existing = document.getElementById('sftp-dialog-overlay');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', _buildDialogHtml(conn));
  _attachDialogEvents(conn);
}

function _buildDialogHtml(conn = {}) {
  const isEdit   = !!conn.id;
  const authType = conn.authType || 'password';
  return `
    <div class="modal-overlay visible" id="sftp-dialog-overlay">
      <div class="modal" style="max-width: 500px;">
        <div class="modal-header">
          <span class="modal-title">${isEdit ? t("sftp.dialog_edit_title") : t("sftp.dialog_add_title")}</span>
          <button class="modal-close" id="sftp-dialog-close">
            <span class="material-icons">close</span>
          </button>
        </div>
        <div class="modal-body">
          <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.name")}</label>
          <input type="text" class="modal-input" id="sftp-input-name" placeholder="My HAOS Host" value="${_escapeHtml(conn.name || '')}" style="margin-bottom:12px;" />

          <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.host")}</label>
          <input type="text" class="modal-input" id="sftp-input-host" placeholder="192.168.1.100" value="${_escapeHtml(conn.host || '')}" style="margin-bottom:12px;" />

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div>
              <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.port")}</label>
              <input type="number" class="modal-input" id="sftp-input-port" value="${conn.port || 22}" />
            </div>
            <div>
              <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.username")}</label>
              <input type="text" class="modal-input" id="sftp-input-username" placeholder="root" value="${_escapeHtml(conn.username || '')}" />
            </div>
          </div>

          <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.auth_type")}</label>
          <select class="modal-input" id="sftp-input-auth-type" style="margin-bottom:12px;">
            <option value="password" ${authType === 'password' ? 'selected' : ''}>${t("sftp.auth_password")}</option>
            <option value="key"      ${authType === 'key'      ? 'selected' : ''}>${t("sftp.auth_key")}</option>
          </select>

          <div id="sftp-password-section" style="${authType === 'password' ? '' : 'display:none'}">
            <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.password")}</label>
            <input type="password" class="modal-input" id="sftp-input-password" placeholder="••••••••" value="${_escapeHtml(conn.password || '')}" />
          </div>

          <div id="sftp-key-section" style="${authType === 'key' ? '' : 'display:none'}">
            <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.private_key")}</label>
            <textarea class="modal-input" id="sftp-input-private-key" rows="6" placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..." style="margin-bottom:12px;font-family:monospace;font-size:12px;">${_escapeHtml(conn.privateKey || '')}</textarea>
            <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">${t("sftp.key_passphrase")}</label>
            <input type="password" class="modal-input" id="sftp-input-key-passphrase" value="${_escapeHtml(conn.privateKeyPassphrase || '')}" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn secondary" id="sftp-dialog-cancel">${t("modal.cancel_button")}</button>
          <button class="modal-btn primary" id="sftp-dialog-save">
            ${isEdit ? t("auth.save") : t("sftp.test_and_save")}
          </button>
        </div>
      </div>
    </div>`;
}

/**
 * Restores an active SFTP session based on saved state
 */
export async function restoreSftpSession() {
  if (state.activeSftp.connectionId) {
    const connId = state.activeSftp.connectionId;
    const conn = findConnection(connId);
    if (!conn) {
      // Connection no longer exists — clear stale state
      state.activeSftp.connectionId = null;
      state.activeSftp.currentPath = '/';
      renderSftpPanel();
      return;
    }
    const path = state.activeSftp.currentPath || '/';

    if (path === '/') {
      await connectToServer(connId);
    } else {
      await navigateSftp(connId, path);
    }
  }
}
