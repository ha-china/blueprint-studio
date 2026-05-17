import { t } from './translations.js';
/** GIT-DIFF.JS | Purpose: * Visualizes git diffs and commit history. Shows file changes, commit details, */
import { state, elements, gitState } from './state.js';
import { fetchWithAuth } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE } from './constants.js';
import {
  showGlobalLoading,
  hideGlobalLoading,
  showToast,
  showModal,
  resetModalToDefault
} from './ui.js';
import { getEditorMode, ensureDiffLibrariesLoaded } from './utils.js';
import { isGitEnabled } from './git-operations.js';
import { revealAndOpenFile as _revealAndOpenFile, showNavIndicator } from './file-nav-helper.js';

let _aiDiffQueue = [];
let _aiDiffActive = false;

const DIFF_HISTORY_KEY = 'bps_ai_diff_history';
const DIFF_HISTORY_MAX = 30;

function _loadDiffHistory() {
  try {
    return JSON.parse(localStorage.getItem(DIFF_HISTORY_KEY) || '[]');
  } catch (_) { return []; }
}

function _saveDiffHistory(history) {
  try {
    localStorage.setItem(DIFF_HISTORY_KEY, JSON.stringify(history.slice(-DIFF_HISTORY_MAX)));
  } catch (_) {}
}

function _pushDiffRecord(path, oldContent, newContent, action) {
  const history = _loadDiffHistory();
  history.push({
    path,
    oldContent,
    newContent,
    action,
    ts: Date.now(),
    undone: false
  });
  _saveDiffHistory(history);
}

export function getDiffHistory() {
  return _loadDiffHistory();
}

export async function undoLastDiff() {
  const history = _loadDiffHistory();
  const last = [...history].reverse().find(r => r.action === 'accepted' && !r.undone);
  if (!last) {
    showToast('No AI diff to undo', 'warning', 2000);
    return false;
  }
  last.undone = true;
  _saveDiffHistory(history);

  const { openFile } = await import('./coordinators/FileCoordinator.js');
  await openFile(last.path, true);
  await new Promise(r => setTimeout(r, 100));
  if (state.editor) state.editor.setValue(last.oldContent);
  const tab = state.openTabs.find(t => t.path === last.path);
  if (tab) {
    tab.content = last.oldContent;
    tab.originalContent = last.oldContent;
    tab.modified = false;
  }
  eventBus.emit('ui:refresh-tabs');
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('ui:update-toolbar-state');
  try {
    await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write_file', path: last.path, content: last.oldContent })
    });
  } catch (_) {}
  showToast(`Reverted: ${last.path.split('/').pop()}`, 'info', 2500);
  return true;
}

export async function undoDiffByIndex(index) {
  const history = _loadDiffHistory();
  if (index < 0 || index >= history.length) return false;
  const entry = history[index];
  if (entry.undone) { showToast('Already undone', 'warning', 1500); return false; }
  entry.undone = true;
  _saveDiffHistory(history);

  const restoreContent = entry.action === 'accepted' ? entry.oldContent : entry.newContent;
  const { openFile } = await import('./coordinators/FileCoordinator.js');
  await openFile(entry.path, true);
  await new Promise(r => setTimeout(r, 100));
  if (state.editor) state.editor.setValue(restoreContent);
  const tab = state.openTabs.find(t => t.path === entry.path);
  if (tab) {
    tab.content = restoreContent;
    tab.originalContent = restoreContent;
    tab.modified = false;
  }
  eventBus.emit('ui:refresh-tabs');
  eventBus.emit('ui:refresh-tree');
  eventBus.emit('ui:update-toolbar-state');
  try {
    await fetchWithAuth(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write_file', path: entry.path, content: restoreContent })
    });
  } catch (_) {}
  showToast(`Reverted: ${entry.path.split('/').pop()}`, 'info', 2500);
  return true;
}

export function initAiDiffListener() {
  console.log('[BPS] initAiDiffListener registered');
  eventBus.on('ai:show-diff', (data) => {
    console.log('[BPS] ai:show-diff event', data?.path);
    _aiDiffQueue.push(data);
    if (!_aiDiffActive) _processNextAiDiff();
  });
  eventBus.on('ai:navigate-file', (data) => {
    console.log('[BPS] ai:navigate-file event', data?.path);
    if (data && data.path) _revealAndOpenFile(data.path, 'navigate').catch((e) => console.warn('[BPS] navigate-file error', e));
  });
  eventBus.on('ai:undo-diff', () => { undoLastDiff(); });
  eventBus.on('ai:show-diff-history', () => { _showDiffHistoryPanel(); });
  if (!window.__blueprintStudioAiEditListenerInstalled) {
    window.__blueprintStudioAiEditListenerInstalled = true;
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'blueprint_studio_ai_edit') return;
      console.log('[BPS] postMessage received', event.data.payload?.action, event.data.payload?.path);
      const data = event.data.payload || {};
      if (data.action === 'navigate' && data.path) {
        _revealAndOpenFile(data.path, 'tool').catch((e) => console.warn('[BPS] postMessage navigate error', e));
      } else if (data.path) {
        enqueueAiDiff({
          path: data.path,
          oldContent: data.old_content || "",
          newContent: data.new_content || "",
        });
      }
    });
    console.log('[BPS] postMessage listener installed');
  }
}

export function enqueueAiDiff(data) {
  if (!data || !data.path) return;
  _aiDiffQueue.push(data);
  if (!_aiDiffActive) _processNextAiDiff();
}

async function _processNextAiDiff() {
  if (!_aiDiffQueue.length) { _aiDiffActive = false; return; }
  _aiDiffActive = true;
  const data = _aiDiffQueue.shift();
  try {
    await showAiDiffModal(data.path, data.oldContent, data.newContent);
  } catch (e) {
    console.error('[AI Diff] error:', e);
  }
  _processNextAiDiff();
}

export async function showAiDiffModal(path, oldContent, newContent) {
  try {
    if (state.sidebarVisible) {
      const { hideSidebar } = await import('./sidebar.js');
      hideSidebar();
    }
    const { openFile } = await import('./coordinators/FileCoordinator.js');
    await openFile(path, true);
    await new Promise(r => setTimeout(r, 100));
    await ensureDiffLibrariesLoaded();
    
    const editor = state.editor;
    if (!editor) {
      console.warn('[AI Edit] No editor available');
      return "no-editor";
    }
    
    showNavIndicator(path, 'diff');
    const diffMarkers = _applyInlineDiff(editor, oldContent, newContent);
    _showAiActionBar(path, oldContent, newContent, diffMarkers);
    
    return "pending";
  } catch (e) {
    console.error('[AI Edit] error:', e);
    return "error";
  }
}

function _applyInlineDiff(editor, oldContent, newContent) {
  const markers = [];
  editor.setValue(oldContent);
  const lastLine = editor.lastLine();
  const lastCh = editor.getLine(lastLine).length;
  editor.operation(() => {
    editor.replaceRange(newContent, { line: 0, ch: 0 }, { line: lastLine, ch: lastCh });
  });

  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(oldContent, newContent);
  dmp.diff_cleanupSemantic(diffs);

  let index = 0;
  for (const [op, text] of diffs) {
    if (op === 0) {
      index += text.length;
      continue;
    }
    if (op === 1 && text.length) {
      const from = editor.posFromIndex(index);
      const to = editor.posFromIndex(index + text.length);
      const marker = editor.markText(from, to, { className: 'ai-diff-text-added' });
      editor.addLineClass(from.line, 'background', 'ai-diff-added');
      editor.addLineClass(from.line, 'gutter', 'ai-diff-gutter-added');
      markers.push({ marker, line: from.line, type: 'added' });
      index += text.length;
    } else if (op === -1) {
      const pos = editor.posFromIndex(index);
      editor.addLineClass(pos.line, 'background', 'ai-diff-modified');
      editor.addLineClass(pos.line, 'gutter', 'ai-diff-gutter-modified');
      markers.push({ line: pos.line, type: 'modified' });
    }
  }

  if (markers.length > 0) {
    editor.scrollIntoView({ line: markers[0].line, ch: 0 }, 100);
  }
  
  return markers;
}

function _clearDiffMarkers(editor, markers) {
  if (!editor || !markers) return;
  for (const m of markers) {
    try {
      if (m.marker) m.marker.clear();
      editor.removeLineClass(m.line, 'background', 'ai-diff-added');
      editor.removeLineClass(m.line, 'background', 'ai-diff-modified');
      editor.removeLineClass(m.line, 'background', 'ai-diff-current');
      editor.removeLineClass(m.line, 'gutter', 'ai-diff-gutter-added');
      editor.removeLineClass(m.line, 'gutter', 'ai-diff-gutter-modified');
    } catch (_) {}
  }
}

function _escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _buildCompactDiffRows(oldContent, newContent) {
  const dmp = new diff_match_patch();
  const lines = dmp.diff_linesToChars_(oldContent, newContent);
  const diffs = dmp.diff_main(lines.chars1, lines.chars2, false);
  dmp.diff_charsToLines_(diffs, lines.lineArray);
  dmp.diff_cleanupSemantic(diffs);
  const rows = [];

  for (const [op, text] of diffs) {
    if (op === 0 || !text) continue;
    const cls = op > 0 ? 'ai-diff-preview-add' : 'ai-diff-preview-del';
    const sign = op > 0 ? '+' : '-';
    for (const line of text.replace(/\n$/, '').split('\n')) {
      if (!line && text.length <= 1) continue;
      rows.push(`<div class="${cls}"><span>${sign}</span><code>${_escapeHtml(line)}</code></div>`);
    }
  }

  return rows;
}

function _buildCompactDiffHtml(oldContent, newContent) {
  const rows = _buildCompactDiffRows(oldContent, newContent);
  if (!rows.length) return '<div class="ai-diff-preview-empty">No visible changes</div>';
  return rows.join('');
}

function _showRejectDiffPrompt(path, oldContent, newContent) {
  return new Promise((resolve) => {
    const modalOverlay = document.getElementById("modal-overlay");
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modal-title");
    const modalBody = document.getElementById("modal-body");
    const modalFooter = document.querySelector(".modal-footer");

    resetModalToDefault();
    modalTitle.textContent = `Reject File: ${path.split('/').pop()}`;
    modal.style.maxWidth = "900px";
    modal.style.width = "min(900px, 92vw)";
    modalBody.innerHTML = `<div class="ai-reject-diff">${_buildCompactDiffHtml(oldContent, newContent)}</div>`;
    if (modalFooter) {
      modalFooter.style.display = "flex";
      modalFooter.innerHTML = `
        <button id="ai-reject-cancel" class="modal-btn secondary">Keep Changes</button>
        <button id="ai-reject-confirm" class="modal-btn danger">Reject File</button>
      `;
    }
    modalOverlay.classList.add("visible");

    const close = (result) => {
      modalOverlay.classList.remove("visible");
      resetModalToDefault();
      modal.style.maxWidth = "";
      modal.style.width = "";
      resolve(result);
    };

    document.getElementById("ai-reject-cancel").onclick = () => close(false);
    document.getElementById("ai-reject-confirm").onclick = () => close(true);
    document.getElementById("modal-close").onclick = () => close(false);
  });
}

let _aiDiffFileQueue = [];
let _aiDiffFileIndex = -1;

function _showAiActionBar(path, oldContent, newContent, diffMarkers) {
  const existing = document.getElementById('ai-edit-bar');
  if (existing) existing.remove();
  const existingPreview = document.getElementById('ai-edit-preview');
  if (existingPreview) existingPreview.remove();

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const editCount = diffMarkers.length;
  let navIndex = editCount > 0 ? 0 : -1;

  const fileEntry = { path, oldContent, newContent, diffMarkers, status: 'pending' };
  const existingIdx = _aiDiffFileQueue.findIndex(f => f.path === path);
  if (existingIdx >= 0) {
    _aiDiffFileQueue[existingIdx] = fileEntry;
    _aiDiffFileIndex = existingIdx;
  } else {
    _aiDiffFileQueue.push(fileEntry);
    _aiDiffFileIndex = _aiDiffFileQueue.length - 1;
  }

  const totalFiles = _aiDiffFileQueue.length;
  const fileNum = _aiDiffFileIndex + 1;
  const acceptKey = isMac ? '⌘⏎' : 'Ctrl+Enter';
  const rejectKey = isMac ? '⇧⌘⌫' : 'Ctrl+Shift+Del';

  const bar = document.createElement('div');
  bar.id = 'ai-edit-bar';
  bar.innerHTML = `
    <div class="ai-bar-nav">
      <button id="ai-bar-prev" class="ai-bar-nav-btn" title="Previous edit">
        <span class="material-icons">keyboard_arrow_up</span>
      </button>
      <span id="ai-bar-edit-count" class="ai-bar-edit-label">${editCount} edit${editCount !== 1 ? 's' : ''}</span>
      <button id="ai-bar-next" class="ai-bar-nav-btn" title="Next edit">
        <span class="material-icons">keyboard_arrow_down</span>
      </button>
    </div>
    <span class="ai-bar-sep"></span>
    <div class="ai-bar-center">
      <button id="ai-bar-accept" class="ai-bar-btn ai-bar-btn-accept" title="Accept File (${acceptKey})">
        Accept File <kbd>${acceptKey}</kbd>
      </button>
      <button id="ai-bar-reject" class="ai-bar-btn ai-bar-btn-reject" title="Reject File (${rejectKey})">
        Reject File <kbd>${rejectKey}</kbd>
      </button>
    </div>
    <span class="ai-bar-sep"></span>
    <button id="ai-bar-toggle-preview" class="ai-bar-nav-btn" title="Toggle diff preview">
      <span class="material-icons">unfold_more</span>
    </button>
    <span class="ai-bar-sep"></span>
    <div class="ai-bar-file-nav">
      <button id="ai-bar-file-prev" class="ai-bar-nav-btn" title="Previous file" ${totalFiles <= 1 ? 'disabled' : ''}>
        <span class="material-icons">chevron_left</span>
      </button>
      <span id="ai-bar-file-count" class="ai-bar-file-label">${fileNum} of ${totalFiles} file${totalFiles !== 1 ? 's' : ''}</span>
      <button id="ai-bar-file-next" class="ai-bar-nav-btn" title="Next file" ${totalFiles <= 1 ? 'disabled' : ''}>
        <span class="material-icons">chevron_right</span>
      </button>
    </div>
    <span class="ai-bar-sep"></span>
    <button id="ai-bar-undo" class="ai-bar-nav-btn" title="Undo last accepted AI diff">
      <span class="material-icons">undo</span>
    </button>
    <button id="ai-bar-history" class="ai-bar-nav-btn" title="AI diff history">
      <span class="material-icons">history</span>
    </button>
  `;

  const preview = document.createElement('div');
  preview.id = 'ai-edit-preview';
  preview.className = 'collapsed';
  preview.innerHTML = _buildCompactDiffHtml(oldContent, newContent);
  document.body.appendChild(bar);
  document.body.appendChild(preview);
  _injectAiDiffStyles();

  const _updateEditLabel = () => {
    const el = document.getElementById('ai-bar-edit-count');
    if (el) el.textContent = `${editCount} edit${editCount !== 1 ? 's' : ''}`;
  };

  const jumpToEdit = (idx) => {
    if (!diffMarkers.length) return;
    for (const m of diffMarkers) {
      state.editor?.removeLineClass(m.line, 'background', 'ai-diff-current');
    }
    navIndex = ((idx % editCount) + editCount) % editCount;
    const m = diffMarkers[navIndex];
    if (state.editor) {
      state.editor.addLineClass(m.line, 'background', 'ai-diff-current');
      state.editor.scrollIntoView({ line: m.line, ch: 0 }, 120);
    }
    _updateEditLabel();
  };

  if (navIndex >= 0) jumpToEdit(0);

  const cleanup = () => {
    bar.remove();
    preview.remove();
    _clearDiffMarkers(state.editor, diffMarkers);
    document.removeEventListener('keydown', keyHandler);
  };

  const doAccept = () => {
    cleanup();
    _pushDiffRecord(path, oldContent, newContent, 'accepted');
    const tab = state.openTabs.find(t => t.path === path);
    if (tab) {
      tab.content = newContent;
      tab.originalContent = oldContent;
      tab.modified = true;
    }
    eventBus.emit('ui:refresh-tabs');
    eventBus.emit('ui:update-toolbar-state');
    const fe = _aiDiffFileQueue.find(f => f.path === path);
    if (fe) fe.status = 'accepted';
    _advanceOrClose();
  };

  const doReject = async () => {
    const confirmed = await _showRejectDiffPrompt(path, oldContent, newContent);
    if (!confirmed) return;
    cleanup();
    if (state.editor) state.editor.setValue(oldContent);
    const tab = state.openTabs.find(t => t.path === path);
    if (tab) {
      tab.content = oldContent;
      tab.originalContent = oldContent;
      tab.modified = false;
    }
    try {
      await fetchWithAuth(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'write_file', path, content: oldContent })
      });
    } catch (_) {}
    _pushDiffRecord(path, oldContent, newContent, 'rejected');
    const fe = _aiDiffFileQueue.find(f => f.path === path);
    if (fe) fe.status = 'rejected';
    _advanceOrClose();
  };

  const _advanceOrClose = () => {
    const next = _aiDiffFileQueue.find(f => f.status === 'pending');
    if (!next) {
      const accepted = _aiDiffFileQueue.filter(f => f.status === 'accepted').length;
      const rejected = _aiDiffFileQueue.filter(f => f.status === 'rejected').length;
      showToast(`${accepted} accepted, ${rejected} rejected`, 'info');
      _aiDiffFileQueue = [];
      _aiDiffFileIndex = -1;
      return;
    }
    _aiDiffFileIndex = _aiDiffFileQueue.indexOf(next);
    showAiDiffModal(next.path, next.oldContent, next.newContent).catch(() => {});
  };

  const keyHandler = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      doAccept();
    } else if (
      (isMac && e.key === 'Backspace' && e.metaKey && e.shiftKey) ||
      (!isMac && e.key === 'Delete' && e.ctrlKey && e.shiftKey)
    ) {
      e.preventDefault();
      doReject();
    } else if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault();
      jumpToEdit(navIndex - 1);
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      jumpToEdit(navIndex + 1);
    }
  };
  document.addEventListener('keydown', keyHandler);

  document.getElementById('ai-bar-accept').onclick = doAccept;
  document.getElementById('ai-bar-reject').onclick = doReject;
  document.getElementById('ai-bar-prev').onclick = () => jumpToEdit(navIndex - 1);
  document.getElementById('ai-bar-next').onclick = () => jumpToEdit(navIndex + 1);
  document.getElementById('ai-bar-toggle-preview').onclick = () => {
    const collapsed = preview.classList.toggle('collapsed');
    const icon = document.querySelector('#ai-bar-toggle-preview .material-icons');
    if (icon) icon.textContent = collapsed ? 'unfold_more' : 'unfold_less';
  };

  const filePrev = document.getElementById('ai-bar-file-prev');
  const fileNext = document.getElementById('ai-bar-file-next');
  if (filePrev) filePrev.onclick = () => {
    const pending = _aiDiffFileQueue.filter(f => f.status === 'pending');
    const prev = pending.findLast((_, i) => _aiDiffFileQueue.indexOf(pending[i]) < _aiDiffFileIndex);
    if (prev) { cleanup(); _aiDiffFileIndex = _aiDiffFileQueue.indexOf(prev); showAiDiffModal(prev.path, prev.oldContent, prev.newContent).catch(() => {}); }
  };
  if (fileNext) fileNext.onclick = () => {
    const pending = _aiDiffFileQueue.filter(f => f.status === 'pending');
    const nxt = pending.find((_, i) => _aiDiffFileQueue.indexOf(pending[i]) > _aiDiffFileIndex);
    if (nxt) { cleanup(); _aiDiffFileIndex = _aiDiffFileQueue.indexOf(nxt); showAiDiffModal(nxt.path, nxt.oldContent, nxt.newContent).catch(() => {}); }
  };
  const undoBtn = document.getElementById('ai-bar-undo');
  if (undoBtn) undoBtn.onclick = () => undoLastDiff();
  const histBtn = document.getElementById('ai-bar-history');
  if (histBtn) histBtn.onclick = () => _showDiffHistoryPanel();
}

function _showDiffHistoryPanel() {
  const history = _loadDiffHistory();
  const overlay = document.createElement('div');
  overlay.className = 'ai-diff-history-overlay';
  const panel = document.createElement('div');
  panel.className = 'ai-diff-history-panel';

  const header = document.createElement('div');
  header.className = 'ai-diff-history-header';
  header.innerHTML = `<span>AI Diff History (${history.length}/${DIFF_HISTORY_MAX})</span>
    <button class="ai-diff-history-close"><span class="material-icons">close</span></button>`;
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ai-diff-history-body';

  if (!history.length) {
    body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary)">No AI diff history yet</div>';
  } else {
    [...history].reverse().forEach((entry, ri) => {
      const idx = history.length - 1 - ri;
      const row = document.createElement('div');
      row.className = 'ai-diff-history-row' + (entry.undone ? ' undone' : '');
      const fname = entry.path.split('/').pop();
      const date = new Date(entry.ts);
      const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const badge = entry.action === 'accepted' ? '<span class="badge-accept">accepted</span>' : '<span class="badge-reject">rejected</span>';
      const undoneLabel = entry.undone ? ' <span class="badge-undone">undone</span>' : '';
      row.innerHTML = `
        <div class="history-row-info">
          <span class="history-file">${_escapeHtml(fname)}</span>
          ${badge}${undoneLabel}
          <span class="history-time">${day} ${time}</span>
        </div>
        <div class="history-row-actions">
          <button class="history-view-btn" data-idx="${idx}" title="View diff"><span class="material-icons">visibility</span></button>
          ${!entry.undone ? `<button class="history-undo-btn" data-idx="${idx}" title="Undo this change"><span class="material-icons">undo</span></button>` : ''}
        </div>`;
      body.appendChild(row);
    });
  }
  panel.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'ai-diff-history-footer';
  footer.innerHTML = '<button class="ai-diff-history-clear-btn">Clear All History</button>';
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  header.querySelector('.ai-diff-history-close').onclick = () => overlay.remove();
  footer.querySelector('.ai-diff-history-clear-btn').onclick = () => {
    _saveDiffHistory([]);
    overlay.remove();
    showToast('Diff history cleared', 'info', 1500);
  };

  body.querySelectorAll('.history-undo-btn').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.idx);
      const ok = await undoDiffByIndex(i);
      if (ok) overlay.remove();
    };
  });

  body.querySelectorAll('.history-view-btn').forEach(btn => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.idx);
      const entry = history[i];
      if (!entry) return;
      const diffHtml = _buildCompactDiffHtml(entry.oldContent, entry.newContent);
      const viewer = document.createElement('div');
      viewer.className = 'ai-diff-history-viewer';
      viewer.innerHTML = `<div class="viewer-header"><span>${_escapeHtml(entry.path)}</span><button class="viewer-close"><span class="material-icons">close</span></button></div><div class="viewer-body">${diffHtml}</div>`;
      panel.appendChild(viewer);
      viewer.querySelector('.viewer-close').onclick = () => viewer.remove();
    };
  });
}

function _injectAiDiffStyles() {
  if (document.getElementById('ai-diff-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-diff-styles';
  style.textContent = `
    .ai-diff-added { background: rgba(46, 160, 67, 0.13) !important; }
    .ai-diff-modified { background: rgba(248, 81, 73, 0.13) !important; }
    .ai-diff-text-added { background: rgba(46, 160, 67, 0.25) !important; color: var(--text-primary) !important; border-radius: 2px; }
    .ai-diff-gutter-added { border-left: 3px solid #2ea043 !important; }
    .ai-diff-gutter-modified { border-left: 3px solid #f85149 !important; }
    .ai-diff-current {
      box-shadow: inset 3px 0 0 #58a6ff, inset 0 0 0 1px rgba(88, 166, 255, 0.35);
    }
    #ai-edit-preview {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 38px;
      max-height: 118px;
      overflow: auto;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      z-index: 9998;
      font-family: var(--editor-font-family, 'SF Mono', Consolas, monospace);
      font-size: 12px;
      box-shadow: 0 -8px 24px rgba(0,0,0,0.18);
    }
    #ai-edit-preview.collapsed {
      display: none;
    }
    .ai-reject-diff {
      max-height: min(60vh, 520px);
      overflow: auto;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-primary);
      font-family: var(--editor-font-family, 'SF Mono', Consolas, monospace);
      font-size: 12px;
    }
    .ai-diff-preview-add,
    .ai-diff-preview-del {
      display: grid;
      grid-template-columns: 22px 1fr;
      min-height: 22px;
      align-items: center;
      border-left: 3px solid transparent;
    }
    .ai-diff-preview-add {
      background: rgba(46, 160, 67, 0.14);
      border-left-color: #2ea043;
    }
    .ai-diff-preview-del {
      background: rgba(248, 81, 73, 0.14);
      border-left-color: #f85149;
    }
    .ai-diff-preview-add span { color: #3fb950; }
    .ai-diff-preview-del span { color: #ff7b72; }
    .ai-diff-preview-add span,
    .ai-diff-preview-del span {
      text-align: center;
      user-select: none;
      font-weight: 600;
    }
    .ai-diff-preview-add code,
    .ai-diff-preview-del code {
      color: var(--text-primary);
      white-space: pre;
      overflow: hidden;
      text-overflow: ellipsis;
      padding-right: 12px;
      font-family: inherit;
    }
    .ai-diff-preview-empty {
      padding: 12px;
      color: var(--text-secondary);
    }
    
    #ai-edit-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 38px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 0 12px;
      z-index: 9999;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .ai-bar-nav, .ai-bar-center, .ai-bar-file-nav {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ai-bar-nav-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 0;
    }
    .ai-bar-nav-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .ai-bar-nav-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .ai-bar-nav-btn .material-icons {
      font-size: 18px;
    }
    .ai-bar-edit-label, .ai-bar-file-label {
      font-size: 12px;
      color: var(--text-secondary);
      white-space: nowrap;
      min-width: 52px;
      text-align: center;
      user-select: none;
    }
    .ai-bar-sep {
      width: 1px;
      height: 18px;
      background: var(--border-color);
      flex-shrink: 0;
    }
    .ai-bar-center {
      gap: 6px;
    }
    .ai-bar-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      white-space: nowrap;
      line-height: 20px;
    }
    .ai-bar-btn kbd {
      display: inline-block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 11px;
      opacity: 0.6;
      margin-left: 4px;
      padding: 0 3px;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 3px;
      line-height: 16px;
    }
    .ai-bar-btn-reject kbd {
      border-color: var(--border-color);
    }
    .ai-bar-btn-accept {
      background: var(--accent-color);
      color: #fff;
    }
    .ai-bar-btn-accept:hover {
      filter: brightness(1.1);
    }
    .ai-bar-btn-reject {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }
    .ai-bar-btn-reject:hover {
      background: var(--bg-hover);
    }
    .ai-diff-history-overlay {
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
    }
    .ai-diff-history-panel {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      width: min(520px, 92vw);
      max-height: 80vh;
      display: flex; flex-direction: column;
      box-shadow: 0 16px 48px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .ai-diff-history-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      font-size: 13px; font-weight: 600;
      color: var(--text-primary);
    }
    .ai-diff-history-close {
      background: none; border: none; cursor: pointer;
      color: var(--text-secondary); padding: 2px;
    }
    .ai-diff-history-close:hover { color: var(--text-primary); }
    .ai-diff-history-body {
      flex: 1; overflow-y: auto; padding: 4px 0;
    }
    .ai-diff-history-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 16px; gap: 8px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
    }
    .ai-diff-history-row.undone { opacity: 0.45; }
    .ai-diff-history-row:hover { background: var(--bg-hover); }
    .history-row-info { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
    .history-file { font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .history-time { color: var(--text-secondary); font-size: 11px; white-space: nowrap; }
    .badge-accept { background: rgba(46,160,67,0.18); color: #3fb950; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
    .badge-reject { background: rgba(248,81,73,0.18); color: #f85149; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
    .badge-undone { background: rgba(136,136,136,0.18); color: var(--text-secondary); padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
    .history-row-actions { display: flex; gap: 4px; }
    .history-row-actions button {
      background: none; border: none; cursor: pointer;
      color: var(--text-secondary); padding: 2px; border-radius: 4px;
    }
    .history-row-actions button:hover { background: var(--bg-hover); color: var(--text-primary); }
    .history-row-actions .material-icons { font-size: 16px; }
    .ai-diff-history-footer {
      padding: 8px 16px; border-top: 1px solid var(--border-color);
      display: flex; justify-content: flex-end;
    }
    .ai-diff-history-clear-btn {
      background: transparent; border: 1px solid var(--border-color);
      color: var(--text-secondary); padding: 4px 12px; border-radius: 4px;
      font-size: 11px; cursor: pointer;
    }
    .ai-diff-history-clear-btn:hover { background: var(--bg-hover); color: var(--error-color); border-color: var(--error-color); }
    .ai-diff-history-viewer {
      position: absolute; inset: 0;
      background: var(--bg-primary);
      display: flex; flex-direction: column;
      z-index: 1;
    }
    .viewer-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px; font-weight: 600; color: var(--text-primary);
    }
    .viewer-close {
      background: none; border: none; cursor: pointer;
      color: var(--text-secondary); padding: 2px;
    }
    .viewer-close:hover { color: var(--text-primary); }
    .viewer-body {
      flex: 1; overflow: auto;
      font-family: var(--editor-font-family, 'SF Mono', Consolas, monospace);
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

// Keep old modal for manual diff viewing (git diff etc)
export async function showFullDiffModal(path, oldContent, newContent) {
  try {
    await ensureDiffLibrariesLoaded();
    _revealAndOpenFile(path, 'diff').catch(() => {});

    const modalOverlay = document.getElementById("modal-overlay");
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modal-title");
    const modalBody = document.getElementById("modal-body");
    const modalFooter = document.querySelector(".modal-footer");

    resetModalToDefault();
    modal.style.maxWidth = "95vw";
    modal.style.width = "95vw";
    modal.style.height = "85vh";
    modal.style.display = "flex";
    modal.style.flexDirection = "column";

    const isNew = !oldContent;
    modalTitle.textContent = isNew ? `AI Created: ${path}` : `AI Edit: ${path}`;

    modalBody.innerHTML = `
      <div class="diff-viewer-toolbar" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-color);">
        <div class="diff-viewer-summary" style="display:flex;align-items:center;gap:8px;">
          <span class="material-icons" style="color:var(--accent-color);">difference</span>
          <span id="diff-nav-count">Calculating...</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div class="diff-viewer-actions" style="display:flex;gap:4px;">
            <button id="diff-nav-prev" class="diff-nav-btn" type="button" title="Previous difference">
              <span class="material-icons">keyboard_arrow_up</span>
            </button>
            <button id="diff-nav-next" class="diff-nav-btn" type="button" title="Next difference">
              <span class="material-icons">keyboard_arrow_down</span>
            </button>
          </div>
          <button id="ai-diff-reject" type="button" style="display:inline-flex;align-items:center;gap:4px;padding:6px 16px;border-radius:6px;border:1px solid var(--error-color);background:transparent;color:var(--error-color);cursor:pointer;font-size:13px;font-weight:600;">
            <span class="material-icons" style="font-size:16px;">undo</span> Reject
          </button>
          <button id="ai-diff-accept" type="button" style="display:inline-flex;align-items:center;gap:4px;padding:6px 16px;border-radius:6px;border:none;background:var(--success-color);color:#fff;cursor:pointer;font-size:13px;font-weight:600;">
            <span class="material-icons" style="font-size:16px;">check</span> Accept
          </button>
        </div>
      </div>
      <div id="diff-view" class="diff-viewer-container"></div>
    `;
    modalBody.style.padding = "0";
    modalBody.style.flex = "1";
    modalBody.style.display = "flex";
    modalBody.style.flexDirection = "column";
    modalBody.style.overflow = "hidden";
    if (modalFooter) modalFooter.style.display = "none";

    modalOverlay.classList.add("visible");

    const target = document.getElementById("diff-view");
    const mode = getEditorMode(path);

    const mergeView = CodeMirror.MergeView(target, {
      value: newContent,
      origLeft: oldContent,
      lineNumbers: true,
      mode: mode,
      theme: state.theme === "light" ? "default" : "material-darker",
      highlightDifferences: true,
      connect: "align",
      collapseIdentical: false,
      readOnly: true,
      revertButtons: false,
    });
    const diffNavigation = setupDiffNavigation(mergeView);

    return new Promise((resolve) => {
      let isClosed = false;
      let unsubscribeHideModal = null;

      const closeHandler = (result) => {
        if (isClosed) return;
        isClosed = true;
        diffNavigation.cleanup();
        modalOverlay.classList.remove("visible");
        modalOverlay.removeEventListener("click", overlayClickHandler);
        if (unsubscribeHideModal) unsubscribeHideModal();
        resetModalToDefault();
        modal.style.width = "";
        modal.style.height = "";
        modal.style.display = "";
        modal.style.flexDirection = "";
        modalBody.style.padding = "";
        modalBody.style.flex = "";
        modalBody.style.display = "";
        modalBody.style.flexDirection = "";
        modalBody.style.overflow = "";
        resolve(result);
      };

      const overlayClickHandler = (e) => {
        if (e.target === modalOverlay) closeHandler("dismiss");
      };
      modalOverlay.addEventListener("click", overlayClickHandler);
      document.getElementById("modal-close").onclick = () => closeHandler("dismiss");
      unsubscribeHideModal = eventBus.on("ui:hide-modal", () => closeHandler("dismiss"));

      document.getElementById("ai-diff-accept").onclick = async () => {
        showToast(`✅ Accepted changes to ${path}`, "success");
        const tab = state.openTabs.find(t => t.path === path);
        if (tab) {
          tab.content = newContent;
          tab.originalContent = newContent;
          tab.modified = false;
          if (state.activeTab && state.activeTab.path === path && state.editor) {
            state.editor.setValue(newContent);
          }
          eventBus.emit('file:check-updates');
        } else {
          await _revealAndOpenFile(path, 'edit');
        }
        closeHandler("accept");
      };

      document.getElementById("ai-diff-reject").onclick = async () => {
        try {
          await fetchWithAuth(API_BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "write_file", path: path, content: oldContent }),
          });
          showToast(`↩️ Reverted ${path}`, "success");
          const tab = state.openTabs.find(t => t.path === path);
          if (tab) {
            tab.content = oldContent;
            tab.modified = false;
            if (state.activeTab && state.activeTab.path === path && state.editor) {
              state.editor.setValue(oldContent);
            }
            eventBus.emit('file:check-updates');
          }
        } catch (err) {
          showToast(`Failed to revert: ${err.message}`, "error");
        }
        closeHandler("reject");
      };
    });

  } catch (error) {
    showToast(`Diff failed: ${error.message}`, "error");
  }
}

const ACTIVE_DIFF_CHUNK_CLASS = "CodeMirror-merge-active-chunk";
const MAX_ACTIVE_DIFF_HIGHLIGHT_LINES = 80;

function getMergeViewChunks(mergeView) {
  const chunks = mergeView.leftChunks?.() || mergeView.rightChunks?.() || [];
  return chunks.filter(chunk => (
    chunk.origFrom !== chunk.origTo ||
    chunk.editFrom !== chunk.editTo
  ));
}

function getChunkDisplayLine(cm, from, to) {
  const firstLine = cm.firstLine();
  const lastLine = cm.lastLine();
  const targetLine = from === to ? Math.max(firstLine, from - 1) : from;
  return Math.max(firstLine, Math.min(targetLine, lastLine));
}

function centerEditorOnLine(cm, line) {
  if (!cm) return;

  const safeLine = Math.max(cm.firstLine(), Math.min(line, cm.lastLine()));
  const scrollInfo = cm.getScrollInfo();
  const coords = cm.charCoords({ line: safeLine, ch: 0 }, "local");
  const targetTop = Math.max(0, coords.top - Math.floor(scrollInfo.clientHeight * 0.35));

  cm.scrollTo(null, targetTop);
}

function setupDiffNavigation(mergeView) {
  const previousButton = document.getElementById("diff-nav-prev");
  const nextButton = document.getElementById("diff-nav-next");
  const countLabel = document.getElementById("diff-nav-count");
  const editor = mergeView.editor();
  const leftOriginal = mergeView.leftOriginal?.();
  const rightOriginal = mergeView.rightOriginal?.();
  const chunks = getMergeViewChunks(mergeView);
  let activeIndex = chunks.length ? 0 : -1;
  let activeLineHandles = [];
  let isActive = true;
  let pendingFrame = null;

  function clearActiveChunk() {
    activeLineHandles.forEach(({ cm, handle }) => {
      cm.removeLineClass(handle, "background", ACTIVE_DIFF_CHUNK_CLASS);
    });
    activeLineHandles = [];
  }

  function markChunkInEditor(cm, from, to) {
    if (!cm) return;

    const firstLine = cm.firstLine();
    const lastLine = cm.lastLine();
    const start = getChunkDisplayLine(cm, from, to);
    const end = from === to
      ? start + 1
      : Math.max(start + 1, Math.min(to, lastLine + 1));

    const highlightedEnd = Math.min(end, start + MAX_ACTIVE_DIFF_HIGHLIGHT_LINES);

    cm.operation(() => {
      for (let line = start; line < highlightedEnd && line <= lastLine; line++) {
        const handle = cm.getLineHandle(Math.max(firstLine, line));
        if (handle) {
          cm.addLineClass(handle, "background", ACTIVE_DIFF_CHUNK_CLASS);
          activeLineHandles.push({ cm, handle });
        }
      }
    });
  }

  function updateCountLabel() {
    if (!countLabel) return;

    if (!chunks.length) {
      countLabel.textContent = "No differences";
      return;
    }

    const plural = chunks.length === 1 ? "difference" : "differences";
    countLabel.textContent = `${activeIndex + 1} / ${chunks.length} ${plural}`;
  }

  function updateButtonState() {
    const disabled = chunks.length === 0;
    if (previousButton) previousButton.disabled = disabled;
    if (nextButton) nextButton.disabled = disabled;
  }

  function jumpToChunk(index) {
    if (!chunks.length) return;

    activeIndex = (index + chunks.length) % chunks.length;
    const chunk = chunks[activeIndex];
    const editLine = getChunkDisplayLine(editor, chunk.editFrom, chunk.editTo);
    const originalLine = getChunkDisplayLine(leftOriginal || rightOriginal || editor, chunk.origFrom, chunk.origTo);

    clearActiveChunk();
    markChunkInEditor(editor, chunk.editFrom, chunk.editTo);
    markChunkInEditor(leftOriginal, chunk.origFrom, chunk.origTo);
    markChunkInEditor(rightOriginal, chunk.origFrom, chunk.origTo);
    updateCountLabel();

    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
    }

    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (!isActive) return;

      centerEditorOnLine(editor, editLine);
      centerEditorOnLine(leftOriginal, originalLine);
      centerEditorOnLine(rightOriginal, originalLine);
    });
  }

  previousButton?.addEventListener("click", () => jumpToChunk(activeIndex - 1));
  nextButton?.addEventListener("click", () => jumpToChunk(activeIndex + 1));

  updateCountLabel();
  updateButtonState();

  if (chunks.length) {
    jumpToChunk(activeIndex);
  }

  return {
    cleanup() {
      isActive = false;
      if (pendingFrame) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
      clearActiveChunk();
    }
  };
}

/**
 * Show diff modal for a file
 * Compares HEAD version with current version
 */
export async function showDiffModal(path) {
  try {
    await ensureDiffLibrariesLoaded();
    showGlobalLoading(`Calculating diff for ${path}...`);

    // 1. Get HEAD content (Old)
    const headData = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_show", path: path }),
    });

    let oldContent = "";
    if (headData.success) {
      oldContent = headData.content;
    }

    // 2. Get Current Content (New)
    let newContent = "";
    const tab = state.openTabs.find(t => t.path === path);
    if (tab) {
      newContent = tab.content;
    } else {
      // Import on demand to avoid circular dependency
      const { loadFile } = await import('./app.js');
      const diskData = await loadFile(path);
      newContent = diskData.content;
    }

    hideGlobalLoading();

    // 3. Setup Modal
    const modalOverlay = document.getElementById("modal-overlay");
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modal-title");
    const modalBody = document.getElementById("modal-body");
    const modalFooter = document.querySelector(".modal-footer");

    resetModalToDefault();
    modal.style.maxWidth = "95vw";
    modal.style.width = "95vw";
    modal.style.height = "85vh";
    modal.style.display = "flex";
    modal.style.flexDirection = "column";

    modalTitle.textContent = `Diff: ${path}`;
    modalFooter.style.display = "none";

    // Use flex column for body to let MergeView fill it
    modalBody.innerHTML = `
      <div class="diff-viewer-toolbar">
        <div class="diff-viewer-summary">
          <span class="material-icons">difference</span>
          <span id="diff-nav-count">No differences</span>
        </div>
        <div class="diff-viewer-actions" aria-label="Diff navigation">
          <button id="diff-nav-prev" class="diff-nav-btn" type="button" title="Previous difference" aria-label="Previous difference">
            <span class="material-icons">keyboard_arrow_up</span>
          </button>
          <button id="diff-nav-next" class="diff-nav-btn" type="button" title="Next difference" aria-label="Next difference">
            <span class="material-icons">keyboard_arrow_down</span>
          </button>
        </div>
      </div>
      <div id="diff-view" class="diff-viewer-container"></div>
    `;
    modalBody.style.padding = "0";
    modalBody.style.flex = "1";
    modalBody.style.display = "flex";
    modalBody.style.flexDirection = "column";
    modalBody.style.overflow = "hidden"; // Let CodeMirror handle scroll

    modalOverlay.classList.add("visible");

    // 4. Initialize CodeMirror Merge View
    const target = document.getElementById("diff-view");
    const mode = getEditorMode(path);

    // Old on Left (origLeft), New on Right (value/main)
    const mergeView = CodeMirror.MergeView(target, {
      value: newContent,
      origLeft: oldContent,
      lineNumbers: true,
      mode: mode,
      theme: state.theme === "light" ? "default" : "material-darker",
      highlightDifferences: true,
      connect: "align",
      collapseIdentical: false,
      readOnly: true,
      revertButtons: false
    });
    const diffNavigation = setupDiffNavigation(mergeView);

    // Cleanup handler
    let isClosed = false;
    let unsubscribeHideModal = null;
    const closeHandler = () => {
      if (isClosed) return;
      isClosed = true;
      diffNavigation.cleanup();
      modalOverlay.classList.remove("visible");
      modalOverlay.removeEventListener("click", overlayClickHandler);
      if (unsubscribeHideModal) unsubscribeHideModal();
      // Clean up modal styles
      resetModalToDefault();
      modal.style.width = "";
      modal.style.height = "";
      modal.style.display = "";
      modal.style.flexDirection = "";
      modalBody.style.padding = "";
      modalBody.style.flex = "";
      modalBody.style.display = "";
      modalBody.style.flexDirection = "";
      modalBody.style.overflow = "";
    };

    const overlayClickHandler = (e) => {
      if (e.target === modalOverlay) closeHandler();
    };
    modalOverlay.addEventListener("click", overlayClickHandler);
    document.getElementById("modal-close").onclick = closeHandler;
    unsubscribeHideModal = eventBus.on("ui:hide-modal", closeHandler);

  } catch (error) {
    hideGlobalLoading();
    showToast(t("toast.diff_failed", { error: error.message }), "error");
  }
}

/**
 * Show git commit history
 */
export async function showGitHistory() {
  if (!isGitEnabled()) {
    showToast(t("toast.git_integration_is_not_enabled"), "error");
    return;
  }

  if (!gitState.isInitialized) {
    showToast(t("toast.git_integration_is_not_initial"), "error");
    return;
  }

  try {
    showGlobalLoading("Fetching history...");
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_log", count: 30 }),
    });
    hideGlobalLoading();

    if (data.success) {
      if (data.commits.length === 0) {
        showToast(t("toast.no_commits_found_in_this_repos"), "success");
        return;
      }

      const commitListHtml = data.commits.map(commit => {
        const date = new Date(commit.timestamp * 1000).toLocaleString();
        return `
          <div class="git-history-item" data-hash="${commit.hash}" style="padding: 12px; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background 0.15s;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-weight: 600; color: var(--accent-color); font-family: monospace;">${commit.hash.substring(0, 7)}</span>
              <span style="font-size: 11px; color: var(--text-muted);">${date}</span>
            </div>
            <div style="font-size: 14px; color: var(--text-primary); margin-bottom: 4px;">${commit.message}</div>
            <div style="font-size: 12px; color: var(--text-secondary); opacity: 0.8;">by ${commit.author}</div>
          </div>
        `;
      }).join("");

      // Show commit history modal
      const historyPromise = showModal({
        title: "Commit History",
        message: `
          <div style="max-height: 60vh; overflow-y: auto; margin: -16px; background: var(--bg-primary);">
            ${commitListHtml}
          </div>
        `,
        confirmText: "Close",
        onConfirm: () => {}
      });

      // Make modal wider (responsive for mobile)
      const modal = document.getElementById("modal");
      if (modal) {
        modal.style.maxWidth = "min(900px, 95vw)";
        modal.style.width = "min(900px, 95vw)";
      }

      // Add click listeners to history items
      setTimeout(() => {
        const items = document.querySelectorAll(".git-history-item");
        items.forEach(item => {
          item.addEventListener("click", () => {
            const hash = item.getAttribute("data-hash");
            const commit = data.commits.find(c => c.hash === hash);
            showGitCommitDiff(commit);
          });
          item.addEventListener("mouseenter", () => item.style.background = "var(--bg-tertiary)");
          item.addEventListener("mouseleave", () => item.style.background = "transparent");
        });
      }, 100);

    } else {
      showToast(t("toast.fetch_history_failed", { error: data.message }), "error");
    }
  } catch (e) {
    hideGlobalLoading();
    showToast(t("toast.fetch_history_error", { error: e.message }), "error");
  }
}

/**
 * Show diff for a specific commit
 */
export async function showGitCommitDiff(commit) {
  try {
    showGlobalLoading(`Loading diff for ${commit.hash.substring(0, 7)}...`);
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "git_diff_commit", hash: commit.hash }),
    });
    hideGlobalLoading();

    if (data.success) {
      // We'll reuse the modal but with a large diff view
      const date = new Date(commit.timestamp * 1000).toLocaleString();

      // Format diff with some basic coloring
      const lines = data.diff.split("\n");
      const coloredDiff = lines.map(line => {
        let color = "inherit";
        if (line.startsWith("+") && !line.startsWith("+++")) color = "var(--success-color)";
        else if (line.startsWith("-") && !line.startsWith("---")) color = "var(--error-color)";
        else if (line.startsWith("@@")) color = "var(--accent-color)";

        return `<div style="color: ${color}; white-space: pre-wrap; font-family: monospace; font-size: 12px; line-height: 1.4;">${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
      }).join("");

      // Show commit diff modal
      const diffPromise = showModal({
        title: `Commit: ${commit.hash.substring(0, 7)}`,
        message: `
          <div style="display: flex; flex-direction: column; height: 70vh;">
            <div style="padding-bottom: 12px; border-bottom: 1px solid var(--border-color); margin-bottom: 12px;">
              <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">${commit.message}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                <strong>Author:</strong> ${commit.author} | <strong>Date:</strong> ${date}
              </div>
            </div>
            <div style="flex: 1; overflow: auto; background: var(--bg-primary); padding: 12px; border-radius: 4px; border: 1px solid var(--border-color);">
              ${coloredDiff || '<div style="color: var(--text-muted); text-align: center; padding: 20px;">No changes to display in this commit</div>'}
            </div>
          </div>
        `,
        confirmText: "Back to History"
      });

      // Make modal wider (responsive for mobile)
      const modal = document.getElementById("modal");
      if (modal) {
        modal.style.maxWidth = "min(900px, 95vw)";
        modal.style.width = "min(900px, 95vw)";
      }

      // Wait for user to close the modal
      const result = await diffPromise;

      // Only navigate back to history if user clicked "Back to History" button
      // (not if they clicked Cancel/Close which returns null)
      if (result !== null) {
        await showGitHistory();
      }

    } else {
      showToast(t("toast.fetch_diff_failed", { error: data.message }), "error");
    }
  } catch (e) {
    hideGlobalLoading();
    showToast(t("toast.fetch_diff_error", { error: e.message }), "error");
  }
}
