/** INITIALIZATION.JS | Purpose: * Handles complete application initialization including DOM element caching, */

import { API_BASE } from './constants.js';
import { eventBus } from './event-bus.js';

import {
  fetchWithAuth,
  initWebSocketSubscription
} from './api.js';

import {
  loadEntities,
  loadServices,
  defineHAYamlMode,
  defineCSVMode,
  defineShowWhitespaceMode
} from './ha-autocomplete.js';

import {
  state,
  elements,
  gitState,
  giteaState
} from './state.js';

import {
  initElements,
  showToast,
  hideGlobalLoading,
  showModal,
  applyTheme,
  applyCustomSyntaxColors,
  applyLayoutSettings,
  applyEditorSettings,
  resetModalToDefault,
  showConfirmDialog,
  hideModal
} from './ui.js';

import {
  isMobile
} from './utils.js';

import { t, initTranslations, refreshAllUIStrings } from './translations.js';


import {
  renderFavoritesPanel,
  toggleFavorite
} from './favorites.js';

import {
  renderRecentFilesPanel,
  addToRecentFiles
} from './recent-files.js';

import {
  initResizeHandle
} from './resize.js';

import {
  initStatusBarEvents
} from './status-bar.js';

import {
  autoSaveTimer,
  triggerAutoSave,
  clearAutoSaveTimer,
  saveAllFiles
} from './autosave.js';

import {
  checkFileUpdates,
  startGitStatusPolling
} from './polling.js';

import {
  triggerUpload
} from './downloads-uploads.js';

import {
  isSftpPath,
  parseSftpPath,
  uploadSftpFile,
  refreshSftp
} from './sftp.js';

import {
  loadSettings,
  saveSettings,
  updateShowHiddenButton
} from './settings.js';

import {
  showAppSettings
} from './settings-ui.js';

import {
  toggleSelectionMode,
  handleSelectionChange
} from './selection.js';

import {
} from './file-operations.js';

import {
  navigateBack,
  navigateToFolder
} from "./file-tree.js";

import {
  isGitEnabled,
  checkGitStatusIfEnabled,
  gitStatus,
  gitInit,
  gitGetRemotes,
  gitSetCredentials
} from "./git-operations.js";

import {
  gitAddRemote,
  saveGitRemote,
  saveGitCredentials,
  testGitConnection,
  githubCreateRepo
} from "./github-integration.js";

import {
  giteaStatus,
  giteaCreateRepo
} from "./gitea-integration.js";

import {
  updateSplitViewButtons
} from './split-view.js';
import { initAiDiffListener, enqueueAiDiff } from './git-diff.js';
import { initializeEventHandlers } from './coordinators/index.js';
import { 
  isTextFile, 
  copyToClipboard 
} from './utils.js';
import { updateToolbarState } from './toolbar.js';
import { updateStatusBar } from './status-bar.js';

let isInitializing = false;

/**
 * Main initialization function
 * Initializes the entire Blueprint Studio application
 */
export async function init() {
  if (isInitializing) {
    console.warn("[Init] Already initializing, ignoring second call.");
    return;
  }
  isInitializing = true;
  
  try {
    initElements();

    // Initialize coordinator event handlers (must happen after initElements)
    initializeEventHandlers();

    // Register custom CodeMirror modes
    defineHAYamlMode();
    defineCSVMode();
    defineShowWhitespaceMode();

    await loadSettings();
    await initTranslations(state.language);
    
    // Initial application of settings via events
    eventBus.emit('settings:loaded');
    eventBus.emit('ui:refresh-strings');
    eventBus.emit('ui:refresh-visibility');
    eventBus.emit('ui:refresh-layout');


    // Auto-reload settings when user comes back to the app
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        try {
          await loadSettings();
          eventBus.emit('settings:loaded');
          eventBus.emit('ui:refresh-visibility');
        } catch (err) {
          console.error('[Settings] Failed to reload settings:', err);
        }
      }
    });


    eventBus.emit('ui:refresh-sftp'); // Re-render with loaded connections

    // Load actual files into tree
    await Promise.all(eventBus.emit('ui:reload-files', { force: true }));

    try {
      const raw = localStorage.getItem('blueprint_studio_pending_ai_edit');
      console.log('[BPS-init] localStorage check:', raw ? 'FOUND' : 'empty');
      if (raw) {
        localStorage.removeItem('blueprint_studio_pending_ai_edit');
        const data = JSON.parse(raw);
        console.log('[BPS-init] consuming localStorage:', data.action, data.path);
        if (data.action === 'navigate' && data.path) {
          const { revealAndOpenFile } = await import('./file-nav-helper.js');
          revealAndOpenFile(data.path, 'tool').catch((e) => console.warn('[BPS-init] navigate error', e));
        } else if (data.path) {
          enqueueAiDiff({
            path: data.path,
            oldContent: data.old_content || "",
            newContent: data.new_content || "",
          });
        }
      }
    } catch (err) {
      console.warn("[BPS-init] Failed to consume pending AI edit", err);
    }

    window.addEventListener('storage', async (event) => {
      if (event.key === 'blueprint_studio_pending_ai_edit' && event.newValue) {
        console.log('[BPS-storage] storage event fired:', event.newValue.substring(0, 100));
        try {
          localStorage.removeItem('blueprint_studio_pending_ai_edit');
          const data = JSON.parse(event.newValue);
          console.log('[BPS-storage] processing:', data.action, data.path);
          if (data.action === 'navigate' && data.path) {
            const { revealAndOpenFile } = await import('./file-nav-helper.js');
            revealAndOpenFile(data.path, 'tool').catch((e) => console.warn('[BPS-storage] navigate error', e));
          } else if (data.path) {
            enqueueAiDiff({
              path: data.path,
              oldContent: data.old_content || "",
              newContent: data.new_content || "",
            });
          }
        } catch (e) {
          console.warn('[BPS-storage] error', e);
        }
      }
    });

    // Non-blocking git status — don't hold up page load
    // First check uses fetch=false (local only); polling will fetch from remote in ~30s
    checkGitStatusIfEnabled(false, true).catch(() => {});

    updateShowHiddenButton();

    initResizeHandle();

    // Initialize status bar interactions
    initStatusBarEvents();

    // Initialize AI diff listener (claw_assistant hook)
    initAiDiffListener();

    elements.sidebar.classList.remove("visible");
    elements.sidebar.classList.add("hidden");
    if (elements.sidebarOverlay) elements.sidebarOverlay.classList.remove("visible");
    state.sidebarVisible = false;

    // ⚡ PARALLEL INITIALIZATION - Run independent operations concurrently
    const [versionData] = await Promise.all([
      // Fetch version (independent)
      fetchWithAuth(`${API_BASE}?action=get_version`).catch(e => {
        console.warn("Failed to fetch version for display");
        return null;
      }),

      // Initialize WebSocket (independent)
      initWebSocketSubscription().catch(e => {
        console.warn("Failed to init WebSocket:", e);
      }),

      // Load entities and services for autocomplete (independent)
      Promise.resolve().then(() => loadEntities()),
      Promise.resolve().then(() => loadServices())
    ]);

    // Display version if fetched successfully
    if (versionData && versionData.integration_version && elements.appVersionDisplay) {
      elements.appVersionDisplay.textContent = `v${versionData.integration_version}`;
    }

    // Store HAOS detection flag for conditional UI
    if (versionData && versionData.is_haos !== undefined) {
      state.isHaos = versionData.is_haos;
    }

    // Start git status polling (needed even with WebSocket for remote changes)
    startGitStatusPolling();

    // Restore file tree collapsed state
    if (state.fileTreeCollapsed) {
      const fileTree = document.getElementById("file-tree");
      const btn = document.getElementById("btn-file-tree-collapse");
      if (fileTree) fileTree.style.display = "none";
      if (btn) {
        const icon = btn.querySelector(".material-icons");
        if (icon) icon.textContent = "expand_more";
        btn.title = "Expand file tree";
      }
    }

    // Restore sidebar view panels (without expanding the sidebar)
    if (state.activeSidebarView) {
      const v = state.activeSidebarView;
      if (elements.activityExplorer) elements.activityExplorer.classList.toggle("active", v === "explorer");
      if (elements.activitySearch) elements.activitySearch.classList.toggle("active", v === "search");
      if (elements.activitySftp) elements.activitySftp.classList.toggle("active", v === "sftp");
      if (elements.viewExplorer) { elements.viewExplorer.style.display = v === "explorer" ? "flex" : "none"; elements.viewExplorer.classList.toggle("hidden", v !== "explorer"); }
      if (elements.viewSearch) { elements.viewSearch.style.display = v === "search" ? "flex" : "none"; elements.viewSearch.classList.toggle("hidden", v !== "search"); }
      if (elements.viewSftp) { elements.viewSftp.style.display = v === "sftp" ? "flex" : "none"; elements.viewSftp.classList.toggle("hidden", v !== "sftp"); }
    }

    // ⚡ CRITICAL: Restore open tabs AFTER files are loaded
    // This must happen sequentially, not in parallel, because restoreOpenTabs
    // needs state.files to be populated to check if files exist
    await Promise.all(eventBus.emit('app:restore-tabs'));
    state._restorationComplete = true;

    // Restore Markdown Preview if it was active
    if (state.markdownPreviewActive && state.activeTab?.path.endsWith(".md")) {
      // Delay slightly to ensure UI is ready
      setTimeout(() => {
        eventBus.emit('ui:toggle-markdown-preview', true);
      }, 500);
    }

    // Restore Blueprint Form if it was active
    if (state.blueprintFormActive && state.blueprintFormTabPath) {
      setTimeout(async () => {
        const tab = state.openTabs.find(t => t.path === state.blueprintFormTabPath);
        if (tab?.content) {
          const { showBlueprintForm } = await import('./blueprint-form.js?v=' + (window.__BS_VERSION__ || '0'));
          await showBlueprintForm(tab.content);
        } else {
          // Tab not found or no content — clear persisted state
          state.blueprintFormActive = false;
          state.blueprintFormTabPath = null;
        }
      }, 600);
    }

    // ⚡ PARALLEL POST-LOAD - Run remaining operations concurrently
    // Restore SFTP session (connection and path)
    if (state.sftpIntegrationEnabled) {
      await Promise.all(eventBus.emit('app:restore-sftp'));
    }
    // Restore Terminal
    if (state.terminalVisible) {
      await Promise.all(eventBus.emit('terminal:toggle', true));
    }

    updateToolbarState();
    updateStatusBar();
    eventBus.emit('ui:update-split-buttons');

    // Start onboarding if new user
    startOnboarding();
  } catch (error) {
    console.error("Blueprint Studio: Critical initialization error:", error);
    // Even if it fails, try to show the UI
    if (typeof showToast === 'function') {
        showToast(t("toast.initialization_error_some_feat"), "error");
    }
  } finally {
    // ALWAYS dismiss initial loading screen
    hideGlobalLoading();

    // Initialize blueprintStudio namespace if not already
    window.blueprintStudio = window.blueprintStudio || {};

    // Expose for testing (after all initialization)
    window.blueprintStudio.giteaCreateRepo = giteaCreateRepo;
    window.blueprintStudio.githubCreateRepo = githubCreateRepo;
  }
}

/**
 * Start the onboarding wizard for new users
 * Guides users through setting up Git integration
 */
export async function startOnboarding() {
    if (state.onboardingCompleted) return;

    let shouldOpenSettings = false;

    // Step 1: Welcome & Git Choice
    const choiceResult = await new Promise((resolve) => {
        const modalBody = document.getElementById("modal-body");
        const modalTitle = document.getElementById("modal-title");
        const modal = document.getElementById("modal");
        const modalFooter = document.querySelector(".modal-footer");

        resetModalToDefault();
        modalTitle.textContent = "Welcome to Blueprint Studio! 🚀";
        if (modalFooter) modalFooter.style.display = "none";

        modalBody.innerHTML = `
            <div style="text-align: center;">
                <p style="margin-bottom: 20px;">The modern, Git-powered file editor for Home Assistant.</p>
                <div style="font-weight: 600; margin-bottom: 16px;">Choose your preferred version control system:</div>
                <div class="git-choice-container" style="display: flex; flex-direction: column; gap: 12px;">
                    <button class="btn-secondary onboarding-choice-btn" data-value="github" style="padding: 16px; border: 1px solid var(--border-color); border-radius: 8px; text-align: left; background: var(--bg-secondary); cursor: pointer; transition: background 0.2s; width: 100%; color: inherit;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <svg class="octicon" viewBox="0 0 16 16" width="24" height="24" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02-.08-2.12 0 0 .67-.22 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"></path></svg>
                            <div>
                                <div style="font-weight: 600;">GitHub</div>
                                <div style="font-size: 12px; color: var(--text-secondary);">Connect to GitHub.com</div>
                            </div>
                        </div>
                    </button>
                    <button class="btn-secondary onboarding-choice-btn" data-value="gitea" style="padding: 16px; border: 1px solid var(--border-color); border-radius: 8px; text-align: left; background: var(--bg-secondary); cursor: pointer; transition: background 0.2s; width: 100%; color: inherit;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span class="material-icons" style="font-size: 24px; color: #fa8e14;">emoji_food_beverage</span>
                            <div>
                                <div style="font-weight: 600;">Gitea</div>
                                <div style="font-size: 12px; color: var(--text-secondary);">Connect to self-hosted Gitea</div>
                            </div>
                        </div>
                    </button>
                    <button class="btn-secondary onboarding-choice-btn" data-value="none" style="padding: 16px; border: 1px solid var(--border-color); border-radius: 8px; text-align: left; background: var(--bg-secondary); cursor: pointer; transition: background 0.2s; width: 100%; color: inherit;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span class="material-icons" style="font-size: 24px;">block</span>
                            <div>
                                <div style="font-weight: 600;">None</div>
                                <div style="font-size: 12px; color: var(--text-secondary);">Skip version control</div>
                            </div>
                        </div>
                    </button>
                </div>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 20px;">You can change this later in Settings.</p>
            </div>
        `;

        const buttons = modalBody.querySelectorAll('.onboarding-choice-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.getAttribute('data-value');
                hideModal();
                resolve(val);
            });
        });

        document.getElementById('modal-overlay').classList.add("visible");
    });

    const provider = choiceResult;
    const useGit = provider !== 'none';

    if (useGit) {
        // User chose to enable
        state.gitIntegrationEnabled = (provider === 'github');
        state.giteaIntegrationEnabled = (provider === 'gitea');
        saveSettings();
        eventBus.emit('ui:refresh-visibility');

        // Step 3: Initialize Git (if needed)
        if (!gitState.isInitialized) {
          const initResult = await showConfirmDialog({
            title: "Step 1: Track Your Changes",
            message: `
              <div style="text-align: center;">
                <span class="material-icons" style="font-size: 48px; color: var(--accent-color);">source</span>
                <p>First, we need to initialize a Git repository to track your file changes.</p>
                <p style="font-size: 12px; color: var(--text-secondary);">This creates a hidden .git folder in your config directory.</p>
              </div>
            `,
            confirmText: "Initialize Repo",
            cancelText: "Skip"
          });

          if (initResult) {
            const success = await gitInit(true); // Skip prompt
            if (success) {
                gitState.isInitialized = true;
            }
          }
        }

        // Step 4: Git Ignore
        if (gitState.isInitialized) {
            const ignoreResult = await showConfirmDialog({
                title: "Step 2: Ignore Files",
                message: `
                    <div style="text-align: center;">
                        <span class="material-icons" style="font-size: 48px; color: var(--text-secondary); margin-bottom: 10px;">visibility_off</span>
                        <p style="margin-bottom: 10px;">Configure which files to hide from GitHub (like passwords or temp files).</p>
                        <p style="font-size: 12px; color: var(--text-secondary);">We've already configured safe defaults for you.</p>
                    </div>
                `,
                confirmText: "Manage Exclusions",
                cancelText: "Use Defaults"
            });

            if (ignoreResult) {
                eventBus.emit('git:show-exclusions');
            }
        }

        // Step 5: Connect to Provider (Login)
        let isLoggedIn = false;
        if (provider === 'github') {
            try {
                const creds = await fetchWithAuth(API_BASE, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "git_get_credentials" }),
                });
                isLoggedIn = creds.has_credentials;
            } catch (e) {}

            if (!isLoggedIn) {
                const loginResult = await showConfirmDialog({
                    title: "Step 3: Login to GitHub",
                    message: `
                        <div style="text-align: center;">
                            <span class="material-icons" style="font-size: 48px; color: var(--text-secondary);">login</span>
                            <p>Login to GitHub to sync your configuration to the cloud.</p>
                        </div>
                    `,
                    confirmText: "Login",
                    cancelText: "Skip"
                });

                if (loginResult) {
                    const success = await eventBus.emit('git:login-github');
                    if (success) isLoggedIn = true;
                }
            }
        } else if (provider === 'gitea') {
            // Gitea login is via settings
            shouldOpenSettings = true;
        }

        // Step 6: Create Repository (if logged in and no remote)
        if (provider === 'github' && isLoggedIn && !gitState.hasRemote) {
            const createResult = await showConfirmDialog({
                title: "Step 4: Create Repository",
                message: `
                    <div style="text-align: center;">
                        <span class="material-icons" style="font-size: 48px; color: var(--accent-color);">add_circle_outline</span>
                        <p>Create a new private repository on GitHub to store your backups.</p>
                    </div>
                `,
                confirmText: "Create Repo",
                cancelText: "Skip"
            });

            if (createResult) {
                eventBus.emit('git:show-create-repo');
            }
        }
    } else {
        // User chose to disable
        state.gitIntegrationEnabled = false;
        state.giteaIntegrationEnabled = false;
        saveSettings();
        eventBus.emit('ui:refresh-visibility');
    }

    // Final Step: Finish
    const finishMessage = useGit
        ? `
        <div style="text-align: center;">
          <p>Explore your files on the left.</p>
          <p>Use the <b>${provider === 'gitea' ? 'Gitea' : 'Git'} Panel</b> to stage, commit, and push changes.</p>
          <br>
          <p style="font-size: 12px;">Need help? Click the <span class="material-icons" style="font-size: 14px; vertical-align: middle;">help_outline</span> icon in the panel.</p>
        </div>
      `
        : `
        <div style="text-align: center;">
          <p>You're good to go! 🚀</p>
          <br>
          <p>Explore your files on the left and start editing.</p>
          <br>
          <p style="font-size: 12px; color: var(--text-secondary);">If you change your mind, you can enable Git integration in <b>Settings</b>.</p>
        </div>
      `;

    await showModal({
      title: "You're All Set! 🎉",
      message: finishMessage,
      confirmText: "Start Editing"
    });

    state.onboardingCompleted = true;
    saveSettings();

    // If they chose to connect Gitea (or GitHub failed login), open the settings modal now
    if (shouldOpenSettings) {
        if (provider === 'gitea') eventBus.emit('git:show-gitea-settings');
        else if (provider === 'github') eventBus.emit('git:show-settings');
    }
  }

// Export init as default
export default init;
