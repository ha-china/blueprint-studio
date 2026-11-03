/**
 * FILE-COORDINATOR.JS | Purpose:
 * Coordinates all file-related operations, tab management, and folder interactions.
 * This is a "piece" of the decomposed app.js.
 */

import { state, elements } from '../state.js';
import { eventBus } from '../event-bus.js';
import { t } from '../translations.js';
import { API_BASE, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from '../constants.js';
import { fetchWithAuth } from '../api.js';
import { 
    renderFileTree as renderFileTreeImpl,
    loadDirectory as loadDirectoryImpl,
    buildFileTree as buildFileTreeImpl,
    startInlineExplorerCreate,
    startInlineExplorerRename
} from '../file-tree.js';
import { showToast, setButtonLoading, showConfirmDialog } from '../ui.js';
import { classifyTreeError, renderTreeViewState } from '../tree-view-state.js';
import { startOperationFeedback } from '../feedback-service.js';

import { 
    isTextFile, 
    formatBytes 
} from '../utils.js';
import { 
    downloadFileByPath as downloadFileByPathUtil,
    downloadContent as downloadContentUtil
} from '../downloads-uploads.js';
import { 
    isSftpPath as isSftpPathImpl,
    parseSftpPath as parseSftpPathImpl,
    openSftpFile as openSftpFileImpl
} from '../sftp.js';
import {
    saveFile as saveFileImpl,
    createFile as createFileImpl,
    createFolder as createFolderImpl,
    renameItem as renameItemImpl,
    copyItem as copyItemImpl,
    deleteItem as deleteItemImpl
} from '../file-operations.js';
import {
    promptNewBlueprint as promptNewBlueprintImpl,
    promptCopy as promptCopyImpl,
    promptMove as promptMoveImpl,
    duplicateItem as duplicateItemImpl,
    promptDelete as promptDeleteImpl
} from '../file-operations-ui.js';

// blueprint-form.js loaded lazily with cache-busting (see usage below)

import {
    nextTab as nextTabImpl,
    previousTab as previousTabImpl,
    activateTab,
    closeTab,
    closeAllTabs as closeAllTabsImpl,
    closeOtherTabs as closeOtherTabsImpl,
    closeTabsToRight as closeTabsToRightImpl
} from '../tabs.js';
import { deleteSelectedItems as deleteSelectedItemsImpl } from '../selection.js';
import {
    downloadSelectedItems as downloadSelectedItemsImpl,
    triggerUpload as triggerUploadImpl
} from '../downloads-uploads.js';

let isLoadingFiles = false;
const fileContentCache = new Map();

function openBlueprintConversionPath(path) {
    eventBus.emit('ui:switch-sidebar-view', 'explorer');
    eventBus.emit('file:open', { path });
}

async function confirmBlueprintConversionRetry(request) {
    const confirmed = await showConfirmDialog({
        title: t('blueprint_ops.conversion_retry_title'),
        message: t('blueprint_ops.conversion_retry_message', { kind: request.sourceKind.toLowerCase(), path: request.destinationPath }),
        confirmText: t('blueprint_ops.conversion_retry_confirm'),
        cancelText: t('modal.cancel_button'),
        isDanger: true,
    });
    if (confirmed) return runBlueprintConversion(request);
    return false;
}

async function runBlueprintConversion(request) {
    let destinationSaved = false;
    let conversionComplete = false;
    const operation = startOperationFeedback({
        label: t('blueprint_ops.conversion_label'),
        icon: 'architecture',
        scope: request.sourceKind,
        target: `${request.sourcePath} -> ${request.destinationPath}`,
        message: t('blueprint_ops.converting', { source: request.sourceLabel }),
        retry: () => confirmBlueprintConversionRetry(request),
        open: () => openBlueprintConversionPath(destinationSaved ? request.destinationPath : request.sourcePath),
        openLabel: t('workspace_ops.open_file'),
        openIcon: 'description',
    });

    try {
        operation.update({ message: t('blueprint_ops.converting', { source: request.sourceLabel }), percent: 20 });
        const response = await fetchWithAuth(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'convert_to_blueprint',
                content: request.content,
                blueprint_name: request.blueprintName,
            }),
        });
        if (!response?.success || typeof response.blueprint !== 'string' || !response.blueprint.trim()) {
            throw new Error(response?.message || response?.error || t('blueprint_ops.no_content'));
        }

        conversionComplete = true;
        operation.update({ message: t('blueprint_ops.destination_saving', { path: request.destinationPath }), percent: 65 });
        let saveFailure = '';
        const saved = await createFileImpl(
            request.destinationPath,
            response.blueprint,
            false,
            true,
            false,
            {
                silentOperation: true,
                silentToast: true,
                silentErrorToast: true,
                onResult: result => { if (!result.success) saveFailure = result.message; },
            },
        );
        if (!saved) throw new Error(saveFailure || t('blueprint_ops.generated_write_rejected'));

        destinationSaved = true;
        operation.finish(t('blueprint_ops.destination_created', { path: request.destinationPath }), { percent: 100 });
        showToast(t('toast.blueprint_created', { source: request.sourceLabel, destination: request.destinationPath }), 'success');
        return true;
    } catch (error) {
        const message = conversionComplete
            ? t('blueprint_ops.converted_save_failed')
            : t('blueprint_ops.conversion_failed');
        operation.fail(message, error.message);
        showToast(t('toast.operation_failed', { operation: message, error: error.message }), 'error');
        return false;
    }
}

/**
 * Saves a file to the backend
 */
export async function saveFile(path, content, options = {}) {
    return saveFileImpl(path, content, options);
}

/**
 * Saves the currently active tab
 */
export async function saveCurrentFile(isAutoSave = false) {
    const reallyAutoSave = isAutoSave === true;
    
    if (reallyAutoSave && !state.autoSave) return;
    if (!state.activeTab) return;

    const tab = state.activeTab;
    
    // Prevent saving read-only files
    if (tab.path.endsWith(".gitignore") || tab.path.endsWith(".lock")) {
      if (!reallyAutoSave) {
        showToast(t("toast.this_file_is_read_only_and_can"), "warning");
      }
      return;
    }

    const content = tab.content;
    const previousContent = tab.originalContent;
    const isYaml = tab.path.endsWith(".yaml") || tab.path.endsWith(".yml");

    // 1. Validate if it's a YAML file
    if (isYaml && !reallyAutoSave) {
      if (functions.validateYaml) {
        const validationResult = await functions.validateYaml(content);
        if (validationResult && !validationResult.valid) {
          const confirmed = await showConfirmDialog({
            title: "YAML Validation Error",
            message: `The file contains an error and may not work with Home Assistant.<br><br><div style="background: var(--bg-tertiary); padding: 10px; border-radius: 4px; font-family: monospace; font-size: 0.9em;">${validationResult.error}</div>`,
            confirmText: "Save Anyway",
            cancelText: "Cancel",
            isDanger: true
          });

          if (!confirmed) {
            showToast(t("toast.save_cancelled_due_to_validati"), "warning");
            return;
          }
        }
      }
    }

    // 2. Proceed with saving
    if (!reallyAutoSave && elements.btnSave) {
      setButtonLoading(elements.btnSave, true);
    }

    tab.saveState = 'saving';
    tab.saveError = '';
    eventBus.emit('ui:refresh-tabs');

    const success = await saveFile(tab.path, content, {
      silentToast: reallyAutoSave,
      silentOperation: reallyAutoSave,
    });

    if (!reallyAutoSave && elements.btnSave) {
      setButtonLoading(elements.btnSave, false);
    }

    if (success) {
      tab.previousContent = previousContent;
      tab.originalContent = content;
      const unchangedSinceRequest = tab.content === content;
      tab.modified = !unchangedSinceRequest;
      tab.saveState = unchangedSinceRequest ? 'saved' : '';
      if (unchangedSinceRequest) tab.externalConflict = false;
      eventBus.emit('ui:refresh-tabs');
      eventBus.emit('ui:refresh-tree');
      if (functions.updateToolbarState) functions.updateToolbarState();

      eventBus.emit('settings:save');

      if (reallyAutoSave) {
        showToast(t('toast.saved_plain'), "success", 1200);
      }
    } else {
      tab.saveState = 'failed';
      tab.saveError = 'Save failed';
      eventBus.emit('ui:refresh-tabs');
    }
}

/**
 * Show/hide loading indicator for the file tree
 */
export function setFileTreeLoading(isLoading) {
    if (elements.fileTree) {
        if (isLoading) {
            elements.fileTree.classList.add("loading");
            renderTreeViewState(elements.fileTree, {
                status: "loading",
                title: t("tree.loading_local"),
                copy: t("tree.loading_copy"),
            });
        } else {
            elements.fileTree.classList.remove("loading");
        }
    }
}

/**
 * Fetches file content from the server with caching
 */
export async function loadFile(path) {
    try {
      // 1. Check cache first
      if (fileContentCache.has(path)) {
          const cached = fileContentCache.get(path);
          if (Date.now() - cached.timestamp < 60000) {
              return cached.data;
          }
          fileContentCache.delete(path);
      }

      // 2. Fetch from server
      const isText = isTextFile(path);
      const fileInfo = state.files.find(f => f.path === path);

      // CRITICAL SAFETY CHECK: Block files over 500MB
      const MAX_FILE_SIZE = 500 * 1024 * 1024;
      const TEXT_FILE_WARNING_SIZE = 2 * 1024 * 1024;

      if (fileInfo && fileInfo.size > MAX_FILE_SIZE) {
          showToast(
              t('toast.file_too_large', { file: path.split("/").pop(), size: formatBytes(fileInfo.size), max: formatBytes(MAX_FILE_SIZE) }),
              "error",
              8000
          );
          throw new Error(`File too large: ${formatBytes(fileInfo.size)}`);
      }

      // Enforce warning for large TEXT files
      if (isText && fileInfo && fileInfo.size > TEXT_FILE_WARNING_SIZE) {
          const confirmed = await showConfirmDialog({
              title: "Large File Detected",
              message: `This text file is <b>${formatBytes(fileInfo.size)}</b>. Opening it in the editor may cause the browser to freeze.<br><br>Do you want to download it instead?`,
              confirmText: "Download",
              cancelText: "Open Anyway (Risky)"
          });

          if (confirmed) {
              downloadFileByPathUtil(path);
              return { content: "", mtime: 0 };
          }
      }

      const data = await fetchWithAuth(
        `${API_BASE}?action=read_file&path=${encodeURIComponent(path)}&_t=${Date.now()}`
      );

      // 3. Save to cache
      if (data && !isSftpPathImpl(path)) {
          if (fileContentCache.size >= (state.fileCacheSize || 10)) {
              const firstKey = fileContentCache.keys().next().value;
              fileContentCache.delete(firstKey);
          }
          fileContentCache.set(path, {
              data: data,
              timestamp: Date.now()
          });
      }

      return data;
    } catch (error) {
      showToast(t("toast.load_file_failed", { error: error.message }), "error");
      throw error;
    }
}

/**
 * Opens a file and manages the tab state
 */
export async function openFile(path, forceReload = false, noActivate = false, forceText = false) {
    if (isSftpPathImpl(path)) {
      const { connId, remotePath } = parseSftpPathImpl(path);
      return await openSftpFileImpl(connId, remotePath, noActivate);
    }

    const filename = path.split("/").pop();
    const ext = filename.split(".").pop().toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const isPdf = ext === "pdf";
    const isVideo = VIDEO_EXTENSIONS.has(ext);
    const isAudio = AUDIO_EXTENSIONS.has(ext);
    const isBinary = !forceText && !isTextFile(path);
    let tab = state.openTabs.find((t) => t.path === path);

    // Unknown binary files get a recoverable preview instead of downloading immediately.
    if (!tab && isBinary && !isImage && !isPdf && !isVideo && !isAudio) {
      try {
        const data = await loadFile(path);
        tab = {
          path,
          content: data.content,
          originalContent: data.content,
          mtime: data.mtime,
          modified: false,
          history: null,
          cursor: null,
          scroll: null,
          isBinary: true,
          isImage: false,
          isPdf: false,
          isVideo: false,
          isAudio: false,
          mimeType: data.mime_type || 'application/octet-stream'
        };
        state.openTabs.push(tab);
      } catch (error) {
        showToast(t("toast.open_failed", { file: filename, error: error.message }), "error");
        return;
      }
    }

    if (forceText && tab?.isBinary) {
      try {
        tab.content = atob(tab.content || '');
      } catch (error) {
        showToast(t('toast.text_decode_failed', { file: filename, error: error.message }), 'error');
        return;
      }
      tab.originalContent = tab.content;
      tab.isBinary = false;
      tab.isImage = false;
      tab.isPdf = false;
      tab.isVideo = false;
      tab.isAudio = false;
    }

    // ONE TAB MODE logic
    if (state.onTabMode && !tab) {
      const tabsToClose = state.openTabs.slice();
      for (const t of tabsToClose) {
        if (t.modified && t.content !== undefined && !t.isBinary) {
          try {
            const saved = await saveFile(t.path, t.content, {
              silentToast: true,
              silentOperation: true,
            });
            if (!saved) console.warn("One Tab Mode: could not auto-save", t.path);
          } catch (e) {
            console.warn("One Tab Mode: could not auto-save", t.path, e);
          }
        }
        if (t._blobUrl) URL.revokeObjectURL(t._blobUrl);
      }
      state.openTabs = [];
      state.activeTab = null;
    }

    if (tab && forceReload) {
        if (state.activeTab === tab && state.editor && !tab.isBinary) {
            tab.cursor = state.editor.getCursor();
            tab.scroll = state.editor.getScrollInfo();
        }

        try {
            const data = await loadFile(path);
            tab.content = data.content;
            tab.originalContent = data.content;
            tab.mtime = data.mtime;
            tab.modified = false;
            tab.history = null; 
        } catch (e) {
            console.error("Failed to reload file content", e);
        }
    } else if (!tab) {
      // Video and audio files: skip loadFile entirely — they stream via serve_file URL
      if (isVideo || isAudio) {
        const mimePrefix = isVideo ? "video" : "audio";
        const mimeMap = {
          mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
          avi: "video/x-msvideo", mkv: "video/x-matroska", flv: "video/x-flv",
          wmv: "video/x-ms-wmv", m4v: "video/x-m4v",
          mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
          flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4",
          wma: "audio/x-ms-wma", opus: "audio/opus",
        };
        tab = {
          path,
          content: null,
          originalContent: null,
          mtime: null,
          modified: false,
          history: null,
          cursor: null,
          scroll: null,
          isBinary: true,
          isImage: false,
          isPdf: false,
          isVideo,
          isAudio,
          mimeType: mimeMap[ext] || `${mimePrefix}/${ext}`,
        };
        state.openTabs.push(tab);
      } else {
        try {
          const data = await loadFile(path);
          const content = data.content;

          tab = {
            path,
            content,
            originalContent: content,
            mtime: data.mtime,
            modified: false,
            history: null,
            cursor: null,
            scroll: null,
            isBinary: isBinary,
            isImage: isImage,
            isPdf: isPdf,
            isVideo: false,
            isAudio: false,
            mimeType: data.mime_type
          };
          state.openTabs.push(tab);
        } catch (error) {
          showToast(t("toast.open_failed", { file: filename, error: error.message }), "error");
          return;
        }
      }
    }

    // Update recent files
    if (functions.addToRecentFiles) functions.addToRecentFiles(path);
    eventBus.emit('ui:refresh-recent-files');

    if (noActivate) return tab;

    activateTab(tab, forceReload);
    eventBus.emit('ui:refresh-tabs');
    eventBus.emit('ui:refresh-tree');
    eventBus.emit('ui:update-split-buttons');
    eventBus.emit('settings:save');
}

/**
 * Loads all files from the backend and builds the file tree
 */
export async function loadFiles(force = false) {
    if (isLoadingFiles) {
        console.warn("[FileCoordinator] loadFiles already in progress, ignoring call.");
        return;
    }
    isLoadingFiles = true;
    state.localTreeViewState = { status: "loading", error: "" };
    setFileTreeLoading(true);
    
    try {
      if (elements.btnRefresh) {
          elements.btnRefresh.classList.add("loading");
          elements.btnRefresh.disabled = true;
      }

      // LAZY LOADING: Only load root directory initially
      if (state.lazyLoadingEnabled) {
        // Remember current navigation path to restore it after root load
        const preservedPath = state.currentNavigationPath || "";

        const result = await fetchWithAuth(`${API_BASE}?action=list_directory&path=&show_hidden=${state.showHidden}`);

        if (result.error) {
          throw new Error(result.error);
        }

        // Clear loaded directories cache if forcing refresh
        if (force) {
          state.loadedDirectories.clear();
        }

        // Cache root directory contents
        state.loadedDirectories.set("", {
          folders: result.folders || [],
          files: result.files || []
        });

        // Build initial file tree (just root level)
        state.fileTree = {};
        result.folders.forEach(folder => {
          state.fileTree[folder.name] = {
            _path: folder.path,
            _childCount: folder.childCount || 0
          };
        });
        state.fileTree._files = result.files || [];

        // Store flat lists for backward compatibility
        state.folders = result.folders || [];
        state.files = result.files || [];
        state.allItems = [...result.folders, ...result.files];
        state.localTreeViewState = { status: "ready", error: "" };

        // Initialize navigation if first load
        if (!state.currentNavigationPath && state.currentNavigationPath !== "") {
          state.currentNavigationPath = "";
        }

        // If we preserved a path (force refresh while in subfolder), reload that folder
        if (preservedPath && preservedPath !== "") {
          state.currentNavigationPath = preservedPath;
          try {
            const currentResult = await fetchWithAuth(
              `${API_BASE}?action=list_directory&path=${encodeURIComponent(preservedPath)}&show_hidden=${state.showHidden}`
            );
            if (!currentResult.error) {
              state.loadedDirectories.set(preservedPath, {
                folders: currentResult.folders || [],
                files: currentResult.files || []
              });
            } else {
              console.warn("Failed to reload preserved path:", currentResult.error);
              state.currentNavigationPath = "";
              state.navigationHistory = [];
            }
          } catch (e) {
            console.warn("Failed to reload preserved path:", e);
            state.currentNavigationPath = "";
            state.navigationHistory = [];
          }
        }

        // Restore expanded folders in treeview mode
        if (state.treeCollapsableMode && state.expandedFolders.size > 0) {
          const loadPromises = Array.from(state.expandedFolders).map(path => loadDirectoryImpl(path));
          await Promise.allSettled(loadPromises);
        }

        eventBus.emit('ui:refresh-tree');
        eventBus.emit('ui:refresh-sftp');
        setFileTreeLoading(false);
        setButtonLoading(elements.btnRefresh, false);
        return;
      }

      // FALLBACK: Old behavior (load all recursively)
      const shouldForce = force || state._lastShowHidden !== state.showHidden;
      state._lastShowHidden = state.showHidden;

      const items = await fetchWithAuth(`${API_BASE}?action=list_all&show_hidden=${state.showHidden}&force=${shouldForce}`);
      state.files = items.filter(item => item.type === "file");
      state.folders = items.filter(item => item.type === "folder");
      state.allItems = items;
      state.fileTree = buildFileTreeImpl(items);
      state.localTreeViewState = { status: "ready", error: "" };
      eventBus.emit('ui:refresh-tree');
      eventBus.emit('ui:refresh-sftp');

      setFileTreeLoading(false);
      setButtonLoading(elements.btnRefresh, false);
    } catch (error) {
      setFileTreeLoading(false);
      setButtonLoading(elements.btnRefresh, false);

      // 🛡️ AUTO-RECOVERY: If we get HTTP 500, automatically retry with force=true
      if (error.message && error.message.includes("500") && !force) {
        console.warn("HTTP 500 detected - Attempting auto-recovery...");
        showToast(t("toast.recovering_error"), "warning");
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
          const items = await fetchWithAuth(`${API_BASE}?action=list_all&show_hidden=${state.showHidden}&force=true`);
          state.files = items.filter(item => item.type === "file");
          state.folders = items.filter(item => item.type === "folder");
          state.allItems = items;
          state.fileTree = buildFileTreeImpl(items);
          state.localTreeViewState = { status: "ready", error: "" };
          eventBus.emit('ui:refresh-tree');
          showToast(t("toast.recovered_success"), "success");
          return;
        } catch (retryError) {
          console.error("Auto-recovery failed:", retryError);
          const status = classifyTreeError(retryError);
          state.localTreeViewState = { status, error: retryError.message || String(retryError) };
          eventBus.emit('ui:refresh-tree');
          showToast(t("toast.load_files_failed_retry", { error: retryError.message }), "error");
          return;
        }
      }

      const status = classifyTreeError(error);
      state.localTreeViewState = { status, error: error.message || String(error) };
      eventBus.emit('ui:refresh-tree');
      showToast(t("toast.load_files_failed", { error: error.message }), "error");
    } finally {
        isLoadingFiles = false;
    }
}

// Functions provided via callbacks during initialization to avoid circular dependencies
let functions = {
    saveAllFiles: null,
    toggleFavorite: null,
    validateYaml: null,
    triggerAutoSave: null,
    checkFileUpdates: null,
    addToRecentFiles: null,
    updateToolbarState: null
};

/**
 * Initializes the File Coordinator by registering event listeners
 * @param {Object} callbacks - Implementation functions from app.js
 */
export function initFileCoordinator(callbacks) {
    functions = { ...functions, ...callbacks };

    eventBus.on("ui:reload-files", async (data) => {
        await loadFiles(data?.force || false);
    });

    eventBus.on("file:load", async (data) => {
        return await loadFile(data.path);
    });

    // File Operations
    eventBus.on("file:open", async (data) => {
        return await openFile(data.path, data.forceReload, data.noActivate, data.forceText);
    });

    eventBus.on("file:new", (data) => {
        startInlineExplorerCreate("file", data?.path);
    });

    eventBus.on("folder:new", (data) => {
        startInlineExplorerCreate("folder", data?.path);
    });

    eventBus.on("blueprint:new", (data) => {
        promptNewBlueprintImpl(data?.path);
    });

    eventBus.on("blueprint:convert", async () => {
        if (!state.activeTab || !state.activeTab.content) {
            showToast(t('toast.no_file_to_convert'), "warning");
            return;
        }
        const tab = state.activeTab;

        // Use editor selection if present, otherwise fall back to full file content
        const selection = state.editor?.getSelection();
        const usingSelection = selection && selection.trim().length > 0;
        const content = usingSelection ? selection.trim() : tab.content;

        const originalName = tab.path.split('/').pop().replace(/\.ya?ml$/i, '');

        // Try to derive a name from the selection's alias: line, or fall back to filename
        let blueprintName = originalName.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (usingSelection) {
            const aliasMatch = content.match(/alias:\s*["']?(.+?)["']?\s*$/m);
            if (aliasMatch) blueprintName = aliasMatch[1].trim();
        }

        const slug = blueprintName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'converted';
        const destinationPath = `blueprints/automation/${slug}_blueprint.yaml`;
        await runBlueprintConversion(Object.freeze({
            sourcePath: tab.path,
            sourceKind: usingSelection ? 'Document selection' : 'Document',
            sourceLabel: usingSelection ? 'selection' : originalName,
            destinationPath,
            blueprintName,
            content,
        }));
    });

    eventBus.on("blueprint:use", async () => {
        const tab = state.activeTab;
        if (!tab) {
            showToast(t('toast.no_file_open'), "warning");
            return;
        }
        const { showBlueprintForm } = await import('../blueprint-form.js');
        showBlueprintForm(tab.content);
    });

    eventBus.on("file:prompt-rename", (data) => {
        startInlineExplorerRename(data.path, data.isFolder);
    });

    eventBus.on("file:prompt-move", (data) => {
        promptMoveImpl(data.path, data.isFolder);
    });

    eventBus.on("file:prompt-copy", (data) => {
        promptCopyImpl(data.path, data.isFolder);
    });

    eventBus.on("file:duplicate", (data) => {
        duplicateItemImpl(data.path, data.isFolder);
    });

    eventBus.on("file:prompt-delete", (data) => {
        promptDeleteImpl(data.path, data.isFolder);
    });

    eventBus.on("file:create", (data) => {
        createFileImpl(data.path, data.content, data.noOpen, data.overwrite);
    });

    eventBus.on("folder:create", (data) => {
        createFolderImpl(data.path);
    });

    eventBus.on("file:rename", (data) => {
        renameItemImpl(data.oldPath, data.newPath, data.overwrite);
    });

    eventBus.on("file:copy", (data) => {
        copyItemImpl(data.oldPath, data.newPath, data.overwrite, data.isFolder);
    });

    eventBus.on("file:delete", (data) => {
        deleteItemImpl(data.path, data.isFolder);
    });

    eventBus.on("file:save", async (data) => {
        await saveFile(data.path, data.content);
    });

    eventBus.on("file:save-current", async (data) => {
        await saveCurrentFile(data?.isAutoSave);
    });

    eventBus.on("file:save-all", () => {
        if (functions.saveAllFiles) functions.saveAllFiles();
    });

    eventBus.on("file:validate-yaml", (data) => {
        if (functions.validateYaml) functions.validateYaml(data.content);
    });

    eventBus.on("file:toggle-favorite", (data) => {
        if (functions.toggleFavorite) functions.toggleFavorite(data.path);
    });

    eventBus.on("file:download", (data) => {
        downloadFileByPathUtil(data.path);
    });

    eventBus.on("file:download-content", (data) => {
        downloadContentUtil(data.filename, data.content, data.isBase64, data.mimeType);
    });

    // Tab Operations
    eventBus.on("tab:open", (data) => {
        const { tab, noActivate } = data;
        if (!state.openTabs.find(t => t.path === tab.path)) {
            state.openTabs.push(tab);
        }
        if (!noActivate) {
            activateTab(tab);
            eventBus.emit('ui:refresh-tabs');
            eventBus.emit('ui:refresh-tree');
        }
    });

    eventBus.on("tab:activate", (data) => {
        activateTab(data.tab, data.skipSave || false);
    });

    eventBus.on("tab:close", (data) => {
        closeTab(data, data.force);
    });

    eventBus.on("tab:next", () => {
        nextTabImpl();
    });

    eventBus.on("tab:previous", () => {
        previousTabImpl();
    });

    // Autosave
    eventBus.on("file:trigger-autosave", () => {
        if (functions.triggerAutoSave) functions.triggerAutoSave();
    });

    eventBus.on("file:check-updates", () => {
        if (functions.checkFileUpdates) functions.checkFileUpdates();
    });

    // Selection operations
    eventBus.on("file:delete-selected", () => {
        deleteSelectedItemsImpl();
    });

    eventBus.on("file:download-selected", () => {
        downloadSelectedItemsImpl();
    });

    // Tab bulk operations
    eventBus.on("tab:close-all", () => {
        closeAllTabsImpl();
    });

    eventBus.on("tab:close-others", (data) => {
        const tab = (data && data.tab) ? data.tab : state.activeTab;
        if (tab) closeOtherTabsImpl(tab);
    });

    eventBus.on("tab:close-right", (data) => {
        const tab = (data && data.tab) ? data.tab : state.activeTab;
        if (tab) closeTabsToRightImpl(tab);
    });

    // Upload trigger (from SFTP context menu and context-menu.js)
    eventBus.on("ui:trigger-upload", () => {
        triggerUploadImpl();
    });
}
