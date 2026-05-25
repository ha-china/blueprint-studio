/**
 * UI-COORDINATOR.JS | Purpose:
 * Coordinates general UI refreshes, file tree updates, and modal/sidebar visibility.
 * This is a "piece" of the decomposed app.js.
 */

import { state, elements } from '../state.js';
import { eventBus } from '../event-bus.js';
import { triggerUpload, triggerFolderUpload, downloadFolder, downloadFileByPath, handleFileUpload, handleFolderUpload } from '../downloads-uploads.js';
import { setThemePreset } from '../ui.js';
import { saveSettings, updateShowHiddenButton } from '../settings.js';
import { renderFileTree, debouncedRenderFileTree, cancelPendingSearch } from '../file-tree.js';
import { updateSearchHighlights, updateMatchStatus, doReplace, doReplaceAll, doFind, openSearchWidget } from '../search.js';
import { downloadCurrentFile } from '../downloads-uploads.js';
import { updateToolbarState } from '../toolbar.js';
import { copyToClipboard as copyToClipboardUtil, getTruePath as getTruePath, enableLongPressContextMenu } from '../utils.js';

import { validateByFileType } from '../file-operations.js';
import { showModal } from '../ui.js';
import { t } from '../translations.js';

import { performGlobalSearch, performGlobalReplace, triggerGlobalSearch, initGlobalSearchWindowFunctions } from '../global-search.js';
import { toggleMarkdownPreview, renderAssetPreview, cleanupMarkdownPreview, handleMarkdownChange } from '../asset-preview.js';
import { toggleTerminal } from '../terminal.js';
import { toggleAISidebar, sendAIChatMessage, updateAIVisibility } from '../ai-ui.js';

import { updateBreadcrumb, expandFolderInTree } from '../breadcrumb.js';
import { showUserGuide } from '../user-guide.js';
// Removed redundant import: import { renderAssetPreview } from '../asset-preview.js';

/**
 * Helper function to escape HTML
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Helper function to format validation results
 */
function formatValidationResults(items, isWarnings) {
    if (!items || items.length === 0) {
        return '<div style="color: gray;">No issues found</div>';
    }

    const htmlItems = items.map((item, idx) => {
        const severity = isWarnings ? 'ℹ️' : '❌';
        const lineInfo = item.line ? `Line ${item.line}${item.column ? `, Col ${item.column}` : ''}` : '';
        const typeLabel = item.type ? `[${item.type}]` : '';

        let html = `
          <div style="margin-bottom: 15px; padding: 10px; background: var(--bg-tertiary); border-left: 3px solid ${isWarnings ? '#FFA500' : '#FF6B6B'}; border-radius: 4px;">
            <div style="font-weight: bold; margin-bottom: 5px;">
              ${severity} ${item.message}
            </div>
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">
              ${lineInfo} ${typeLabel}
            </div>
        `;

        if (item.solution) {
            html += `<div style="margin-bottom: 5px;"><strong>Fix:</strong> ${escapeHtml(item.solution)}</div>`;
        }

        if (item.example) {
            html += `<div style="background: var(--bg-secondary); padding: 5px; border-radius: 3px; font-family: monospace; font-size: 0.8em; margin-top: 5px;"><strong>Example:</strong> ${escapeHtml(item.example)}</div>`;
        }

        html += '</div>';
        return html;
    }).join('');

    return `<div style="max-height: 400px; overflow-y: auto;">${htmlItems}</div>`;
}

/**
 * Performs validation on the active tab's content
 */
async function performValidation() {
    if (state.activeTab) {
        const fileName = state.activeTab.path.split('/').pop();
        const fileExt = fileName.match(/\\.(\\w+)$/i)?.[1]?.toLowerCase() || 'unknown';
        const result = await validateByFileType(fileName, state.activeTab.content);

        // Map extensions to display labels
        const fileTypeLabel = {
            'yaml': 'YAML',
            'yml': 'YAML',
            'json': 'JSON',
            'py': 'Python',
            'js': 'JavaScript'
        }[fileExt] || t("common.file") || 'File';

        if (result.valid) {
            if (functions.showToast) functions.showToast(t("toast.file_is_valid", { type: fileTypeLabel }), "success");

            // Show warnings if any (even though valid)
            if (result.warnings && result.warnings.length > 0) {
                if (functions.showToast) {
                    functions.showToast(
                        t("toast.best_practice_found", { count: result.warning_count }),
                        "info",
                        5000,
                        {
                            text: t("toast.view"),
                            callback: async () => {
                                const warningHtml = formatValidationResults(result.warnings, true);
                                await showModal({
                                    title: t("modal.best_practices_title", { type: fileTypeLabel }),
                                    message: warningHtml,
                                    confirmText: t("modal.ok"),
                                    isDanger: false
                                });
                            }
                        }
                    );
                }
            }
        } else {
            const errorToastMsg = result.error_count
                ? t("toast.validation_errors_count", { type: fileTypeLabel, count: result.error_count })
                : t("toast.validation_error_generic", { type: fileTypeLabel });

            if (functions.showToast) {
                functions.showToast(errorToastMsg, "error", 0, {
                    text: t("toast.view_details"),
                    callback: async () => {
                        // Create formatted error display
                        const errorHtml = formatValidationResults(result.errors || [], false);
                        const fallbackHtml = result.error
                            ? `<div style="color: red;">${escapeHtml(result.error)}</div>`
                            : errorHtml;

                        await showModal({
                            title: t("modal.validation_errors_title", { type: fileTypeLabel }),
                            message: fallbackHtml,
                            confirmText: t("modal.ok"),
                            isDanger: true
                        });
                    }
                });
            }
        }
    } else {
        if (functions.showToast) functions.showToast(t("toast.no_file_open"), "warning");
    }
}

// Functions provided via callbacks during initialization
let functions = {
    renderRecentFilesPanel: null,
    renderFileTree: null,
    renderTabs: null,
    updateShowHiddenButton: null,
    showToast: null,
    showGitExclusions: null,
    resetModalToDefault: null,
    hideModal: null,
    handleSelectionChange: null,
    renderSftpPanel: null,
    navigateSftp: null,
    triggerFolderUpload: null,
    toggleSelectionMode: null,
    processUploads: null,
    insertUUID: null,
    toggleSidebar: null,
    hideSidebar: null,
    showContextMenu: null,
    showTabContextMenu: null,
    hideContextMenu: null,
    renderFavoritesPanel: null,
    setActivePaneFromPosition: null,
    handleTabDragStart: null,
    handleTabDragOver: null,
    handleTabDrop: null,
    handleTabDragEnd: null,
    openSearchWidget: null,
    closeSearchWidget: null,
    updateStatusBar: null,
    updatePaneActiveState: null,
    createSecondaryEditor: null,
    destroySecondaryEditor: null,
    moveToPrimaryPane: null,
    moveToSecondaryPane: null,
    updateSplitViewButtons: null,
    navigateBack: null,
    showAppSettings: null,
    debouncedContentSearch: null,
    debouncedFilenameSearch: null,
    performGlobalSearch: null,
    performGlobalReplace: null,
    triggerGlobalSearch: null,
    toggleMarkdownPreview: null,
    toggleTerminal: null,
    toggleAISidebar: null,
    sendAIChatMessage: null,
    updateAIVisibility: null,
    formatCode: null,
    handleDragStart: null,
    handleDragOver: null,
    handleDragLeave: null,
    handleDrop: null
};

/**
 * Initializes the UI Coordinator by registering event listeners
 * @param {Object} callbacks - Implementation functions from app.js
 */
export function initUICoordinator(callbacks) {
    functions = { ...functions, ...callbacks };

    // Initialize global search window functions (legacy onclick support)
    initGlobalSearchWindowFunctions();

    eventBus.on("tab:activated", async (data) => {
        updateBreadcrumb(data.tab.path);

        // Ensure asset preview container is updated if needed
        const previewContainer = (state.splitView?.activePane === 'secondary') ?
            document.getElementById('secondary-asset-preview') :
            elements.assetPreview;
            
        if (data.tab.isBinary && previewContainer) {
            await renderAssetPreview(data.tab, previewContainer);
        }
        
        // Handle Markdown Preview state when switching tabs
        if (data.tab.path.endsWith(".md") && elements.btnMarkdownPreview?.classList.contains("active")) {
            // Re-attach listener to editors
            if (state.primaryEditor) state.primaryEditor.on("change", handleMarkdownChange);
            if (state.secondaryEditor) state.secondaryEditor.on("change", handleMarkdownChange);
            if (state.editor && !state.splitView.enabled) state.editor.on("change", handleMarkdownChange);
            
            // Initial render
            handleMarkdownChange();
        } else if (!data.tab.path.endsWith(".md")) {
            // Reset markdown preview state for non-markdown tabs
            cleanupMarkdownPreview();
        }
    });

    eventBus.on("ui:refresh-visibility", () => {
        if (functions.updateAIVisibility) functions.updateAIVisibility();
    });

    eventBus.on("ui:switch-sidebar-view", (data) => {
        if (functions.switchSidebarView) {
            functions.switchSidebarView(typeof data === 'string' ? data : data.view);
        }
    });

    // Refresh Handlers
    eventBus.on("ui:refresh-recent-files", () => {
        if (functions.renderRecentFilesPanel) functions.renderRecentFilesPanel();
    });

    eventBus.on("ui:refresh-tree", () => {
        if (functions.renderFileTree) functions.renderFileTree();
    });

    eventBus.on("ui:refresh-tabs", () => {
        if (functions.renderTabs) functions.renderTabs();
    });

    eventBus.on("ui:show-toast", (data) => {
        if (functions.showToast) {
            functions.showToast(data.message, data.type, data.duration, data.action);
        }
    });

    eventBus.on("ui:refresh-hidden-button", () => {
        if (functions.updateShowHiddenButton) functions.updateShowHiddenButton();
    });

    // Sidebar & Navigation
    eventBus.on("ui:toggle-sidebar", () => {
        if (functions.toggleSidebar) functions.toggleSidebar();
    });

    eventBus.on("ui:hide-sidebar", () => {
        if (functions.hideSidebar) functions.hideSidebar();
    });

    eventBus.on("ui:refresh-favorites", () => {
        if (functions.renderFavoritesPanel) functions.renderFavoritesPanel();
    });

    // Modals & Overlays
    eventBus.on("ui:modal-reset", () => {
        if (functions.resetModalToDefault) functions.resetModalToDefault();
    });

    eventBus.on("ui:modal-hide", () => {
        if (functions.hideModal) functions.hideModal();
    });

    eventBus.on("ui:show-git-exclusions", () => {
        if (functions.showGitExclusions) functions.showGitExclusions();
    });

    // Selection & Bulk Actions
    eventBus.on('ui:selection-change', (data) => {
        if (functions.handleSelectionChange) functions.handleSelectionChange(data.path, data.checked);
        if (functions.renderFileTree) functions.renderFileTree();
        if (functions.renderSftpPanel) functions.renderSftpPanel();
        if (functions.renderFavoritesPanel) functions.renderFavoritesPanel();
    });

    eventBus.on('ui:toggle-selection', () => {
        if (functions.toggleSelectionMode) functions.toggleSelectionMode();
    });

    // Upload Operations
    eventBus.on("ui:trigger-folder-upload", () => {
        if (functions.triggerFolderUpload) functions.triggerFolderUpload();
    });

    eventBus.on('ui:process-uploads', (data) => {
        if (functions.processUploads) functions.processUploads(data.files, data.target);
    });

    // Editor Helpers
    eventBus.on("editor:insert-uuid", () => {
        if (functions.insertUUID) functions.insertUUID();
    });

    eventBus.on("search:open", (data) => {
        if (functions.openSearchWidget) functions.openSearchWidget(data?.replace);
    });

    eventBus.on("search:close", () => {
        if (functions.closeSearchWidget) functions.closeSearchWidget();
    });

    eventBus.on("ui:update-status-bar", () => {
        if (functions.updateStatusBar) functions.updateStatusBar();
    });

    eventBus.on("ui:insert-uuid", () => {
        if (functions.insertUUID) functions.insertUUID();
    });

    eventBus.on("editor:toggle-comment", () => {
        const activeEditor = state.splitView?.activePane === 'secondary' ? state.secondaryEditor : state.primaryEditor;
        if (activeEditor) {
            activeEditor.execCommand("toggleComment");
        }
    });

    eventBus.on("ui:update-toolbar-state", () => {
        updateToolbarState();
    });

    eventBus.on("ui:refresh-sftp", () => {
        eventBus.emit('sftp:refresh');
    });

    // Tab & Pane Operations
    eventBus.on("tab:context-menu", (data) => {
        if (functions.showTabContextMenu) {
            functions.showTabContextMenu(data.x, data.y, data.tab, data.tabIndex);
        }
    });

    eventBus.on("file:context-menu", (data) => {
        if (functions.showContextMenu) {
            functions.showContextMenu(data.x, data.y, { path: data.path, isFolder: data.isFolder });
        }
    });

    eventBus.on("ui:set-active-pane", (data) => {
        if (functions.setActivePaneFromPosition) {
            functions.setActivePaneFromPosition(data.pane);
        }
    });

    eventBus.on("editor:update-pane-active-state", () => {
        if (functions.updatePaneActiveState) functions.updatePaneActiveState();
    });

    eventBus.on("editor:create-secondary", () => {
        if (functions.createSecondaryEditor) functions.createSecondaryEditor();
    });

    eventBus.on("editor:destroy-secondary", () => {
        if (functions.destroySecondaryEditor) functions.destroySecondaryEditor();
    });

    eventBus.on("ui:move-to-primary-pane", (data) => {
        if (functions.moveToPrimaryPane) functions.moveToPrimaryPane(data.tabIndex);
    });

    eventBus.on("ui:move-to-secondary-pane", (data) => {
        if (functions.moveToSecondaryPane) functions.moveToSecondaryPane(data.tabIndex);
    });

    eventBus.on("ui:update-split-buttons", () => {
        if (functions.updateSplitViewButtons) functions.updateSplitViewButtons();
    });

    eventBus.on("ui:navigate-back", () => {
        if (functions.navigateBack) functions.navigateBack();
    });

    // Search Operations
    eventBus.on("search:content-debounced", () => {
        if (functions.debouncedContentSearch) functions.debouncedContentSearch();
    });

    eventBus.on("search:filename-debounced", () => {
        if (functions.debouncedFilenameSearch) functions.debouncedFilenameSearch();
    });

    eventBus.on("search:global", (data) => {
        if (functions.performGlobalSearch) {
            functions.performGlobalSearch(data.query, data.options);
        }
    });

    eventBus.on("search:replace-all", () => {
        if (functions.performGlobalReplace) functions.performGlobalReplace();
    });

    // Sidebar & AI
    eventBus.on("ui:toggle-markdown-preview", (data) => {
        if (functions.toggleMarkdownPreview) {
            // Check if data is a boolean or an object with forceState
            const forceState = typeof data === 'boolean' ? data : (data && typeof data.forceState !== 'undefined' ? data.forceState : null);
            functions.toggleMarkdownPreview(forceState);
        }
    });

    eventBus.on("ui:toggle-ai-sidebar", () => {
        if (functions.toggleAISidebar) {
            functions.toggleAISidebar();
        } else {            console.warn("[UICoordinator] toggleAISidebar implementation not registered");
        }
    });

    eventBus.on("ai:send-message", () => {
        if (functions.sendAIChatMessage) functions.sendAIChatMessage();
    });

    // File Actions
    eventBus.on("file:format", () => {
        if (functions.formatCode) functions.formatCode();
    });

    // Tab Drag & Drop
    eventBus.on("tab:drag-start", (e) => {
        if (functions.handleTabDragStart) functions.handleTabDragStart(e);
    });

    eventBus.on("tab:drag-over", (e) => {
        if (functions.handleTabDragOver) functions.handleTabDragOver(e);
    });

    eventBus.on("tab:drop", (e) => {
        if (functions.handleTabDrop) functions.handleTabDrop(e);
    });

    eventBus.on("tab:drag-end", (e) => {
        if (functions.handleTabDragEnd) functions.handleTabDragEnd(e);
    });

    // File Tree Drag & Drop
    eventBus.on("file:drag-start", (e) => {
        if (functions.handleDragStart) functions.handleDragStart(e);
    });

    eventBus.on("file:drag-over", (e) => {
        if (functions.handleDragOver) functions.handleDragOver(e);
    });

    eventBus.on("file:drag-leave", (e) => {
        if (functions.handleDragLeave) functions.handleDragLeave(e);
    });

    eventBus.on("file:drop", (e) => {
        if (functions.handleDrop) functions.handleDrop(e);
    });

    // Welcome screen actions
    if (elements.btnWelcomeNewFile) {
        elements.btnWelcomeNewFile.addEventListener("click", () => {
            eventBus.emit('file:new');
        });
    }
    if (elements.btnWelcomeUploadFile) {
        elements.btnWelcomeUploadFile.addEventListener("click", triggerUpload);
    }

    // Theme toggle
    if (elements.themeToggle) {
        elements.themeToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            elements.themeMenu.classList.toggle("visible");
        });
        // Also handle touchstart so the theme menu opens immediately on mobile.
        // On glass theme, the backdrop-filter composited layer on the status bar
        // can delay or swallow the synthetic click event on iOS Safari — the same
        // issue that was fixed for sidebarOverlay. preventDefault() here prevents
        // a ghost click from firing after the touch and immediately re-closing the
        // menu that was just opened.
        elements.themeToggle.addEventListener("touchstart", (e) => {
            e.preventDefault();
            e.stopPropagation();
            elements.themeMenu.classList.toggle("visible");
        }, { passive: false });
    }

    // Main toolbar buttons
    if (elements.btnMenu) {
        elements.btnMenu.addEventListener("click", () => {
            if (functions.toggleSidebar) functions.toggleSidebar();
        });
    }

    if (elements.btnCloseSidebar) {
        elements.btnCloseSidebar.addEventListener("click", () => {
            if (functions.hideSidebar) functions.hideSidebar();
        });
    }

    if (elements.sidebarOverlay) {
        elements.sidebarOverlay.addEventListener("click", () => {
            if (functions.hideSidebar) functions.hideSidebar();
        });
        // Also handle touchstart so the overlay closes the sidebar immediately on
        // mobile without waiting for the synthetic click event. This is needed on
        // glass theme where the sidebar's heavily composited backdrop-filter layer
        // can delay or swallow the click event on iOS Safari.
        elements.sidebarOverlay.addEventListener("touchstart", (e) => {
            e.preventDefault(); // prevent ghost click
            if (functions.hideSidebar) functions.hideSidebar();
        }, { passive: false });
    }

    // Sidebar activity bar
    if (elements.activityExplorer) {
        elements.activityExplorer.addEventListener("click", () => {
            if (functions.switchSidebarView) functions.switchSidebarView("explorer");
        });
    }

    if (elements.activitySearch) {
        elements.activitySearch.addEventListener("click", () => {
            if (functions.switchSidebarView) functions.switchSidebarView("search");
        });
    }

    if (elements.activitySftp) {
        elements.activitySftp.addEventListener("click", () => {
            if (functions.switchSidebarView) functions.switchSidebarView("sftp");
        });
    }

    if (elements.btnFileTreeCollapse) {
        elements.btnFileTreeCollapse.addEventListener("click", () => {
            state.fileTreeCollapsed = !state.fileTreeCollapsed;
            
            const fileTree = document.getElementById("file-tree");
            
            if (state.fileTreeCollapsed) {
                if (fileTree) fileTree.style.display = "none";
                const icon = elements.btnFileTreeCollapse.querySelector(".material-icons");
                if (icon) icon.textContent = "expand_more";
                elements.btnFileTreeCollapse.title = "Expand file tree";
            } else {
                if (fileTree) fileTree.style.display = "block";
                const icon = elements.btnFileTreeCollapse.querySelector(".material-icons");
                if (icon) icon.textContent = "expand_less";
                elements.btnFileTreeCollapse.title = "Collapse file tree";
            }
            
            eventBus.emit('settings:save');
        });
    }

    // Folder Navigation: Back button
    const btnNavBack = document.getElementById("btn-nav-back");
    if (btnNavBack) {
        btnNavBack.addEventListener("click", () => {
            eventBus.emit('ui:navigate-back');
        });
    }

    if (elements.btnCollapseAllFolders) {
        elements.btnCollapseAllFolders.addEventListener("click", () => {
            if (state.activeSidebarView === "sftp") {
                state.activeSftp.expandedFolders.clear();
                // If in navigation mode and not at root, navigate back to root
                if (!state.treeCollapsableMode && state.activeSftp.currentPath !== "/" && state.activeSftp.connectionId) {
                    if (functions.navigateSftp) functions.navigateSftp("/");
                } else if (functions.renderSftpPanel) {
                    functions.renderSftpPanel();
                }
            } else {
                state.expandedFolders.clear();
                if (functions.renderFileTree) functions.renderFileTree();
            }
            saveSettings();
        });
    }

    if (elements.btnOneTabMode) {
        elements.btnOneTabMode.addEventListener("click", () => {
            state.onTabMode = !state.onTabMode;
            elements.btnOneTabMode.classList.toggle("active", state.onTabMode);
            elements.btnOneTabMode.title = state.onTabMode
                ? "One Tab Mode: ON — only last opened file is kept (click to disable)"
                : "One Tab Mode: OFF — click to enable (auto-saves & closes other tabs on open)";
            saveSettings();
            eventBus.emit('ui:update-toolbar-state');
            renderFileTree();
            eventBus.emit('ui:refresh-tabs');
        });
        // Restore visual state on init
        elements.btnOneTabMode.classList.toggle("active", !!state.onTabMode);
    }

    if (elements.btnSave) {
        elements.btnSave.addEventListener("click", () => {
            eventBus.emit('file:save-current');
        });
    }

    if (elements.btnSaveAll) {
        elements.btnSaveAll.addEventListener("click", () => {
            eventBus.emit('file:save-all');
        });
    }

    if (elements.btnUndo) {
        elements.btnUndo.addEventListener("click", () => {
            const activeEditor = state.splitView?.activePane === 'secondary' ? state.secondaryEditor : state.primaryEditor;
            if (activeEditor) {
                activeEditor.undo();
                updateToolbarState();
            }
        });
    }

    if (elements.btnRedo) {
        elements.btnRedo.addEventListener("click", () => {
            const activeEditor = state.splitView?.activePane === 'secondary' ? state.secondaryEditor : state.primaryEditor;
            if (activeEditor) {
                activeEditor.redo();
                updateToolbarState();
            }
        });
    }

    if (elements.btnFormat) {
        elements.btnFormat.addEventListener("click", () => {
            eventBus.emit('file:format');
        });
    }

    if (elements.btnSearch) {
        elements.btnSearch.addEventListener("click", () => {
            openSearchWidget();
        });
    }

    if (elements.btnRefresh) {
        elements.btnRefresh.addEventListener("click", () => {
            eventBus.emit('ui:reload-files', { force: true });
        });
    }

    if (elements.btnDonate) {
        elements.btnDonate.addEventListener("click", () => {
            if (elements.modalDonationOverlay) elements.modalDonationOverlay.classList.add("visible");
        });
    }

    if (elements.btnCloseDonation) {
        elements.btnCloseDonation.addEventListener("click", () => {
            if (elements.modalDonationOverlay) elements.modalDonationOverlay.classList.remove("visible");
        });
    }

    if (elements.modalDonationOverlay) {
        elements.modalDonationOverlay.addEventListener("click", (e) => {
            if (e.target === elements.modalDonationOverlay) {
                elements.modalDonationOverlay.classList.remove("visible");
            }
        });

        elements.modalDonationOverlay.querySelectorAll(".donation-copy-btn").forEach((button) => {
            button.addEventListener("click", async () => {
                const value = button.dataset.copyValue;
                if (!value) return;

                const copied = await copyToClipboardUtil(value);
                if (copied) {
                    if (functions.showToast) functions.showToast("Donation address copied", "success", 1800);
                    const icon = button.querySelector(".material-icons");
                    if (icon) {
                        icon.textContent = "check";
                        window.setTimeout(() => {
                            icon.textContent = "content_copy";
                        }, 1600);
                    }
                } else if (functions.showToast) {
                    functions.showToast("Could not copy donation address", "error");
                }
            });
        });
    }

    // Support Modal
    if (elements.btnSupport) {
        elements.btnSupport.addEventListener("click", () => {
            if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.add("visible");
        });
    }

    if (elements.btnCloseSupport) {
        elements.btnCloseSupport.addEventListener("click", () => {
            if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.remove("visible");
        });
    }

    if (elements.btnSupportGuide) {
        elements.btnSupportGuide.addEventListener("click", () => {
            if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.remove("visible");
            showUserGuide();
        });
    }

    if (elements.btnSupportShortcuts) {
        elements.btnSupportShortcuts.addEventListener("click", () => {
            if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.remove("visible");
            eventBus.emit('ui:show-shortcuts');
        });
    }

    if (elements.btnSupportFeature) {
        elements.btnSupportFeature.addEventListener("click", () => {
            if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.remove("visible");
            eventBus.emit('ui:request-feature');
        });
    }

    if (elements.btnSupportIssue) {
        elements.btnSupportIssue.addEventListener("click", () => {
            if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.remove("visible");
            eventBus.emit('ui:report-issue');
        });
    }

    if (elements.shortcutsClose) {
        elements.shortcutsClose.addEventListener("click", () => {
            eventBus.emit('ui:hide-shortcuts');
        });
    }

    if (elements.btnGithubStar) {
        elements.btnGithubStar.addEventListener("click", async (e) => {
            const isGitEnabled = localStorage.getItem("gitIntegrationEnabled") !== "false";
            if (isGitEnabled) {
                e.preventDefault();
                try {
                    const res = await fetchWithAuth(API_BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "github_star" }) });
                    if (res.success) {
                        if (functions.showToast) functions.showToast(t("toast.github_star_success"), "success");
                        if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.remove("visible");
                    } else {
                        window.open(elements.btnGithubStar.href, '_blank');
                    }
                } catch (err) { window.open(elements.btnGithubStar.href, '_blank'); }
            }
        });
    }

    if (elements.btnGithubFollow) {
        elements.btnGithubFollow.addEventListener("click", async (e) => {
            const isGitEnabled = localStorage.getItem("gitIntegrationEnabled") !== "false";
            if (isGitEnabled) {
                e.preventDefault();
                try {
                    const res = await fetchWithAuth(API_BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "github_follow" }) });
                    if (res.success) {
                        if (functions.showToast) functions.showToast(t("toast.github_follow_success"), "success");
                        if (elements.modalSupportOverlay) elements.modalSupportOverlay.classList.remove("visible");
                    } else {
                        window.open(elements.btnGithubFollow.href, '_blank');
                    }
                } catch (err) { window.open(elements.btnGithubFollow.href, '_blank'); }
            }
        });
    }

    if (elements.modalSupportOverlay) {
        elements.modalSupportOverlay.addEventListener("click", (e) => {
            if (e.target === elements.modalSupportOverlay) {
                elements.modalSupportOverlay.classList.remove("visible");
            }
        });
    }

    if (elements.btnToggleSelect) {
        elements.btnToggleSelect.addEventListener("click", () => {
            if (functions.toggleSelectionMode) functions.toggleSelectionMode();
        });
    }

    if (elements.btnCancelSelection) {
        elements.btnCancelSelection.addEventListener("click", () => {
            if (functions.toggleSelectionMode) functions.toggleSelectionMode();
        });
    }

    if (elements.btnDeleteSelected) {
        elements.btnDeleteSelected.addEventListener("click", () => {
            eventBus.emit('file:delete-selected');
        });
    }

    if (elements.btnDownloadSelected) {
        elements.btnDownloadSelected.addEventListener("click", () => {
            eventBus.emit('file:download-selected');
        });
    }

    if (elements.btnNewFile) {
        elements.btnNewFile.addEventListener("click", () => {
            eventBus.emit('file:new');
        });
    }

    if (elements.btnNewFolder) {
        elements.btnNewFolder.addEventListener("click", () => {
            eventBus.emit('folder:new');
        });
    }

    if (elements.btnUpload) {
        elements.btnUpload.addEventListener("click", triggerUpload);
    }

    // Wire file input change handlers — these process files after the OS picker closes
    if (elements.fileUploadInput) {
        elements.fileUploadInput.addEventListener("change", handleFileUpload);
    }
    if (elements.folderUploadInput) {
        elements.folderUploadInput.addEventListener("change", handleFolderUpload);
    }

    if (elements.btnDownload) {
        elements.btnDownload.addEventListener("click", downloadCurrentFile);
    }

    if (elements.btnUploadFolder) {
        elements.btnUploadFolder.addEventListener("click", triggerFolderUpload);
    }

    if (elements.btnDownloadFolder) {
        elements.btnDownloadFolder.addEventListener("click", () => {
            const folder = state.treeCollapsableMode ? state.currentFolderPath : state.currentNavigationPath;
            downloadFolder(folder || "");
        });
    }

    if (elements.btnRestartHa) {
        elements.btnRestartHa.addEventListener("click", () => {
            eventBus.emit('ha:restart');
        });
    }

    if (elements.btnDevTools) {
        elements.btnDevTools.addEventListener("click", () => {
            eventBus.emit('ha:dev-tools');
        });
    }

    if (elements.btnAppSettings) {
        elements.btnAppSettings.addEventListener("click", () => {
            eventBus.emit('ui:show-settings');
        });
    }

    if (elements.btnValidate) {
        elements.btnValidate.addEventListener("click", performValidation);
    }

    eventBus.on('file:validate', performValidation);

    // "Use Blueprint" toolbar button
    const btnUseBlueprint = document.getElementById('btn-use-blueprint');
    if (btnUseBlueprint) {
        btnUseBlueprint.addEventListener('click', () => eventBus.emit('blueprint:use'));
    }

    if (elements.btnMarkdownPreview) {
        elements.btnMarkdownPreview.addEventListener("click", () => {
            eventBus.emit('ui:toggle-markdown-preview');
        });
    }

    // Split view buttons
    const btnSplitVertical = document.getElementById("btn-split-vertical");
    if (btnSplitVertical) {
        btnSplitVertical.addEventListener("click", () => {
            eventBus.emit('ui:toggle-split-view');
        });
    }

    const btnSplitClose = document.getElementById("btn-split-close");
    if (btnSplitClose) {
        btnSplitClose.addEventListener("click", () => {
            eventBus.emit('ui:toggle-split-view');
        });
    }

    // Terminal & AI Sidebar buttons
    if (elements.btnTerminal) {
        elements.btnTerminal.addEventListener("click", () => {
            eventBus.emit('terminal:toggle');
        });
    }

    if (elements.btnAiStudio) {
        elements.btnAiStudio.addEventListener("click", () => {
            eventBus.emit('ui:toggle-ai-sidebar');
        });
    }

    if (elements.btnCloseAI) {
        elements.btnCloseAI.addEventListener("click", () => {
            eventBus.emit('ui:toggle-ai-sidebar');
        });
    }

    if (elements.btnAiSend) {
        elements.btnAiSend.addEventListener("click", () => {
            eventBus.emit('ai:send-message');
        });
    }
    if (elements.searchClose) {
        elements.searchClose.addEventListener("click", () => {
            eventBus.emit('search:close');
        });
    }

    if (elements.secondarySearchClose) {
        elements.secondarySearchClose.addEventListener("click", () => {
            eventBus.emit('search:close');
        });
    }

    // Search Toggle Replace
    if (elements.searchToggle) {
        elements.searchToggle.addEventListener("click", () => {
            const isReplace = !elements.searchWidget.classList.contains("replace-mode");
            functions.openSearchWidget(isReplace);
        });
    }

    if (elements.secondarySearchToggle) {
        elements.secondarySearchToggle.addEventListener("click", () => {
            const isReplace = !elements.secondarySearchWidget.classList.contains("replace-mode");
            functions.openSearchWidget(isReplace);
        });
    }

    // Search Operations
    if (elements.searchNext) elements.searchNext.addEventListener("click", () => doFind(false));
    if (elements.searchPrev) elements.searchPrev.addEventListener("click", () => doFind(true));
    if (elements.searchReplaceBtn) elements.searchReplaceBtn.addEventListener("click", () => doReplace());
    if (elements.searchReplaceAllBtn) elements.searchReplaceAllBtn.addEventListener("click", () => doReplaceAll());

    if (elements.secondarySearchNext) elements.secondarySearchNext.addEventListener("click", () => doFind(false));
    if (elements.secondarySearchPrev) elements.secondarySearchPrev.addEventListener("click", () => doFind(true));
    if (elements.secondarySearchReplaceBtn) elements.secondarySearchReplaceBtn.addEventListener("click", () => doReplace());
    if (elements.secondarySearchReplaceAllBtn) elements.secondarySearchReplaceAllBtn.addEventListener("click", () => doReplaceAll());

    // AI Chat Input - Keydown
    if (elements.aiChatInput) {
    elements.aiChatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            eventBus.emit('ai:send-message');
        }
    });
}

// Global Search UI Listeners
if (elements.globalSearchInput) {
    let debounceTimer;
    elements.globalSearchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (functions.triggerGlobalSearch) functions.triggerGlobalSearch();
        }, 500);
    });
}

if (elements.globalSearchInclude) {
    elements.globalSearchInclude.addEventListener("input", () => {
        if (state._patternTimer) clearTimeout(state._patternTimer);
        state._patternTimer = setTimeout(() => {
            if (functions.triggerGlobalSearch) functions.triggerGlobalSearch();
        }, 800);
    });
}

if (elements.globalSearchExclude) {
    elements.globalSearchExclude.addEventListener("input", () => {
        if (state._patternTimer) clearTimeout(state._patternTimer);
        state._patternTimer = setTimeout(() => {
            if (functions.triggerGlobalSearch) functions.triggerGlobalSearch();
        }, 800);
    });
}

['btnMatchCase', 'btnMatchWord', 'btnUseRegex'].forEach(id => {
    const btn = elements[id];
    if (btn) {
        btn.addEventListener("click", () => {
            btn.classList.toggle("active");
            if (functions.triggerGlobalSearch) functions.triggerGlobalSearch();
        });
    }
});

if (elements.btnToggleReplaceAll) {
    elements.btnToggleReplaceAll.addEventListener("click", () => {
        const isVisible = elements.globalReplaceContainer.style.display === "flex";
        elements.globalReplaceContainer.style.display = isVisible ? "none" : "flex";
        elements.btnToggleReplaceAll.classList.toggle("rotated", !isVisible);
    });
}

if (elements.btnTogglePatterns) {
    elements.btnTogglePatterns.addEventListener("click", () => {
        const isVisible = elements.globalPatternsContainer.style.display === "flex";
        elements.globalPatternsContainer.style.display = isVisible ? "none" : "flex";
    });
}

if (elements.btnGlobalReplaceAll) {
    elements.btnGlobalReplaceAll.addEventListener("click", () => {
        eventBus.emit('search:replace-all');
    });
}

const btnRefreshSearch = document.getElementById('btn-refresh-search');
if (btnRefreshSearch) {
    btnRefreshSearch.addEventListener('click', () => {
        if (functions.triggerGlobalSearch) functions.triggerGlobalSearch();
    });
}

const btnCollapseSearch = document.getElementById('btn-collapse-search');
if (btnCollapseSearch) {
    btnCollapseSearch.addEventListener('click', () => {
        if (!elements.globalSearchResults) return;
        const lists = elements.globalSearchResults.querySelectorAll('.search-result-list');
        const arrows = elements.globalSearchResults.querySelectorAll('.search-result-file-header .arrow');
        const icon = btnCollapseSearch.querySelector('.material-icons');
        const isCollapsing = icon && icon.textContent.trim() === 'unfold_less';
        if (isCollapsing) {
            lists.forEach(list => list.classList.add('hidden'));
            arrows.forEach(arrow => arrow.classList.remove('rotated'));
            if (icon) icon.textContent = 'unfold_more';
            btnCollapseSearch.title = t("search.expand_all") || 'Expand All';
        } else {
            lists.forEach(list => list.classList.remove('hidden'));
            arrows.forEach(arrow => arrow.classList.add('rotated'));
            if (icon) icon.textContent = 'unfold_less';
            btnCollapseSearch.title = t("search.collapse_all");
        }
    });
}

// Search Mode Tabs
document.querySelectorAll('.search-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabs = document.querySelectorAll('.search-mode-tab');
        tabs.forEach(t => {
            t.classList.remove('active');
            t.style.background = 'transparent';
            t.style.color = 'var(--text-secondary)';
        });
        tab.classList.add('active');
        tab.style.background = 'var(--bg-tertiary)';
        tab.style.color = 'var(--accent-color)';

        if (functions.triggerGlobalSearch) functions.triggerGlobalSearch();
    });
});

// Breadcrumb copy button
if (elements.breadcrumbCopy) {
    elements.breadcrumbCopy.addEventListener("click", async () => {
        const rawPath = state.activeTab?.path;
        if (rawPath) {
            const path = getTruePath(state.activeTab.path); // Use imported getTruePath
            const success = await copyToClipboardUtil(path); // Use imported copyToClipboardUtil
            if (success) {
                // Visual feedback
                elements.breadcrumbCopy.classList.add("copied");
                const icon = elements.breadcrumbCopy.querySelector(".material-icons");
                if (icon) {
                    const originalIcon = icon.textContent;
                    icon.textContent = "check";
                    setTimeout(() => {
                        icon.textContent = originalIcon;
                        elements.breadcrumbCopy.classList.remove("copied");
                    }, 2000);
                }
                if (functions.showToast) functions.showToast(t("toast.path_copied"), "success");
            } else {
                if (functions.showToast) functions.showToast(t("toast.path_copy_fail"), "error");
            }
        } else {
            if (functions.showToast) functions.showToast(t("toast.no_file_open"), "warning");
        }
    });
}

    // Theme menu items
    document.querySelectorAll(".theme-menu-item").forEach(item => {
        const handleThemeSelect = (e) => {
            e.preventDefault(); // Prevent ghost clicks on touch
            e.stopPropagation();
            const theme = item.dataset.theme;
            setThemePreset(theme);
            elements.themeMenu.classList.remove("visible");
        };

        item.addEventListener("click", handleThemeSelect);
        item.addEventListener("touchend", handleThemeSelect);
    });

    // Close theme menu on outside click/touch
    document.addEventListener("click", () => {
        if (elements.themeMenu) {
            elements.themeMenu.classList.remove("visible");
        }
    });
    // touchstart counterpart — closes the menu when tapping outside on mobile
    // (document-level, does NOT call preventDefault so normal page interaction is preserved)
    document.addEventListener("touchstart", (e) => {
        if (elements.themeMenu && elements.themeMenu.classList.contains("visible")) {
            if (!elements.themeToggle.contains(e.target) && !elements.themeMenu.contains(e.target)) {
                elements.themeMenu.classList.remove("visible");
            }
        }
    });

    // File Context menu items
    if (elements.contextMenu) {
        elements.contextMenu.querySelectorAll(".context-menu-item").forEach(item => {
            item.addEventListener("click", async () => {
                const action = item.dataset.action;
                const target = state.contextMenuTarget;

                if (!target) {
                    if (functions.hideContextMenu) functions.hideContextMenu();
                    return;
                }

                switch (action) {
                    case "new_file":
                        {
                            if (functions.hideContextMenu) functions.hideContextMenu();
                            const targetPath = target.isFolder ? target.path : target.path.split("/").slice(0, -1).join("/");
                            if (state.treeCollapsableMode) {
                                state.currentFolderPath = targetPath;
                            } else {
                                state.currentNavigationPath = targetPath;
                            }
                            document.querySelectorAll(".tree-item.active").forEach(el => el.classList.remove("active"));
                            eventBus.emit('file:new', { path: targetPath });
                        }
                        break;
                    case "new_folder":
                        {
                            if (functions.hideContextMenu) functions.hideContextMenu();
                            const targetPath = target.isFolder ? target.path : target.path.split("/").slice(0, -1).join("/");
                            if (state.treeCollapsableMode) {
                                state.currentFolderPath = targetPath;
                            } else {
                                state.currentNavigationPath = targetPath;
                            }
                            document.querySelectorAll(".tree-item.active").forEach(el => el.classList.remove("active"));
                            eventBus.emit('folder:new', { path: targetPath });
                        }
                        break;
                    case "new_blueprint":
                        {
                            if (functions.hideContextMenu) functions.hideContextMenu();
                            const targetPath = target.isFolder ? target.path : target.path.split("/").slice(0, -1).join("/");
                            if (state.treeCollapsableMode) {
                                state.currentFolderPath = targetPath;
                            } else {
                                state.currentNavigationPath = targetPath;
                            }
                            document.querySelectorAll(".tree-item.active").forEach(el => el.classList.remove("active"));
                            eventBus.emit('blueprint:new', { path: targetPath });
                        }
                        break;
                    case "upload":
                        {
                            const targetPath = target.isFolder ? target.path : target.path.split("/").slice(0, -1).join("/");
                            state._nextUploadTarget = targetPath;
                            if (functions.hideContextMenu) functions.hideContextMenu();
                            // Small timeout ensures the context menu is dismissed and browser allows the click
                            setTimeout(() => {
                                triggerUpload();
                            }, 10);
                        }
                        break;
                    case "upload_folder":
                        {
                            const targetPath = target.isFolder ? target.path : target.path.split("/").slice(0, -1).join("/");
                            state._nextFolderUploadTarget = targetPath;
                            if (functions.hideContextMenu) functions.hideContextMenu();
                            setTimeout(() => {
                                triggerFolderUpload();
                            }, 10);
                        }
                        break;
                    case "run_in_terminal":
                        {
                            if (functions.hideContextMenu) functions.hideContextMenu();
                            if (state.terminalIntegrationEnabled) {
                                let cmd = "";
                                if (target.isFolder) {
                                    cmd = `ls -la "${target.path}"`;
                                } else {
                                    const ext = target.path.split('.').pop().toLowerCase();
                                    if (ext === 'py') {
                                        cmd = `python3 "${target.path}"`;
                                    } else {
                                        cmd = `cat "${target.path}"`;
                                    }
                                }
                                eventBus.emit('terminal:run', { cmd });
                            }
                        }
                        break;
                    case "rename":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        eventBus.emit('file:prompt-rename', { path: target.path, isFolder: target.isFolder });
                        break;
                    case "move":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        eventBus.emit('file:prompt-move', { path: target.path, isFolder: target.isFolder });
                        break;
                    case "copy":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        eventBus.emit('file:prompt-copy', { path: target.path, isFolder: target.isFolder });
                        break;
                    case "duplicate":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        eventBus.emit('file:duplicate', { path: target.path, isFolder: target.isFolder });
                        break;
                    case "download":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        if (target.isFolder) {
                            await downloadFolder(target.path);
                        } else {
                            await downloadFileByPath(target.path);
                        }
                        break;
                    case "delete":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        eventBus.emit('file:prompt-delete', { path: target.path, isFolder: target.isFolder });
                        break;
                    case "copy_path":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        copyToClipboardUtil(target.path);
                        break;
                    case "pin_favorite":
                        if (functions.hideContextMenu) functions.hideContextMenu();
                        eventBus.emit('file:toggle-favorite', { path: target.path });
                        break;
                    default:
                        if (functions.hideContextMenu) functions.hideContextMenu();
                }
            });
        });
    }

    // Tab Context Menu Items
    if (elements.tabContextMenu) {
        elements.tabContextMenu.querySelectorAll(".context-menu-item").forEach(item => {
            item.addEventListener("click", () => {
                const action = item.dataset.action;
                const tab = state.tabContextMenuTarget;

                if (!tab) {
                    if (functions.hideContextMenu) functions.hideContextMenu();
                    return;
                }

                switch (action) {
                    case "close":
                        eventBus.emit('tab:close', { tab });
                        break;
                    case "close_others":
                        eventBus.emit('tab:close-others', { tab });
                        break;
                    case "close_all":
                        eventBus.emit('tab:close-all');
                        break;
                    case "close_right":
                        eventBus.emit('tab:close-right', { tab });
                        break;
                    case "download":
                        downloadFileByPath(tab.path);
                        break;
                    case "copy_path":
                        navigator.clipboard.writeText(tab.path);
                        if (functions.showToast) functions.showToast("Path copied to clipboard", "success", 1500);
                        break;
                    case "move_to_left":
                        if (typeof state.tabContextMenuTargetIndex === 'number') {
                            eventBus.emit('ui:move-to-primary-pane', { tabIndex: state.tabContextMenuTargetIndex });
                        }
                        break;
                    case "move_to_right":
                        if (typeof state.tabContextMenuTargetIndex === 'number') {
                            eventBus.emit('ui:move-to-secondary-pane', { tabIndex: state.tabContextMenuTargetIndex });
                        }
                        break;
                    case "open_to_right":
                    case "open_below":
                        if (typeof state.tabContextMenuTargetIndex === 'number') {
                            if (!state.splitView.enabled) {
                                eventBus.emit('ui:toggle-split-view');
                            }
                            // Give a tiny moment for split view to initialize
                            setTimeout(() => {
                                eventBus.emit('ui:move-to-secondary-pane', { tabIndex: state.tabContextMenuTargetIndex });
                            }, 10);
                        }
                        break;
                }
                if (functions.hideContextMenu) functions.hideContextMenu();
            });
        });
    }

    // File Tree Drag & Drop (Root)
    if (elements.fileTree) {
        // Drop on empty space in the file tree (not on a specific item)
        elements.fileTree.addEventListener("dragover", (e) => {
            // Only handle if not already on a tree item (items have their own handler)
            if (e.target.closest('.tree-item')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            elements.fileTree.classList.add("drag-over-root");
        });

        elements.fileTree.addEventListener("dragleave", (e) => {
            // Only clear if leaving the fileTree itself, not entering a child
            if (!elements.fileTree.contains(e.relatedTarget)) {
                elements.fileTree.classList.remove("drag-over-root");
            }
        });

        elements.fileTree.addEventListener("drop", (e) => {
            // Only handle if not on a tree item (items have their own handler)
            if (e.target.closest('.tree-item')) return;
            e.preventDefault();
            e.stopPropagation();
            elements.fileTree.classList.remove("drag-over-root");

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                // Upload to the current navigation folder
                const targetFolder = state.lazyLoadingEnabled
                    ? (state.currentNavigationPath || "")
                    : (state.currentFolderPath || "");
                eventBus.emit('ui:process-uploads', { files: e.dataTransfer.files, target: targetFolder });
            }
        });

        // Background click handler to deselect items/folders
        elements.fileTree.addEventListener("click", (e) => {
            // Only if clicking the background (not a tree item)
            if (e.target === elements.fileTree) {
                state.currentFolderPath = null;
                document.querySelectorAll(".tree-item.active").forEach(el => el.classList.remove("active"));
            }
        });

        // Background context menu - attached to viewExplorer to catch clicks in empty space below the tree
        if (elements.viewExplorer) {
            elements.viewExplorer.addEventListener("contextmenu", (e) => {
                // Ignore clicks inside other specific panels
                if (e.target.closest('#favorites-panel') ||
                    e.target.closest('#recent-files-panel') ||
                    e.target.closest('#git-panel') ||
                    e.target.closest('#gitea-panel')) {
                    return;
                }                
                // Ignore if clicking a tree item (it has its own handler)
                if (e.target.closest('.tree-item')) return;

                // Don't show if file tree is explicitly collapsed
                if (state.fileTreeCollapsed) return;

                e.preventDefault();
                e.stopPropagation();
                
                const currentPath = state.treeCollapsableMode
                    ? (state.currentFolderPath || "")
                    : (state.currentNavigationPath || "");
                
                eventBus.emit('file:context-menu', { 
                    x: e.clientX, 
                    y: e.clientY, 
                    path: currentPath, 
                    isFolder: true,
                    isRoot: true
                });
            });
        }
    }

    // Search Panel Handlers
    if (elements.searchFindInput) {
        elements.searchFindInput.addEventListener("input", (e) => {
            const query = e.target.value;
            updateSearchHighlights(query);
            updateMatchStatus(query);
        });

        elements.searchFindInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                if (e.shiftKey) {
                    doFind(true); // Reverse
                } else {
                    doFind(false); // Forward
                }
            }
        });
    }

    if (elements.searchReplaceInput) {
        elements.searchReplaceInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                doReplace();
            }
        });
    }

    if (elements.btnSearchFindNext) {
        elements.btnSearchFindNext.addEventListener("click", () => doFind(false));
    }

    if (elements.btnSearchFindPrev) {
        elements.btnSearchFindPrev.addEventListener("click", () => doFind(true));
    }

    if (elements.btnSearchReplace) {
        elements.btnSearchReplace.addEventListener("click", () => doReplace());
    }

    if (elements.btnSearchReplaceAll) {
        elements.btnSearchReplaceAll.addEventListener("click", () => doReplaceAll());
    }

    if (elements.btnSearchClose) {
        elements.btnSearchClose.addEventListener("click", () => {
            eventBus.emit('search:close');
        });
    }

    // Search options toggles
    if (elements.searchCaseSensitiveBtn) {
        elements.searchCaseSensitiveBtn.addEventListener("click", () => {
            state.searchCaseSensitive = !state.searchCaseSensitive;
            elements.searchCaseSensitiveBtn.classList.toggle("active", state.searchCaseSensitive);
            const query = elements.searchFindInput.value;
            if (query) { updateSearchHighlights(query); updateMatchStatus(query); }
        });
    }

    if (elements.searchWholeWordBtn) {
        elements.searchWholeWordBtn.addEventListener("click", () => {
            state.searchWholeWord = !state.searchWholeWord;
            elements.searchWholeWordBtn.classList.toggle("active", state.searchWholeWord);
            const query = elements.searchFindInput.value;
            if (query) { updateSearchHighlights(query); updateMatchStatus(query); }
        });
    }

    if (elements.searchUseRegexBtn) {
        elements.searchUseRegexBtn.addEventListener("click", () => {
            state.searchUseRegex = !state.searchUseRegex;
            elements.searchUseRegexBtn.classList.toggle("active", state.searchUseRegex);
            const query = elements.searchFindInput.value;
            if (query) { updateSearchHighlights(query); updateMatchStatus(query); }
        });
    }

    // Secondary Search Panel Handlers (split-view right pane)
    if (elements.secondarySearchFindInput) {
        elements.secondarySearchFindInput.addEventListener("input", (e) => {
            const query = e.target.value;
            updateSearchHighlights(query);
            updateMatchStatus(query);
        });

        elements.secondarySearchFindInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                doFind(e.shiftKey);
            }
        });
    }

    if (elements.secondarySearchReplaceInput) {
        elements.secondarySearchReplaceInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                doReplace();
            }
        });
    }

    if (elements.secondarySearchNext) {
        elements.secondarySearchNext.addEventListener("click", () => doFind(false));
    }

    if (elements.secondarySearchPrev) {
        elements.secondarySearchPrev.addEventListener("click", () => doFind(true));
    }

    if (elements.secondarySearchReplaceBtn) {
        elements.secondarySearchReplaceBtn.addEventListener("click", () => doReplace());
    }

    if (elements.secondarySearchReplaceAllBtn) {
        elements.secondarySearchReplaceAllBtn.addEventListener("click", () => doReplaceAll());
    }

    if (elements.secondarySearchClose) {
        elements.secondarySearchClose.addEventListener("click", () => {
            eventBus.emit('search:close');
        });
    }

    if (elements.secondarySearchCaseSensitiveBtn) {
        elements.secondarySearchCaseSensitiveBtn.addEventListener("click", () => {
            state.searchCaseSensitive = !state.searchCaseSensitive;
            elements.secondarySearchCaseSensitiveBtn.classList.toggle("active", state.searchCaseSensitive);
            if (elements.searchCaseSensitiveBtn) elements.searchCaseSensitiveBtn.classList.toggle("active", state.searchCaseSensitive);
            const query = elements.secondarySearchFindInput.value;
            if (query) { updateSearchHighlights(query); updateMatchStatus(query); }
        });
    }

    if (elements.secondarySearchWholeWordBtn) {
        elements.secondarySearchWholeWordBtn.addEventListener("click", () => {
            state.searchWholeWord = !state.searchWholeWord;
            elements.secondarySearchWholeWordBtn.classList.toggle("active", state.searchWholeWord);
            if (elements.searchWholeWordBtn) elements.searchWholeWordBtn.classList.toggle("active", state.searchWholeWord);
            const query = elements.secondarySearchFindInput.value;
            if (query) { updateSearchHighlights(query); updateMatchStatus(query); }
        });
    }

    if (elements.secondarySearchUseRegexBtn) {
        elements.secondarySearchUseRegexBtn.addEventListener("click", () => {
            state.searchUseRegex = !state.searchUseRegex;
            elements.secondarySearchUseRegexBtn.classList.toggle("active", state.searchUseRegex);
            if (elements.searchUseRegexBtn) elements.searchUseRegexBtn.classList.toggle("active", state.searchUseRegex);
            const query = elements.secondarySearchFindInput.value;
            if (query) { updateSearchHighlights(query); updateMatchStatus(query); }
        });
    }

    // Show/Hide hidden folders toggle
    if (elements.btnShowHidden) {
        elements.btnShowHidden.addEventListener("click", () => {
            state.showHidden = !state.showHidden;
            saveSettings();
            updateShowHiddenButton();
            eventBus.emit('ui:reload-files', { force: true });
        });
    }

    // File search
    if (elements.fileSearch) {
        elements.fileSearch.addEventListener("input", (e) => {
            state.searchQuery = e.target.value;

            // If cleared, immediately reset to folder navigation view
            if (!state.searchQuery.trim()) {
                cancelPendingSearch(); // Cancel any in-flight debounced search
                state.contentSearchResults = null;
                renderFileTree();
                return;
            }

            // In lazy loading mode, always use recursive search
            if (state.lazyLoadingEnabled) {
                if (state.contentSearchEnabled) {
                    // Search file content across all files
                    eventBus.emit('search:content-debounced');
                } else {
                    // Search filenames across all files
                    eventBus.emit('search:filename-debounced');
                }
            } else {
                // Old tree mode - use local filtering
                if (state.contentSearchEnabled) {
                    eventBus.emit('search:content-debounced');
                } else {
                    debouncedRenderFileTree();
                }
            }
        });
    }

    // Content Search Toggle
    if (elements.btnContentSearch) {
        // Update UI to match current state (from settings)
        if (state.contentSearchEnabled) {
            elements.btnContentSearch.style.background = "var(--accent-color)";
            elements.btnContentSearch.style.color = "white";
            elements.btnContentSearch.style.borderColor = "var(--accent-color)";
            elements.fileSearch.placeholder = "Search all files...";
        }

        elements.btnContentSearch.addEventListener("click", () => {
            state.contentSearchEnabled = !state.contentSearchEnabled;

            // UI Toggle
            if (state.contentSearchEnabled) {
                elements.btnContentSearch.style.background = "var(--accent-color)";
                elements.btnContentSearch.style.color = "white";
                elements.btnContentSearch.style.borderColor = "var(--accent-color)";
                elements.fileSearch.placeholder = "Search all files...";
                // Re-run search with content mode
                if (state.searchQuery) {
                    eventBus.emit('search:content-debounced');
                }
            } else {
                elements.btnContentSearch.style.background = "var(--bg-tertiary)";
                elements.btnContentSearch.style.color = "var(--text-secondary)";
                elements.btnContentSearch.style.borderColor = "var(--border-color)";
                elements.fileSearch.placeholder = "Search all files...";
                // Re-run search with filename mode (or clear if lazy loading disabled)
                if (state.searchQuery) {
                    if (state.lazyLoadingEnabled) {
                        eventBus.emit('search:filename-debounced');
                    } else {
                        state.contentSearchResults = null;
                        renderFileTree();
                    }
                } else {
                    state.contentSearchResults = null;
                    renderFileTree();
                }
            }
        });
    }
}
