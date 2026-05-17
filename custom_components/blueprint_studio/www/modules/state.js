/** STATE.JS | Purpose: * Central state management for Blueprint Studio. This module exports reactive */
import { MOBILE_BREAKPOINT } from './constants.js';

export const state = {
  files: [],
  folders: [],
  allItems: [],
  fileTree: {},
  openTabs: [],
  activeTab: null,
  expandedFolders: new Set(),
  favoriteFiles: [],
  recentFiles: [],
  searchQuery: "",
  contentSearchEnabled: false,
  contentSearchResults: null,
  isMobile: window.innerWidth <= MOBILE_BREAKPOINT,
  sidebarVisible: false,
  activeSidebarView: "explorer", // Current active sidebar view (explorer, search, sftp)
  terminalVisible: false, // Terminal panel state
  sshHosts: [], // Saved SSH connections
  defaultSshHost: 'local', // Default SSH target ('local' or JSON string of host)
  language: "en",         // Current UI language
  theme: "dark",
  showHidden: false,
  showRecentFiles: true,
  contextMenuTarget: null,
  tabContextMenuTarget: null,
  currentFolderPath: "",
  // Tree display mode: false = folder navigation (default), true = collapsable tree
  treeCollapsableMode: false,
  // Lazy loading state (NEW - for on-demand folder loading)
  lazyLoadingEnabled: true, // Enable lazy loading by default
  loadedDirectories: new Map(), // Cache: path -> {folders: [], files: []}
  loadingDirectories: new Set(), // Track which directories are currently loading
  failedDirectories: new Set(), // Paths whose lazy load failed; prevents spinner retry loops
  // Folder navigation (NEW - for browse-style navigation)
  currentNavigationPath: "", // Current folder being viewed (empty = root)
  navigationHistory: [], // History stack for back button
  editor: null,
  gitConfig: null,
  selectionMode: false,
  selectedItems: new Set(),
  customColors: {},

  // AI Configuration (New Structure)
  aiIntegrationEnabled: false,
  aiType: "rule-based", // "none" | "rule-based" | "local-ai" | "cloud" | "hass-agent"

  // Legacy field for migration
  aiProvider: "local",

  // Local AI Settings
  localAiProvider: "ollama", // "ollama" | "lm-studio" | "custom"
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "codellama:7b",
  lmStudioUrl: "http://localhost:1234",
  lmStudioModel: "",
  customAiUrl: "",
  customAiModel: "",

  // Home Assistant Agent Settings
  hassAgentId: "",
  hassAgents: [],

  // Cloud AI Settings
  cloudProvider: "gemini", // "gemini" | "openai" | "claude"
  aiModel: "gemini-2.0-flash-exp",
  geminiApiKey: "",
  openaiApiKey: "",
  openaiBaseUrl: "",
  claudeApiKey: "",
  aiDiscoveredModels: {
    "cloud:gemini": [],
    "cloud:openai": [],
    "cloud:claude": [],
    "local:ollama": [],
    "local:lm-studio": [],
    "local:custom": [],
    "local:hass": [],
  },
  aiModelFetchMeta: {
    "cloud:gemini": { loading: false, error: "", fetchedAt: null, count: 0 },
    "cloud:openai": { loading: false, error: "", fetchedAt: null, count: 0 },
    "cloud:claude": { loading: false, error: "", fetchedAt: null, count: 0 },
    "local:ollama": { loading: false, error: "", fetchedAt: null, count: 0 },
    "local:lm-studio": { loading: false, error: "", fetchedAt: null, count: 0 },
    "local:custom": { loading: false, error: "", fetchedAt: null, count: 0 },
    "local:hass": { loading: false, error: "", fetchedAt: null, count: 0 },
  },
  themePreset: "native",
  accentColor: null,
  fontSize: 13,
  fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
  tabSize: 2,
  indentWithTabs: false,
  sidebarWidth: 320,
  tabPosition: "top",
  terminalIntegrationEnabled: true,
  wordWrap: true,
  showLineNumbers: true,
  showMinimap: false,
  autocompleteEnabled: true,
  showWhitespace: false,
  autoSave: false,
  autoSaveDelay: 1000,
  fileTreeCompact: false,
  fileTreeShowIcons: true,
  recentFilesLimit: 10,
  breadcrumbStyle: "path",
  giteaIntegrationEnabled: false,
  sftpIntegrationEnabled: true,
  gitPanelCollapsed: false,
  giteaPanelCollapsed: false,
  fileTreeCollapsed: false,
  rememberWorkspace: true,
  showToasts: true,
  gitIntegrationEnabled: false,
  // Performance settings
  pollingInterval: 10000,        // Git status polling interval (ms)
  remoteFetchInterval: 30000,    // Remote fetch interval (ms)
  fileCacheSize: 10,             // Number of files to cache in memory
  enableVirtualScroll: false,    // Virtual scrolling for large file trees
  enableSplitView: false,        // Enable split view feature (Experimental)
  onTabMode: false,              // One Tab Mode: auto-save & close other tabs on file open
  markdownPreviewActive: false,  // Is markdown preview currently active?
  blueprintFormActive: false,    // Is the "Use Blueprint" form open?
  blueprintFormTabPath: null,    // Path of the tab that has the blueprint form open
  aiChatHistory: [],             // Saved AI chat messages
  aiSidebarVisible: false,       // Is the AI sidebar open?
  _nextUploadTarget: null,       // Temporary target for next upload operation
  _nextFolderUploadTarget: null, // Temporary target for next folder upload operation
  _lastShowHidden: false,
  _lastGitChanges: null,
  _lastGiteaChanges: null,
  // File content cache
  fileContentCache: new Map(),
  // Internal tracking
  _wsUpdateTimer: null,
  _savedOpenTabs: null,
  _savedActiveTabPath: null,
  _restorationComplete: false,
  // Quick switcher
  quickSwitcherSelectedIndex: 0,
  // Search overlay
  searchOverlay: null,
  activeMatchMark: null,
  searchCaseSensitive: false, // Editor search: match case (exact match)
  searchWholeWord: false,     // Editor search: match whole word
  searchUseRegex: false,      // Editor search: use regular expression
  syntaxTheme: 'custom',      // Pre-defined syntax highlighting theme

  // Split view configuration
  splitView: {
    enabled: false,           // Is split view active?
    orientation: 'vertical',  // 'vertical' or 'horizontal'
    primaryPaneSize: 50,      // Percentage (for resize)
    activePane: 'primary',    // 'primary' or 'secondary'
    primaryTabs: [],          // Tab indices in primary pane
    secondaryTabs: [],        // Tab indices in secondary pane
    primaryActiveTab: null,   // Active tab in primary pane
    secondaryActiveTab: null  // Active tab in secondary pane
  },

  // Secondary editor instance (for split view)
  primaryEditor: null,
  secondaryEditor: null,

  // SFTP
  sftpConnections: [],       // Saved connection profiles
  sftpPanelCollapsed: false, // Panel UI state
  sftpPanelHeight: 300,      // Panel body height in px
  activeSftp: {              // Ephemeral browsing session
    connectionId: null,
    currentPath: "/",
    navigationHistory: [],
    folders: [],
    files: [],
    loading: false,
    expandedFolders: new Set(),
    loadedDirectories: new Map(), // path -> {folders: [], files: []}
    loadingDirectories: new Set(), // paths currently being fetched
  },

  // SSH Host field defaults for new hosts (Phase 1)
  // Existing hosts will be migrated to include these fields with defaults
  // authType: 'password' | 'key' - authentication method
  // privateKey: '' - PEM-formatted SSH private key (only used if authType === 'key')
  // privateKeyPassphrase: '' - optional passphrase for encrypted private keys
};

export const elements = {};

// Git state needs to be shared too
export const gitState = {
    files: { modified: [], added: [], deleted: [], untracked: [], staged: [], unstaged: [] },
    isInitialized: false,
    hasRemote: false,
    currentBranch: "unknown",
    localBranches: [],
    remoteBranches: [],
    ahead: 0,
    behind: 0,
    status: "",
    selectedFiles: new Set(),
    totalChanges: 0,
    collapsedGroups: new Set(),
    conflictFiles: [],
};

export const giteaState = {
    files: { modified: [], added: [], deleted: [], untracked: [], staged: [], unstaged: [] },
    isInitialized: false,
    hasRemote: false,
    currentBranch: "unknown",
    localBranches: [],
    remoteBranches: [],
    ahead: 0,
    behind: 0,
    status: "",
    selectedFiles: new Set(),
    totalChanges: 0,
    collapsedGroups: new Set(),
    conflictFiles: [],
};
