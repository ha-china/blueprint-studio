/** SETTINGS.JS | Purpose: * Handles loading, saving, and migrating user settings between local storage */
import { state, elements, gitState, giteaState } from './state.js';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE, STORAGE_KEY } from './constants.js';
import { trackSettingsSave } from './settings-sync.js';

const SETTINGS_CLIENT_ID_KEY = `${STORAGE_KEY}_client_id`;
const LOCAL_SETTINGS_RECOVERY_WINDOW_MS = 2 * 60 * 1000;

function getSettingsClientId() {
  let clientId = localStorage.getItem(SETTINGS_CLIENT_ID_KEY);
  if (!clientId) {
    clientId = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SETTINGS_CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

function hasSettingsPayload(settings) {
  return !!settings && typeof settings === 'object' && Object.keys(settings).length > 0;
}

function shouldRecoverLocalSettings(serverSettings, localSettings, clientId) {
  if (!hasSettingsPayload(localSettings)) {
    return false;
  }

  const localTs = localSettings._savedAt || 0;
  const serverTs = serverSettings._savedAt || 0;
  if (!localTs || localTs <= serverTs) {
    return false;
  }

  if (localSettings._clientId !== clientId) {
    return false;
  }

  return (Date.now() - localTs) <= LOCAL_SETTINGS_RECOVERY_WINDOW_MS;
}

/**
 * Loads settings from server and local storage
 * Handles migration from local storage to server
 */
export async function loadSettings() {
  try {
    // 1. Fetch from server
    let serverSettings = {};
    try {
      serverSettings = await fetchWithAuth(`${API_BASE}?action=get_settings`);
    } catch (e) {
      // Failed to fetch settings from server, using local fallback
    }

    // 2. Fetch local (legacy/fallback)
    const localStored = localStorage.getItem(STORAGE_KEY);
    const localSettings = localStored ? JSON.parse(localStored) : {};
    const clientId = getSettingsClientId();

    // 3. Use server settings by default.
    // Only recover from localStorage for a short same-device window after an interrupted save.
    let settings = serverSettings;
    if (!hasSettingsPayload(serverSettings) && (hasSettingsPayload(localSettings) || localStorage.getItem("onboardingCompleted"))) {
      // Migrating settings to server...
      settings = { ...localSettings };
      settings._clientId = clientId;
      // Migrate root keys
      settings.onboardingCompleted = localStorage.getItem("onboardingCompleted") === "true";
      settings.gitIntegrationEnabled = localStorage.getItem("gitIntegrationEnabled") !== "false";

      // Save back to server immediately
      await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", settings: settings }),
      });
    } else if (shouldRecoverLocalSettings(serverSettings, localSettings, clientId)) {
      // Same-device crash/reload recovery only.
      settings = localSettings;
      fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", settings: settings }),
      }).catch(e => console.warn("Settings re-sync to server failed:", e));
    }

    if (hasSettingsPayload(settings)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    // 4. Apply to State
    state.theme = settings.theme || localSettings.theme || "dark";
    state.language = settings.language || localSettings.language || "en";
    state.showHidden = settings.showHidden || false;
    state.terminalVisible = settings.terminalVisible || false;

    // Load SSH hosts — unified store for both terminal and SFTP.
    // Phase 1: ensure all schema fields exist.
    // Phase 2: migrate legacy sftpConnections into sshHosts (one-time).
    const rawSshHosts = (settings.sshHosts || []).map(host => ({
      ...host,
      id: host.id || ('host-' + Math.random().toString(36).slice(2, 10)),
      authType: host.authType || 'password',
      privateKey: host.privateKey || '',
      privateKeyPassphrase: host.privateKeyPassphrase || ''
    }));
    // Merge any legacy sftpConnections that are not already in sshHosts
    const legacySftp = settings.sftpConnections || [];
    legacySftp.forEach(conn => {
      if (!rawSshHosts.find(h => h.id === conn.id)) {
        rawSshHosts.push({
          id: conn.id,
          name: conn.name || `${conn.username}@${conn.host}`,
          host: conn.host,
          port: conn.port || 22,
          username: conn.username,
          authType: conn.authType || 'password',
          password: conn.password || '',
          privateKey: conn.privateKey || '',
          privateKeyPassphrase: conn.privateKeyPassphrase || ''
        });
      }
    });
    state.sshHosts = rawSshHosts;

    state.defaultSshHost = settings.defaultSshHost || "local";
    state.showRecentFiles = settings.showRecentFiles !== false;
    state.favoriteFiles = settings.favoriteFiles || [];
    state.recentFiles = settings.recentFiles || [];
    state.gitConfig = settings.gitConfig || null;
    state.customColors = settings.customColors || {};
    state.syntaxTheme = settings.syntaxTheme || 'custom';
    state.geminiApiKey = settings.geminiApiKey || null;
    state.openaiApiKey = settings.openaiApiKey || null;
    state.openaiBaseUrl = settings.openaiBaseUrl || "";
    state.claudeApiKey = settings.claudeApiKey || null;

    // New UI customization settings
    state.themePreset = settings.themePreset || "native";
    state.accentColor = settings.accentColor || null;
    state.fontSize = parseInt(settings.fontSize) || 13;
    state.fontFamily = settings.fontFamily || localSettings.fontFamily || "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace";
    state.tabSize = parseInt(settings.tabSize) || 2;
    state.indentWithTabs = settings.indentWithTabs || false;
    state.sidebarWidth = parseInt(settings.sidebarWidth) || parseInt(localSettings.sidebarWidth) || 320;
    state.tabPosition = settings.tabPosition || localSettings.tabPosition || "top";
    state.activeSidebarView = settings.activeSidebarView || "explorer";
    state.wordWrap = settings.wordWrap !== false; // default true
    state.showLineNumbers = settings.showLineNumbers !== false; // default true
    state.showMinimap = settings.showMinimap || false;
    state.autocompleteEnabled = settings.autocompleteEnabled !== false; // default true
    state.showWhitespace = settings.showWhitespace || false;
    state.autoSave = settings.autoSave || false;
    state.autoSaveDelay = parseInt(settings.autoSaveDelay) || 1000;
    state.fileTreeCompact = settings.fileTreeCompact || false;
    state.fileTreeShowIcons = settings.fileTreeShowIcons !== false; // default true
    state.treeCollapsableMode = settings.treeCollapsableMode || false;
    // Apply tree mode to lazyLoadingEnabled
    // state.lazyLoadingEnabled = !state.treeCollapsableMode;

    if (settings.expandedFolders && Array.isArray(settings.expandedFolders)) {
      state.expandedFolders = new Set(settings.expandedFolders);
    }

    state.recentFilesLimit = parseInt(settings.recentFilesLimit) || 10;
    state.breadcrumbStyle = settings.breadcrumbStyle || "path";
    state.showToasts = settings.showToasts !== false; // default true

    // Experimental features
    state.enableSplitView = settings.enableSplitView || false; // default false (experimental)
    state.onTabMode = settings.onTabMode || false; // default false
    state.markdownPreviewActive = settings.markdownPreviewActive || false;
    state.blueprintFormActive = settings.blueprintFormActive || false;
    state.blueprintFormTabPath = settings.blueprintFormTabPath || null;

    // New state properties for sync
    state.onboardingCompleted = settings.onboardingCompleted ?? (localStorage.getItem("onboardingCompleted") === "true");
    state.gitIntegrationEnabled = settings.gitIntegrationEnabled ?? (localStorage.getItem("gitIntegrationEnabled") !== "false");
    state.giteaIntegrationEnabled = settings.giteaIntegrationEnabled ?? (localStorage.getItem("giteaIntegrationEnabled") === "true");
    state.sftpIntegrationEnabled = settings.sftpIntegrationEnabled ?? true; // Default enabled
    state.terminalIntegrationEnabled = settings.terminalIntegrationEnabled ?? true; // Default enabled

    // Restore collapsed groups
    if (settings.gitCollapsedGroups && Array.isArray(settings.gitCollapsedGroups)) {
      gitState.collapsedGroups = new Set(settings.gitCollapsedGroups);
    }
    if (settings.giteaCollapsedGroups && Array.isArray(settings.giteaCollapsedGroups)) {
      giteaState.collapsedGroups = new Set(settings.giteaCollapsedGroups);
    }

    state.gitPanelCollapsed = settings.gitPanelCollapsed || false;
    state.giteaPanelCollapsed = settings.giteaPanelCollapsed || false;
    state.fileTreeCollapsed = settings.fileTreeCollapsed || false;
    state.rememberWorkspace = settings.rememberWorkspace !== false; // default true

    // Performance settings
    state.pollingInterval = parseInt(settings.pollingInterval) || 10000;
    state.remoteFetchInterval = parseInt(settings.remoteFetchInterval) || 30000;
    state.fileCacheSize = parseInt(settings.fileCacheSize) || 10;
    state.enableVirtualScroll = settings.enableVirtualScroll || false;

    // SFTP settings — connections now live in sshHosts (unified store)
    state.sftpConnections = state.sshHosts; // alias: SFTP reads the same array
    state.sftpPanelCollapsed = settings.sftpPanelCollapsed || false;
    state.sftpPanelHeight = settings.sftpPanelHeight || 300;
    state.activeSftp.connectionId = settings.activeSftpConnectionId || null;
    state.activeSftp.currentPath = settings.activeSftpPath || "/";

    if (settings.activeSftpExpandedFolders && Array.isArray(settings.activeSftpExpandedFolders)) {
      state.activeSftp.expandedFolders = new Set(settings.activeSftpExpandedFolders);
    }

    // Restore Navigation state
    state.currentNavigationPath = settings.currentNavigationPath || "";
    state.navigationHistory = settings.navigationHistory || [];

    // Split view settings
    if (settings.splitView) {
      state.splitView.enabled = settings.splitView.enabled || false;
      state.splitView.orientation = settings.splitView.orientation || 'vertical';
      state.splitView.primaryPaneSize = settings.splitView.primaryPaneSize || 50;
      state.splitView.primaryTabs = settings.splitView.primaryTabs || [];
      state.splitView.secondaryTabs = settings.splitView.secondaryTabs || [];
      state._savedPrimaryActiveTabPath = settings.splitView.primaryActiveTabPath;
      state._savedSecondaryActiveTabPath = settings.splitView.secondaryActiveTabPath;
    }

    // AI Settings - with migration from old structure
    state.aiIntegrationEnabled = settings.aiIntegrationEnabled ?? false;
    state.aiChatHistory = settings.aiChatHistory || [];
    state.aiSidebarVisible = settings.aiSidebarVisible || false;

    // Migrate old aiProvider to new aiType structure
    if (settings.aiType) {
      // New structure exists
      state.aiType = settings.aiType;
    } else if (settings.aiProvider) {
      // Migrate from old structure
      const oldProvider = settings.aiProvider;

      if (oldProvider === "local") {
        state.aiType = "rule-based";
      } else if (["gemini", "openai", "claude"].includes(oldProvider)) {
        state.aiType = "cloud";
        state.cloudProvider = oldProvider;
      } else {
        state.aiType = "rule-based";
      }
    } else {
      state.aiType = "rule-based";
    }

    // Legacy field
    state.aiProvider = settings.aiProvider || "local";

    // Local AI settings
    state.localAiProvider = settings.localAiProvider || "ollama";
    state.ollamaUrl = settings.ollamaUrl || "http://localhost:11434";
    state.ollamaModel = settings.ollamaModel || "codellama:7b";
    state.lmStudioUrl = settings.lmStudioUrl || "http://localhost:1234";
    state.lmStudioModel = settings.lmStudioModel || "";
    state.customAiUrl = settings.customAiUrl || "";
    state.customAiModel = settings.customAiModel || "";
    state.hassAgentId = settings.hassAgentId || "";

    // Cloud AI settings
    state.cloudProvider = settings.cloudProvider || settings.aiProvider || "gemini";
    state.aiModel = settings.aiModel || "gemini-2.0-flash-exp";
    state.geminiApiKey = settings.geminiApiKey || "";
    state.openaiApiKey = settings.openaiApiKey || "";
    state.openaiBaseUrl = settings.openaiBaseUrl || "";
    state.claudeApiKey = settings.claudeApiKey || "";

    state._savedOpenTabs = settings.openTabs || localSettings.openTabs || [];
    state._savedActiveTabPath = settings.activeTabPath || localSettings.activeTabPath || null;

    eventBus.emit('settings:loaded', settings);

  } catch (e) {
    console.error("[Settings] Failed to load settings:", e);
  }
}

/**
 * Saves settings to server and local storage
 * Includes workspace state (open tabs, cursor positions)
 */
export async function saveSettings() {
  try {
    // Update current active tab's cursor/scroll before saving
    if (state.activeTab && state.editor) {
      state.activeTab.cursor = state.editor.getCursor();
      state.activeTab.scroll = state.editor.getScrollInfo();
    }

    // Save open tabs state
    let openTabsState = [];
    let activeTabPath = null;

    if (state.rememberWorkspace && state._restorationComplete) {
      openTabsState = state.openTabs.map(tab => {
        // If this is the active tab, it already has the latest cursor/scroll from above.
        // Other tabs have their cursor/scroll preserved from when they were last active.
        const tabState = {
          path: tab.path,
          modified: tab.modified,
          cursor: tab.cursor,
          scroll: tab.scroll
        };

        // Save modified content so it can be restored
        if (tab.modified && tab.content) {
          tabState.content = tab.content;
          tabState.originalContent = tab.originalContent;
        }

        return tabState;
      });
      activeTabPath = state.activeTab ? state.activeTab.path : null;
    }

    const settings = {
      theme: state.theme,
      language: state.language,
      showHidden: state.showHidden,
          terminalVisible: state.terminalVisible,
          sshHosts: state.sshHosts,
          defaultSshHost: state.defaultSshHost,
          showRecentFiles: state.showRecentFiles,      favoriteFiles: state.favoriteFiles,
      recentFiles: state.recentFiles,
      customColors: state.customColors,
      syntaxTheme: state.syntaxTheme,
      openTabs: openTabsState,
      activeTabPath: activeTabPath,
      gitConfig: state.gitConfig,
      onboardingCompleted: state.onboardingCompleted,
      gitIntegrationEnabled: state.gitIntegrationEnabled,
      giteaIntegrationEnabled: state.giteaIntegrationEnabled,
      sftpIntegrationEnabled: state.sftpIntegrationEnabled,
      terminalIntegrationEnabled: state.terminalIntegrationEnabled,
      gitCollapsedGroups: Array.from(gitState.collapsedGroups),
      giteaCollapsedGroups: Array.from(giteaState.collapsedGroups),
      aiIntegrationEnabled: state.aiIntegrationEnabled,
      aiChatHistory: (state.aiChatHistory || []).slice(-20), // Keep last 20 messages
      aiSidebarVisible: state.aiSidebarVisible,
      aiType: state.aiType,
      aiProvider: state.aiProvider, // Legacy, for migration
      // Local AI settings
      localAiProvider: state.localAiProvider,
      ollamaUrl: state.ollamaUrl,
      ollamaModel: state.ollamaModel,
      lmStudioUrl: state.lmStudioUrl,
      lmStudioModel: state.lmStudioModel,
      customAiUrl: state.customAiUrl,
      customAiModel: state.customAiModel,
      hassAgentId: state.hassAgentId,
      // Cloud AI settings
      cloudProvider: state.cloudProvider,
      aiModel: state.aiModel,
      geminiApiKey: state.geminiApiKey,
      openaiApiKey: state.openaiApiKey,
      openaiBaseUrl: state.openaiBaseUrl,
      claudeApiKey: state.claudeApiKey,
      // New UI customization settings
      themePreset: state.themePreset,
      accentColor: state.accentColor,
      fontSize: state.fontSize,
      fontFamily: state.fontFamily,
      tabSize: state.tabSize,
      indentWithTabs: state.indentWithTabs,
      sidebarWidth: state.sidebarWidth,
      tabPosition: state.tabPosition,
      activeSidebarView: state.activeSidebarView,
      wordWrap: state.wordWrap,
      showLineNumbers: state.showLineNumbers,
      showMinimap: state.showMinimap,
      autocompleteEnabled: state.autocompleteEnabled,
      showWhitespace: state.showWhitespace,
      autoSave: state.autoSave,
      autoSaveDelay: state.autoSaveDelay,
      fileTreeCompact: state.fileTreeCompact,
      fileTreeShowIcons: state.fileTreeShowIcons,
      treeCollapsableMode: state.treeCollapsableMode,
      expandedFolders: Array.from(state.expandedFolders),
      recentFilesLimit: state.recentFilesLimit,
      breadcrumbStyle: state.breadcrumbStyle,
      gitPanelCollapsed: state.gitPanelCollapsed,
      giteaPanelCollapsed: state.giteaPanelCollapsed,
      fileTreeCollapsed: state.fileTreeCollapsed,
      enableSplitView: state.enableSplitView, // Experimental feature
      onTabMode: state.onTabMode, // One Tab Mode
      markdownPreviewActive: state.markdownPreviewActive,
      blueprintFormActive: state.blueprintFormActive,
      blueprintFormTabPath: state.blueprintFormTabPath,
      rememberWorkspace: state.rememberWorkspace,
      // Performance settings
      pollingInterval: state.pollingInterval,
      remoteFetchInterval: state.remoteFetchInterval,
      fileCacheSize: state.fileCacheSize,
      enableVirtualScroll: state.enableVirtualScroll,
      // SFTP settings — connections are stored in sshHosts (unified store)
      sftpPanelCollapsed: state.sftpPanelCollapsed,
      sftpPanelHeight: state.sftpPanelHeight,
      activeSftpConnectionId: state.activeSftp.connectionId,
      activeSftpPath: state.activeSftp.currentPath,
      activeSftpExpandedFolders: Array.from(state.activeSftp.expandedFolders),
      // Navigation settings
      currentNavigationPath: state.currentNavigationPath,
      navigationHistory: state.navigationHistory || [],
      // Split view settings
      splitView: state.splitView ? {
        enabled: state.splitView.enabled,
        orientation: state.splitView.orientation,
        primaryPaneSize: state.splitView.primaryPaneSize,
        primaryTabs: state.splitView.primaryTabs || [],
        secondaryTabs: state.splitView.secondaryTabs || [],
        primaryActiveTabPath: state.splitView.primaryActiveTab?.path || null,
        secondaryActiveTabPath: state.splitView.secondaryActiveTab?.path || null,
      } : null
    };

    // Save to server
    settings._savedAt = Date.now();
    settings._clientId = getSettingsClientId();
    const savePromise = fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_settings", settings: settings }),
    }).catch(e => console.error("Failed to save settings to server:", e));

    // Save to local storage (cache/fallback)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    // Sync legacy keys
    if (state.onboardingCompleted) localStorage.setItem("onboardingCompleted", "true");
    localStorage.setItem("gitIntegrationEnabled", state.gitIntegrationEnabled);

    // Track that we saved (prevents ping-pong sync)
    trackSettingsSave();

    eventBus.emit('settings:saved', settings);

    return savePromise;
  } catch (e) {
    // Could not save settings
    return Promise.resolve();
  }
}

/**
 * Updates the show/hide hidden files button state
 */
export function updateShowHiddenButton() {
  if (elements.btnShowHidden) {
    const icon = elements.btnShowHidden.querySelector('.material-icons');
    if (state.showHidden) {
      icon.textContent = 'visibility';
      elements.btnShowHidden.title = 'Hide hidden folders';
      elements.btnShowHidden.classList.add('active');
    } else {
      icon.textContent = 'visibility_off';
      elements.btnShowHidden.title = 'Show hidden folders';
      elements.btnShowHidden.classList.remove('active');
    }
  }
}
