/** TABS.JS | Purpose: * Handles tab bar rendering, tab navigation, and tab-related UI operations. */
import { state, elements } from './state.js';
import { getFileIcon, getEditorMode, isTextFile, enableLongPressContextMenu } from './utils.js';
import { eventBus } from './event-bus.js';
import { API_BASE, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from './constants.js';
import { fetchWithAuth } from './api.js';
import { 
    getPaneForTab, 
    updatePaneActiveState,
    isResponsiveSinglePaneSplit,
    enableSplitView,
    disableSplitView,
    updatePaneSizes,
    initSplitResize
} from './split-view.js';
import { cleanupMarkdownPreview } from './asset-preview.js';
import { showConfirmDialog } from './ui.js';
import { 
    getTerminalContainer, 
    initTerminal, 
    fitTerminal,
    toggleTerminal as toggleTerminalImpl,
    setTerminalMode
} from './terminal.js';
import {
    createEditor,
    createSecondaryEditor,
    handleEditorChange,
    createLinter,
    detectIndentation
} from './editor.js';
import {
    applyEditorSettings,
    applyTheme,
    applyLayoutSettings,
    applyCustomSyntaxColors,
    resetModalToDefault
} from './ui.js';
import { applyMinimapState } from './minimap.js';
import {
    updateToolbarState
} from './toolbar.js';
import {
    updateStatusBar
} from './status-bar.js';
import {
    saveSettings as saveSettingsImpl
} from './settings.js';
import {
    isSftpPath as isSftpPathImpl,
    parseSftpPath as parseSftpPathImpl,
    openSftpFile as openSftpFileImpl
} from './sftp.js';
import { setOverflowTooltip } from './tooltip.js';
import { getEditorConfigIndent } from './editorconfig.js';
import { restoreWelcomeWorkspace } from './editor-workflow.js';

/**
 * Pause all playing <video> and <audio> elements in the asset preview containers.
 * Called when closing or switching away from a media tab.
 */
function stopActiveMedia() {
  const containers = [elements.assetPreview, document.getElementById('secondary-asset-preview')];
  for (const container of containers) {
    if (!container) continue;
    container.querySelectorAll('video, audio').forEach(el => {
      el.pause();
      el.removeAttribute('src');
      el.load(); // release media resources
    });
  }
}

const TAB_LIST_PANES = ['primary', 'secondary'];
const recentlyClosedTabs = [];
const MAX_RECENTLY_CLOSED_TABS = 10;
let tabListControlsInitialized = false;

function escapeMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function tabLocation(tab) {
  if (tab.isTerminal || tab.path.startsWith('terminal://')) return { label: 'Terminal', icon: 'terminal', className: 'is-terminal' };
  if (isSftpPathImpl(tab.path)) return { label: 'SFTP', icon: 'cloud', className: 'is-remote' };
  return { label: 'Local', icon: 'home', className: 'is-local' };
}

function tabStatus(tab, active = false) {
  if (tab.saveState === 'saving') return { label: 'Saving', icon: 'sync', className: 'is-saving' };
  if (tab.saveState === 'failed') return { label: 'Save failed', icon: 'error', className: 'is-error' };
  if (tab.saveState === 'saved') return { label: 'Saved', icon: 'check_circle', className: 'is-saved' };
  if (tab.externalConflict) return { label: 'Conflict', icon: 'warning', className: 'is-error' };
  if (tab.externallyChanged) return { label: 'Changed outside', icon: 'sync_problem', className: 'is-external' };
  if (tab.modified) return { label: 'Unsaved', icon: 'circle', className: 'is-dirty' };
  if (state.markdownPreviewActive && tab.path.endsWith('.md') && active) return { label: 'Preview', icon: 'visibility', className: 'is-preview' };
  if (state.favoriteFiles.includes(tab.path)) return { label: 'Pinned', icon: 'push_pin', className: 'is-pinned' };
  if (active) return { label: 'Active', icon: 'check', className: 'is-active' };
  return null;
}

function rememberClosedTabs(tabs) {
  tabs.filter((tab) => tab?.path && !tab.isTerminal).forEach((tab) => {
    const existing = recentlyClosedTabs.findIndex((entry) => entry.path === tab.path);
    if (existing !== -1) recentlyClosedTabs.splice(existing, 1);
    recentlyClosedTabs.unshift({ path: tab.path, closedAt: Date.now() });
  });
  recentlyClosedTabs.splice(MAX_RECENTLY_CLOSED_TABS);
}

function reopenClosedTab(pane, entry) {
  const index = recentlyClosedTabs.indexOf(entry);
  if (index !== -1) recentlyClosedTabs.splice(index, 1);
  if (state.splitView?.enabled) eventBus.emit('ui:set-active-pane', { pane });
  eventBus.emit('file:open', { path: entry.path });
  closeTabList(pane);
  renderTabs();
}

function paneTabEntries(pane) {
  if (isResponsiveSinglePaneSplit()) {
    if (pane !== state.splitView.activePane) return [];
    return state.openTabs.map((tab, tabIndex) => ({
      tab,
      tabIndex,
      pane: getPaneForTab(tabIndex) || state.splitView.activePane,
      active: tab === state.activeTab,
    }));
  }
  if (!state.splitView?.enabled) {
    return pane === 'primary'
      ? state.openTabs.map((tab, tabIndex) => ({ tab, tabIndex, pane: 'primary', active: tab === state.activeTab }))
      : [];
  }
  const tabIndices = pane === 'primary' ? state.splitView.primaryTabs : state.splitView.secondaryTabs;
  const activeTab = pane === 'primary' ? state.splitView.primaryActiveTab : state.splitView.secondaryActiveTab;
  return tabIndices
    .filter((tabIndex) => tabIndex >= 0 && tabIndex < state.openTabs.length)
    .map((tabIndex) => ({ tab: state.openTabs[tabIndex], tabIndex, pane, active: state.openTabs[tabIndex] === activeTab }));
}

function closeTabList(pane, restoreFocus = false) {
  const trigger = document.getElementById(`${pane}-tab-list-trigger`);
  const menu = document.getElementById(`${pane}-tab-list-menu`);
  if (!trigger || !menu) return;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
}

function closeAllTabLists(exceptPane = null) {
  TAB_LIST_PANES.forEach((pane) => {
    if (pane !== exceptPane) closeTabList(pane);
  });
}

function activateListedTab(pane, tab) {
  if (state.splitView?.enabled) eventBus.emit('ui:set-active-pane', { pane });
  eventBus.emit('tab:activate', { tab });
  closeTabList(pane);
  renderTabs();
  eventBus.emit('ui:refresh-tree');
}

function rebuildTabList(pane) {
  const trigger = document.getElementById(`${pane}-tab-list-trigger`);
  const menu = document.getElementById(`${pane}-tab-list-menu`);
  if (!trigger || !menu) return;
  const entries = paneTabEntries(pane);
  trigger.hidden = entries.length === 0 && recentlyClosedTabs.length === 0;
  menu.replaceChildren();

  if (entries.length) {
    const heading = document.createElement('div');
    heading.className = 'tab-list-heading';
    heading.textContent = 'Open files';
    menu.appendChild(heading);
  }

  entries.forEach(({ tab, active, pane: targetPane }) => {
    const item = document.createElement('button');
    const icon = tab.isTerminal ? { icon: 'terminal', class: 'default' } : getFileIcon(tab.path);
    const fileName = tab.path.split('/').pop();
    const parentPath = tab.path.includes('/') ? tab.path.split('/').slice(0, -1).join('/') : tab.path;
    item.type = 'button';
    item.className = 'ui-menu__item tab-list-item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-current', active ? 'page' : 'false');
    const location = tabLocation(tab);
    const currentStatus = tabStatus(tab, active);
    item.setAttribute('aria-label', `${fileName}, ${location.label}${currentStatus ? `, ${currentStatus.label}` : ''}`);

    const iconNode = document.createElement('span');
    iconNode.className = `tab-list-item-icon ui-icon material-icons ${icon.class}`;
    iconNode.setAttribute('aria-hidden', 'true');
    iconNode.textContent = icon.icon;
    const copy = document.createElement('span');
    copy.className = 'tab-list-item-copy';
    const name = document.createElement('span');
    name.className = 'tab-list-item-name';
    name.textContent = fileName;
    const path = document.createElement('span');
    path.className = 'tab-list-item-path';
    path.textContent = `${location.label} · ${parentPath}`;
    copy.append(name, path);
    item.append(iconNode, copy);
    if (currentStatus) {
      const status = document.createElement('span');
      status.className = `tab-list-item-status ${currentStatus.className}`;
      status.innerHTML = `<span class="ui-icon material-icons" aria-hidden="true">${currentStatus.icon}</span><span>${currentStatus.label}</span>`;
      item.appendChild(status);
    }
    item.addEventListener('click', () => activateListedTab(targetPane, tab));
    menu.appendChild(item);
  });

  if (recentlyClosedTabs.length) {
    const heading = document.createElement('div');
    heading.className = 'tab-list-heading tab-list-heading--recent';
    heading.textContent = 'Recently closed';
    menu.appendChild(heading);
    recentlyClosedTabs.forEach((entry) => {
      const item = document.createElement('button');
      const location = isSftpPathImpl(entry.path) ? 'SFTP' : 'Local';
      item.type = 'button';
      item.className = 'ui-menu__item tab-list-item recently-closed-tab';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('aria-label', `Reopen ${entry.path}`);
      item.innerHTML = `<span class="tab-list-item-icon ui-icon material-icons" aria-hidden="true">restore</span><span class="tab-list-item-copy"><span class="tab-list-item-name"></span><span class="tab-list-item-path"></span></span>`;
      item.querySelector('.tab-list-item-name').textContent = entry.path.split('/').pop();
      item.querySelector('.tab-list-item-path').textContent = `${location} · ${entry.path}`;
      item.addEventListener('click', () => reopenClosedTab(pane, entry));
      menu.appendChild(item);
    });
  }

  if (!entries.length) closeTabList(pane);
}

function initializeTabListControls() {
  if (tabListControlsInitialized) return;
  const controls = TAB_LIST_PANES.map((pane) => ({
    pane,
    trigger: document.getElementById(`${pane}-tab-list-trigger`),
    menu: document.getElementById(`${pane}-tab-list-menu`),
  }));
  if (controls.some(({ trigger, menu }) => !trigger || !menu)) return;
  tabListControlsInitialized = true;

  controls.forEach(({ pane, trigger, menu }) => {
    trigger.addEventListener('click', () => {
      const shouldOpen = menu.hidden;
      closeAllTabLists(shouldOpen ? pane : null);
      menu.hidden = !shouldOpen;
      trigger.setAttribute('aria-expanded', String(shouldOpen));
      if (shouldOpen) menu.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (menu.hidden) trigger.click();
      menu.querySelector('.tab-list-item')?.focus();
    });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('.tab-list-item')];
      const currentIndex = items.indexOf(document.activeElement);
      let targetIndex = null;
      if (event.key === 'ArrowDown') targetIndex = (currentIndex + 1) % items.length;
      if (event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + items.length) % items.length;
      if (event.key === 'Home') targetIndex = 0;
      if (event.key === 'End') targetIndex = items.length - 1;
      if (targetIndex !== null && items.length) {
        event.preventDefault();
        items[targetIndex].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeTabList(pane, true);
      }
    });
  });

  document.addEventListener('pointerdown', (event) => {
    controls.forEach(({ pane, trigger, menu }) => {
      if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) closeTabList(pane);
    });
  });
  window.addEventListener('resize', () => closeAllTabLists());
}

/**
 * Renders the tab bar UI
 * Shows tabs separately for each pane when split view is enabled
 * Optimized with DocumentFragment for better performance
 */
export function renderTabs() {
  const primaryContainer = document.getElementById('primary-tabs-container');
  const secondaryContainer = document.getElementById('secondary-tabs-container');

  if (!primaryContainer) return;
  initializeTabListControls();

  // Clear both containers
  primaryContainer.innerHTML = "";
  if (secondaryContainer) {
    secondaryContainer.innerHTML = "";
  }

  if (state.splitView && state.splitView.enabled) {
    // Split view mode - render tabs separately for each pane

    // Use DocumentFragment for batch DOM insertion (performance optimization)
    const primaryFragment = document.createDocumentFragment();
    const secondaryFragment = document.createDocumentFragment();

    // Render primary pane tabs
    state.splitView.primaryTabs.forEach((tabIndex) => {
      if (tabIndex >= 0 && tabIndex < state.openTabs.length) {
        const tab = state.openTabs[tabIndex];
        const isActive = tab === state.splitView.primaryActiveTab;
        const tabEl = createTabElement(tab, tabIndex, isActive, 'primary');
        primaryFragment.appendChild(tabEl);
      }
    });
    primaryContainer.appendChild(primaryFragment); // Single DOM operation

    // Render secondary pane tabs
    if (secondaryContainer) {
      state.splitView.secondaryTabs.forEach((tabIndex) => {
        if (tabIndex >= 0 && tabIndex < state.openTabs.length) {
          const tab = state.openTabs[tabIndex];
          const isActive = tab === state.splitView.secondaryActiveTab;
          const tabEl = createTabElement(tab, tabIndex, isActive, 'secondary');
          secondaryFragment.appendChild(tabEl);
        }
      });
      secondaryContainer.appendChild(secondaryFragment); // Single DOM operation
    }
  } else {
    // Normal single pane mode - render all tabs in primary container
    // Use DocumentFragment for batch DOM insertion (performance optimization)
    const fragment = document.createDocumentFragment();
    state.openTabs.forEach((tab, tabIndex) => {
      const isActive = tab === state.activeTab;
      const tabEl = createTabElement(tab, tabIndex, isActive, null);
      fragment.appendChild(tabEl);
    });
    primaryContainer.appendChild(fragment); // Single DOM operation instead of N operations
  }

  TAB_LIST_PANES.forEach(rebuildTabList);
  window.requestAnimationFrame(() => {
    primaryContainer.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    secondaryContainer?.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
}

/**
 * Creates a tab element
 */
function createTabElement(tab, tabIndex, isActive, pane) {
  const tabEl = document.createElement("div");
  tabEl.className = `tab ${isActive ? "active" : ""}`;
  tabEl.setAttribute('data-tab-index', tabIndex);
  tabEl.setAttribute('draggable', 'true');
  tabEl.setAttribute('role', 'tab');
  tabEl.setAttribute('aria-selected', String(isActive));
  tabEl.tabIndex = isActive ? 0 : -1;

  if (pane) {
    tabEl.setAttribute('data-pane', pane);
  }

  let icon;
  if (tab.isTerminal) {
    icon = { icon: "terminal", class: "default" };
  } else {
    icon = getFileIcon(tab.path);
  }
  
  const fileName = tab.path.split("/").pop();
  const location = tabLocation(tab);
  const currentStatus = tabStatus(tab, isActive);
  const stateClass = currentStatus ? ` ${currentStatus.className}` : '';
  tabEl.className += `${stateClass} ${location.className}`;

  tabEl.innerHTML = `
    <span class="tab-icon ${icon.class} ui-icon material-icons">${icon.icon}</span>
    <span class="tab-location" title="${location.label}">${location.label}</span>
    <span class="tab-name">${fileName}</span>
    ${currentStatus ? `<span class="tab-state ${currentStatus.className}"><span class="ui-icon material-icons" aria-hidden="true">${currentStatus.icon}</span><span class="tab-state-label">${currentStatus.label}</span></span>` : ""}
    <button class="tab-close" type="button"><span class="ui-icon material-icons" aria-hidden="true">close</span></button>
  `;
  const tabName = tabEl.querySelector('.tab-name');
  tabEl.setAttribute('aria-label', `${tab.path}, ${location.label}${currentStatus ? `, ${currentStatus.label}` : ''}`);
  setOverflowTooltip(tabEl, tab.path, tabName);

  tabEl.addEventListener("click", (e) => {
    if (!e.target.closest(".tab-close")) {
      // Set active pane if split view is enabled
      if (state.splitView && state.splitView.enabled && pane) {
        eventBus.emit('ui:set-active-pane', { pane });
      }
      eventBus.emit('tab:activate', { tab });
      renderTabs();
      eventBus.emit('ui:refresh-tree');
    }
  });
  tabEl.addEventListener('keydown', (event) => {
    if (event.target.closest('.tab-close')) return;
    if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('.tab-close')) {
      event.preventDefault();
      tabEl.click();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabContainer = tabEl.parentElement;
    const tabs = Array.from(tabContainer?.querySelectorAll(':scope > .tab') || []);
    const current = tabs.indexOf(tabEl);
    if (current < 0 || tabs.length < 2) return;
    event.preventDefault();
    const targetIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const targetTabIndex = tabs[targetIndex].dataset.tabIndex;
    tabs[targetIndex].click();
    window.requestAnimationFrame(() => {
      tabContainer?.querySelector(`[data-tab-index="${targetTabIndex}"]`)?.focus();
    });
  });

  // Drag-drop handlers (wrapped to pass the original event)
  tabEl.addEventListener('dragstart', (e) => eventBus.emit('tab:drag-start', e));
  tabEl.addEventListener('dragover', (e) => eventBus.emit('tab:drag-over', e));
  tabEl.addEventListener('drop', (e) => eventBus.emit('tab:drop', e));
  tabEl.addEventListener('dragend', (e) => eventBus.emit('tab:drag-end', e));

  tabEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    eventBus.emit('tab:context-menu', { x: e.clientX, y: e.clientY, tab, tabIndex });
  });

  enableLongPressContextMenu(tabEl);

  const closeBtn = tabEl.querySelector(".tab-close");
  closeBtn.setAttribute('aria-label', `Close ${fileName}`);
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    eventBus.emit('tab:close', { tab, pane });
  });

  return tabEl;
}

/**
 * Finds a tab by path
 */
export function findTabByPath(path) {
  return state.openTabs.find((t) => t.path === path);
}

/**
 * Gets the index of a tab
 */
export function getTabIndex(tab) {
  return state.openTabs.indexOf(tab);
}

/**
 * Gets the next tab after closing current one
 */
export function getNextTab(closingTab) {
  const index = getTabIndex(closingTab);
  if (state.openTabs.length > 1) {
    const newIndex = Math.min(index, state.openTabs.length - 2); // -2 because we're about to remove one
    return state.openTabs[newIndex === index ? newIndex + 1 : newIndex];
  }
  return null;
}

/**
 * Checks if any tabs have unsaved changes
 */
export function hasUnsavedTabs() {
  return state.openTabs.some(tab => tab.modified);
}

/**
 * Gets all modified tabs
 */
export function getModifiedTabs() {
  return state.openTabs.filter(tab => tab.modified);
}

/**
 * Closes all tabs
 */
export async function closeAllTabs(force = false) {
  if (!force && hasUnsavedTabs()) {
    const modifiedCount = getModifiedTabs().length;
    if (!await showConfirmDialog({ title: 'Close All Tabs', message: `${modifiedCount} tab(s) have unsaved changes. Close all anyway?`, confirmText: 'Close All', isDanger: true })) {
      return false;
    }
  }

  // Revoke all blob URLs
  state.openTabs.forEach(tab => {
    if (tab._blobUrl) {
      URL.revokeObjectURL(tab._blobUrl);
    }
  });

  rememberClosedTabs(state.openTabs);
  state.openTabs = [];
  state.activeTab = null;

  if (state.splitView && state.splitView.enabled) {
    disableSplitView();
  }

  // Clear editor and show welcome screen
  if (state.editor) {
    state.editor.setValue("");
    // Hide the editor wrapper to show welcome screen
    state.editor.getWrapperElement().style.display = "none";
  }
  restoreWelcomeWorkspace();
  if (elements.assetPreview) {
    elements.assetPreview.classList.remove("visible");
    elements.assetPreview.innerHTML = "";
  }
  if (elements.breadcrumb) {
    elements.breadcrumb.innerHTML = "";
  }

  renderTabs();
  eventBus.emit('ui:refresh-tree');

  return true;
}

/**
 * Closes tabs other than the specified tab
 */
export async function closeOtherTabs(keepTab, force = false) {
  const otherTabs = state.openTabs.filter(t => t !== keepTab);
  const modifiedOthers = otherTabs.filter(t => t.modified);

  if (!force && modifiedOthers.length > 0) {
    if (!await showConfirmDialog({ title: 'Close Other Tabs', message: `${modifiedOthers.length} other tab(s) have unsaved changes. Close them anyway?`, confirmText: 'Close Others', isDanger: true })) {
      return false;
    }
  }

  // Revoke blob URLs for tabs being closed
  otherTabs.forEach(tab => {
    if (tab._blobUrl) {
      URL.revokeObjectURL(tab._blobUrl);
    }
  });

  rememberClosedTabs(otherTabs);
  state.openTabs = [keepTab];

  if (state.splitView && state.splitView.enabled) {
    disableSplitView();
  }

  if (state.activeTab !== keepTab) {
    eventBus.emit('tab:activate', { tab: keepTab });
  }

  renderTabs();
  eventBus.emit('ui:refresh-tree');

  return true;
}

/**
 * Closes tabs to the right of the specified tab
 */
export async function closeTabsToRight(tab, force = false) {
  const index = getTabIndex(tab);
  if (index === -1 || index === state.openTabs.length - 1) return true;

  const tabsToClose = state.openTabs.slice(index + 1);
  const modifiedTabs = tabsToClose.filter(t => t.modified);

  if (!force && modifiedTabs.length > 0) {
    if (!await showConfirmDialog({ title: 'Close Tabs to the Right', message: `${modifiedTabs.length} tab(s) to the right have unsaved changes. Close them anyway?`, confirmText: 'Close Tabs', isDanger: true })) {
      return false;
    }
  }

  // Revoke blob URLs
  tabsToClose.forEach(t => {
    if (t._blobUrl) {
      URL.revokeObjectURL(t._blobUrl);
    }
  });

  rememberClosedTabs(tabsToClose);
  state.openTabs = state.openTabs.slice(0, index + 1);

  if (state.splitView && state.splitView.enabled && state.openTabs.length <= 1) {
    disableSplitView();
  }

  // If active tab was closed, activate the last remaining tab
  if (!state.openTabs.includes(state.activeTab)) {
    eventBus.emit('tab:activate', { tab: state.openTabs[state.openTabs.length - 1] });
  }

  renderTabs();
  eventBus.emit('ui:refresh-tree');

  return true;
}

/**
 * Moves to next tab (with split view support)
 */
export function nextTab() {
  if (state.openTabs.length === 0) return;

  // Get available tabs based on split view state
  let availableTabs;
  if (state.splitView && state.splitView.enabled) {
    const activePane = state.splitView.activePane;
    const tabIndices = activePane === 'primary'
      ? state.splitView.primaryTabs
      : state.splitView.secondaryTabs;
    availableTabs = tabIndices.map(idx => state.openTabs[idx]).filter(t => t);
  } else {
    availableTabs = state.openTabs;
  }

  if (availableTabs.length <= 1) return; // No other tab to switch to

  const currentIndex = availableTabs.indexOf(state.activeTab);
  if (currentIndex === -1) {
    // Active tab not in available tabs, activate first available
    eventBus.emit('tab:activate', { tab: availableTabs[0] });
  } else {
    // Move to next tab (wrap around)
    const nextIndex = (currentIndex + 1) % availableTabs.length;
    eventBus.emit('tab:activate', { tab: availableTabs[nextIndex] });
  }

  renderTabs();
  eventBus.emit('ui:refresh-tree');
}

/**
 * Moves to previous tab (with split view support)
 */
export function previousTab() {
  if (state.openTabs.length === 0) return;

  // Get available tabs based on split view state
  let availableTabs;
  if (state.splitView && state.splitView.enabled) {
    const activePane = state.splitView.activePane;
    const tabIndices = activePane === 'primary'
      ? state.splitView.primaryTabs
      : state.splitView.secondaryTabs;
    availableTabs = tabIndices.map(idx => state.openTabs[idx]).filter(t => t);
  } else {
    availableTabs = state.openTabs;
  }

  if (availableTabs.length <= 1) return; // No other tab to switch to

  const currentIndex = availableTabs.indexOf(state.activeTab);
  if (currentIndex === -1) {
    // Active tab not in available tabs, activate last available
    eventBus.emit('tab:activate', { tab: availableTabs[availableTabs.length - 1] });
  } else {
    // Move to previous tab (wrap around)
    const prevIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    eventBus.emit('tab:activate', { tab: availableTabs[prevIndex] });
  }

  renderTabs();
  eventBus.emit('ui:refresh-tree');
}

// Event Listeners
eventBus.on("ui:refresh-tabs", () => {
  renderTabs();
});

/**
 * Activates a tab, restoring its state into the editor
 */
export async function activateTab(tab, skipSave = false) {
    if (!state.openTabs.includes(tab)) return;
    // Hide welcome screen
    if (elements.welcomeScreen) {
      elements.welcomeScreen.style.display = "none";
    }

    // Detach terminal if leaving terminal tab
    if (state.activeTab && state.activeTab.isTerminal && tab !== state.activeTab) {
        setTerminalMode('panel');
        toggleTerminalImpl(false);
    }

    // Stop media playback when switching away from video/audio tab
    if (state.activeTab && (state.activeTab.isVideo || state.activeTab.isAudio) && tab !== state.activeTab) {
        stopActiveMedia();
    }

    // Determine which pane this tab should be in
    const tabIndex = state.openTabs.indexOf(tab);
    let pane = null;
    
    let currentEditor = state.editor; 
    if (state.splitView && state.splitView.enabled && state.activeTab) {
        const activeIdx = state.openTabs.indexOf(state.activeTab);
        if (activeIdx !== -1) {
            const activePane = getPaneForTab(activeIdx);
            if (activePane === 'primary') currentEditor = state.primaryEditor;
            else if (activePane === 'secondary') currentEditor = state.secondaryEditor;
        }
    }

    let targetEditor = state.editor;  

    if (state.splitView && state.splitView.enabled && tabIndex !== -1) {
      pane = getPaneForTab(tabIndex);
      if (pane === 'primary') {
        targetEditor = state.primaryEditor;
        state.splitView.primaryActiveTab = tab;
        state.splitView.activePane = 'primary';
      } else if (pane === 'secondary') {
        targetEditor = state.secondaryEditor;
        state.splitView.secondaryActiveTab = tab;
        state.splitView.activePane = 'secondary';
      } else {
        if (state.splitView.activePane === 'secondary' && state.secondaryEditor) {
          targetEditor = state.secondaryEditor;
          pane = 'secondary';
          if (!state.splitView.secondaryTabs.includes(tabIndex)) {
            state.splitView.secondaryTabs.push(tabIndex);
          }
          state.splitView.secondaryActiveTab = tab;
        } else {
          targetEditor = state.primaryEditor;
          pane = 'primary';
          if (!state.splitView.primaryTabs.includes(tabIndex)) {
            state.splitView.primaryTabs.push(tabIndex);
          }
          state.splitView.primaryActiveTab = tab;
        }
      }
      state.editor = targetEditor;
      updatePaneActiveState();
    }

    // Save current tab state before switching
    if (!skipSave && state.activeTab && currentEditor && !state.activeTab.isBinary && !state.activeTab.isTerminal) {
      state.activeTab.content = currentEditor.getValue();
      state.activeTab.history = currentEditor.getHistory();
      state.activeTab.cursor = currentEditor.getCursor();
      state.activeTab.scroll = currentEditor.getScrollInfo();
    }

    state.activeTab = tab;

    // Update minimap visibility for the newly active tab
    applyMinimapState(state.primaryEditor, state.secondaryEditor, state.showMinimap, tab);

    // Handle Binary Preview
    if (tab.isBinary) {
        if (targetEditor) {
            targetEditor.getWrapperElement().style.display = "none";
        }
        const previewContainer = (pane === 'secondary') ?
          document.getElementById('secondary-asset-preview') :
          elements.assetPreview;
        if (previewContainer) {
            previewContainer.classList.add("visible");
        }
    } else if (tab.isTerminal) {
        // Handle Terminal Tab
        if (targetEditor) {
            targetEditor.getWrapperElement().style.display = "none";
        }
        const previewContainer = (pane === 'secondary') ?
          document.getElementById('secondary-asset-preview') :
          elements.assetPreview;
          
        if (previewContainer) {
            if (!getTerminalContainer()) {
                previewContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary)"><span class="tab-terminal-loading-icon ui-icon ui-icon--size-lg ui-icon--space-after-8 material-icons">sync</span> Loading Terminal...</div>';
                previewContainer.classList.add("visible");
                
                initTerminal().then(() => {
                    if (state.activeTab === tab) {
                        previewContainer.innerHTML = '';
                        previewContainer.appendChild(getTerminalContainer());
                        setTerminalMode('tab');
                        fitTerminal();
                    }
                });
            } else {
                previewContainer.innerHTML = ''; 
                previewContainer.classList.add("visible");
                const terminal = getTerminalContainer();
                if (terminal) {
                    previewContainer.appendChild(terminal);
                }
                setTerminalMode('tab');
                fitTerminal();
            }
        }
    } else {
        // Handle Text Editor
        const previewContainer = (pane === 'secondary') ?
          document.getElementById('secondary-asset-preview') :
          elements.assetPreview;
        if (previewContainer) {
            previewContainer.classList.remove("visible");
            if (!previewContainer.contains(getTerminalContainer())) {
                 previewContainer.innerHTML = "";
            }
        }

        if (!targetEditor) {
          if (pane === 'secondary') {
            createSecondaryEditor();
            targetEditor = state.secondaryEditor;
          } else {
            createEditor();
            targetEditor = state.primaryEditor;
          }
          state.editor = targetEditor;
          applyEditorSettings(); 
          updateToolbarState();
        }

        if (targetEditor) {
          if (pane === 'primary' || !pane) {
            const wrapperDiv = document.getElementById('codemirror-wrapper');
            if (wrapperDiv) wrapperDiv.style.display = "block";
          } else if (pane === 'secondary') {
            const wrapperDiv = document.getElementById('codemirror-wrapper-secondary');
            if (wrapperDiv) wrapperDiv.style.display = "block";
          }

          targetEditor.getWrapperElement().style.display = "block";

          const mode = getEditorMode(tab.path);
          targetEditor.blueprintStudioFilePath = tab.path;
          try {
            targetEditor.setOption("mode", mode);
          } catch (error) {
            console.error("Error setting editor mode:", error);
            if (mode === "ha-yaml") {
              targetEditor.setOption("mode", "yaml");
            }
          }

          const isReadOnly = tab.path.endsWith(".lock");
          targetEditor.setOption("readOnly", isReadOnly);

          const fileName = tab.path;
          const fileExt = fileName.match(/\.(\w+)$/i)?.[1]?.toLowerCase();
          const lintableTypes = ['yaml', 'yml', 'json', 'py', 'js'];

          if (lintableTypes.includes(fileExt)) {
            targetEditor.setOption("lint", { getAnnotations: createLinter(fileName), async: true });
          } else {
            targetEditor.setOption("lint", false);
          }

          const hasIndentedContent = tab.content && tab.content.split('\n').length > 2 && /^\s+/m.test(tab.content);
          // 1. EditorConfig wins if present
          // 2. Otherwise detect from content + file-type defaults
          const ecIndent = await getEditorConfigIndent(tab.path || "");
          // File loading and EditorConfig discovery are asynchronous. Do not
          // let a closed or superseded tab restore a full-size editor above
          // the Welcome screen after its close workflow has completed.
          if (!state.openTabs.includes(tab) || state.activeTab !== tab) {
            if (state.openTabs.length === 0) restoreWelcomeWorkspace();
            return;
          }
          const indent = ecIndent || (hasIndentedContent
            ? detectIndentation(tab.content, tab.path || "")
            : detectIndentation("", tab.path || ""));

          targetEditor.setOption("indentWithTabs", indent.tabs);
          targetEditor.setOption("indentUnit", indent.tabs ? 1 : indent.size);
          targetEditor.setOption("tabSize", indent.size);
          // Update status bar to reflect this file's indentation without
          // overwriting the user's saved global preference in state.

          targetEditor.off("change", handleEditorChange);
          targetEditor.setValue(tab.content);
          targetEditor.on("change", () => handleEditorChange(targetEditor));

          if (tab.history) targetEditor.setHistory(tab.history);
          else targetEditor.clearHistory();

          if (tab.cursor) targetEditor.setCursor(tab.cursor);
          if (tab.scroll) targetEditor.scrollTo(tab.scroll.left, tab.scroll.top);

          targetEditor.refresh();
          targetEditor.focus();
        }
    }

    eventBus.emit('ui:refresh-tree');
    updateToolbarState();
    updateStatusBar();

    if (elements.groupMarkdown) {
        elements.groupMarkdown.style.display = tab.path.endsWith(".md") ? "flex" : "none";
        
        if (tab.path.endsWith(".md")) {
            // Restore button state from persisted state
            elements.btnMarkdownPreview?.classList.toggle("active", state.markdownPreviewActive);
        } else {
            // Only clean up UI (listeners/containers) when switching away from markdown
            // We don't reset the global 'markdownPreviewActive' state here so it 
            // persists when switching back to another markdown file.
            cleanupMarkdownPreview(false);
        }
    }

    eventBus.emit('tab:activated', { tab });
    const folderOfTab = tab.path.split("/").slice(0, -1).join("/");
    if (state.treeCollapsableMode) {
        state.currentFolderPath = folderOfTab;
    } else {
        state.currentNavigationPath = folderOfTab;
    }
    saveSettingsImpl();
}

/**
 * Closes a tab, managing state and ensuring at least one tab stays active if possible
 */
export async function closeTab(data, force = false) {
    const tab = (data && data.tab) ? data.tab : data;
    const pane = (data && data.pane) ? data.pane : null;

    // Handle closing the Markdown Live Preview tab specifically
    if (state.markdownPreviewActive && pane === 'secondary' && tab === state.activeTab) {
        eventBus.emit('ui:toggle-markdown-preview', false);
        return;
    }

    // Handle closing the Blueprint Form tab — close the form, keep the file open
    if (state.blueprintFormActive && pane === 'secondary') {
        const { closeBlueprintForm } = await import('./blueprint-form.js');
        closeBlueprintForm();
        return;
    }

    if (!force && tab.modified) {
      const location = tabLocation(tab);
      const pathLabel = isSftpPathImpl(tab.path) ? tab.path : `/config/${tab.path}`;
      if (!await showConfirmDialog({ title: 'Close Unsaved File', message: `<div class="operation-location ${location.className}"><span class="ui-icon material-icons" aria-hidden="true">${location.icon}</span><span><strong>${location.label}</strong><small>${escapeMarkup(pathLabel)}</small></span></div>File <b>${escapeMarkup(tab.path.split("/").pop())}</b> has unsaved changes. Close anyway?`, confirmText: 'Close File', isDanger: true })) {
        return;
      }
    }

    // Stop media playback before removing the tab
    if (tab.isVideo || tab.isAudio) {
      stopActiveMedia();
    }

    if (tab._blobUrl) {
      URL.revokeObjectURL(tab._blobUrl);
    }

    // Revoke streaming blob URL (SFTP media)
    if (tab.blobUrl) {
      URL.revokeObjectURL(tab.blobUrl);
    }

    const index = state.openTabs.indexOf(tab);
    if (index === -1) return;

    // Handle Split View state cleanup
    if (state.splitView && state.splitView.enabled) {
      state.splitView.primaryTabs = state.splitView.primaryTabs.filter(i => i !== index).map(i => i > index ? i - 1 : i);
      state.splitView.secondaryTabs = state.splitView.secondaryTabs.filter(i => i !== index).map(i => i > index ? i - 1 : i);
      
      if (state.splitView.primaryActiveTab === tab) state.splitView.primaryActiveTab = null;
      if (state.splitView.secondaryActiveTab === tab) state.splitView.secondaryActiveTab = null;
    }

    rememberClosedTabs([tab]);
    state.openTabs.splice(index, 1);

    // Auto-close split view if only 1 tab remains
    if (state.splitView && state.splitView.enabled && state.openTabs.length <= 1) {
      disableSplitView();
    }

    if (state.activeTab === tab) {
      // If closing a markdown file, we should reset the preview state entirely
      cleanupMarkdownPreview(tab.path.endsWith(".md"));
      
      if (state.openTabs.length > 0) {
        const nextIndex = Math.min(index, state.openTabs.length - 1);
        activateTab(state.openTabs[nextIndex]);
      } else {
        state.activeTab = null;
        applyMinimapState(state.primaryEditor, state.secondaryEditor, state.showMinimap, null);
        if (state.editor) state.editor.getWrapperElement().style.display = "none";
        if (state.secondaryEditor) state.secondaryEditor.getWrapperElement().style.display = "none";
        restoreWelcomeWorkspace();
        if (elements.assetPreview) elements.assetPreview.classList.remove("visible");
        if (elements.breadcrumb) elements.breadcrumb.innerHTML = "";
        if (elements.groupMarkdown) elements.groupMarkdown.style.display = "none";
      }
    }

    renderTabs();
    eventBus.emit('ui:refresh-tree');
    updateToolbarState();
    eventBus.emit('ui:update-split-buttons');
    saveSettingsImpl();
}

/**
 * Restores tabs from saved workspace state
 */
export async function restoreOpenTabs() {
    if (!state.rememberWorkspace) {
      restoreWelcomeWorkspace();
      return;
    }

    // CRITICAL: Ensure primary editor exists BEFORE restoring any tabs
    if (!state.primaryEditor) {
      createEditor();
    }

    if (!state._savedOpenTabs || state._savedOpenTabs.length === 0) {
      // No tabs to restore - show welcome screen
      if (state.primaryEditor) {
        state.primaryEditor.setValue("");
        const wrapperDiv = document.getElementById('codemirror-wrapper');
        if (wrapperDiv) {
          wrapperDiv.style.display = "none";
        }
      }
      restoreWelcomeWorkspace();
      if (elements.assetPreview) {
        elements.assetPreview.classList.remove("visible");
        elements.assetPreview.innerHTML = "";
      }
      return;
    }

    // Restore tabs
    for (const tabState of state._savedOpenTabs) {
      if (isSftpPathImpl(tabState.path)) {
        const { connId, remotePath } = parseSftpPathImpl(tabState.path);
        const connExists = state.sftpConnections.some(c => c.id === connId);
        if (connExists) {
          try {
            await openSftpFileImpl(connId, remotePath, true);
            const tab = state.openTabs.find(t => t.path === tabState.path);
            if (tab) {
              tab.cursor = tabState.cursor || null;
              tab.scroll = tabState.scroll || null;
              if (tabState.modified && tabState.content) {
                tab.modified = true;
                tab.content = tabState.content;
                if (tabState.originalContent) {
                  tab.originalContent = tabState.originalContent;
                }
                if (state.editor && state.activeTab === tab) {
                  state.editor.setValue(tab.content);
                }
              }
            }
          } catch (err) {
            console.warn(`Failed to restore SFTP tab ${tabState.path}:`, err);
          }
        }
      } else if (tabState.path.startsWith("terminal://")) {
        const tab = {
          path: tabState.path,
          name: "Terminal",
          isTerminal: true,
          modified: false,
          isBinary: false
        };
        state.openTabs.push(tab);
        toggleTerminalImpl(false);
      } else {
        const fileExists = state.files.some(f => f.path === tabState.path);
        if (fileExists) {
          const tabResults = await Promise.all(eventBus.emit('file:open', { path: tabState.path, forceReload: false, noActivate: true }));
          // Note: eventBus.emit returns array of results
          const tabObj = Array.isArray(tabResults) ? tabResults[0] : tabResults;
          
          if (tabObj) {
            tabObj.cursor = tabState.cursor || null;
            tabObj.scroll = tabState.scroll || null;

            if (tabState.modified && tabState.content) {
              tabObj.modified = true;
              tabObj.content = tabState.content;
              if (tabState.originalContent) {
                tabObj.originalContent = tabState.originalContent;
              }

              if (state.editor && state.activeTab === tabObj) {
                state.editor.setValue(tabObj.content);
              }
            }
          }
        } else {
          try {
            const dataResults = await Promise.all(eventBus.emit('file:load', { path: tabState.path }));
            const dataObj = Array.isArray(dataResults) ? dataResults[0] : dataResults;
            
            if (dataObj && (dataObj.content !== undefined || dataObj.is_binary)) {
              console.log("   ✅ Loaded from server directly:", tabState.path);
              const ext = tabState.path.split(".").pop().toLowerCase();
              const isImage = IMAGE_EXTENSIONS.has(ext);
              const isPdf = ext === "pdf";
              const isVideo = VIDEO_EXTENSIONS.has(ext);
              const isAudio = AUDIO_EXTENSIONS.has(ext);
              const isBinary = dataObj.is_binary || !isTextFile(tabState.path);

              const tab = {
                path: tabState.path,
                content: dataObj.content,
                originalContent: dataObj.content,
                mtime: dataObj.mtime,
                modified: false,
                history: null,
                cursor: tabState.cursor || null,
                scroll: tabState.scroll || null,
                isBinary: isBinary,
                isImage: isImage,
                isPdf: isPdf,
                isVideo: isVideo,
                isAudio: isAudio,
                mimeType: dataObj.mime_type
              };

              state.openTabs.push(tab);

              if (tabState.modified && tabState.content) {
                tab.modified = true;
                tab.content = tabState.content;
                if (tabState.originalContent) {
                  tab.originalContent = tabState.originalContent;
                }
              }
            } else {
              console.warn("[Tabs] file:load returned invalid data for", tabState.path, dataObj);
            }
          } catch (err) {
            console.error("[Tabs] Failed to load from server:", tabState.path, err);
          }
        }
      }
    }

    if (state._savedActiveTabPath) {
      const activeTab = state.openTabs.find(t => t.path === state._savedActiveTabPath);
      if (activeTab) {
        activateTab(activeTab);
        renderTabs();
      } else {
        if (state.openTabs.length > 0) {
          activateTab(state.openTabs[0]);
          renderTabs();
        }
      }
    } else if (state.openTabs.length > 0) {
      activateTab(state.openTabs[0]);
      renderTabs();
    }

    if (state.openTabs.length === 0) {
      if (state.primaryEditor) {
        state.primaryEditor.setValue("");
        const wrapperDiv = document.getElementById('codemirror-wrapper');
        if (wrapperDiv) wrapperDiv.style.display = "none";
      }
      restoreWelcomeWorkspace();
      return;
    }

    if (state.splitView && state.splitView.enabled) {
      if (!state.secondaryEditor) {
        createSecondaryEditor();
      }

      const splitContainer = document.getElementById('split-container');
      const primaryPane = document.getElementById('primary-pane');
      const secondaryPane = document.getElementById('secondary-pane');
      const resizeHandle = document.getElementById('split-resize-handle');
      if (splitContainer) splitContainer.className = `split-container ${state.splitView.orientation}`;
      if (primaryPane) {
        primaryPane.style.display = 'flex';
        primaryPane.style.flex = `0 0 ${state.splitView.primaryPaneSize}%`;
      }
      if (secondaryPane) {
        secondaryPane.style.display = 'flex';
        secondaryPane.style.flex = `0 0 ${100 - state.splitView.primaryPaneSize}%`;
      }
      if (resizeHandle) resizeHandle.style.display = 'block';

      enableSplitView(state.splitView.orientation, true);

      if (state._savedPrimaryActiveTabPath) {
        const primaryTab = state.openTabs.find(t => t.path === state._savedPrimaryActiveTabPath);
        if (primaryTab) {
          state.splitView.primaryActiveTab = primaryTab;
          if (state.primaryEditor) {
            state.primaryEditor.setValue(primaryTab.content || primaryTab.originalContent || "");
            const mode = getEditorMode(primaryTab.path);
            if (mode) state.primaryEditor.setOption('mode', mode);
            if (primaryTab.cursor) state.primaryEditor.setCursor(primaryTab.cursor);
            if (primaryTab.scroll) state.primaryEditor.scrollTo(primaryTab.scroll.left, primaryTab.scroll.top);
            state.primaryEditor.refresh();
          }
        }
      }

      if (state._savedSecondaryActiveTabPath) {
        const secondaryTab = state.openTabs.find(t => t.path === state._savedSecondaryActiveTabPath);
        if (secondaryTab) {
          state.splitView.secondaryActiveTab = secondaryTab;
          if (state.secondaryEditor) {
            state.secondaryEditor.setValue(secondaryTab.content || secondaryTab.originalContent || "");
            const mode = getEditorMode(secondaryTab.path);
            if (mode) state.secondaryEditor.setOption('mode', mode);
            if (secondaryTab.cursor) state.secondaryEditor.setCursor(secondaryTab.cursor);
            if (secondaryTab.scroll) state.secondaryEditor.scrollTo(secondaryTab.scroll.left, secondaryTab.scroll.top);
            state.secondaryEditor.refresh();
          }
        }
      }

      if (state.splitView.primaryPaneSize) {
        updatePaneSizes(state.splitView.primaryPaneSize);
      }

      // Re-initialize handle if needed (can be handled by split-view.js initSplitResize)
      initSplitResize();

      renderTabs();
      updatePaneActiveState();

      if (state.splitView.activePane === 'primary' && state.splitView.primaryActiveTab) {
        state.editor = state.primaryEditor;
        if (state.primaryEditor) {
          state.primaryEditor.focus();
          state.primaryEditor.refresh();
        }
      } else if (state.splitView.activePane === 'secondary' && state.splitView.secondaryActiveTab) {
        state.editor = state.secondaryEditor;
        if (state.secondaryEditor) {
          state.secondaryEditor.focus();
          state.secondaryEditor.refresh();
        }
      }

      if (state.primaryEditor) {
        const primaryWrapper = state.primaryEditor.getWrapperElement();
        if (primaryWrapper) primaryWrapper.style.display = 'block';
      }
      if (state.secondaryEditor) {
        const secondaryWrapper = state.secondaryEditor.getWrapperElement();
        if (secondaryWrapper) secondaryWrapper.style.display = 'block';
      }
    }

    delete state._savedOpenTabs;
    delete state._savedActiveTabPath;
    delete state._savedPrimaryActiveTabPath;
    delete state._savedSecondaryActiveTabPath;
}
