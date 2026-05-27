/** ASSET-PREVIEW.JS | Purpose: * Handles preview rendering for non-code files including images, PDFs, videos, */
import { state, elements } from './state.js';
import { isSftpPath, parseSftpPath, sftpStreamUrl } from './sftp.js';
import { t } from './translations.js';
import { eventBus } from './event-bus.js';
import { copyToClipboard } from './utils.js';
import { saveSettings } from './settings.js';
import { IMAGE_EXTENSIONS, AUDIO_EXTENSIONS } from './constants.js';
import { urlWithToken, serveFileUrl } from './api.js';

/**
 * Renders preview for binary assets (images, PDFs, videos)
 * @param {Object} tab - The tab object containing file data
 * @param {HTMLElement} container - The preview container element (optional, defaults to elements.assetPreview)
 */
export async function renderAssetPreview(tab, container = null) {
  const previewContainer = container || elements.assetPreview;
  if (!previewContainer) return;

  // Temporarily swap elements.assetPreview to use the provided container
  const originalPreview = elements.assetPreview;
  elements.assetPreview = previewContainer;

  const filename = tab.path.split("/").pop();

  if (tab.isImage) {
    renderImagePreview(tab, filename);
  } else if (tab.isPdf) {
    renderPdfPreview(tab, filename);
  } else if (tab.isVideo) {
    await renderVideoPreview(tab, filename);
  } else if (tab.isAudio) {
    await renderAudioPreview(tab, filename);
  }

  // Restore original elements.assetPreview
  elements.assetPreview = originalPreview;
}

/**
 * Renders image preview with navigation
 */
function renderImagePreview(tab, filename) {
  let imageFiles = [];

  if (isSftpPath(tab.path)) {
    // SFTP Logic
    const { connId } = parseSftpPath(tab.path);
    if (state.activeSftp.connectionId === connId) {
      imageFiles = state.activeSftp.files
        .filter(f => {
          const ext = f.name.split(".").pop().toLowerCase();
          return IMAGE_EXTENSIONS.has(ext);
        })
        .map(f => ({
          name: f.name,
          path: `sftp://${connId}${f.path}` // Reconstruct virtual path
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
    }
  } else {
    // Local Files Logic
    const currentDir = tab.path.substring(0, tab.path.lastIndexOf("/"));
    
    // Check if we are using lazy loading and have this directory cached
    let sourceFiles = state.files;
    if (state.lazyLoadingEnabled && state.loadedDirectories && state.loadedDirectories.has(currentDir)) {
      sourceFiles = state.loadedDirectories.get(currentDir).files;
    } else if (state.lazyLoadingEnabled && state.loadedDirectories && currentDir === "") {
      sourceFiles = state.loadedDirectories.get("").files || state.files;
    }

    imageFiles = sourceFiles
      .filter(f => {
        const fPath = f.path || f; // handle potential object or string
        const fName = f.name || fPath.split("/").pop();
        const fDir = fPath.substring(0, fPath.lastIndexOf("/"));
        const ext = fName.split(".").pop().toLowerCase();

        // In lazy loading, sourceFiles are already from currentDir, so fDir check might be redundant but safe
        // If sourceFiles is state.files, we need the fDir check
        return (fDir === currentDir || (state.lazyLoadingEnabled && sourceFiles !== state.files)) && IMAGE_EXTENSIONS.has(ext);
      })
      .map(f => ({
        name: f.name || f.path.split("/").pop(),
        path: f.path || f
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
  }

  const currentIndex = imageFiles.findIndex(f => f.path === tab.path);
  const prevImage = currentIndex > 0 ? imageFiles[currentIndex - 1] : null;
  const nextImage = currentIndex < imageFiles.length - 1 ? imageFiles[currentIndex + 1] : null;

  elements.assetPreview.style.padding = "0";
  const dataUrl = `data:${tab.mimeType};base64,${tab.content}`;

  elements.assetPreview.innerHTML = `
    <div class="image-viewer-container" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--bg-tertiary);">
      <div class="pdf-toolbar" style="padding: 8px 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--borderColor); display: flex; justify-content: space-between; align-items: center; height: 48px; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="color: var(--accent-color);">image</span>
          <span style="font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">${filename}</span>
          <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${tab.mimeType}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <button id="img-prev" class="toolbar-btn" title="Previous Image" ${!prevImage ? 'disabled style="opacity: 0.5; cursor: default;"' : ''}>
              <span class="material-icons">chevron_left</span>
            </button>
            <span style="font-size: 13px; color: var(--text-secondary); min-width: 60px; text-align: center;">${currentIndex + 1} / ${imageFiles.length}</span>
            <button id="img-next" class="toolbar-btn" title="Next Image" ${!nextImage ? 'disabled style="opacity: 0.5; cursor: default;"' : ''}>
              <span class="material-icons">chevron_right</span>
            </button>
          </div>
          <div style="width: 1px; height: 24px; background: var(--borderColor);"></div>
          <button id="img-download" class="toolbar-btn" title="Download Image">
            <span class="material-icons">download</span>
          </button>
        </div>
      </div>
      <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 20px; background: var(--bg-primary);">
        <div style="position: relative; max-width: 100%; max-height: 100%;">
          <img src="${dataUrl}" alt="${filename}" style="max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 4px 12px rgba(0,0,0,0.3); background-image: linear-gradient(45deg, var(--bg-secondary) 25%, transparent 25%), linear-gradient(-45deg, var(--bg-secondary) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg-secondary) 75%), linear-gradient(-45deg, transparent 75%, var(--bg-secondary) 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px;">
        </div>
      </div>
    </div>
  `;

  if (prevImage) {
    document.getElementById("img-prev").addEventListener("click", () => {
      const currentTab = state.activeTab;
      if (currentTab) {
        currentTab.path = prevImage.path;
        eventBus.emit('file:open', { path: prevImage.path, forceReload: true });
      }
    });
  }

  if (nextImage) {
    document.getElementById("img-next").addEventListener("click", () => {
      const currentTab = state.activeTab;
      if (currentTab) {
        currentTab.path = nextImage.path;
        eventBus.emit('file:open', { path: nextImage.path, forceReload: true });
      }
    });
  }

  document.getElementById("img-download").addEventListener("click", () => {
    eventBus.emit('file:download-content', {
      filename,
      content: tab.content,
      isBase64: true,
      mimeType: tab.mimeType
    });
  });

  const handleKeyNav = (e) => {
    if (!document.body.contains(elements.assetPreview)) {
      document.removeEventListener("keydown", handleKeyNav);
      return;
    }
    if (e.key === "ArrowLeft" && prevImage) {
      const currentTab = state.activeTab;
      if (currentTab) {
        currentTab.path = prevImage.path;
        eventBus.emit('file:open', { path: prevImage.path, forceReload: true });
      }
    }
    if (e.key === "ArrowRight" && nextImage) {
      const currentTab = state.activeTab;
      if (currentTab) {
        currentTab.path = nextImage.path;
        eventBus.emit('file:open', { path: nextImage.path, forceReload: true });
      }
    }
  };
  document.addEventListener("keydown", handleKeyNav, { once: true });
}

/**
 * Renders PDF preview with page navigation using PDF.js
 * (Required because native <object> tags are often blocked by Home Assistant's sandbox)
 */
async function renderPdfPreview(tab, filename) {
  elements.assetPreview.style.padding = "0";

  const binaryString = atob(tab.content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Setup PDF.js (loaded as ES module)
  const pdfjsLib = await import('/local/blueprint_studio/vendor/pdfjs/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/local/blueprint_studio/vendor/pdfjs/pdf.worker.min.js';

  elements.assetPreview.innerHTML = `
    <div class="pdf-container" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--bg-tertiary);">
      <div class="pdf-toolbar" style="padding: 8px 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--borderColor); display: flex; justify-content: space-between; align-items: center; height: 48px; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="color: var(--error-color);">picture_as_pdf</span>
          <span style="font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">${filename}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 13px;">
            <button id="pdf-prev" class="toolbar-btn" style="min-width: 32px; height: 32px; padding: 0;"><span class="material-icons">chevron_left</span></button>
            <span>Page <span id="pdf-page-num">1</span> / <span id="pdf-page-count">-</span></span>
            <button id="pdf-next" class="toolbar-btn" style="min-width: 32px; height: 32px; padding: 0;"><span class="material-icons">chevron_right</span></button>
          </div>
          <div style="width: 1px; height: 24px; background: var(--borderColor);"></div>
          <button id="btn-download-pdf" class="toolbar-btn" title="Download"><span class="material-icons">download</span></button>
        </div>
      </div>
      <div id="pdf-viewer-viewport" style="flex-grow: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 20px; background: var(--bg-primary);">
        <canvas id="pdf-canvas" style="box-shadow: 0 4px 12px rgba(0,0,0,0.3); max-width: 100%; height: auto; display: block;"></canvas>
      </div>
    </div>
  `;

  let pdfDoc = null;
  let pageNum = 1;
  let pageRendering = false;
  let pageNumPending = null;
  const scale = 1.5;
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');

  async function renderPage(num) {
    pageRendering = true;
    const page = await pdfDoc.getPage(num);
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr });

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Set display size
    const styleViewport = page.getViewport({ scale });
    canvas.style.width = styleViewport.width + 'px';
    canvas.style.height = styleViewport.height + 'px';

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };
    const renderTask = page.render(renderContext);

    await renderTask.promise;
    pageRendering = false;
    if (pageNumPending !== null) {
      renderPage(pageNumPending);
      pageNumPending = null;
    }
    document.getElementById('pdf-page-num').textContent = num;
  }

  function queueRenderPage(num) {
    if (pageRendering) {
      pageNumPending = num;
    } else {
      renderPage(num);
    }
  }

  // Load PDF
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  loadingTask.promise.then(pdf => {
    pdfDoc = pdf;
    document.getElementById('pdf-page-count').textContent = pdf.numPages;
    renderPage(pageNum);
  }).catch(err => {
    console.error('PDF.js error:', err);
    elements.assetPreview.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--error-color);">Failed to load PDF: ${err.message}</div>`;
  });

  document.getElementById('pdf-prev').addEventListener('click', () => {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
  });

  document.getElementById('pdf-next').addEventListener('click', () => {
    if (pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
  });

  document.getElementById("btn-download-pdf")?.addEventListener("click", () => {
    eventBus.emit('file:download-content', {
      filename,
      content: tab.content,
      isBase64: true,
      mimeType: tab.mimeType
    });
  });
}

/**
 * Renders video preview with streaming URL (Range support).
 */
async function renderVideoPreview(tab, filename) {
  elements.assetPreview.style.padding = "0";

  // SFTP files use a direct stream URL so the browser can request metadata/ranges.
  const isSftp = isSftpPath(tab.path);
  let srcUrl;
  if (isSftp) {
    if (tab.streamUrl) {
      srcUrl = tab.streamUrl;
    } else {
      const { connId, remotePath } = parseSftpPath(tab.path);
      srcUrl = await sftpStreamUrl(connId, remotePath);
      tab.streamUrl = srcUrl;
    }
  } else {
    srcUrl = await urlWithToken(serveFileUrl(tab.path));
  }

  elements.assetPreview.innerHTML = `
    <div class="video-viewer-container" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--bg-tertiary);">
      <div class="pdf-toolbar" style="padding: 8px 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--borderColor); display: flex; justify-content: space-between; align-items: center; height: 48px; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="color: var(--accent-color);">movie</span>
          <span style="font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;">${filename}</span>
          <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${tab.mimeType || ""}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          ${isSftp
            ? `<button id="video-download" class="toolbar-btn" title="Download Video"><span class="material-icons">download</span></button>`
            : `<a href="${srcUrl}" download="${filename}" class="toolbar-btn" title="Download Video" style="text-decoration:none;color:inherit;display:flex;align-items:center;"><span class="material-icons">download</span></a>`
          }
        </div>
      </div>
      <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg-primary);">
        <video
          controls
          preload="metadata"
          style="max-width: 100%; max-height: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.3); background: #000;">
          <source src="${srcUrl}" type="${tab.mimeType || ""}">
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  `;

  if (isSftp) {
    document.getElementById("video-download")?.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = srcUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
}

/**
 * Renders audio preview with streaming URL.
 * Uses direct SFTP stream URLs for browser Range support.
 */
async function renderAudioPreview(tab, filename) {
  elements.assetPreview.style.padding = "0";

  const isSftp = isSftpPath(tab.path);
  let srcUrl;
  if (isSftp) {
    if (tab.streamUrl) {
      srcUrl = tab.streamUrl;
    } else {
      const { connId, remotePath } = parseSftpPath(tab.path);
      srcUrl = await sftpStreamUrl(connId, remotePath);
      tab.streamUrl = srcUrl;
    }
  } else {
    srcUrl = await urlWithToken(serveFileUrl(tab.path));
  }

  elements.assetPreview.innerHTML = `
    <div class="audio-viewer-container" style="width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--bg-tertiary);">
      <div class="pdf-toolbar" style="padding: 8px 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--borderColor); display: flex; justify-content: space-between; align-items: center; height: 48px; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="color: var(--accent-color);">audiotrack</span>
          <span style="font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;">${filename}</span>
          <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${tab.mimeType || ""}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          ${isSftp
            ? `<button id="audio-download" class="toolbar-btn" title="Download Audio"><span class="material-icons">download</span></button>`
            : `<a href="${srcUrl}" download="${filename}" class="toolbar-btn" title="Download Audio" style="text-decoration:none;color:inherit;display:flex;align-items:center;"><span class="material-icons">download</span></a>`
          }
        </div>
      </div>
      <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; padding: 40px; background: var(--bg-primary);">
        <div style="width: 100%; max-width: 600px; text-align: center;">
          <span class="material-icons" style="font-size: 64px; color: var(--text-muted); margin-bottom: 20px; display: block;">audiotrack</span>
          <audio
            controls
            preload="metadata"
            style="width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border-radius: 8px;">
            <source src="${srcUrl}" type="${tab.mimeType || ""}">
            Your browser does not support the audio tag.
          </audio>
        </div>
      </div>
    </div>
  `;

  if (isSftp) {
    document.getElementById("audio-download")?.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = srcUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
}

/**
 * Adds copy buttons to all code blocks (pre tags) within a container
 * @param {HTMLElement} container - The container element to process
 */
export function addCodeCopyButtons(container) {
  if (!container) return;
  
  container.querySelectorAll('pre').forEach(block => {
    // Only add if not already present
    if (block.querySelector('.code-copy-btn')) return;
    
    // Ensure relative positioning for button placement
    if (getComputedStyle(block).position === 'static') {
      block.style.position = 'relative';
    }
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.innerHTML = '<span class="material-icons" style="font-size: 18px;">content_copy</span>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s, background 0.2s;
      z-index: 10;
      width: 32px;
      height: 32px;
    `;
    
    block.addEventListener('mouseenter', () => copyBtn.style.opacity = '1');
    block.addEventListener('mouseleave', () => copyBtn.style.opacity = '0');
    
    copyBtn.addEventListener('mouseenter', () => {
      copyBtn.style.background = 'var(--bg-secondary)';
      copyBtn.style.color = 'var(--accent-color)';
    });
    copyBtn.addEventListener('mouseleave', () => {
      copyBtn.style.background = 'var(--bg-primary)';
      copyBtn.style.color = 'var(--text-secondary)';
    });
    
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = block.querySelector('code')?.innerText || block.innerText;
      copyToClipboard(code).then(success => {
        if (success) {
          const icon = copyBtn.querySelector('.material-icons');
          icon.textContent = 'check';
          copyBtn.style.color = 'var(--success-color)';
          setTimeout(() => {
            icon.textContent = 'content_copy';
            copyBtn.style.color = 'var(--text-secondary)';
          }, 2000);
        }
      });
    });
    
    block.appendChild(copyBtn);
  });
}

/**
 * Renders markdown text to HTML using marked.js (GitHub Flavored Markdown)
 * with syntax highlighting via highlight.js
 * @param {string} text - Markdown text to render
 * @returns {string} HTML string
 */
export function renderMarkdown(text) {
  if (!text) return "";

  if (typeof marked === 'undefined') {
    console.warn('[Markdown] marked.js not yet available for rendering');
    return `<pre>${text}</pre>`;
  }

  try {
    // Initialize marked extensions if not already done
    if (!renderMarkdown.initialized) {
      const extensions = [];
      
      // Add heading IDs
      if (window.markedGfmHeadingId) {
        extensions.push(window.markedGfmHeadingId.gfmHeadingId());
      }
      
      // Add mangle (email protection)
      if (window.markedMangle) {
        extensions.push(window.markedMangle.mangle());
      }
      
      // Add Highlight.js support via marked-highlight
      if (window.markedHighlight && typeof hljs !== 'undefined') {
        const { markedHighlight } = window.markedHighlight;
        extensions.push(markedHighlight({
          emptyLangClass: 'hljs',
          langPrefix: 'hljs language-',
          highlight(code, lang) {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
          }
        }));
      }

      marked.use(...extensions, {
        gfm: true,
        breaks: true,
        headerIds: true,
        mangle: false,
        sanitize: false,
        smartLists: true,
        smartypants: false,
        xhtml: false
      });
      
      renderMarkdown.initialized = true;
    }

    const html = marked.parse(text);
    return html;
  } catch (error) {
    console.error('Markdown rendering error:', error);
    return `<pre>${text}</pre>`;
  }
}

// Persistent update function for markdown preview live updates
let markdownUpdateTimer = null;
export const handleMarkdownChange = () => {
  if (markdownUpdateTimer) clearTimeout(markdownUpdateTimer);
  markdownUpdateTimer = setTimeout(() => {
    if (elements.btnMarkdownPreview?.classList.contains("active")) {
      // Use primaryEditor as source if in split view, otherwise use state.editor
      const sourceEditor = state.splitView.enabled ? state.primaryEditor : state.editor;
      const content = sourceEditor ? sourceEditor.getValue() : (state.activeTab ? state.activeTab.content : "");
      
      // Target correct preview container
      const previewContainer = state.splitView.enabled ? 
        document.getElementById('secondary-asset-preview') : 
        elements.assetPreview;
        
      if (previewContainer) {
        previewContainer.innerHTML = `<div class="markdown-body">${renderMarkdown(content)}</div>`;
        
        // No need for manual hljs.highlightElement here as marked-highlight handles it
        // during parsing if we use standard ``` code blocks.
        
        // Add copy buttons to code blocks
        addCodeCopyButtons(previewContainer);
      }
    }
  }, 300); // 300ms throttle
};

/**
 * Cleans up markdown preview state, ensuring listeners are removed from the editor.
 * @param {boolean} resetState - If true, also resets the global markdownPreviewActive state.
 */
export function cleanupMarkdownPreview(resetState = false) {
  if (state.editor) {
    state.editor.off("change", handleMarkdownChange);
  }
  
  if (state.primaryEditor) {
    state.primaryEditor.off("change", handleMarkdownChange);
  }
  
  if (state.secondaryEditor) {
    state.secondaryEditor.off("change", handleMarkdownChange);
  }
  
  if (resetState) {
    state.markdownPreviewActive = false;
    saveSettings();
  }
  
  if (elements.btnMarkdownPreview) {
    // Only remove active class if we are resetting the state
    if (resetState) {
        elements.btnMarkdownPreview.classList.remove("active");
    }
  }
  
  // Only hide and clear the preview container if we are NOT switching to a binary file
  // or if we explicitly requested a reset (e.g. toggling preview off)
  if (resetState || (!state.activeTab || !state.activeTab.isBinary)) {
    // CRITICAL: Don't clear if this is a terminal tab!
    if (state.activeTab && state.activeTab.isTerminal) return;

    if (elements.assetPreview) {
      elements.assetPreview.classList.remove("visible");
      // Don't clear if it contains the terminal
      if (!elements.assetPreview.querySelector('#terminal-panel')) {
          elements.assetPreview.innerHTML = "";
      }
    }
    
    const secondaryPreview = document.getElementById('secondary-asset-preview');
    if (secondaryPreview && !secondaryPreview.classList.contains('bf-active')) {
      secondaryPreview.classList.remove("visible");
      // Don't clear if it contains the terminal
      if (!secondaryPreview.querySelector('#terminal-panel')) {
          secondaryPreview.innerHTML = "";
      }
    }
  }
}

/**
 * Toggles markdown preview mode for .md files
 * @param {boolean} forceState - Optional: force a specific state (true for on, false for off)
 */
export function toggleMarkdownPreview(forceState = null) {
  if (!state.activeTab || !state.activeTab.path.endsWith(".md")) return;

  const isPreview = forceState !== null ? forceState : !state.markdownPreviewActive;
  
  if (isPreview) {
    state.markdownPreviewActive = true;
    if (elements.btnMarkdownPreview) {
      elements.btnMarkdownPreview.classList.add("active");
    }
    saveSettings();

    // Enable side-by-side preview using split view
    if (!state.splitView.enabled) {
      eventBus.emit("ui:toggle-split-view");
    }
    
    // For immediate feedback:
    const renderToPane = (pane) => {
      const previewContainer = (pane === 'secondary') ? 
        document.getElementById('secondary-asset-preview') : 
        elements.assetPreview;
        
      if (previewContainer) {
        previewContainer.classList.add("visible");
        const sourceEditor = state.splitView.enabled ? state.primaryEditor : state.editor;
        const content = sourceEditor ? sourceEditor.getValue() : state.activeTab.content;
        previewContainer.innerHTML = `<div class="markdown-body">${renderMarkdown(content)}</div>`;
        addCodeCopyButtons(previewContainer);
      }
    };

    // If we just enabled split view, we might need a small timeout
    setTimeout(() => {
      // In side-by-side mode, we usually want the preview in the secondary pane
      renderToPane(state.splitView.enabled ? 'secondary' : 'primary');
      
      // Add live update listeners
      if (state.primaryEditor) {
        state.primaryEditor.getWrapperElement().style.display = "block";
        state.primaryEditor.on("change", handleMarkdownChange);
        state.primaryEditor.refresh();
      }
      
      if (state.secondaryEditor) {
        state.secondaryEditor.on("change", handleMarkdownChange);
      }
      
      if (state.editor && !state.splitView.enabled) {
        state.editor.on("change", handleMarkdownChange);
      }
    }, 100);

  } else {
    // Disable side-by-side preview if it's currently enabled and only showing the preview.
    // This restores the "simple view" when no other files are open in the secondary pane.
    if (state.splitView.enabled) {
      const secondaryTabs = state.splitView.secondaryTabs || [];
      const activeIdx = state.openTabs.indexOf(state.activeTab);
      
      // If secondary pane is empty or only contains the same tab as the active one,
      // we close the split view to return to a single-pane layout.
      if (secondaryTabs.length === 0 || (secondaryTabs.length === 1 && secondaryTabs[0] === activeIdx)) {
        eventBus.emit("ui:toggle-split-view");
      }
    }
    
    // Reset state AFTER potentially disabling split view so disableSplitView knows we were in preview
    state.markdownPreviewActive = false;
    if (elements.btnMarkdownPreview) {
      elements.btnMarkdownPreview.classList.remove("active");
    }
    saveSettings();
    
    cleanupMarkdownPreview(true);
    
    // Ensure the editor for the active tab is shown again
    if (state.editor) {
      state.editor.getWrapperElement().style.display = "block";
      state.editor.refresh();
      state.editor.focus();
    }
  }
}
