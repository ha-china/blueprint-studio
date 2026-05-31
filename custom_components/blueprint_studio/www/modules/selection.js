import { t } from './translations.js';
/** SELECTION.JS | Purpose: Multi-file/folder selection mode for bulk operations. */
import { state, elements } from './state.js';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE } from './constants.js';
import { showGlobalLoading, hideGlobalLoading, showToast, showConfirmDialog } from './ui.js';
import { parseSftpPath } from './sftp.js';

/**
 * Toggle selection mode on/off
 */
export function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  if (!state.selectionMode) {
    state.selectedItems.clear();
  }

  // Update toolbar visibility
  if (elements.selectionToolbar) {
    elements.selectionToolbar.style.display = state.selectionMode ? "flex" : "none";
  }

  // Update button active state
  if (elements.btnToggleSelect) {
    elements.btnToggleSelect.classList.toggle("active", state.selectionMode);
  }

  updateSelectionCount();
  
  // Broadcast that selection mode changed so trees can refresh
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('ui:refresh-sftp');
}

/**
 * Handle selection change for a file/folder
 */
export function handleSelectionChange(path, isSelected) {
  const prefix = `${path.replace(/\/+$/, "")}/`;
  if (isSelected) {
    for (const selectedPath of Array.from(state.selectedItems)) {
      if (selectedPath.startsWith(prefix)) {
        state.selectedItems.delete(selectedPath);
      }
    }
    state.selectedItems.add(path);
  } else {
    state.selectedItems.delete(path);
    for (const selectedPath of Array.from(state.selectedItems)) {
      if (selectedPath.startsWith(prefix)) {
        state.selectedItems.delete(selectedPath);
      }
    }
  }
  updateSelectionCount();
}

export function isItemSelected(path) {
  if (!path) return false;
  if (state.selectedItems.has(path)) return true;

  const isSftp = path.startsWith("sftp://");
  for (const selectedPath of state.selectedItems) {
    if (isSftp !== selectedPath.startsWith("sftp://")) continue;
    const prefix = `${selectedPath.replace(/\/+$/, "")}/`;
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Update the selection count display and button states
 */
export function updateSelectionCount() {
  if (elements.selectionCount) {
    const count = state.selectedItems.size;
    elements.selectionCount.textContent = `${count} selected`;

    if (elements.btnDownloadSelected) {
      elements.btnDownloadSelected.disabled = count === 0;
    }
    if (elements.btnDeleteSelected) {
      elements.btnDeleteSelected.disabled = count === 0;
    }
  }
}

/**
 * Delete all selected items
 */
export async function deleteSelectedItems() {
  if (state.selectedItems.size === 0) return;

  const paths = Array.from(state.selectedItems);

  const confirmed = await showConfirmDialog({
    title: "Delete Selected Items?",
    message: `Are you sure you want to permanently delete <b>${paths.length} items</b>? This action cannot be undone.`,
    confirmText: "Delete All",
    cancelText: "Cancel",
    isDanger: true
  });

  if (confirmed) {
    try {
      showGlobalLoading(`Deleting ${paths.length} items...`);

      const localPaths = paths.filter(p => !p.startsWith('sftp://'));
      const sftpPaths = paths.filter(p => p.startsWith('sftp://'));

      // 1. Delete Local Items
      if (localPaths.length > 0) {
        await fetchWithAuth(API_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete_multi", paths: localPaths }),
        });
      }

      // 2. Delete SFTP Items
      if (sftpPaths.length > 0) {
        // Group by connection to be efficient
        const byConn = {};
        sftpPaths.forEach(p => {
          const { connId, remotePath } = parseSftpPath(p);
          if (!byConn[connId]) byConn[connId] = [];
          byConn[connId].push(remotePath);
        });

        for (const connId in byConn) {
          const conn = state.sftpConnections.find(c => c.id === connId);
          if (!conn) continue;

          await fetchWithAuth(API_BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "sftp_delete_multi",
              connection: {
                host: conn.host,
                port: conn.port || 22,
                username: conn.username,
                auth: state.activeSftp.connectionId === connId ? 
                  (state.activeSftp.auth || { type: 'password', password: conn.password || '' }) : 
                  { type: 'password', password: conn.password || '' } // Fallback
              },
              paths: byConn[connId]
            }),
          });
        }
      }

      hideGlobalLoading();
      showToast(t("toast.deleted_items", { count: paths.length }), "success");

      // Close open tabs for all deleted items (exact + folder children)
      paths.forEach(path => {
        const folderPrefix = path.endsWith('/') ? path : path + '/';
        const tabsToClose = state.openTabs.filter(t => t.path === path || t.path.startsWith(folderPrefix));
        tabsToClose.forEach(tab => eventBus.emit('tab:close', { tab, force: true }));
      });

      // Exit selection mode and refresh
      toggleSelectionMode();
      
      // Refresh both local and sftp
      eventBus.emit('ui:reload-files', { force: true });
      eventBus.emit('ui:refresh-sftp');
      
      // Refresh git status if enabled
      eventBus.emit('git:refresh');
    } catch (error) {
      hideGlobalLoading();
      showToast(t("toast.delete_items_failed", { error: error.message }), "error");
    }
  }
}
