/**
 * COORDINATORS/INDEX.JS | Purpose:
 * Central entry point for initializing all application coordinators.
 * This decouples the core logic from app.js.
 */

import { state, elements, gitState, giteaState } from '../state.js';
import { eventBus } from '../event-bus.js';

import {
  initElements as initElementsImpl,
  showToast as showToastImpl,
  showGlobalLoading as showGlobalLoadingImpl,
  hideGlobalLoading as hideGlobalLoadingImpl,
  showModal as showModalImpl,
  getEffectiveTheme as getEffectiveThemeImpl,
  applyTheme as applyThemeImpl,
  applyCustomSyntaxColors as applyCustomSyntaxColorsImpl,
  applyEditorSettings as applyEditorSettingsImpl,
  applyLayoutSettings as applyLayoutSettingsImpl,
  setThemePreset as setThemePresetImpl,
  setAccentColor as setAccentColorImpl,
  setTheme as setThemeImpl,
  resetModalToDefault as resetModalToDefaultImpl,
  showConfirmDialog as showConfirmDialogImpl,
  hideModal as hideModalImpl,
  confirmModal as confirmModalImpl,
  setButtonLoading as setButtonLoadingImpl
} from '../ui.js';

import {
  fetchWithAuth,
  getAuthToken as getAuthTokenImpl,
  restartHomeAssistant as restartHomeAssistantImpl
} from '../api.js';

import {
  openDevTools as openDevToolsImpl
} from '../dev-tools.js';

import {
  insertUUID as insertUUIDImpl
} from '../editor.js';

import {
  autoSaveTimer,
  saveAllFiles as saveAllFilesImpl,
  triggerAutoSave as triggerAutoSaveImpl,
  clearAutoSaveTimer as clearAutoSaveTimerImpl
} from '../autosave.js';

import {
  enableSplitView as enableSplitViewImpl,
  disableSplitView as disableSplitViewImpl,
  setActivePaneFromPosition as setActivePaneFromPositionImpl,
  moveToPrimaryPane as moveToPrimaryPaneImpl,
  moveToSecondaryPane as moveToSecondaryPaneImpl,
  getPaneForTab as getPaneForTabImpl,
  getActivePaneEditor as getActivePaneEditorImpl,
  updatePaneSizes as updatePaneSizesImpl,
  initSplitResize as initSplitResizeImpl,
  handleTabDragStart as handleTabDragStartImpl,
  handleTabDragOver as handleTabDragOverImpl,
  handleTabDrop as handleTabDropImpl,
  handleTabDragEnd as handleTabDragEndImpl,
  updatePaneActiveState as updatePaneActiveStateImpl,
  updateSplitViewButtons as updateSplitViewButtonsImpl
} from '../split-view.js';

import {
  loadSettings as loadSettingsImpl,
  saveSettings as saveSettingsImpl,
  updateShowHiddenButton as updateShowHiddenButtonImpl
} from '../settings.js';

import {
  showAppSettings as showAppSettingsImpl
} from '../settings-ui.js';

import {
  toggleSelectionMode as toggleSelectionModeImpl,
  handleSelectionChange as handleSelectionChangeImpl,
  updateSelectionCount as updateSelectionCountImpl,
  deleteSelectedItems as deleteSelectedItemsImpl
} from '../selection.js';

import {
  saveFile as saveFileRaw,
  createFile as createFileImpl,
  createFolder as createFolderImpl,
  deleteItem as deleteItemImpl,
  copyItem as copyItemImpl,
  renameItem as renameItemImpl,
  formatCode as formatCodeImpl,
  validateYaml as validateYamlImpl
} from '../file-operations.js';

import {
  fileTreeRenderTimer,
  debouncedRenderFileTree as debouncedRenderFileTreeImpl,
  buildFileTree as buildFileTreeImpl,
  renderFileTree as renderFileTreeImpl,
  renderTreeLevel as renderTreeLevelImpl,
  handleFileDropMulti as handleFileDropMultiImpl,
  handleFileDrop as handleFileDropImpl,
  folderMatchesSearch as folderMatchesSearchImpl,
  createTreeItem as createTreeItemImpl,
  handleDragStart as handleDragStartFileTreeImpl,
  handleDragOver as handleDragOverFileTreeImpl,
  handleDragLeave as handleDragLeaveFileTreeImpl,
  handleDrop as handleDropFileTreeImpl,
  toggleFolder as toggleFolderImpl,
  loadDirectory as loadDirectoryImpl,
  updateToggleAllButton as updateToggleAllButtonImpl,
  debouncedContentSearch as debouncedContentSearchImpl,
  debouncedFilenameSearch as debouncedFilenameSearchImpl,
  performContentSearch as performContentSearchImpl,
  navigateBack as navigateBackImpl
} from '../file-tree.js';

import {
  showDiffModal as showDiffModalImpl,
  showGitHistory as showGitHistoryImpl,
  showGitCommitDiff as showGitCommitDiffImpl
} from '../git-diff.js';

import {
  isGitEnabled as isGitEnabledImpl,
  checkGitStatusIfEnabled as checkGitStatusIfEnabledImpl,
  gitStatus as gitStatusImpl,
  gitInit as gitInitImpl,
  abortGitOperation as abortGitOperationImpl,
  forcePush as forcePushImpl,
  hardReset as hardResetImpl,
  deleteRemoteBranch as deleteRemoteBranchImpl,
  gitGetRemotes as gitGetRemotesImpl,
  gitSetCredentials as gitSetCredentialsImpl,
  gitStage as gitStageImpl,
  handleGitLockAndRetry as handleGitLockAndRetryImpl,
  gitCleanLocks as gitCleanLocksImpl,
  gitRepairIndex as gitRepairIndexImpl,
  gitUnstage as gitUnstageImpl,
  gitReset as gitResetImpl,
  gitCommit as gitCommitImpl,
  gitPull as gitPullImpl,
  gitPush as gitPushImpl
} from '../git-operations.js';

import {
  gitAddRemote as gitAddRemoteImpl,
  githubCreateRepo as githubCreateRepoImpl,
  repairBranchMismatch as repairBranchMismatchImpl,
  gitTestConnection as gitTestConnectionImpl,
  gitClearCredentials as gitClearCredentialsImpl,
  githubDeviceFlowStart as githubDeviceFlowStartImpl,
  githubDeviceFlowPoll as githubDeviceFlowPollImpl,
  showGithubDeviceFlowLogin as showGithubDeviceFlowLoginImpl,
  showGitExclusions as showGitExclusionsImpl,
  showGitSettings as showGitSettingsImpl,
  showCreateGithubRepoDialog as showCreateGithubRepoDialogImpl,
  saveGitRemote as saveGitRemoteImpl,
  saveGitCredentials as saveGitCredentialsImpl,
  testGitConnection as testGitConnectionImpl
} from '../github-integration.js';

import {
  giteaInit as giteaInitImpl,
  giteaStatus as giteaStatusImpl,
  giteaPush as giteaPushImpl,
  giteaPull as giteaPullImpl,
  giteaCommit as giteaCommitImpl,
  giteaStage as giteaStageImpl,
  giteaUnstage as giteaUnstageImpl,
  giteaAbort as giteaAbortImpl,
  giteaForcePush as giteaForcePushImpl,
  giteaHardReset as giteaHardResetImpl,
  toggleGiteaFileSelection as toggleGiteaFileSelectionImpl,
  stageSelectedGiteaFiles as stageSelectedGiteaFilesImpl,
  stageAllGiteaFiles as stageAllGiteaFilesImpl,
  unstageAllGiteaFiles as unstageAllGiteaFilesImpl,
  updateGiteaPanel as updateGiteaPanelImpl,
  renderGiteaFiles as renderGiteaFilesImpl,
  showGiteaSettings as showGiteaSettingsImpl,
  giteaCreateRepo as giteaCreateRepoImpl,
  refreshGiteaPanelStrings as refreshGiteaPanelStringsImpl
} from '../gitea-integration.js';

import {
  refreshAllUIStrings as refreshAllUIStringsImpl
} from '../translations.js';

import {
  updateGitPanel as updateGitPanelImpl,
  renderGitFiles as renderGitFilesImpl,
  toggleGitGroup as toggleGitGroupImpl,
  toggleFileSelection as toggleFileSelectionImpl,
  stageSelectedFiles as stageSelectedFilesImpl,
  stageAllFiles as stageAllFilesImpl,
  unstageAllFiles as unstageAllFilesImpl,
  commitStagedFiles as commitStagedFilesImpl,
  applyVersionControlVisibility as applyVersionControlVisibilityImpl,
  refreshGitPanelStrings as refreshGitPanelStringsImpl
} from '../git-ui.js';

import {
  renderTabs as renderTabsImpl,
  activateTab as activateTabImpl,
  closeTab as closeTabImpl,
  closeAllTabs as closeAllTabsImpl,
  closeOtherTabs as closeOtherTabsImpl,
  closeTabsToRight as closeTabsToRightImpl,
  nextTab as nextTabImpl,
  previousTab as previousTabImpl,
  restoreOpenTabs as restoreOpenTabsImpl
} from '../tabs.js';

import {
  createEditor as createEditorImpl,
  createSecondaryEditor as createSecondaryEditorImpl,
  destroySecondaryEditor as destroySecondaryEditorImpl,
  createLinter as createLinterImpl,
  yamlLinter as yamlLinterImpl,
  detectIndentation as detectIndentationImpl,
  handleEditorChange as handleEditorChangeImpl,
  selectNextOccurrence as selectNextOccurrenceImpl
} from '../editor.js';

import {
  renderAssetPreview as renderAssetPreviewImpl,
  toggleMarkdownPreview as toggleMarkdownPreviewImpl
} from '../asset-preview.js';

import {
  updateAIVisibility as updateAIVisibilityImpl,
  toggleAISidebar as toggleAISidebarImpl,
  formatAiResponse as formatAiResponseImpl,
  copyCode as copyCodeImpl,
  sendAIChatMessage as sendAIChatMessageImpl
} from '../ai-ui.js';

import {
  showCommandPalette as showCommandPaletteImpl
} from '../command-palette.js';

import {
  reportIssue as reportIssueImpl,
  requestFeature as requestFeatureImpl,
  showShortcuts as showShortcutsImpl,
  hideShortcuts as hideShortcutsImpl
} from '../dialogs.js';

import {
  performGlobalSearch as performGlobalSearchImpl,
  performGlobalReplace as performGlobalReplaceImpl,
  initGlobalSearchWindowFunctions as initGlobalSearchWindowFunctionsImpl,
  triggerGlobalSearch as triggerGlobalSearchImpl
} from '../global-search.js';

import {
  showInputModal as showInputModalImpl,
  promptNewFile as promptNewFileImpl,
  promptNewFolder as promptNewFolderImpl,
  promptRename as promptRenameImpl,
  promptCopy as promptCopyImpl,
  promptMove as promptMoveImpl,
  duplicateItem as duplicateItemImpl,
  promptDelete as promptDeleteImpl
} from '../file-operations-ui.js';

import {
  toggleTerminal as toggleTerminalImpl,
  runCommand as runCommandImpl,
  setTerminalMode as setTerminalModeImpl,
  getTerminalContainer as getTerminalContainerImpl,
  fitTerminal as fitTerminalImpl,
  applyTerminalVisibility as applyTerminalVisibilityImpl,
  initTerminal as initTerminalImpl,
  openTerminalTab as openTerminalTabImpl,
  closeTerminalTab as closeTerminalTabImpl,
  onTerminalTabClosed as onTerminalTabClosedImpl,
  isTerminalFocused
} from '../terminal.js';

import {
  renderRecentFilesPanel as renderRecentFilesPanelImpl,
  addToRecentFiles as addToRecentFilesImpl
} from '../recent-files.js';

import {
  updateStatusBar as updateStatusBarImpl,
  initStatusBarEvents as initStatusBarEventsImpl
} from '../status-bar.js';

import {
  updateToolbarState as updateToolbarStateImpl
} from '../toolbar.js';

import {
  showContextMenu as showContextMenuImpl,
  showTabContextMenu as showTabContextMenuImpl,
  hideContextMenu as hideContextMenuImpl
} from '../context-menu.js';

import {
  updateSearchHighlights as updateSearchHighlightsImpl,
  updateMatchStatus as updateMatchStatusImpl,
  openSearchWidget as openSearchWidgetImpl,
  closeSearchWidget as closeSearchWidgetImpl,
  doFind as doFindImpl,
  doReplace as doReplaceImpl,
  doReplaceAll as doReplaceAllImpl
} from '../search.js';

import {
  updateBreadcrumb as updateBreadcrumbImpl,
  expandFolderInTree as expandFolderInTreeImpl
} from '../breadcrumb.js';

import {
  showSidebar as showSidebarImpl,
  hideSidebar as hideSidebarImpl,
  switchSidebarView as switchSidebarViewImpl,
  toggleSidebar as toggleSidebarImpl
} from '../sidebar.js';

import {
  isFavorite as isFavoriteImpl,
  toggleFavorite as toggleFavoriteImpl,
  renderFavoritesPanel as renderFavoritesPanelImpl
} from '../favorites.js';

import {
  initResizeHandle as initResizeHandleImpl
} from '../resize.js';

import {
  gitStatusPollingInterval as pollingInterval,
  checkFileUpdates as checkFileUpdatesImpl,
  startGitStatusPolling as startGitStatusPollingImpl
} from '../polling.js';

import {
  downloadCurrentFile as downloadCurrentFileImpl,
  downloadFileByPath as downloadFileByPathImpl,
  downloadContent as downloadContentImpl,
  downloadFolder as downloadFolderImpl,
  downloadSelectedItems as downloadSelectedItemsImpl,
  triggerUpload as triggerUploadImpl,
  processUploads as processUploadsImpl,
  handleFileUpload as handleFileUploadImpl,
  readFileAsText as readFileAsTextImpl,
  readFileAsBase64 as readFileAsBase64Impl,
  uploadFile as uploadFileImpl,
  triggerFolderUpload as triggerFolderUploadImpl,
  handleFolderUpload as handleFolderUploadImpl
} from '../downloads-uploads.js';

import {
  isSftpPath as isSftpPathImpl,
  parseSftpPath as parseSftpPathImpl,
  saveSftpFile as saveSftpFileImpl,
  renderSftpPanel as renderSftpPanelImpl,
  applySftpVisibility as applySftpVisibilityImpl,
  initSftpPanelButtons as initSftpPanelButtonsImpl,
  connectToServer as connectToServerImpl,
  navigateSftp as navigateSftpImpl,
  openSftpFile as openSftpFileImpl,
  showAddConnectionDialog as showAddConnectionDialogImpl,
  showEditConnectionDialog as showEditConnectionDialogImpl,
  deleteConnection as deleteConnectionImpl,
  refreshSftp as refreshSftpImpl,
  refreshSftpStrings as refreshSftpStringsImpl
} from '../sftp.js';

import {
  isTextFile,
  isMobile,
  getFileIcon,
  getEditorMode,
  getLanguageName,
  formatBytes,
  loadScript,
  ensureDiffLibrariesLoaded,
  copyToClipboard as copyToClipboardUtil,
  getTruePath as getTruePathImpl
} from '../utils.js';

import { 
  initFileCoordinator,
  saveFile as saveFileImpl,
  saveCurrentFile as saveCurrentFileImpl,
  setFileTreeLoading as setFileTreeLoadingImpl,
  loadFile as loadFileImpl,
  openFile as openFileImpl,
  loadFiles as loadFilesImpl
} from './FileCoordinator.js';
import { initGitCoordinator } from './GitCoordinator.js';
import { initSettingsCoordinator } from './SettingsCoordinator.js';
import { initDialogCoordinator } from './DialogCoordinator.js';
import { initTerminalCoordinator } from './TerminalCoordinator.js';
import { initUICoordinator } from './UICoordinator.js';
import { initSftpCoordinator } from './SftpCoordinator.js';

// Re-export EVERYTHING for app.js
export {
  initElementsImpl as initElements,
  showToastImpl as showToast,
  showGlobalLoadingImpl as showGlobalLoading,
  hideGlobalLoadingImpl as hideGlobalLoading,
  showModalImpl as showModal,
  getEffectiveThemeImpl as getEffectiveTheme,
  applyThemeImpl as applyTheme,
  applyCustomSyntaxColorsImpl as applyCustomSyntaxColors,
  applyEditorSettingsImpl as applyEditorSettings,
  applyLayoutSettingsImpl as applyLayoutSettings,
  setThemePresetImpl as setThemePreset,
  setAccentColorImpl as setAccentColor,
  setThemeImpl as setTheme,
  resetModalToDefaultImpl as resetModalToDefault,
  showConfirmDialogImpl as showConfirmDialog,
  hideModalImpl as hideModal,
  confirmModalImpl as confirmModal,
  setButtonLoadingImpl as setButtonLoading,
  restartHomeAssistantImpl as restartHomeAssistant,
  insertUUIDImpl as insertUUID,
  updateSplitViewButtonsImpl as updateSplitViewButtons,
  autoSaveTimer,
  fileTreeRenderTimer,
  copyItemImpl as copyItem,
  createFileImpl as createFile,
  createFolderImpl as createFolder,
  deleteItemImpl as deleteItem,
  renameItemImpl as renameItem,
  saveAllFilesImpl as saveAllFiles,
  triggerAutoSaveImpl as triggerAutoSave,
  clearAutoSaveTimerImpl as clearAutoSaveTimer,
  enableSplitViewImpl as enableSplitView,
  disableSplitViewImpl as disableSplitView,
  setActivePaneFromPositionImpl as setActivePaneFromPosition,
  moveToPrimaryPaneImpl as moveToPrimaryPane,
  moveToSecondaryPaneImpl as moveToSecondaryPane,
  getPaneForTabImpl as getPaneForTab,
  getActivePaneEditorImpl as getActivePaneEditor,
  updatePaneSizesImpl as updatePaneSizes,
  initSplitResizeImpl as initSplitResize,
  handleTabDragStartImpl as handleTabDragStart,
  handleTabDragOverImpl as handleTabDragOver,
  handleTabDropImpl as handleTabDrop,
  handleTabDragEndImpl as handleTabDragEnd,
  updatePaneActiveStateImpl as updatePaneActiveState,
  saveFileImpl as saveFile,
  saveCurrentFileImpl as saveCurrentFile,
  setFileTreeLoadingImpl as setFileTreeLoading,
  loadFileImpl as loadFile,
  openFileImpl as openFile,
  loadFilesImpl as loadFiles,
  loadSettingsImpl as loadSettings,  saveSettingsImpl as saveSettings,
  updateShowHiddenButtonImpl as updateShowHiddenButton,
  showAppSettingsImpl as showAppSettings,
  reportIssueImpl as reportIssue,
  requestFeatureImpl as requestFeature,
  showShortcutsImpl as showShortcuts,
  hideShortcutsImpl as hideShortcuts,
  toggleSelectionModeImpl as toggleSelectionMode,
  handleSelectionChangeImpl as handleSelectionChange,
  updateSelectionCountImpl as updateSelectionCount,
  deleteSelectedItemsImpl as deleteSelectedItems,
  formatCodeImpl as formatCode,
  validateYamlImpl as validateYaml,
  buildFileTreeImpl as buildFileTree,
  renderFileTreeImpl as renderFileTree,
  renderTreeLevelImpl as renderTreeLevel,
  handleFileDropMultiImpl as handleFileDropMulti,
  handleFileDropImpl as handleFileDrop,
  folderMatchesSearchImpl as folderMatchesSearch,
  createTreeItemImpl as createTreeItem,
  handleDragStartFileTreeImpl as handleDragStart,
  handleDragOverFileTreeImpl as handleDragOver,
  handleDragLeaveFileTreeImpl as handleDragLeave,
  handleDropFileTreeImpl as handleDrop,
  toggleFolderImpl as toggleFolder,
  loadDirectoryImpl as loadDirectory,
  updateToggleAllButtonImpl as updateToggleAllButton,
  debouncedRenderFileTreeImpl as debouncedRenderFileTree,
  debouncedContentSearchImpl as debouncedContentSearch,
  debouncedFilenameSearchImpl as debouncedFilenameSearch,
  performContentSearchImpl as performContentSearch,
  navigateBackImpl as navigateBack,
  showDiffModalImpl as showDiffModal,
  showGitHistoryImpl as showGitHistory,
  showGitCommitDiffImpl as showGitCommitDiff,
  isGitEnabledImpl as isGitEnabled,
  checkGitStatusIfEnabledImpl as checkGitStatusIfEnabled,
  gitStatusImpl as gitStatus, gitInitImpl as gitInit, abortGitOperationImpl as abortGitOperation,
  forcePushImpl as forcePush, hardResetImpl as hardReset, deleteRemoteBranchImpl as deleteRemoteBranch,
  gitGetRemotesImpl as gitGetRemotes, gitSetCredentialsImpl as gitSetCredentials, gitStageImpl as gitStage,
  handleGitLockAndRetryImpl as handleGitLockAndRetry, gitCleanLocksImpl as gitCleanLocks,
  gitRepairIndexImpl as gitRepairIndex, gitUnstageImpl as gitUnstage, gitResetImpl as gitReset,
  gitCommitImpl as gitCommit, gitPullImpl as gitPull, gitPushImpl as gitPush,
  gitAddRemoteImpl as gitAddRemote, githubCreateRepoImpl as githubCreateRepo, repairBranchMismatchImpl as repairBranchMismatch,
  gitTestConnectionImpl as gitTestConnection, gitClearCredentialsImpl as gitClearCredentials,
  githubDeviceFlowStartImpl as githubDeviceFlowStart, githubDeviceFlowPollImpl as githubDeviceFlowPoll,
  showGithubDeviceFlowLoginImpl as showGithubDeviceFlowLogin, showGitExclusionsImpl as showGitExclusions,
  showGitSettingsImpl as showGitSettings, showCreateGithubRepoDialogImpl as showCreateGithubRepoDialog,
  saveGitRemoteImpl as saveGitRemote, saveGitCredentialsImpl as saveGitCredentials, testGitConnectionImpl as testGitConnection,
  giteaInitImpl as giteaInit, giteaStatusImpl as giteaStatus, giteaPushImpl as giteaPush, giteaPullImpl as giteaPull,
  giteaCommitImpl as giteaCommit, giteaStageImpl as giteaStage, giteaUnstageImpl as giteaUnstage,
  giteaAbortImpl as giteaAbort, giteaForcePushImpl as giteaForcePush, giteaHardResetImpl as giteaHardReset,
  toggleGiteaFileSelectionImpl as toggleGiteaFileSelection, stageSelectedGiteaFilesImpl as stageSelectedGiteaFiles,
  stageAllGiteaFilesImpl as stageAllGiteaFiles, unstageAllGiteaFilesImpl as unstageAllGiteaFiles,
  updateGitPanelImpl as updateGitPanel, updateGiteaPanelImpl as updateGiteaPanel, renderGitFilesImpl as renderGitFiles,
  toggleGitGroupImpl as toggleGitGroup, toggleFileSelectionImpl as toggleFileSelection,
  stageSelectedFilesImpl as stageSelectedFiles, stageAllFilesImpl as stageAllFiles,
  unstageAllFilesImpl as unstageAllFiles, commitStagedFilesImpl as commitStagedFiles,
  showGiteaSettingsImpl as showGiteaSettings, giteaCreateRepoImpl as giteaCreateRepo, refreshGiteaPanelStringsImpl as refreshGiteaPanelStrings,
  refreshGitPanelStringsImpl as refreshGitPanelStrings,
  refreshAllUIStringsImpl as refreshAllUIStrings, renderTabsImpl as renderTabs, activateTabImpl as activateTab,
  closeTabImpl as closeTab, closeAllTabsImpl as closeAllTabs, closeOtherTabsImpl as closeOtherTabs,
  closeTabsToRightImpl as closeTabsToRight, nextTabImpl as nextTab, previousTabImpl as previousTab,
  restoreOpenTabsImpl as restoreOpenTabs, createEditorImpl as createEditor, createSecondaryEditorImpl as createSecondaryEditor,
  destroySecondaryEditorImpl as destroySecondaryEditor, createLinterImpl as createLinter,
  yamlLinterImpl as yamlLinter, detectIndentationImpl as detectIndentation, handleEditorChangeImpl as handleEditorChange,
  selectNextOccurrenceImpl as selectNextOccurrence, renderAssetPreviewImpl as renderAssetPreview,
  toggleMarkdownPreviewImpl as toggleMarkdownPreview, updateAIVisibilityImpl as updateAIVisibility,
  toggleAISidebarImpl as toggleAISidebar, formatAiResponseImpl as formatAiResponse, copyCodeImpl as copyCode,
  sendAIChatMessageImpl as sendAIChatMessage, showCommandPaletteImpl as showCommandPalette,
  performGlobalSearchImpl as performGlobalSearch, performGlobalReplaceImpl as performGlobalReplace,
  showInputModalImpl as showInputModal, promptNewFileImpl as promptNewFile,
  promptNewFolderImpl as promptNewFolder, promptRenameImpl as promptRename, promptCopyImpl as promptCopy,
  promptMoveImpl as promptMove, duplicateItemImpl as duplicateItem, promptDeleteImpl as promptDelete,
  toggleTerminalImpl as toggleTerminal, runCommandImpl as runCommand, setTerminalModeImpl as setTerminalMode,
  getTerminalContainerImpl as getTerminalContainer, fitTerminalImpl as fitTerminal, applyTerminalVisibilityImpl as applyTerminalVisibility,
  initTerminalImpl as initTerminal, openTerminalTabImpl as openTerminalTab, closeTerminalTabImpl as closeTerminalTab,
  renderRecentFilesPanelImpl as renderRecentFilesPanel, addToRecentFilesImpl as addToRecentFiles,
  updateStatusBarImpl as updateStatusBar, initStatusBarEventsImpl as initStatusBarEvents, updateToolbarStateImpl as updateToolbarState,
  showContextMenuImpl as showContextMenu, showTabContextMenuImpl as showTabContextMenu, hideContextMenuImpl as hideContextMenu,
  updateSearchHighlightsImpl as updateSearchHighlights, updateMatchStatusImpl as updateMatchStatus,
  openSearchWidgetImpl as openSearchWidget, closeSearchWidgetImpl as closeSearchWidget, doFindImpl as doFind,
  doReplaceImpl as doReplace, doReplaceAllImpl as doReplaceAll, updateBreadcrumbImpl as updateBreadcrumb,
  expandFolderInTreeImpl as expandFolderInTree, showSidebarImpl as showSidebar, hideSidebarImpl as hideSidebar,
  switchSidebarViewImpl as switchSidebarView, toggleSidebarImpl as toggleSidebar, isFavoriteImpl as isFavorite,
  toggleFavoriteImpl as toggleFavorite, renderFavoritesPanelImpl as renderFavoritesPanel, initResizeHandleImpl as initResizeHandle,
  pollingInterval as gitStatusPollingInterval, checkFileUpdatesImpl as checkFileUpdates, startGitStatusPollingImpl as startGitStatusPolling,
  downloadCurrentFileImpl as downloadCurrentFile, downloadFileByPathImpl as downloadFileByPath,
  downloadContentImpl as downloadContent, downloadFolderImpl as downloadFolder, downloadSelectedItemsImpl as downloadSelectedItems,
  triggerUploadImpl as triggerUpload, processUploadsImpl as processUploads, handleFileUploadImpl as handleFileUpload,
  readFileAsTextImpl as readFileAsText, readFileAsBase64Impl as readFileAsBase64, uploadFileImpl as uploadFile,
  triggerFolderUploadImpl as triggerFolderUpload, handleFolderUploadImpl as handleFolderUpload,
  isSftpPathImpl as isSftpPath, parseSftpPathImpl as parseSftpPath, saveSftpFileImpl as saveSftpFile,
  renderSftpPanelImpl as renderSftpPanel, applySftpVisibilityImpl as applySftpVisibility,
  connectToServerImpl as connectToServer, navigateSftpImpl as navigateSftp, openSftpFileImpl as openSftpFile,
  showAddConnectionDialogImpl as showAddConnectionDialog, showEditConnectionDialogImpl as showEditConnectionDialog,
  deleteConnectionImpl as deleteConnection, refreshSftpImpl as refreshSftp, refreshSftpStringsImpl as refreshSftpStrings,
  initSftpPanelButtonsImpl as initSftpPanelButtons,
  fetchWithAuth, getAuthTokenImpl as getAuthToken, isTextFile, isMobile, getFileIcon, getEditorMode,
  getLanguageName, formatBytes, loadScript, ensureDiffLibrariesLoaded, copyToClipboardUtil as copyToClipboard,
  getTruePathImpl as getTruePath, applyVersionControlVisibilityImpl as applyVersionControlVisibility
};

/**
 * Initialize all application coordinators and global event bus handlers
 */
export function initializeEventHandlers() {
  // Initialize Coordinators
  initFileCoordinator({
    saveAllFiles: saveAllFilesImpl,
    toggleFavorite: toggleFavoriteImpl,
    validateYaml: validateYamlImpl,
    triggerAutoSave: triggerAutoSaveImpl,
    checkFileUpdates: checkFileUpdatesImpl,
    addToRecentFiles: addToRecentFilesImpl,
    updateToolbarState: updateToolbarStateImpl
  });

  initGitCoordinator({
    showGitHistory: showGitHistoryImpl,
    updateGitPanel: updateGitPanelImpl,
    updateGiteaPanel: updateGiteaPanelImpl,
    showDiffModal: showDiffModalImpl,
    toggleGitGroup: toggleGitGroupImpl,
    stageSelectedFiles: stageSelectedFilesImpl,
    stageAllFiles: stageAllFilesImpl,
    unstageAllFiles: unstageAllFilesImpl,
    commitStagedFiles: commitStagedFilesImpl,
    toggleFileSelection: toggleFileSelectionImpl,
    showGithubDeviceFlowLogin: showGithubDeviceFlowLoginImpl,
    showGitExclusions: showGitExclusionsImpl,
    showGitSettings: showGitSettingsImpl,
    showCreateGithubRepoDialog: showCreateGithubRepoDialogImpl,
    showGiteaSettings: showGiteaSettingsImpl,
    applyVersionControlVisibility: applyVersionControlVisibilityImpl
  });

  initSettingsCoordinator({
    applyTheme: applyThemeImpl,
    applyEditorSettings: applyEditorSettingsImpl,
    applyLayoutSettings: applyLayoutSettingsImpl,
    updateAIVisibility: updateAIVisibilityImpl,
    saveSettings: saveSettingsImpl,
    refreshAllUIStrings: refreshAllUIStringsImpl,
    showAppSettings: showAppSettingsImpl,
    setThemePreset: setThemePresetImpl,
    applyCustomSyntaxColors: applyCustomSyntaxColorsImpl
  });

  initDialogCoordinator({
    showShortcuts: showShortcutsImpl,
    hideShortcuts: hideShortcutsImpl,
    reportIssue: reportIssueImpl,
    requestFeature: requestFeatureImpl,
    restartHomeAssistant: restartHomeAssistantImpl,
    openDevTools: openDevToolsImpl,
    showCommandPalette: showCommandPaletteImpl,
    hideModal: hideModalImpl,
    confirmModal: confirmModalImpl
  });

  initTerminalCoordinator({
    toggleTerminal: toggleTerminalImpl,
    openTerminalTab: openTerminalTabImpl,
    closeTerminalTab: closeTerminalTabImpl,
    onTerminalTabClosed: onTerminalTabClosedImpl,
    runCommand: runCommandImpl,
    fitTerminal: fitTerminalImpl,
    getAuthToken: getAuthTokenImpl,
    applyTerminalVisibility: applyTerminalVisibilityImpl
  });

  initSftpCoordinator({
    connectToServer: connectToServerImpl,
    navigateSftp: (path) => navigateSftpImpl(state.activeSftp.connectionId, path),
    openSftpFile: openSftpFileImpl,
    showAddConnectionDialog: showAddConnectionDialogImpl,
    showEditConnectionDialog: showEditConnectionDialogImpl,
    deleteConnection: deleteConnectionImpl,
    refreshSftp: refreshSftpImpl,
    saveSftpFile: saveSftpFileImpl,
    applySftpVisibility: applySftpVisibilityImpl,
    refreshSftpStrings: refreshSftpStringsImpl
  });

  initUICoordinator({
    renderRecentFilesPanel: renderRecentFilesPanelImpl,
    renderFileTree: renderFileTreeImpl,
    renderTabs: renderTabsImpl,
    updateShowHiddenButton: updateShowHiddenButtonImpl,
    showToast: showToastImpl,
    showGitExclusions: showGitExclusionsImpl,
    resetModalToDefault: resetModalToDefaultImpl,
    hideModal: hideModalImpl,
    handleSelectionChange: handleSelectionChangeImpl,
    renderSftpPanel: renderSftpPanelImpl,
    navigateSftp: (path) => navigateSftpImpl(state.activeSftp.connectionId, path),
    refreshSftp: refreshSftpImpl,
    triggerFolderUpload: triggerFolderUploadImpl,
    toggleSelectionMode: toggleSelectionModeImpl,
    processUploads: processUploadsImpl,
    insertUUID: insertUUIDImpl,
    toggleSidebar: toggleSidebarImpl,
    hideSidebar: hideSidebarImpl,
    showContextMenu: showContextMenuImpl,
    showTabContextMenu: showTabContextMenuImpl,
    hideContextMenu: hideContextMenuImpl,
    renderFavoritesPanel: renderFavoritesPanelImpl,
    switchSidebarView: switchSidebarViewImpl,
    setActivePaneFromPosition: setActivePaneFromPositionImpl,
    handleTabDragStart: handleTabDragStartImpl,
    handleTabDragOver: handleTabDragOverImpl,
    handleTabDrop: handleTabDropImpl,
    handleTabDragEnd: handleTabDragEndImpl,
    openSearchWidget: openSearchWidgetImpl,
    closeSearchWidget: closeSearchWidgetImpl,
    updateStatusBar: updateStatusBarImpl,
    updatePaneActiveState: updatePaneActiveStateImpl,
    createSecondaryEditor: createSecondaryEditorImpl,
    destroySecondaryEditor: destroySecondaryEditorImpl,
    moveToPrimaryPane: moveToPrimaryPaneImpl,
    moveToSecondaryPane: moveToSecondaryPaneImpl,
    updateSplitViewButtons: updateSplitViewButtonsImpl,
    navigateBack: navigateBackImpl,
    debouncedContentSearch: debouncedContentSearchImpl,
    debouncedFilenameSearch: debouncedFilenameSearchImpl,
    performGlobalSearch: performGlobalSearchImpl,
    performGlobalReplace: performGlobalReplaceImpl,
    triggerGlobalSearch: triggerGlobalSearchImpl,
    toggleMarkdownPreview: toggleMarkdownPreviewImpl,
    toggleAISidebar: toggleAISidebarImpl,
    updateAIVisibility: updateAIVisibilityImpl,
    sendAIChatMessage: sendAIChatMessageImpl,
    formatCode: formatCodeImpl,
    handleDragStart: handleDragStartFileTreeImpl,
    handleDragOver: handleDragOverFileTreeImpl,
    handleDragLeave: handleDragLeaveFileTreeImpl,
    handleDrop: handleDropFileTreeImpl,
    showAppSettings: showAppSettingsImpl,
    toggleTerminal: toggleTerminalImpl
  });

  // App Lifecycle Events
  eventBus.on('app:restore-tabs', async () => {
    await restoreOpenTabsImpl();
  });

  // Global UI Initializations
  // Migrated to SftpCoordinator and UICoordinator

  // Global Window/Document Listeners
  // Hide context menu on outside click
  document.addEventListener("click", hideContextMenuImpl);

  // Keyboard shortcuts - using capture phase to intercept before browser
  window.addEventListener("keydown", (e) => {
    // When the terminal has focus, all keystrokes belong to the PTY.
    // Do not intercept anything — let xterm handle it.
    if (isTerminalFocused()) return;

    // Ctrl + Shift + ] - Next Tab (all platforms, including macOS)
    const isNextTabShortcut =
      (e.key === "]" || e.key === "}" || e.code === "BracketRight") &&
      e.ctrlKey && e.shiftKey && !e.metaKey;

    if (isNextTabShortcut) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('tab:next');
      return false;
    }

    // Ctrl + Shift + [ - Previous Tab (all platforms, including macOS)
    const isPrevTabShortcut =
      (e.key === "[" || e.key === "{" || e.code === "BracketLeft") &&
      e.ctrlKey && e.shiftKey && !e.metaKey;

    if (isPrevTabShortcut) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('tab:previous');
      return false;
    }

    // Alt/Option + W - Close Tab
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === "w" || e.code === "KeyW")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (state.activeTab) {
        eventBus.emit('tab:close', { tab: state.activeTab });
      }
      return false;
    }

    // Ctrl + S - Save
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "s" || e.code === "KeyS")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.shiftKey) {
        eventBus.emit('file:save-all');
      } else {
        eventBus.emit('file:save-current');
      }
      return false;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === "z" || e.code === "KeyZ")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('ai:undo-diff');
      return false;
    }

    // Ctrl + B - Toggle Sidebar
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "b" || e.code === "KeyB")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('ui:toggle-sidebar');
      return false;
    }

    // Ctrl + Shift + U - Insert UUID
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === "u" || e.code === "KeyU")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('ui:insert-uuid');
      return false;
    }

    // Ctrl + / - Toggle Comment
    if ((e.ctrlKey || e.metaKey) && (e.key === "/" || e.code === "Slash")) {
      // Note: toggleComment is a CodeMirror command, we need the editor to handle it
      // but we can emit a signal for it
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('editor:toggle-comment');
      return false;
    }

    // Ctrl + 1 / Ctrl + 2 - Focus Panes
    if ((e.ctrlKey || e.metaKey) && (e.key === "1" || e.key === "2")) {
      e.preventDefault();
      const pane = e.key === "1" ? "primary" : "secondary";
      eventBus.emit('ui:set-active-pane', { pane });
      return false;
    }

    // Ctrl + Shift + F - Global Search
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === "f" || e.code === "KeyF")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('ui:switch-sidebar-view', "search");
      // Focus the global search input
      setTimeout(() => {
        if (elements.globalSearchInput) elements.globalSearchInput.focus();
      }, 50);
      return false;
    }

    // Ctrl + F - Find
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "f" || e.code === "KeyF")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('search:open');
      return false;
    }

    // Ctrl + K - Command Palette (with > prefix)
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('ui:show-command-palette', { initialMode: ">" });
      return false;
    }

    // Ctrl + E / Ctrl + T - Quick Switcher (File Search)
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "e" || e.code === "KeyE" || e.key.toLowerCase() === "t" || e.code === "KeyT")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('ui:show-command-palette', { initialMode: "" });
      return false;
    }

    // Ctrl + H - Replace
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "h" || e.code === "KeyH")) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('search:open', { replace: true });
      return false;
    }

    // Ctrl + ` - Toggle Terminal
    if ((e.ctrlKey || e.metaKey) && (e.key === "`" || e.code === "Backquote") && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggleTerminalImpl();
      return false;
    }

    // Ctrl + Shift + G - Toggle Git Panel collapse
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === "g" || e.code === "KeyG") && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('git:toggle-panel');
      return false;
    }

    // Shift + Alt + F - Format / indent YAML
    if (e.shiftKey && e.altKey && (e.key.toLowerCase() === "f" || e.code === "KeyF") && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('file:format');
      return false;
    }

    // F1 - Show Keyboard Shortcuts
    if (e.key === "F1") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      eventBus.emit('ui:show-shortcuts');
      return false;
    }

    // Escape - Close various UI elements
    if (e.key === "Escape") {
      let handled = false;

      // 1. Shortcuts Overlay
      if (elements.shortcutsOverlay?.classList.contains("visible")) {
        eventBus.emit('ui:hide-shortcuts');
        handled = true;
      }
      // 2. Command Palette / Quick Switcher
      else if (elements.commandPaletteOverlay?.classList.contains("visible")) {
        // Command palette handles its own escape, but we can ensure it here
        elements.commandPaletteOverlay.classList.remove("visible");
        handled = true;
      }
      // 3. Generic Modal (Dialogs)
      else if (elements.modalOverlay?.classList.contains("visible")) {
        eventBus.emit('ui:hide-modal');
        handled = true;
      }
      // 4. Support Modal
      else if (elements.modalSupportOverlay?.classList.contains("visible")) {
        elements.modalSupportOverlay.classList.remove("visible");
        handled = true;
      }
      // 5. Search Widget
      else if (state.searchWidgetVisible) {
        eventBus.emit('search:close');
        handled = true;
      }
      // 6. AI Sidebar
      else if (state.aiSidebarVisible) {
        eventBus.emit('ui:toggle-ai-sidebar', false);
        handled = true;
      }
      // 7. Theme Menu
      else if (elements.themeMenu?.classList.contains("visible")) {
        elements.themeMenu.classList.remove("visible");
        handled = true;
      }

      // Hide context menu (always safe)
      hideContextMenuImpl();

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  });

  // Window resize
  window.addEventListener("resize", () => {
    const wasMobile = state.isMobile;
    state.isMobile = isMobile();

    if (wasMobile !== state.isMobile) {
      if (state.isMobile) {
        hideSidebarImpl();
      } else {
        showSidebarImpl();
      }
    }

    // Refresh editor
    if (state.editor) {
      setTimeout(() => state.editor.refresh(), 100);
    }
  });

  // Before unload warning
  window.addEventListener("beforeunload", (e) => {
    if (state.openTabs.some((t) => t.modified)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // System theme change (for auto mode)
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "auto") {
      applyThemeImpl();
    }
  });

  // Visibility change - refresh editor when page/tab becomes visible
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.editor) {
      setTimeout(() => state.editor.refresh(), 50);
      setTimeout(() => state.editor.refresh(), 150);
      setTimeout(() => state.editor.refresh(), 300);
    }
  });

  // Also handle focus on the window (helps with HA mobile apps)
  window.addEventListener("focus", () => {
    if (state.editor) {
      setTimeout(() => state.editor.refresh(), 50);
      setTimeout(() => state.editor.refresh(), 150);
    }
  });

  // Touch Gestures for Mobile Sidebar
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].screenY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // Ignore vertical scrolls (stricter ratio to avoid capturing horizontal scroll)
    if (Math.abs(diffY) > Math.abs(diffX) * 1.5) return;

    // AI sidebar swipe: swipe left from right edge to open, swipe right to close
    const aiSidebar = document.querySelector('.ai-sidebar');
    if (touchStartX > window.innerWidth - 50 && diffX < -60) {
      toggleAISidebarImpl(true);
      return;
    }
    if (aiSidebar && aiSidebar.classList.contains('visible') && diffX > 60) {
      const touchStartedInsideAI = touchStartX > window.innerWidth - aiSidebar.offsetWidth;
      if (touchStartedInsideAI) {
        toggleAISidebarImpl(false);
        return;
      }
    }

    // Threshold for horizontal swipe (100px)
    if (Math.abs(diffX) > 100) {
      if (diffX > 0) {
        // Swipe Right -> Open Sidebar
        if (touchStartX < 50 && !state.sidebarVisible) {
          showSidebarImpl();
        }
      } else {
        // Swipe Left -> Close Sidebar
        if (state.sidebarVisible) {
          hideSidebarImpl();
        }
      }
    }
  }, { passive: true });

  // Floating command palette button on mobile
  if (isMobile()) {
    const mobileCmdBtn = document.createElement('button');
    mobileCmdBtn.id = 'mobile-cmd-btn';
    mobileCmdBtn.title = 'Command Palette';
    mobileCmdBtn.innerHTML = '<span class="material-icons" style="font-size:20px;vertical-align:middle;">bolt</span>';

    const FAB_SIZE = 48;
    const FAB_EDGE_PAD = 16;
    const FAB_TOP_MIN = 80;
    const FAB_BOTTOM_MIN = 80;

    // Default position: bottom-right (mirroring original bottom+right style)
    const defaultTop = window.innerHeight - FAB_SIZE - FAB_BOTTOM_MIN;
    const defaultLeft = window.innerWidth - FAB_SIZE - FAB_EDGE_PAD;

    mobileCmdBtn.style.cssText = `
      position: fixed;
      top: ${defaultTop}px;
      left: ${defaultLeft}px;
      z-index: 8000;
      width: ${FAB_SIZE}px;
      height: ${FAB_SIZE}px;
      border-radius: 24px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--accent-color, #5c8df6);
      color: #fff;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      touch-action: none;
      -webkit-tap-highlight-color: transparent;
    `;

    // Restore saved position from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('bp_fab_pos') || 'null');
      if (saved && typeof saved.top === 'number' && (saved.side === 'left' || saved.side === 'right')) {
        const clampedTop = Math.max(FAB_TOP_MIN, Math.min(saved.top, window.innerHeight - FAB_SIZE - FAB_BOTTOM_MIN));
        mobileCmdBtn.style.top = clampedTop + 'px';
        if (saved.side === 'left') {
          mobileCmdBtn.style.left = FAB_EDGE_PAD + 'px';
        } else {
          mobileCmdBtn.style.left = (window.innerWidth - FAB_SIZE - FAB_EDGE_PAD) + 'px';
        }
      }
    } catch (_) { /* ignore parse errors */ }

    // Drag state
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    mobileCmdBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // Prevent document swipe-sidebar handler from firing
      const touch = e.touches[0];
      const rect = mobileCmdBtn.getBoundingClientRect();
      // Offset from touch point to button top-left corner
      dragOffsetX = touch.clientX - rect.left;
      dragOffsetY = touch.clientY - rect.top;
      dragStartX = touch.clientX;
      dragStartY = touch.clientY;
      isDragging = false;
      // Remove any lingering snap transition
      mobileCmdBtn.style.transition = 'none';
    }, { passive: false });

    mobileCmdBtn.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      const movedX = Math.abs(touch.clientX - dragStartX);
      const movedY = Math.abs(touch.clientY - dragStartY);

      if (!isDragging && movedX < 5 && movedY < 5) return;

      e.preventDefault(); // Prevent page scroll while dragging

      if (!isDragging) {
        isDragging = true;
        mobileCmdBtn.classList.add('bf-fab-dragging');
        mobileCmdBtn.style.transition = 'none';
        mobileCmdBtn.style.opacity = '0.85';
        mobileCmdBtn.style.transform = 'scale(1.1)';
      }

      const newLeft = touch.clientX - dragOffsetX;
      const newTop = touch.clientY - dragOffsetY;

      // Clamp within viewport with edge padding
      const clampedLeft = Math.max(FAB_EDGE_PAD, Math.min(newLeft, window.innerWidth - FAB_SIZE - FAB_EDGE_PAD));
      const clampedTop = Math.max(FAB_TOP_MIN, Math.min(newTop, window.innerHeight - FAB_SIZE - FAB_BOTTOM_MIN));

      mobileCmdBtn.style.left = clampedLeft + 'px';
      mobileCmdBtn.style.top = clampedTop + 'px';
    }, { passive: false });

    mobileCmdBtn.addEventListener('touchend', (e) => {
      mobileCmdBtn.classList.remove('bf-fab-dragging');
      mobileCmdBtn.style.opacity = '';
      mobileCmdBtn.style.transform = '';

      if (!isDragging) {
        // Treat as tap — open command palette
        showCommandPaletteImpl();
        return;
      }

      // Snap to nearest horizontal edge
      const rect = mobileCmdBtn.getBoundingClientRect();
      const btnCenterX = rect.left + FAB_SIZE / 2;
      const snapToLeft = btnCenterX < window.innerWidth / 2;
      const snappedLeft = snapToLeft ? FAB_EDGE_PAD : window.innerWidth - FAB_SIZE - FAB_EDGE_PAD;
      const snappedTop = Math.max(FAB_TOP_MIN, Math.min(rect.top, window.innerHeight - FAB_SIZE - FAB_BOTTOM_MIN));
      const side = snapToLeft ? 'left' : 'right';

      // Animate snap
      mobileCmdBtn.style.transition = 'left 0.2s ease, top 0.2s ease';
      mobileCmdBtn.style.left = snappedLeft + 'px';
      mobileCmdBtn.style.top = snappedTop + 'px';

      // Remove transition after animation completes
      setTimeout(() => {
        mobileCmdBtn.style.transition = 'none';
      }, 220);

      // Persist position
      try {
        localStorage.setItem('bp_fab_pos', JSON.stringify({ side, top: snappedTop }));
      } catch (_) { /* ignore storage errors */ }

      isDragging = false;
    }, { passive: true });

    document.body.appendChild(mobileCmdBtn);
  }
}
