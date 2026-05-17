import { state } from './state.js';
import {
  renderFileTree,
  loadDirectory,
  updateFolderNavigationBreadcrumb,
  updateNavigationBackButton,
} from './file-tree.js';

export async function revealAndOpenFile(path, navType) {
  if (!path) return;

  const fileName = path.split('/').pop() || '';
  const isFile = fileName.includes('.');

  if (!isFile) {
    await _navigateToDirectory(path);
    return;
  }

  const lastSlash = path.lastIndexOf('/');
  const folderPath = lastSlash > 0 ? path.substring(0, lastSlash) : '';

  if (state.treeCollapsableMode) {
    await _expandAncestors(folderPath);
    renderFileTree();
  } else {
    await _navigateToParent(folderPath);
  }

  const { openFile } = await import('./coordinators/FileCoordinator.js');
  await openFile(path, true);

  renderFileTree();

  _highlightInTree(path, navType);
}

async function _navigateToDirectory(dirPath) {
  if (state.treeCollapsableMode) {
    await _expandAncestors(dirPath);
    renderFileTree();
  } else {
    await _navigateToParent(dirPath);
  }
}

async function _expandAncestors(folderPath) {
  if (!folderPath) return;
  const segments = folderPath.split('/');
  let cumulative = '';
  for (const seg of segments) {
    cumulative = cumulative ? cumulative + '/' + seg : seg;
    if (!state.expandedFolders.has(cumulative)) {
      state.expandedFolders.add(cumulative);
    }
    if (state.lazyLoadingEnabled && !state.loadedDirectories.has(cumulative)) {
      await loadDirectory(cumulative);
    }
  }
}

async function _navigateToParent(folderPath) {
  if (state.currentNavigationPath === folderPath) {
    if (!state.loadedDirectories.has(folderPath)) {
      await loadDirectory(folderPath);
      renderFileTree();
    }
    return;
  }

  if (state.currentNavigationPath !== folderPath) {
    state.navigationHistory.push(state.currentNavigationPath);
  }
  state.currentNavigationPath = folderPath;

  if (!state.loadedDirectories.has(folderPath)) {
    await loadDirectory(folderPath);
  }

  renderFileTree();
  try { updateFolderNavigationBreadcrumb(); } catch (_) {}
  try { updateNavigationBackButton(); } catch (_) {}
}

function _highlightInTree(path, navType) {
  setTimeout(() => {
    const el = document.querySelector('[data-path="' + path.replace(/"/g, '\\"') + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.classList.add('ai-highlight');
      setTimeout(() => el.classList.remove('ai-highlight'), 2500);
    }
  }, 150);
  
  _showNavIndicator(path, navType);
}

const _svgIcon = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:var(--accent-color)"><path d="${d}"/></svg>`;
const _navTypeMap = {
  navigate: { svg: _svgIcon('M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zM13 9V3.5L18.5 9H13z'), label: '' },
  diff:     { svg: _svgIcon('M9.01 14H2v2h7.01v3L13 15l-3.99-4v3zm5.98-1v-3H22V8h-7.01V5L11 9l3.99 4z'), label: 'Diff' },
  edit:     { svg: _svgIcon('M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'), label: 'Edit' },
  tool:     { svg: _svgIcon('M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'), label: 'Tool' },
  create:   { svg: _svgIcon('M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3v2zm-3-7V3.5L18.5 9H13z'), label: 'New' },
  delete:   { svg: _svgIcon('M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'), label: 'Del' },
};

export function showNavIndicator(path, navType) { _showNavIndicator(path, navType); }

function _showNavIndicator(path, navType) {
  const existing = document.getElementById('ai-nav-indicator');
  if (existing) existing.remove();
  
  const fileName = path.split('/').pop();
  const meta = _navTypeMap[navType] || _navTypeMap.navigate;
  const prefix = meta.label ? `<span style="opacity:.55;margin-right:2px">${meta.label}</span>` : '';
  const indicator = document.createElement('div');
  indicator.id = 'ai-nav-indicator';
  indicator.innerHTML = `
    ${meta.svg}
    ${prefix}<span>${fileName}</span>
  `;
  indicator.style.cssText = `
    position: fixed;
    top: 60px;
    right: 20px;
    background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
    border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    border-radius: 14px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--text-primary);
    z-index: 9998;
    box-shadow: 0 14px 40px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05);
    animation: ai-nav-in 0.2s cubic-bezier(.2,.8,.2,1);
    pointer-events: none;
  `;
  
  if (!document.getElementById('ai-nav-styles')) {
    const style = document.createElement('style');
    style.id = 'ai-nav-styles';
    style.textContent = `
      @keyframes ai-nav-in {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes ai-nav-out {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(20px); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(indicator);
  
  setTimeout(() => {
    indicator.style.animation = 'ai-nav-out 0.3s ease forwards';
    setTimeout(() => indicator.remove(), 300);
  }, 2000);
}
