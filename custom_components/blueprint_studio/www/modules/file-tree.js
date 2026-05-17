import { t } from './translations.js';
import { eventBus } from './event-bus.js';
import { enableLongPressContextMenu } from './utils.js';
/** FILE-TREE.JS | Purpose: * Handles file tree rendering, folder expansion/collapse, drag & drop, */
import { state, elements, gitState } from './state.js';
import { fetchWithAuth, getAuthToken } from './api.js';
import { API_BASE, STREAM_BASE } from './constants.js';
import {
  showToast,
  showGlobalLoading,
  hideGlobalLoading,
  showConfirmDialog
} from './ui.js';
import { getFileIcon, formatBytes, isMobile, isTouchDevice } from './utils.js';
import { saveSettings } from './settings.js';

// Timer for debounced rendering
export let fileTreeRenderTimer = null;

// Timer for debounced content search
export let contentSearchTimer = null;

/**
 * Cancel any pending debounced search
 */
export function cancelPendingSearch() {
  if (contentSearchTimer) {
    clearTimeout(contentSearchTimer);
    contentSearchTimer = null;
  }
}

/**
 * Debounced file tree rendering
 */
export function debouncedRenderFileTree() {
  if (fileTreeRenderTimer) clearTimeout(fileTreeRenderTimer);
  fileTreeRenderTimer = setTimeout(() => {
    renderFileTree();
  }, 50);
}

/**
 * Debounced content search in file tree
 */
export function debouncedContentSearch() {
  if (contentSearchTimer) clearTimeout(contentSearchTimer);

  // Show loading state
  if (elements.fileSearch) {
    elements.fileSearch.style.opacity = "0.7";
  }

  contentSearchTimer = setTimeout(() => {
    performContentSearch();
  }, 500); // 500ms debounce
}

/**
 * Debounced filename search in file tree
 */
export function debouncedFilenameSearch() {
  if (contentSearchTimer) clearTimeout(contentSearchTimer);

  // Show loading state
  if (elements.fileSearch) {
    elements.fileSearch.style.opacity = "0.7";
  }

  contentSearchTimer = setTimeout(() => {
    performFilenameSearch();
  }, 300); // 300ms debounce (faster for filename search)
}

/**
 * Perform content search across all files using streaming NDJSON response.
 * Results appear in the tree as each file is matched — no waiting for full scan.
 */
export async function performContentSearch() {
  const query = state.searchQuery.trim();

  if (!query) {
    state.contentSearchResults = null;
    if (elements.fileSearch) elements.fileSearch.style.opacity = "1";
    renderFileTree();
    return;
  }

  // Get auth token for the stream request
  const token = await getAuthToken() || "";
  const url = `${STREAM_BASE}?action=search_stream&query=${encodeURIComponent(query)}&authorization=${encodeURIComponent(token)}`;

  try {
    state.contentSearchResults = new Set();

    const response = await fetch(url);
    if (!response.ok || !response.body) {
      // Fall back to regular search if stream not available
      throw new Error("Stream unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      // If the user changed the query while streaming, abort
      if (state.searchQuery.trim() !== query) {
        reader.cancel();
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete last line

      let hadNew = false;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const result = JSON.parse(line);
          state.contentSearchResults.add(result.path);
          hadNew = true;
        } catch {
          // skip malformed line
        }
      }

      // Re-render incrementally as results arrive
      if (hadNew && state.searchQuery.trim() === query) {
        renderFileTree();
      }
    }
  } catch (e) {
    // Fallback: regular non-streaming search
    try {
      const results = await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "global_search", query, case_sensitive: false, use_regex: false }),
      });
      if (state.searchQuery.trim() !== query) return;
      state.contentSearchResults = new Set(Array.isArray(results) ? results.map(r => r.path) : []);
    } catch (e2) {
      console.error("Content search failed", e2);
      state.contentSearchResults = new Set();
    }
  } finally {
    if (elements.fileSearch) elements.fileSearch.style.opacity = "1";
    if (state.searchQuery.trim() === query) {
      renderFileTree();
    }
  }
}

/**
 * Perform filename search across all files (lazy loading mode)
 */
export async function performFilenameSearch() {
  const query = state.searchQuery.trim().toLowerCase();

  if (!query) {
    state.contentSearchResults = null;
    if (elements.fileSearch) elements.fileSearch.style.opacity = "1";
    renderFileTree();
    return;
  }

  try {
    // Load all files from backend
    const allFiles = await fetchWithAuth(API_BASE + "?action=list_files&show_hidden=" + state.showHidden);

    // If query changed while fetching (e.g. user cleared the box), discard results
    if (state.searchQuery.trim().toLowerCase() !== query) return;

    if (allFiles && Array.isArray(allFiles)) {
      const matchingPaths = allFiles
        .filter(file => file.name.toLowerCase().includes(query))
        .map(file => file.path);
      state.contentSearchResults = new Set(matchingPaths);
    } else {
      state.contentSearchResults = new Set();
    }
  } catch (e) {
    console.error("Filename search failed", e);
    state.contentSearchResults = new Set();
  } finally {
    if (elements.fileSearch) elements.fileSearch.style.opacity = "1";
    // Only render if query still matches (user hasn't cleared)
    if (state.searchQuery.trim().toLowerCase() === query) {
      renderFileTree();
    }
  }
}

/**
 * Build file tree structure from flat list
 */
export function buildFileTree(items) {
  const tree = {};

  items.forEach((item) => {
    const parts = item.path.split("/");
    let current = tree;

    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        // Last part - either a file or folder
        if (item.type === "file") {
          if (!current._files) current._files = [];
          current._files.push({ name: part, path: item.path });
        } else if (item.type === "folder") {
          // Create folder entry if it doesn't exist
          if (!current[part]) {
            current[part] = { _path: item.path };
          }
        }
      } else {
        // Intermediate folders in the path
        if (!current[part]) {
          current[part] = { _path: parts.slice(0, index + 1).join("/") };
        }
        current = current[part];
      }
    });
  });

  return tree;
}

// Performance constants
const RENDER_CHUNK_SIZE = 100; // Render 100 items at a time in virtual scroll mode

/**
 * Render the entire file tree
 */
export function renderFileTree() {
    if (!elements.fileTree) {
        console.warn("[FileTree] Cannot render: elements.fileTree is missing");
        return;
    }

  // Clear current tree
  elements.fileTree.innerHTML = "";

  // If search query is active and content search is disabled, use flat list filtered by search
  if (state.searchQuery && !state.contentSearchEnabled && !state.lazyLoadingEnabled) {
    const fragment = document.createDocumentFragment();
    const query = state.searchQuery.toLowerCase();
    
    // Combine folders and files for search
    const allItems = [...state.folders, ...state.files];
    const filtered = allItems.filter(item => 
      item.name.toLowerCase().includes(query) || 
      item.path.toLowerCase().includes(query)
    );

    filtered.forEach(item => {
      const treeItem = createTreeItem(item.name, 0, item.type === "folder", false, item.path, false,
        item.isSymlink ? (item.symlinkTarget || "") : null);
      
      treeItem.addEventListener("click", (e) => {
        if (e.target.closest(".tree-action-btn")) return;
        e.stopPropagation();
        if (item.type === "folder") {
          if (!state.expandedFolders.has(item.path)) {
            state.currentFolderPath = item.path;
            state.expandedFolders.add(item.path);
          } else {
            state.expandedFolders.delete(item.path);
          }
          renderFileTree();
        } else {
          eventBus.emit('file:open', { path: item.path });
          if (isMobile()) eventBus.emit('ui:hide-sidebar');
        }
      });

      treeItem.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        eventBus.emit('file:context-menu', { x: e.clientX, y: e.clientY, path: item.path, isFolder: item.type === "folder" });
      });
      enableLongPressContextMenu(treeItem);

      if (state.activeTab && state.activeTab.path === item.path) {
        treeItem.classList.add("active");
      }

      fragment.appendChild(treeItem);
    });

    elements.fileTree.appendChild(fragment);
    updateToggleAllButton();
    return;
  }

  // If content search results exist, show them as a flat list
  // In lazy loading mode, we always use this flat view for both filename and content search
  if (state.contentSearchResults && (state.contentSearchEnabled || state.lazyLoadingEnabled)) {
    const fragment = document.createDocumentFragment();
    const searchResults = Array.from(state.contentSearchResults).sort();

    searchResults.forEach((filePath) => {
      const fileName = filePath.split("/").pop();
      const item = createTreeItem(fileName, 0, false, false, filePath);

      item.addEventListener("click", (e) => {
        if (e.target.closest(".tree-action-btn")) return;
        eventBus.emit('file:open', { path: filePath });
        if (isMobile()) eventBus.emit('ui:hide-sidebar');
      });

      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        eventBus.emit('file:context-menu', { x: e.clientX, y: e.clientY, path: filePath, isFolder: false });
      });
      enableLongPressContextMenu(item);

      if (state.activeTab && state.activeTab.path === filePath) {
        item.classList.add("active");
      }

      const tab = state.openTabs.find((t) => t.path === filePath);
      if (tab && tab.modified) {
        item.classList.add("modified");
      }

      fragment.appendChild(item);
    });

    elements.fileTree.appendChild(fragment);
    updateToggleAllButton();
    return; // Exit early - don't show folder navigation
  }

  // COLLAPSABLE TREE MODE: Classic expand/collapse tree (when treeCollapsableMode is enabled)
  if (state.treeCollapsableMode) {
    const fragment = document.createDocumentFragment();
    if (state.fileTree && Object.keys(state.fileTree).length > 0) {
      renderTreeLevel(state.fileTree, fragment, 0);
    }
    elements.fileTree.appendChild(fragment);
    updateToggleAllButton();
    return;
  }

  // FOLDER NAVIGATION MODE: Show only current folder contents
  const currentPath = state.currentNavigationPath;
  const currentData = state.loadedDirectories.get(currentPath);

  if (!currentData) {
    if (state.failedDirectories.has(currentPath)) {
      const errorItem = document.createElement("div");
      errorItem.className = "loading-item";
      errorItem.innerHTML = `
        <span class="material-icons" style="color: var(--error-color);">error_outline</span>
        <span class="tree-name">${t("toast.load_folder_error", { error: "Unable to load folder" })}</span>
      `;
      elements.fileTree.appendChild(errorItem);
      return;
    }

    // No data loaded yet — trigger load (e.g. on settings restore) and show spinner
    if (!state.loadingDirectories.has(currentPath)) {
      loadDirectory(currentPath); // fire-and-forget; re-renders in its finally block
    }
    const loadingItem = document.createElement("div");
    loadingItem.className = "loading-item";
    loadingItem.innerHTML = `
      <span class="material-icons loading-spinner">sync</span>
      <span class="tree-name">${t("common.loading")}</span>
    `;
    elements.fileTree.appendChild(loadingItem);
    return;
  }

  const query = state.searchQuery.toLowerCase();
  
  // Prepare all items to render
  const itemsToRender = [];

  // 1. Add ".." back item if not at root
  if (currentPath !== "") {
    const parentPath = currentPath.includes("/") 
      ? currentPath.substring(0, currentPath.lastIndexOf("/")) 
      : "";
    itemsToRender.push({ name: "..", path: parentPath, isFolder: true, isBack: true });
  }

  // 2. Add folders
  currentData.folders.forEach(f => {
    if (!query || f.name.toLowerCase().includes(query)) {
      itemsToRender.push({ ...f, isFolder: true });
    }
  });

  // 3. Add files
  currentData.files.forEach(f => {
    let match = true;
    if (state.contentSearchResults && state.contentSearchResults.size > 0) {
      match = state.contentSearchResults.has(f.path);
    } else if (query) {
      match = f.name.toLowerCase().includes(query);
    }
    if (match) {
      itemsToRender.push({ ...f, isFolder: false });
    }
  });

  // Handle Virtual Scrolling / Incremental Rendering
  if (state.enableVirtualScroll && itemsToRender.length > RENDER_CHUNK_SIZE) {
    _renderIncremental(itemsToRender, 0);
  } else {
    const fragment = document.createDocumentFragment();
    itemsToRender.forEach(item => {
      fragment.appendChild(_createTreeItemFromMeta(item));
    });
    elements.fileTree.appendChild(fragment);
  }
}

/**
 * Helper to render items in chunks to keep UI responsive
 */
function _renderIncremental(items, startIndex) {
  const fragment = document.createDocumentFragment();
  const endIndex = Math.min(startIndex + RENDER_CHUNK_SIZE, items.length);
  
  for (let i = startIndex; i < endIndex; i++) {
    fragment.appendChild(_createTreeItemFromMeta(items[i]));
  }
  
  elements.fileTree.appendChild(fragment);
  
  if (endIndex < items.length) {
    // Schedule next chunk
    requestAnimationFrame(() => {
      _renderIncremental(items, endIndex);
    });
  }
}

/**
 * Helper to create a tree item element from a metadata object
 */
function _createTreeItemFromMeta(itemMeta) {
  const { name, path, isFolder, isBack, isSymlink, symlinkTarget, size } = itemMeta;
  
  const treeItem = createTreeItem(name, 0, isFolder, false, path, false,
    isSymlink ? (symlinkTarget || "") : null);

  if (isBack) {
    treeItem.classList.add("back-item");
    treeItem.addEventListener("click", (e) => {
      if (e.target.closest(".tree-action-btn")) return;
      e.stopPropagation();
      navigateBack();
    });
  } else if (isFolder) {
    // Navigation for folders
    if (isTouchDevice()) {
      treeItem.addEventListener("click", (e) => {
        if (e.target.closest(".tree-action-btn")) return;
        e.stopPropagation();
        navigateToFolder(path);
      });
    } else {
      treeItem.addEventListener("dblclick", (e) => {
        if (e.target.closest(".tree-action-btn")) return;
        e.stopPropagation();
        navigateToFolder(path);
      });
    }
    
    treeItem.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      eventBus.emit('file:context-menu', { x: e.clientX, y: e.clientY, path, isFolder: true });
    });
    enableLongPressContextMenu(treeItem);
  } else {
    // Click for files
    treeItem.addEventListener("click", (e) => {
      if (e.target.closest(".tree-action-btn")) return;
      eventBus.emit('file:open', { path });
      if (isMobile()) eventBus.emit('ui:hide-sidebar');
    });

    treeItem.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      eventBus.emit('file:context-menu', { x: e.clientX, y: e.clientY, path, isFolder: false });
    });
    enableLongPressContextMenu(treeItem);

    if (state.activeTab && state.activeTab.path === path) {
      treeItem.classList.add("active");
    }

    const tab = state.openTabs.find((t) => t.path === path);
    if (tab && tab.modified) {
      treeItem.classList.add("modified");
    }
  }
  
  return treeItem;
}

/**
 * Render a level of the tree (recursive)
 */
export function renderTreeLevel(tree, container, depth) {
  const folders = Object.keys(tree)
    .filter((k) => !k.startsWith("_"))
    .sort();
  const files = (tree._files || []).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const query = state.searchQuery.toLowerCase();
  const fragment = document.createDocumentFragment();

  // Render folders
  folders.forEach((folderName) => {
    const folderData = tree[folderName];
    const folderPath = folderData._path;

    if (query && !folderMatchesSearch(folderData, query)) {
      return;
    }

    // Auto-expand if searching and matches
    const isExpanded = state.expandedFolders.has(folderPath) || (query && folderMatchesSearch(folderData, query));
    const isLoading = state.loadingDirectories.has(folderPath);
    const folderMeta = state.folders.find(f => f.path === folderPath);
    const item = createTreeItem(folderName, depth, true, isExpanded, folderPath, isLoading,
      folderMeta?.isSymlink ? (folderMeta.symlinkTarget || "") : null);

    const activePath = state.treeCollapsableMode
      ? state.currentFolderPath
      : state.currentNavigationPath;
    if (activePath === folderPath) {
      item.classList.add("active");
    }

    item.addEventListener("click", (e) => {
      if (e.target.closest(".tree-action-btn")) return;
      e.stopPropagation();
      const isCurrentlyExpanded = state.expandedFolders.has(folderPath);
      if (state.treeCollapsableMode) {
        // Only update currentFolderPath when expanding — not when collapsing.
        // Changing it on collapse would shift the "active" folder context away
        // from where the user is, mirroring the same bug fixed for navigation mode.
        if (!isCurrentlyExpanded) {
          state.currentFolderPath = folderPath;
        }
      } else {
        // Only update navigation path when expanding — not when collapsing.
        // Setting currentNavigationPath while collapsing causes the tree to
        // switch view to that folder, making it look like everything collapsed.
        if (!isCurrentlyExpanded) {
          state.currentNavigationPath = folderPath;
        }
      }
      toggleFolder(folderPath);
    });

    // Context menu
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      eventBus.emit('file:context-menu', { x: e.clientX, y: e.clientY, path: folderPath, isFolder: true });
    });
    enableLongPressContextMenu(item);

    fragment.appendChild(item);

    if (isExpanded && !isLoading) {
      // Only render children if expanded and not currently loading
      const childFolders = Object.keys(folderData).filter(k => !k.startsWith('_'));
      const childFiles = folderData._files || [];
      if (childFolders.length === 0 && childFiles.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'tree-item';
        emptyItem.style.setProperty('--depth', depth + 1);
        emptyItem.style.color = 'var(--text-secondary)';
        emptyItem.style.pointerEvents = 'none';
        emptyItem.innerHTML = '<div class="tree-chevron hidden"></div><span class="tree-name" style="font-style:italic">(empty)</span>';
        fragment.appendChild(emptyItem);
      } else {
        renderTreeLevel(folderData, fragment, depth + 1);
      }
    } else if (isExpanded && isLoading) {
      // Show loading placeholder
      const loadingItem = document.createElement("div");
      loadingItem.className = "tree-item loading-item";
      loadingItem.style.setProperty('--depth', depth + 1);
      loadingItem.innerHTML = `
        <span class="material-icons loading-spinner">sync</span>
        <span class="tree-name">${t("common.loading")}</span>
      `;
      fragment.appendChild(loadingItem);
    }
  });

  // Render files
  files.forEach((file) => {
    // If search results exist (from either content or filename search), filter by them
    if (state.contentSearchResults && state.contentSearchResults.size > 0) {
      if (!state.contentSearchResults.has(file.path)) return;
    } else if (query && !file.name.toLowerCase().includes(query)) {
      return;
    }

    const fileMeta = state.files.find(f => f.path === file.path);
    const item = createTreeItem(file.name, depth, false, false, file.path, false,
      fileMeta?.isSymlink ? (fileMeta.symlinkTarget || "") : null);

    item.addEventListener("click", (e) => {
      if (e.target.closest(".tree-action-btn")) return;
      eventBus.emit('file:open', { path: file.path });
      if (isMobile()) eventBus.emit('ui:hide-sidebar');
    });

    // Context menu
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      eventBus.emit('file:context-menu', { x: e.clientX, y: e.clientY, path: file.path, isFolder: false });
    });
    enableLongPressContextMenu(item);

    if (state.activeTab && state.activeTab.path === file.path) {
      item.classList.add("active");
    }

    const tab = state.openTabs.find((t) => t.path === file.path);
    if (tab && tab.modified) {
      item.classList.add("modified");
    }

    fragment.appendChild(item);
  });

  container.appendChild(fragment);
}

/**
 * Handle dropping multiple files/folders
 */
export async function handleFileDropMulti(sourcePaths, targetFolder) {
  const targetFolderDisplay = targetFolder || t("modal.config_folder");

  // Filter out redundant moves (already in target folder)
  const pathsToMove = sourcePaths.filter(path => {
    const lastSlash = path.lastIndexOf("/");
    const currentFolder = lastSlash === -1 ? "" : path.substring(0, lastSlash);
    return currentFolder !== (targetFolder || "");
  });

  if (pathsToMove.length === 0) return;

  const confirmed = await showConfirmDialog({
    title: t("modal.move_multi_title"),
    message: t("modal.move_multi_message", { count: pathsToMove.length, target: targetFolderDisplay }),
    confirmText: t("modal.move_multi_confirm"),
    cancelText: t("modal.cancel_button")
  });

  if (confirmed) {
    try {
      showGlobalLoading(`Moving ${pathsToMove.length} items...`);

      await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move_multi",
          paths: pathsToMove,
          destination: targetFolder
        }),
      });

      hideGlobalLoading();
      showToast(t("toast.moved_items", { count: pathsToMove.length }), "success");

      // Exit selection mode and refresh
      if (state.selectionMode) {
        eventBus.emit('ui:toggle-selection');
      }
      eventBus.emit('ui:reload-files', { force: true });

      // Refresh git status if enabled
      eventBus.emit('git:refresh');
    } catch (error) {
      hideGlobalLoading();
      showToast(t("toast.move_items_failed", { error: error.message }), "error");
    }
  }
}

/**
 * Handle dropping a single file/folder
 */
export async function handleFileDrop(sourcePath, targetFolder) {
  if (sourcePath === targetFolder) return;

  const fileName = sourcePath.split("/").pop();
  const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;

  // Check if moving into itself (for folders)
  if (targetFolder && (targetFolder === sourcePath || targetFolder.startsWith(sourcePath + "/"))) {
    showToast(t("toast.move_folder_itself"), "warning");
    return;
  }

  // Check if moving to same location
  const lastSlashIndex = sourcePath.lastIndexOf("/");
  const currentFolder = lastSlashIndex === -1 ? "" : sourcePath.substring(0, lastSlashIndex);
  const targetFolderNormalized = targetFolder || "";

  if (currentFolder === targetFolderNormalized) return;

  const confirmed = await showConfirmDialog({
    title: t("modal.move_item_title"),
    message: t("modal.move_item_message", { name: fileName, target: targetFolderNormalized || t("modal.config_folder") }),
    confirmText: t("modal.move_confirm"),
    cancelText: t("modal.cancel_button")
  });

  if (confirmed) {
    try {
      showGlobalLoading("Moving...");
      const data = await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          source: sourcePath,
          destination: newPath
        }),
      });

      if (data.success) {
        showToast(t("toast.moved_successfully"), "success");
        eventBus.emit('ui:reload-files');
      } else {
        showToast(t("toast.move_failed", { error: data.message }), "error");
      }
    } catch (error) {
      showToast(t("toast.move_error", { error: error.message }), "error");
    } finally {
      hideGlobalLoading();
    }
  }
}

/**
 * Check if folder matches search query
 */
export function folderMatchesSearch(folder, query) {
  // Search results mode (content or filename search)
  if (state.contentSearchResults && state.contentSearchResults.size > 0) {
    if (folder._files) {
      if (folder._files.some(f => state.contentSearchResults.has(f.path))) return true;
    }
    for (const key of Object.keys(folder)) {
      if (!key.startsWith("_") && folderMatchesSearch(folder[key], query)) return true;
    }
    return false;
  }

  // Standard Filename Search
  if (folder._files) {
    if (folder._files.some((f) => f.name.toLowerCase().includes(query))) {
      return true;
    }
  }

  for (const key of Object.keys(folder)) {
    if (!key.startsWith("_") && folderMatchesSearch(folder[key], query)) {
      return true;
    }
  }

  return false;
}

/**
 * Create a tree item element (file or folder)
 */
export function createTreeItem(name, depth, isFolder, isExpanded, itemPath = null, isLoading = false, symlinkTarget = null) {
  const item = document.createElement("div");
  item.className = "tree-item";
  item.style.setProperty("--depth", depth);
  item.draggable = true;
  item.dataset.path = itemPath;
  item.dataset.isFolder = isFolder ? "true" : "false";

  // Checkbox for selection mode
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "tree-item-checkbox";
  if (state.selectionMode) {
    checkbox.classList.add("visible");
    checkbox.checked = state.selectedItems.has(itemPath);
  }

  // Prevent item click when clicking checkbox
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    eventBus.emit('ui:selection-change', { path: itemPath, checked: e.target.checked });
  });
  item.appendChild(checkbox);

  // In folder navigation mode (lazy loading), don't show chevrons
  // We navigate by double-clicking instead of expanding
  if (isFolder && state.treeCollapsableMode) {
    const chevron = document.createElement("div");
    chevron.className = `tree-chevron ${isExpanded ? "expanded" : ""}`;
    if (isLoading) {
      // Show spinning loader icon while loading
      chevron.innerHTML = '<span class="material-icons loading-spinner">sync</span>';
    } else {
      chevron.innerHTML = '<span class="material-icons">chevron_right</span>';
    }
    item.appendChild(chevron);
  } else if (state.treeCollapsableMode) {
    // Spacer for alignment if not a folder (only in tree mode)
    const spacer = document.createElement("div");
    spacer.className = "tree-chevron hidden";
    item.appendChild(spacer);
  }

  const fileIcon = getFileIcon(itemPath || name);
  const icon = document.createElement("div");
  icon.className = `tree-icon ${isFolder ? "folder" : fileIcon.class}`;
  icon.innerHTML = `<span class="material-icons">${
    isFolder ? (isExpanded ? "folder_open" : "folder") : fileIcon.icon
  }</span>`;
  item.appendChild(icon);

  const label = document.createElement("span");
  label.className = "tree-name";
  label.textContent = name;
  item.appendChild(label);

  // Check if this is a symlink (passed directly from renderFileTree)
  // Symlink indicator
  if (symlinkTarget !== null) {
    const symlinkIcon = document.createElement("span");
    symlinkIcon.className = "material-icons tree-symlink-badge";
    symlinkIcon.textContent = "link";
    symlinkIcon.style.fontSize = "14px";
    symlinkIcon.style.marginLeft = "4px";
    symlinkIcon.style.opacity = "0.8";
    if (symlinkTarget === "") {
      // Broken symlink
      symlinkIcon.style.color = "var(--error-color)";
      symlinkIcon.title = "Broken symlink";
    } else {
      symlinkIcon.style.color = "var(--accent-color)";
      symlinkIcon.title = `Symlink → ${symlinkTarget}`;
    }
    item.appendChild(symlinkIcon);
  }

  // File Size (if available)
  if (!isFolder && itemPath) {
    let fileData = state.files.find(f => f.path === itemPath);
    // For files in subdirectories (lazy loading), look in loadedDirectories cache
    if (!fileData && state.loadedDirectories) {
      const parentPath = itemPath.includes('/') ? itemPath.split('/').slice(0, -1).join('/') : '';
      const dirData = state.loadedDirectories.get(parentPath);
      if (dirData) {
        fileData = dirData.files.find(f => f.path === itemPath);
      }
    }
    if (fileData && typeof fileData.size === 'number') {
      const sizeLabel = document.createElement("span");
      sizeLabel.className = "tree-file-size";
      sizeLabel.textContent = formatBytes(fileData.size, 0);
      sizeLabel.style.fontSize = "11px";
      sizeLabel.style.color = "var(--text-muted)";
      sizeLabel.style.marginLeft = "8px";
      sizeLabel.style.flexShrink = "0";
      item.appendChild(sizeLabel);
    }
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "tree-item-actions";

  // Pin Button (Favorites)
  if (!state.selectionMode) {
    const isPinned = state.favoriteFiles.includes(itemPath);
    const pinBtn = document.createElement("button");
    pinBtn.className = "tree-action-btn";
    pinBtn.title = isPinned ? "Unpin" : "Pin to top";
    pinBtn.innerHTML = `<span class="material-icons" style="font-size: 16px; ${isPinned ? 'color: var(--accent-color);' : ''}">push_pin</span>`;
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      eventBus.emit('file:toggle-favorite', { path: itemPath });
    });
    actions.appendChild(pinBtn);
  }

  // Diff Button - Only for modified files
  if (!isFolder && gitState.files.modified.includes(itemPath)) {
    const diffBtn = document.createElement("button");
    diffBtn.className = "tree-action-btn";
    diffBtn.title = "View Diff";
    diffBtn.innerHTML = '<span class="material-icons" style="font-size: 16px; color: var(--warning-color);">difference</span>';

    diffBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      eventBus.emit('git:show-diff', { path: itemPath });
    });
    actions.appendChild(diffBtn);
  }

  item.appendChild(actions);

  // Drag events
  item.addEventListener("dragstart", handleDragStart);
  item.addEventListener("dragover", handleDragOver);
  item.addEventListener("dragleave", handleDragLeave);
  item.addEventListener("drop", handleDrop);
  item.addEventListener("dragend", (e) => {
    e.currentTarget.classList.remove("dragging");
    elements.fileTree.classList.remove("drag-over-root");
  });

  return item;
}

/**
 * Handle drag start
 */
export function handleDragStart(e) {
  const path = e.currentTarget.dataset.path;
  if (!path || path === ".git" || path === ".gitignore") {
    e.preventDefault();
    return;
  }

  // If dragged item is selected, we move all selected items
  if (state.selectionMode && state.selectedItems.has(path)) {
    const paths = Array.from(state.selectedItems);
    e.dataTransfer.setData("application/x-blueprint-studio-multi", JSON.stringify(paths));
  }

  e.dataTransfer.setData("text/plain", path);
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
}

/**
 * Handle drag over
 */
export function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  const item = e.currentTarget.closest(".tree-item");
  if (item) {
    item.classList.add("drag-over");
  } else if (e.currentTarget === elements.fileTree || e.currentTarget.id === 'file-tree') {
    elements.fileTree.classList.add("drag-over-root");
  }
}

/**
 * Handle drag leave
 */
export function handleDragLeave(e) {
  const item = e.currentTarget.closest(".tree-item");
  if (item) {
    item.classList.remove("drag-over");
  } else if (e.currentTarget === elements.fileTree) {
    elements.fileTree.classList.remove("drag-over-root");
  }
}

/**
 * Handle drop
 */
export async function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const item = e.currentTarget.closest(".tree-item");
  if (item) {
    item.classList.remove("drag-over");
  }
  elements.fileTree.classList.remove("drag-over-root");

  const multiData = e.dataTransfer.getData("application/x-blueprint-studio-multi");
  const sourcePath = e.dataTransfer.getData("text/plain");
  const itemPath = item ? item.dataset.path : null;

  // Determine target folder
  let targetFolder = null;
  
  if (item) {
    const isFolder = item.dataset.isFolder === "true";
    if (isFolder) {
      targetFolder = itemPath;
    } else {
      // Drop onto a file - target its parent folder
      const lastSlash = itemPath.lastIndexOf("/");
      targetFolder = lastSlash === -1 ? "" : itemPath.substring(0, lastSlash);
    }
  } else if (state.lazyLoadingEnabled) {
    // If dropped on empty space in navigation mode, target the current folder
    targetFolder = state.currentNavigationPath || "";
  }

  // Case 1: External File Upload
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    eventBus.emit('ui:process-uploads', { files: e.dataTransfer.files, target: targetFolder });
    return;
  }

  // Case 2: Internal Multi-Move
  if (multiData) {
    const paths = JSON.parse(multiData);
    await handleFileDropMulti(paths, targetFolder);
    return;
  }

  // Case 3: Internal Single Move
  if (sourcePath) {
    await handleFileDrop(sourcePath, targetFolder);
  }
}

/**
 * Toggle folder expansion
 */
/**
 * Navigate into a folder (show only its contents)
 */
export async function navigateToFolder(folderPath) {
  // Add current path to history before navigating
  if (state.currentNavigationPath !== folderPath) {
    state.navigationHistory.push(state.currentNavigationPath);
  }

  state.currentNavigationPath = folderPath;

  // Load folder contents if not already loaded
  if (!state.loadedDirectories.has(folderPath)) {
    await loadDirectory(folderPath);
  }

  // Render current folder
  renderFileTree();
  updateFolderNavigationBreadcrumb();
  updateNavigationBackButton();

  eventBus.emit("settings:save");
}

/**
 * Navigate back to previous folder
 */
export async function navigateBack() {
  if (state.navigationHistory.length === 0) return;

  const previousPath = state.navigationHistory.pop();
  state.currentNavigationPath = previousPath;

  if (!state.loadedDirectories.has(previousPath)) {
    await loadDirectory(previousPath);
  }

  renderFileTree();
  updateFolderNavigationBreadcrumb();
  updateNavigationBackButton();

  eventBus.emit("settings:save");
}

/**
 * Update folder navigation breadcrumb
 */
export function updateFolderNavigationBreadcrumb() {
  const breadcrumb = document.getElementById("explorer-breadcrumb");
  if (!breadcrumb) return;

  breadcrumb.innerHTML = "";

  // Home (root)
  const homeItem = document.createElement("span");
  homeItem.className = `breadcrumb-item breadcrumb-home ${state.currentNavigationPath === "" ? "active" : ""}`;
  homeItem.dataset.path = "";
  homeItem.innerHTML = `
    <span class="material-icons">home</span>
    <span class="breadcrumb-text">${t("sidebar.home")}</span>
  `;
  homeItem.addEventListener("click", () => navigateToFolder(""));
  
  // Drag and drop for breadcrumb home
  homeItem.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    homeItem.classList.add("drag-over");
  });
  homeItem.addEventListener("dragleave", () => homeItem.classList.remove("drag-over"));
  homeItem.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    homeItem.classList.remove("drag-over");
    const sourcePath = e.dataTransfer.getData("text/plain");
    if (sourcePath) await handleFileDrop(sourcePath, "");
  });

  breadcrumb.appendChild(homeItem);

  // Path segments
  if (state.currentNavigationPath) {
    const parts = state.currentNavigationPath.split("/");
    let currentPath = "";

    parts.forEach((part, index) => {
      // Add separator
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "›";
      breadcrumb.appendChild(separator);

      // Add breadcrumb item
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = index === parts.length - 1;
      const itemPath = currentPath; // Capture for closure

      const item = document.createElement("span");
      item.className = `breadcrumb-item ${isLast ? "active" : ""}`;
      item.dataset.path = itemPath;
      item.textContent = part;

      item.addEventListener("click", () => {
        navigateToFolder(itemPath);
      });

      // Drag and drop for breadcrumb parts
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        item.classList.add("drag-over");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
      item.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove("drag-over");
        const sourcePath = e.dataTransfer.getData("text/plain");
        if (sourcePath) await handleFileDrop(sourcePath, itemPath);
      });

      breadcrumb.appendChild(item);
    });
  }
}

/**
 * Update navigation back button state
 */
export function updateNavigationBackButton() {
  const backBtn = document.getElementById("btn-nav-back");
  if (!backBtn) return;

  if (state.navigationHistory.length > 0) {
    backBtn.disabled = false;
  } else {
    backBtn.disabled = true;
  }
}

export async function toggleFolder(path) {
  // Guard against rapid double-clicks while loading
  if (state.loadingDirectories && state.loadingDirectories.has(path)) return;

  if (state.expandedFolders.has(path)) {
    // Collapse folder
    state.expandedFolders.delete(path);
    saveSettings();
    renderFileTree();
  } else {
    // Expand folder
    state.expandedFolders.add(path);
    saveSettings();

    // LAZY LOADING: Load directory contents if not already loaded
    if (state.lazyLoadingEnabled) {
      const cachedDirectory = state.loadedDirectories.get(path);
      if (cachedDirectory) {
        updateFileTreeWithLoadedDirectory(
          path,
          cachedDirectory.folders || [],
          cachedDirectory.files || []
        );
        renderFileTree();
      } else {
        await loadDirectory(path);
      }
    } else {
      renderFileTree();
    }
  }
}

/**
 * Load directory contents on demand (LAZY LOADING)
 */
export async function loadDirectory(path) {
  if (state.loadingDirectories.has(path)) {
    // Already loading, skip
    return;
  }

  try {
    state.loadingDirectories.add(path);
    state.failedDirectories.delete(path);

    // Show loading indicator
    renderFileTree(); // Re-render to show spinner


    const result = await fetchWithAuth(
      `${API_BASE}?action=list_directory&path=${encodeURIComponent(path)}&show_hidden=${state.showHidden}`
    );


    if (result.error) {
      console.error(`Failed to load directory ${path}:`, result.error);
      // Directory no longer exists — clean up stale state
      state.failedDirectories.add(path);
      state.expandedFolders.delete(path);
      state.loadedDirectories.delete(path);
      return;
    }

    // Cache the loaded directory contents
    state.loadedDirectories.set(path, {
      folders: result.folders || [],
      files: result.files || []
    });
    state.failedDirectories.delete(path);


    // Update file tree structure (add loaded items)
    updateFileTreeWithLoadedDirectory(path, result.folders || [], result.files || []);

    // Prefetch child folders in background so expand is instant
    const childFolders = result.folders || [];
    for (const folder of childFolders) {
      const childPath = path ? `${path}/${folder.name}` : folder.name;
      if (!state.loadedDirectories.has(childPath) && !state.loadingDirectories.has(childPath)) {
        fetchWithAuth(
          `${API_BASE}?action=list_directory&path=${encodeURIComponent(childPath)}&show_hidden=${state.showHidden}`
        ).then(childResult => {
          if (childResult && !childResult.error) {
            state.loadedDirectories.set(childPath, {
              folders: childResult.folders || [],
              files: childResult.files || []
            });
            updateFileTreeWithLoadedDirectory(childPath, childResult.folders || [], childResult.files || []);
          }
        }).catch(() => {});
      }
    }

  } catch (error) {
    console.error(`Error loading directory ${path}:`, error);
    state.failedDirectories.add(path);
    showToast(t("toast.load_folder_error", { error: error.message }), "error");
  } finally {
    state.loadingDirectories.delete(path);
    renderFileTree();
  }
}

/**
 * Update file tree structure with newly loaded directory contents
 */
function updateFileTreeWithLoadedDirectory(parentPath, folders, files) {
  // Navigate to parent folder in tree
  const parts = parentPath ? parentPath.split("/") : [];
  let current = state.fileTree;

  for (const part of parts) {
    if (!current[part]) {
      current[part] = { _path: parentPath };
    }
    current = current[part];
  }

  const nextFolderNames = new Set(folders.map(folder => folder.name));

  // Remove stale child folders that no longer exist in this directory.
  Object.keys(current)
    .filter(key => !key.startsWith("_"))
    .forEach(key => {
      if (!nextFolderNames.has(key)) {
        delete current[key];
      }
    });

  // Add folders
  folders.forEach(folder => {
    const existingNode = current[folder.name] && typeof current[folder.name] === "object"
      ? current[folder.name]
      : {};
    current[folder.name] = existingNode;
    current[folder.name]._path = folder.path;
    current[folder.name]._childCount = folder.childCount || 0;
  });

  current._files = files.map(file => ({ name: file.name, path: file.path, size: file.size }));
  current._loaded = true;
}

/**
 * Update toggle all button state
 */
export function updateToggleAllButton() {
  if (elements.btnToggleAll) {
    const icon = elements.btnToggleAll.querySelector('.material-icons');
    if (state.expandedFolders.size > 0) {
      elements.btnToggleAll.title = "Collapse All";
      icon.textContent = "unfold_less";
    } else {
      elements.btnToggleAll.title = "Expand All";
      icon.textContent = "unfold_more";
    }
  }
}

/**
 * Collapse all folders — works in both tree and navigation modes
 */
export async function collapseAllFolders() {
  // Collapsable tree mode: clear expanded set and re-render
  if (state.treeCollapsableMode) {
    state.expandedFolders.clear();
    renderFileTree();
    return;
  }

  // Folder navigation mode (default/lazy loading): collapse all expanded folders
  // without navigating away — just clear the expanded set and re-render in place.
  state.expandedFolders.clear();
  renderFileTree();
}
