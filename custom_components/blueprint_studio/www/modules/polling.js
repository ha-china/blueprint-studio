/** POLLING.JS | Purpose: Background polling for git status and file changes. */
import { state } from './state.js';
import { fetchWithAuth } from './api.js';
import { API_BASE } from './constants.js';
import { showToast } from './ui.js';
import { eventBus } from './event-bus.js';

// Polling interval reference
export let gitStatusPollingInterval = null;
let fileTreeSnapshotPollingInterval = null;
let pollCount = 0; // Track poll cycles for fetch timing
let lastFileTreeSnapshot = null;
let fileTreeSnapshotInFlight = false;

/**
 * Checks if the active file has been modified externally
 * Auto-reloads the file if it hasn't been modified locally
 */
export async function checkFileUpdates() {
  // Only check if window is focused to save resources
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;

  if (!state.activeTab || !state.activeTab.path) return;

  // Skip polling for virtual paths (SFTP, Terminal, etc.)
  if (state.activeTab.path.includes("://")) return;

  try {
    const response = await fetchWithAuth(`${API_BASE}?action=get_file_stat&path=${encodeURIComponent(state.activeTab.path)}&_t=${Date.now()}`);
    if (response.success && response.mtime) {
      // Initialize mtime if missing (first run or legacy tab)
      if (!state.activeTab.mtime) {
        state.activeTab.mtime = response.mtime;
        return;
      }

      // If we have a stored mtime and the new one is different
      if (state.activeTab.mtime !== response.mtime) {
        if (!state.activeTab.modified) {
          const path = state.activeTab.path;
          await Promise.all(eventBus.emit('file:open', { path, forceReload: true }));
          showToast(`File updated externally: ${path.split('/').pop()}`, "info");
        }
      }
    }
  } catch (e) {
    // Silent fail
  }
}

function isTerminalActive() {
  return state.terminalVisible || state.openTabs.some(tab => tab && tab.isTerminal);
}

/**
 * Checks whether terminal commands changed local file-tree contents.
 */
export async function checkFileTreeSnapshot() {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
  if (!isTerminalActive() || fileTreeSnapshotInFlight) return;

  fileTreeSnapshotInFlight = true;
  try {
    const response = await fetchWithAuth(
      `${API_BASE}?action=get_tree_snapshot&show_hidden=${state.showHidden}&_t=${Date.now()}`
    );
    if (!response.success || !response.signature) return;

    const signature = `${state.showHidden}:${response.signature}`;
    if (lastFileTreeSnapshot === null) {
      lastFileTreeSnapshot = signature;
      eventBus.emit('ui:reload-files', { force: true });
      return;
    }

    if (lastFileTreeSnapshot !== signature) {
      lastFileTreeSnapshot = signature;
      eventBus.emit('ui:reload-files', { force: true });
    }
  } catch (e) {
    // Silent fail; this is only a terminal-change fallback.
  } finally {
    fileTreeSnapshotInFlight = false;
  }
}

/**
 * Starts polling for git status and file updates
 * Polls every 10 seconds when window is focused (optimized)
 * Fetches from remote every 30 seconds (every 3rd poll) - Balanced mode
 */
export function startGitStatusPolling() {
  // Clear any existing interval
  if (gitStatusPollingInterval) {
    clearInterval(gitStatusPollingInterval);
  }

  // Reset poll count
  pollCount = 0;

  // Poll every 10 seconds (reduced from 5s for better performance)
  gitStatusPollingInterval = setInterval(async () => {
    // Only poll if window is focused
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;

    pollCount++;
    // Fetch from remote every 3rd poll (30 seconds) - Balanced mode
    const shouldFetch = (pollCount % 3 === 0);

    try {
      checkFileUpdates(); // Check for external file changes

      // Poll GitHub/Gitea if enabled
      if (state.gitIntegrationEnabled || state.giteaIntegrationEnabled) {
        eventBus.emit('git:status-check', { fetch: shouldFetch, silent: true });
      }
    } catch (error) {
      // Silently fail
    }
  }, 10000); // 10 seconds (optimized from 5s)

  if (fileTreeSnapshotPollingInterval) {
    clearInterval(fileTreeSnapshotPollingInterval);
  }
  lastFileTreeSnapshot = null;
  fileTreeSnapshotPollingInterval = setInterval(() => {
    checkFileTreeSnapshot();
  }, 2500);
}

/**
 * Stops git status polling
 */
export function stopGitStatusPolling() {
  if (gitStatusPollingInterval) {
    clearInterval(gitStatusPollingInterval);
    gitStatusPollingInterval = null;
  }
  if (fileTreeSnapshotPollingInterval) {
    clearInterval(fileTreeSnapshotPollingInterval);
    fileTreeSnapshotPollingInterval = null;
  }
}

// Event Listeners
eventBus.on("polling:start", () => {
  startGitStatusPolling();
});
