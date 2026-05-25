/**
 * GIT-COORDINATOR.JS | Purpose:
 * Coordinates all Git and Gitea related operations and panel updates.
 * This is a "piece" of the decomposed app.js.
 */

import { state, elements } from '../state.js';
import { eventBus } from '../event-bus.js';
import { showModal } from '../ui.js';
import { saveSettings } from '../settings.js';
import { renderFileTree } from '../file-tree.js';
import {
    gitPull as gitPullImpl,
    gitPush as gitPushImpl,
    checkGitStatusIfEnabled as checkGitStatusIfEnabledImpl,
    gitCleanLocks as gitCleanLocksImpl,
    gitStatus as gitStatusImpl,
    gitInit as gitInitImpl,
    abortGitOperation as abortGitOperationImpl,
    forcePush as forcePushImpl,
    hardReset as hardResetImpl,
    showBranchManager as showBranchManagerImpl,
    gitResolveConflict as gitResolveConflictImpl
} from '../git-operations.js';
import {
    giteaStatus as giteaStatusImpl,
    giteaPull as giteaPullImpl,
    giteaPush as giteaPushImpl,
    giteaAbort as giteaAbortImpl,
    giteaForcePush as giteaForcePushImpl,
    giteaHardReset as giteaHardResetImpl,
    giteaCommit as giteaCommitImpl,
    stageSelectedGiteaFiles as stageSelectedGiteaFilesImpl,
    stageAllGiteaFiles as stageAllGiteaFilesImpl,
    unstageAllGiteaFiles as unstageAllGiteaFilesImpl,
    toggleGiteaFileSelection as toggleGiteaFileSelectionImpl
} from '../gitea-integration.js';

// Functions provided via callbacks during initialization to avoid circular dependencies
let functions = {
    showGitHistory: null,
    updateGitPanel: null,
    updateGiteaPanel: null,
    showDiffModal: null,
    toggleGitGroup: null,
    stageSelectedFiles: null,
    stageAllFiles: null,
    unstageAllFiles: null,
    commitStagedFiles: null,
    toggleFileSelection: null,
    showGithubDeviceFlowLogin: null,
    showGitExclusions: null,
    showGitSettings: null,
    showCreateGithubRepoDialog: null,
    showGiteaSettings: null,
    applyVersionControlVisibility: null
};

/**
 * Initializes the Git Coordinator by registering event listeners
 * @param {Object} callbacks - Implementation functions from app.js
 */
export function initGitCoordinator(callbacks) {
    functions = { ...functions, ...callbacks };

    // Git panel event delegation
    const gitFilesContainer = document.getElementById("git-files-container");
    if (gitFilesContainer) {
        gitFilesContainer.addEventListener("click", (e) => {
            // Handle git file group header clicks (toggle collapse)
            const groupHeader = e.target.closest(".git-file-group-header");
            if (groupHeader) {
                const groupElement = groupHeader.closest(".git-file-group");
                if (groupElement) {
                    const groupKey = groupElement.getAttribute("data-group");
                    if (functions.toggleGitGroup) functions.toggleGitGroup(groupKey, 'git');
                }
                return;
            }

            // Handle Diff Button
            const diffBtn = e.target.closest(".btn-git-diff");
            if (diffBtn) {
                const path = diffBtn.dataset.path;
                if (functions.showDiffModal) functions.showDiffModal(path);
                return;
            }

            // Handle Conflict Resolution buttons
            const oursBtn = e.target.closest(".btn-conflict-ours");
            if (oursBtn) {
                gitResolveConflictImpl(oursBtn.dataset.path, "ours").then(() => gitStatusImpl(false, true));
                return;
            }
            const theirsBtn = e.target.closest(".btn-conflict-theirs");
            if (theirsBtn) {
                gitResolveConflictImpl(theirsBtn.dataset.path, "theirs").then(() => gitStatusImpl(false, true));
                return;
            }

            // Handle empty state buttons
            const target = e.target.closest('button');
            if (target) {
                if (target.id === "btn-git-pull-empty-state") {
                    gitPullImpl();
                } else if (target.id === "btn-git-refresh-empty-state") {
                    checkGitStatusIfEnabledImpl(true);
                } else if (target.id === "btn-git-init-panel") {
                    gitInitImpl();
                } else if (target.id === "btn-git-connect-panel") {
                    if (functions.showGitSettings) functions.showGitSettings();
                } else if (target.id === "btn-git-abort") {
                    abortGitOperationImpl();
                } else if (target.id === "btn-abort-git") {
                    abortGitOperationImpl();
                } else if (target.id === "btn-git-force-push") {
                    forcePushImpl();
                } else if (target.id === "btn-git-hard-reset") {
                    hardResetImpl();
                }
                return;
            }

            // Handle file row click (toggle checkbox)
            const fileItem = e.target.closest(".git-file-item");
            if (fileItem && !e.target.classList.contains("git-file-checkbox")) {
                const checkbox = fileItem.querySelector(".git-file-checkbox");
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    const path = checkbox.getAttribute("data-file-path");
                    if (path && functions.toggleFileSelection) {
                        functions.toggleFileSelection(path);
                    }
                }
            }
        });

        // Handle direct checkbox changes for git files (e.g. clicking the checkbox itself)
        gitFilesContainer.addEventListener("change", (e) => {
            if (e.target.classList.contains("git-file-checkbox")) {
                const filePath = e.target.getAttribute("data-file-path");
                if (filePath && functions.toggleFileSelection) {
                    functions.toggleFileSelection(filePath);
                }
            }
        });
    }

    // Gitea panel event delegation
    const giteaFilesContainer = document.getElementById("gitea-files-container");
    if (giteaFilesContainer) {
        giteaFilesContainer.addEventListener("click", (e) => {
            // Handle gitea file group header clicks (toggle collapse)
            const groupHeader = e.target.closest(".git-file-group-header");
            if (groupHeader) {
                const groupElement = groupHeader.closest(".git-file-group");
                if (groupElement) {
                    const groupKey = groupElement.getAttribute("data-group");
                    if (functions.toggleGitGroup) functions.toggleGitGroup(groupKey, 'gitea');
                }
                return;
            }

            // Handle Diff Button
            const diffBtn = e.target.closest(".btn-git-diff");
            if (diffBtn) {
                const path = diffBtn.dataset.path;
                if (functions.showDiffModal) functions.showDiffModal(path);
                return;
            }

            // Handle Conflict Resolution buttons
            const oursBtn = e.target.closest(".btn-conflict-ours");
            if (oursBtn) {
                gitResolveConflictImpl(oursBtn.dataset.path, "ours").then(() => giteaStatusImpl(false, true));
                return;
            }
            const theirsBtn = e.target.closest(".btn-conflict-theirs");
            if (theirsBtn) {
                gitResolveConflictImpl(theirsBtn.dataset.path, "theirs").then(() => giteaStatusImpl(false, true));
                return;
            }

            // Handle empty state buttons
            const target = e.target.closest('button');
            if (target) {
                if (target.id === "btn-gitea-pull-empty-state") {
                    giteaPullImpl();
                } else if (target.id === "btn-gitea-refresh-empty-state") {
                    giteaStatusImpl(true);
                } else if (target.id === "btn-gitea-init-panel") {
                    gitInitImpl();
                } else if (target.id === "btn-gitea-connect-panel") {
                    if (functions.showGiteaSettings) functions.showGiteaSettings();
                } else if (target.id === "btn-gitea-abort") {
                    giteaAbortImpl();
                } else if (target.id === "btn-gitea-force-push") {
                    giteaForcePushImpl();
                } else if (target.id === "btn-gitea-hard-reset") {
                    giteaHardResetImpl();
                }
                return;
            }

            // Handle file row click (toggle checkbox)
            const fileItem = e.target.closest(".git-file-item");
            if (fileItem && !e.target.classList.contains("gitea-file-checkbox")) {
                const checkbox = fileItem.querySelector(".gitea-file-checkbox");
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    const path = checkbox.getAttribute("data-file-path");
                    if (path) {
                        if (functions.toggleFileSelection) functions.toggleFileSelection(path);
                    }
                }
            }
        });

        // Touch start event for tap gestures (needed for mobile)
        gitFilesContainer.addEventListener("touchstart", (e) => {
            // Placeholder for touch logic if needed, previously was in event-handlers.js
        }, { passive: true });
    }

    // Git panel actions delegation (handles dynamically created sync indicator buttons)
    const gitPanel = document.getElementById("git-panel");
    if (gitPanel) {
        gitPanel.addEventListener("click", (e) => {
            const btn = e.target.closest("button");
            if (!btn) return;
            if (btn.id === "btn-git-push-sync") {
                gitPushImpl();
            } else if (btn.id === "btn-git-pull-sync") {
                gitPullImpl();
            }
        });
    }

    // Gitea panel actions delegation (handles dynamically created sync indicator buttons)
    const giteaPanel = document.getElementById("gitea-panel");
    if (giteaPanel) {
        giteaPanel.addEventListener("click", (e) => {
            const btn = e.target.closest("button");
            if (!btn) return;
            if (btn.id === "btn-gitea-push-sync") {
                giteaPushImpl();
            } else if (btn.id === "btn-gitea-pull-sync") {
                giteaPullImpl();
            }
        });
    }

    // Git toolbar buttons
    if (elements.btnGitStatus) {
        elements.btnGitStatus.addEventListener("click", () => gitStatusImpl(true));
    }
    if (elements.btnGitHistory) {
        elements.btnGitHistory.addEventListener("click", () => {
            if (functions.showGitHistory) functions.showGitHistory();
        });
    }
    if (elements.btnGitPull) {
        elements.btnGitPull.addEventListener("click", () => gitPullImpl());
    }
    if (elements.btnGitPush) {
        elements.btnGitPush.addEventListener("click", () => gitPushImpl());
    }
    if (elements.btnGitSettings) {
        elements.btnGitSettings.addEventListener("click", () => {
            if (functions.showGitSettings) functions.showGitSettings();
        });
    }
    if (elements.btnGitRefresh) {
        elements.btnGitRefresh.addEventListener("click", () => gitStatusImpl(true));
    }
    const btnGitBranches = document.getElementById("btn-git-branches");
    if (btnGitBranches) {
        btnGitBranches.addEventListener("click", () => showBranchManagerImpl());
    }
    if (elements.btnGitHelp) {
        elements.btnGitHelp.addEventListener("click", () => {
            showModal({
                title: "Git Quick Help",
                message: `
                    <div style="line-height: 1.8; font-size: 13px;">
                        <p><b>Stage</b> — Select which changed files to include in your next commit.</p>
                        <p><b>Commit</b> — Save staged changes as a local checkpoint with a message.</p>
                        <p><b>Push</b> — Upload your commits to the remote repository (GitHub).</p>
                        <p><b>Pull</b> — Download the latest changes from the remote repository.</p>
                        <p><b>Diff</b> — Click the diff icon on any file to see what changed.</p>
                        <p style="margin-top: 12px; color: var(--text-secondary); font-size: 12px;">
                            Tip: Use Git Settings (gear icon) to configure your repository and authentication.
                        </p>
                    </div>`,
                confirmText: "Got it",
                cancelText: null
            });
        });
    }
    if (elements.btnGitCollapse) {
        elements.btnGitCollapse.addEventListener("click", () => {
            state.gitPanelCollapsed = !state.gitPanelCollapsed;
            if (functions.updateGitPanel) functions.updateGitPanel();
            saveSettings();
        });
    }

    // Git panel action buttons
    if (elements.btnStageSelected) {
        elements.btnStageSelected.addEventListener("click", () => {
            if (functions.stageSelectedFiles) functions.stageSelectedFiles();
        });
    }
    if (elements.btnStageAll) {
        elements.btnStageAll.addEventListener("click", () => {
            if (functions.stageAllFiles) functions.stageAllFiles();
        });
    }
    if (elements.btnUnstageAll) {
        elements.btnUnstageAll.addEventListener("click", () => {
            if (functions.unstageAllFiles) functions.unstageAllFiles();
        });
    }
    if (elements.btnCommitStaged) {
        elements.btnCommitStaged.addEventListener("click", () => {
            if (functions.commitStagedFiles) functions.commitStagedFiles();
        });
    }

    // Gitea toolbar buttons
    if (elements.btnGiteaStatus) {
        elements.btnGiteaStatus.addEventListener("click", () => giteaStatusImpl(true));
    }
    if (elements.btnGiteaHistory) {
        elements.btnGiteaHistory.addEventListener("click", () => {
            if (functions.showGitHistory) functions.showGitHistory();
        });
    }
    if (elements.btnGiteaPull) {
        elements.btnGiteaPull.addEventListener("click", () => giteaPullImpl());
    }
    if (elements.btnGiteaPush) {
        elements.btnGiteaPush.addEventListener("click", () => giteaPushImpl());
    }
    if (elements.btnGiteaSettings) {
        elements.btnGiteaSettings.addEventListener("click", () => {
            if (functions.showGiteaSettings) functions.showGiteaSettings();
        });
    }
    if (elements.btnGiteaRefresh) {
        elements.btnGiteaRefresh.addEventListener("click", () => giteaStatusImpl(true));
    }
    const btnGiteaBranches = document.getElementById("btn-gitea-branches");
    if (btnGiteaBranches) {
        btnGiteaBranches.addEventListener("click", () => showBranchManagerImpl());
    }
    if (elements.btnGiteaHelp) {
        elements.btnGiteaHelp.addEventListener("click", () => {
            showModal({
                title: "Gitea Quick Help",
                message: `
                    <div style="line-height: 1.8; font-size: 13px;">
                        <p><b>Stage</b> — Select which changed files to include in your next commit.</p>
                        <p><b>Commit</b> — Save staged changes as a local checkpoint with a message.</p>
                        <p><b>Push</b> — Upload your commits to the Gitea server.</p>
                        <p><b>Pull</b> — Download the latest changes from Gitea.</p>
                        <p><b>Diff</b> — Click the diff icon on any file to see what changed.</p>
                        <p style="margin-top: 12px; color: var(--text-secondary); font-size: 12px;">
                            Tip: Use Gitea Settings (tea icon) to configure your Gitea server and credentials.
                        </p>
                    </div>`,
                confirmText: "Got it",
                cancelText: null
            });
        });
    }
    if (elements.btnGiteaCollapse) {
        elements.btnGiteaCollapse.addEventListener("click", () => {
            state.giteaPanelCollapsed = !state.giteaPanelCollapsed;
            if (functions.updateGiteaPanel) functions.updateGiteaPanel();
            saveSettings();
        });
    }

    // Gitea panel action buttons
    if (elements.btnGiteaStageSelected) {
        elements.btnGiteaStageSelected.addEventListener("click", () => stageSelectedGiteaFilesImpl());
    }
    if (elements.btnGiteaStageAll) {
        elements.btnGiteaStageAll.addEventListener("click", () => stageAllGiteaFilesImpl());
    }
    if (elements.btnGiteaUnstageAll) {
        elements.btnGiteaUnstageAll.addEventListener("click", () => unstageAllGiteaFilesImpl());
    }
    if (elements.btnGiteaCommitStaged) {
        elements.btnGiteaCommitStaged.addEventListener("click", () => giteaCommitImpl());
    }

    // Gitea panel delegation for checkboxes
    if (giteaFilesContainer) {
        giteaFilesContainer.addEventListener("change", (e) => {
            if (e.target.classList.contains("gitea-file-checkbox")) {
                const filePath = e.target.getAttribute("data-file-path");
                if (filePath) {
                    toggleGiteaFileSelectionImpl(filePath);
                }
            }
        });
    }

    // Git Operations
    eventBus.on("git:push", () => {
        gitPushImpl();
    });

    eventBus.on("git:pull", () => {
        gitPullImpl();
    });

    eventBus.on("git:show-history", () => {
        if (functions.showGitHistory) functions.showGitHistory();
    });

    eventBus.on("git:show-diff", (data) => {
        if (functions.showDiffModal) functions.showDiffModal(data.path);
    });

    eventBus.on("git:toggle-group", (data) => {
        if (functions.toggleGitGroup) functions.toggleGitGroup(data.groupKey, data.type);
    });

    eventBus.on("git:stage-selected", () => {
        if (functions.stageSelectedFiles) functions.stageSelectedFiles();
    });

    eventBus.on("git:stage-all", () => {
        if (functions.stageAllFiles) functions.stageAllFiles();
    });

    eventBus.on("git:unstage-all", () => {
        if (functions.unstageAllFiles) functions.unstageAllFiles();
    });

    eventBus.on("git:commit-staged", () => {
        if (functions.commitStagedFiles) functions.commitStagedFiles();
    });

    eventBus.on("git:toggle-selection", (data) => {
        if (functions.toggleFileSelection) functions.toggleFileSelection(data.path);
    });

    eventBus.on("git:clean-locks", () => {
        gitCleanLocksImpl();
    });

    eventBus.on("git:login-github", async () => {
        if (functions.showGithubDeviceFlowLogin) return await functions.showGithubDeviceFlowLogin();
    });

    eventBus.on("git:show-exclusions", () => {
        if (functions.showGitExclusions) functions.showGitExclusions();
    });

    eventBus.on("git:show-settings", () => {
        if (functions.showGitSettings) functions.showGitSettings();
    });

    eventBus.on("git:show-create-repo", () => {
        if (functions.showCreateGithubRepoDialog) functions.showCreateGithubRepoDialog();
    });

    eventBus.on("git:show-gitea-settings", () => {
        if (functions.showGiteaSettings) functions.showGiteaSettings();
    });

    eventBus.on('git:status-check', (data) => {
        checkGitStatusIfEnabledImpl(data?.fetch || false, data?.silent || false);
    });

    eventBus.on('gitea:status-check', (data) => {
        giteaStatusImpl(data?.fetch || false, data?.silent || false);
    });

    eventBus.on('git:apply-visibility', () => {
        if (functions.applyVersionControlVisibility) functions.applyVersionControlVisibility();
    });

    // UI Updates
    eventBus.on("git:refresh", () => {
        if (functions.updateGitPanel) functions.updateGitPanel();
        if (functions.updateGiteaPanel) functions.updateGiteaPanel();
        renderFileTree();
    });

    // Toggle git panel collapse via keyboard shortcut (Ctrl+Shift+G)
    eventBus.on("git:toggle-panel", () => {
        state.gitPanelCollapsed = !state.gitPanelCollapsed;
        if (functions.updateGitPanel) functions.updateGitPanel();
        saveSettings();
    });
}
