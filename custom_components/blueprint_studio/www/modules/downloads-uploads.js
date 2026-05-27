import { t } from './translations.js';
/** DOWNLOADS-UPLOADS.JS | Purpose: File transfers - download files/folders, upload files via drag-drop */
import { state, elements } from './state.js';
import { fetchWithAuth, downloadFileUrl, downloadFolderUrl, getAuthToken } from './api.js';
import { eventBus } from './event-bus.js';
import { API_BASE, UPLOAD_BASE } from './constants.js';
import { 
  showToast, 
  showGlobalLoading, 
  hideGlobalLoading, 
  showConfirmDialog,
  showModal
} from './ui.js';
import { isTextFile, formatBytes } from './utils.js';
import {
  isSftpPath,
  parseSftpPath,
  uploadSftpFile,
  uploadSftpFolder,
  refreshSftp,
  sftpStreamUrl,
  getSftpConnectionDetails
} from './sftp.js';

/**
 * Downloads the currently active file via streaming URL
 */
export async function downloadCurrentFile() {
  if (!state.activeTab) {
    showToast(t("toast.no_file_open"), "warning");
    return;
  }
  await downloadFileByPath(state.activeTab.path);
}

/**
 * Downloads a file by its path using streaming URL (local or SFTP)
 */
export async function downloadFileByPath(path) {
  const filename = path.split("/").pop();
  try {
    let url;
    if (isSftpPath(path)) {
      // SFTP: direct stream URL avoids buffering the whole file in browser memory.
      const { connId, remotePath } = parseSftpPath(path);
      url = await sftpStreamUrl(connId, remotePath);
    } else {
      // Local: use authenticated serve_file URL
      url = await downloadFileUrl(path);
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Downloaded ${filename}`, "success");
  } catch (error) {
    showToast(`Failed to download ${filename}: ${error.message}`, "error");
  }
}

/**
 * Generic download handler
 */
export function downloadContent(filename, content, is_base64 = false, mimeType = "application/octet-stream") {
  try {
    let blobContent;
    let blobType = mimeType;

    if (is_base64) {
      const binaryString = atob(content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      blobContent = [bytes];
    } else {
      blobContent = [content];
      if (!blobType || blobType === "application/octet-stream") {
        blobType = "text/plain;charset=utf-8";
      }
    }

    const blob = new Blob(blobContent, { type: blobType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${filename}`, "success");
  } catch (error) {
    showToast(`Failed to download ${filename}: ${error.message}`, "error");
  }
}

/**
 * Downloads a folder as a ZIP file via streaming URL
 */
export async function downloadFolder(path) {
  try {
    const url = await downloadFolderUrl(path);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${path.split('/').filter(Boolean).pop() || "download"}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (error) {
    showToast(t("toast.download_items_fail", { error: error.message }), "error");
  }
}

/**
 * Downloads selected items (bulk download) — streams ZIP directly
 */
export async function downloadSelectedItems() {
  if (state.selectedItems.size === 0) return;
  const paths = Array.from(state.selectedItems);

  try {
    showGlobalLoading("Preparing bulk download...");

    // We need a raw fetch (not fetchWithAuth) because the response is binary, not JSON
    let token = null;
    try {
      if (window.parent && window.parent.hassConnection) {
        const conn = await window.parent.hassConnection;
        if (conn && conn.auth) {
          if (conn.auth.expired) await conn.auth.refreshAccessToken();
          token = conn.auth.accessToken;
        }
      }
    } catch (e) {}
    if (!token && window.pwaAuth && window.pwaAuth.isAuthenticated()) {
      token = await window.pwaAuth.getToken();
    }

    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(API_BASE, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ action: "download_multi", paths }),
    });

    hideGlobalLoading();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "download.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    eventBus.emit("ui:toggle-selection");
  } catch (error) {
    hideGlobalLoading();
    showToast(t("toast.delete_items_failed", { error: error.message }), "error");
  }
}

/**
 * Triggers the file upload input click
 */
export function triggerUpload() {
  if (elements.fileUploadInput) {
    elements.fileUploadInput.click();
  }
}

/**
 * Prompts user when a folder already exists during upload
 * @returns {Promise<string|null>} 'merge', 'replace', or null (cancel)
 */
async function promptFolderConflict(folderName) {
    const html = `
        <div style="margin-bottom: 16px; line-height: 1.5;">
            ${t("modal.folder_exists_message", { name: folderName })}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <button id="btn-folder-merge" class="modal-btn primary" style="width: 100%;">${t("modal.merge")}</button>
            <button id="btn-folder-replace" class="modal-btn danger" style="width: 100%;">${t("modal.replace")}</button>
        </div>
    `;

    return new Promise((resolve) => {
        const modalPromise = showModal({
            title: t("modal.folder_exists_title"),
            message: html,
            confirmText: null, // We use custom buttons
            cancelText: t("modal.cancel_button")
        });

        // Add listeners to custom buttons
        const checkButtons = setInterval(() => {
            const btnMerge = document.getElementById('btn-folder-merge');
            const btnReplace = document.getElementById('btn-folder-replace');
            const overlay = document.getElementById('modal-overlay');
            const closeBtn = document.getElementById('modal-close');
            const cancelBtn = document.getElementById('modal-cancel');

            if (btnMerge && btnReplace) {
                clearInterval(checkButtons);
                
                btnMerge.onclick = () => {
                    eventBus.emit('ui:hide-modal');
                    resolve('merge');
                };
                
                btnReplace.onclick = () => {
                    eventBus.emit('ui:hide-modal');
                    resolve('replace');
                };

                // If user clicks cancel or close, resolve with null
                if (closeBtn) closeBtn.addEventListener('click', () => resolve(null));
                if (cancelBtn) cancelBtn.addEventListener('click', () => resolve(null));
                if (overlay) overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) resolve(null);
                });
            }
        }, 50);

        modalPromise.then(res => {
            if (res === null) resolve(null);
        });
    });
}

function buildUploadedFolderPath(basePath, folderName) {
  const cleanFolderName = folderName.replace(/^\/+|\/+$/g, "");
  const rawBasePath = basePath || "";

  if (!rawBasePath) return cleanFolderName;
  if (rawBasePath === "/") return `/${cleanFolderName}`;

  const cleanBasePath = rawBasePath.replace(/\/+$/g, "");
  return `${cleanBasePath}/${cleanFolderName}`;
}

/**
 * Processes file uploads
 */
export async function processUploads(files, targetFolder = null) {
  if (!files || files.length === 0) return;

  const isSftp = targetFolder && isSftpPath(targetFolder);
  let connId = null;
  let remoteBaseDir = null;
  
  if (isSftp) {
    const parsed = parseSftpPath(targetFolder);
    connId = parsed.connId;
    remoteBaseDir = parsed.remotePath;
  }

  let basePath = targetFolder;
  if (basePath === null) {
    basePath = state.lazyLoadingEnabled ? (state.currentNavigationPath || "") : (state.currentFolderPath || "");
  }
  
  let processedCount = 0;
  let successCount = 0;
  const totalFiles = files.length;

  showGlobalLoading(`Uploading ${totalFiles} file(s)...`);

  for (const file of files) {
    processedCount++;
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip');
      const isBinaryFile = !isTextFile(file.name);

      // ZIP extraction logic (Local and SFTP)
      if (isZip) {
        const unzip = await showConfirmDialog({
          title: t("modal.unzip_title"),
          message: t("modal.unzip_message", { name: file.name }),
          confirmText: t("modal.unzip_button"),
          cancelText: t("modal.upload_only"),
          isDanger: false
        });

        if (unzip) {
          const base64Data = await readFileAsBase64(file);
          const targetDir = isSftp ? remoteBaseDir : basePath;
          const folderName = file.name.replace(/\.zip$/i, '');
          const targetPath = buildUploadedFolderPath(targetDir, folderName);

          if (isSftp) {
            // Try without overwrite first
            let result = await uploadSftpFolder(connId, targetPath, base64Data, "merge", false);
            
            if (result && result.status === 409) {
                const mode = await promptFolderConflict(result.folder_name || folderName);
                if (mode) {
                    result = await uploadSftpFolder(connId, targetPath, base64Data, mode, true);
                } else {
                    continue;
                }
            }

            if (result && result.success) {
              successCount++;
              await refreshSftp();
              continue;
            } else {
              showToast(`Failed to unzip on remote: ${result?.message || 'Unknown error'}`, "error");
            }
          } else {
            // Local folder upload
            let data = await fetchWithAuth(API_BASE, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "upload_folder",
                path: targetPath,
                zip_data: base64Data,
                mode: "merge",
                overwrite: false
              }),
            });

            if (data && data.status === 409) {
                const mode = await promptFolderConflict(data.folder_name || folderName);
                if (mode) {
                    data = await fetchWithAuth(API_BASE, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "upload_folder",
                          path: targetPath,
                          zip_data: base64Data,
                          mode: mode,
                          overwrite: true
                        }),
                    });
                } else {
                    continue;
                }
            }

            if (data && data.success) {
              successCount++;
              eventBus.emit("ui:reload-files", { force: true });
              continue;
            }
          }
        }
      }

      let content;
      if (isBinaryFile) {
        // Binary files: use multipart upload (no base64, bypasses 16MB limit)
        if (isSftp) {
          const remotePath = remoteBaseDir === '/' ? `/${file.name}` : `${remoteBaseDir}/${file.name}`;
          const connDetails = getSftpConnectionDetails(connId);
          if (!connDetails) {
            showToast(`Failed to upload ${file.name}: SFTP connection not found`, "error");
            continue;
          }
          let res = await uploadFileMultipartSftp(connDetails, remotePath, file, false);

          if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
              title: t("modal.file_exists_title"),
              message: t("modal.file_exists_message", { name: file.name }),
              confirmText: t("modal.overwrite"),
              cancelText: t("modal.cancel_button"),
              isDanger: true
            });
            if (confirm) {
              res = await uploadFileMultipartSftp(connDetails, remotePath, file, true);
            } else {
              continue;
            }
          }

          if (res && res.success) {
            successCount++;
          } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
          }
        } else {
          const filePath = basePath ? `${basePath}/${file.name}` : file.name;
          let res = await uploadFileMultipart(filePath, file, false);

          if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
              title: t("modal.file_exists_title"),
              message: t("modal.file_exists_message", { name: file.name }),
              confirmText: t("modal.overwrite"),
              cancelText: t("modal.cancel_button"),
              isDanger: true
            });
            if (confirm) {
              res = await uploadFileMultipart(filePath, file, true);
            } else {
              continue;
            }
          }

          if (res && res.success) {
            successCount++;
          } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
          }
        }
        continue;
      }

      // Text files: use JSON upload (small, no need for multipart)
      content = await readFileAsText(file);

      if (isSftp) {
        const remotePath = remoteBaseDir === '/' ? `/${file.name}` : `${remoteBaseDir}/${file.name}`;
        
        // Try without overwrite first
        let res = await uploadSftpFile(connId, remotePath, content, false, isBinaryFile);
        
        // If file exists, prompt for overwrite
        if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
                title: t("modal.file_exists_title"),
                message: t("modal.file_exists_message", { name: file.name }),
                confirmText: t("modal.overwrite"),
                cancelText: t("modal.cancel_button"),
                isDanger: true
            });
            if (confirm) {
                res = await uploadSftpFile(connId, remotePath, content, true, isBinaryFile);
            } else {
                continue; // Skip this file
            }
        }
        
        if (res && res.success) {
            successCount++;
        } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
        }
      } else {
        const filePath = basePath ? `${basePath}/${file.name}` : file.name;
        
        // Try without overwrite first
        let res = await uploadFile(filePath, content, false, isBinaryFile);
        
        // If file exists, prompt for overwrite
        if (res && res.status === 409) {
            const confirm = await showConfirmDialog({
                title: t("modal.file_exists_title"),
                message: t("modal.file_exists_message", { name: file.name }),
                confirmText: t("modal.overwrite"),
                cancelText: t("modal.cancel_button"),
                isDanger: true
            });
            if (confirm) {
                res = await uploadFile(filePath, content, true, isBinaryFile);
            } else {
                continue; // Skip this file
            }
        }
        
        if (res && res.success) {
            successCount++;
        } else {
            showToast(`Failed to upload ${file.name}: ${res?.message || 'Unknown error'}`, "error");
        }
      }
    } catch (error) {
      showToast(`Failed to upload ${file.name}: ${error.message}`, "error");
    }
  }

  hideGlobalLoading();
  if (successCount > 0) {
    showToast(t("toast.upload_success"), "success");
    if (isSftp) await refreshSftp();
    else eventBus.emit("ui:reload-files", { force: true });
  }
}

/**
 * Triggers the folder upload input click
 */
export function triggerFolderUpload() {
  if (elements.folderUploadInput) {
    elements.folderUploadInput.click();
  }
}

/**
 * Handles folder upload (ZIP method) — supports both local and SFTP targets
 */
export async function handleFolderUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.zip')) {
    showToast(t("toast.select_zip"), "warning");
    event.target.value = "";
    return;
  }

  try {
    showGlobalLoading(t("modal.confirm") + "...");
    const base64Data = await readFileAsBase64(file);

    let targetPath = state._nextFolderUploadTarget;
    state._nextFolderUploadTarget = null;
    if (targetPath === null) {
      targetPath = state.lazyLoadingEnabled ? (state.currentNavigationPath || "") : (state.currentFolderPath || "");
    }

    if (isSftpPath(targetPath)) {
      // SFTP folder upload
      const { connId, remotePath } = parseSftpPath(targetPath);
      const folderName = file.name.replace(/\.zip$/i, '');
      const remoteFolderPath = buildUploadedFolderPath(remotePath, folderName);

      let result = await uploadSftpFolder(connId, remoteFolderPath, base64Data, "merge", false);

      if (result && result.status === 409) {
        const mode = await promptFolderConflict(result.folder_name || folderName);
        if (mode) {
          result = await uploadSftpFolder(connId, remoteFolderPath, base64Data, mode, true);
        } else {
          hideGlobalLoading();
          event.target.value = "";
          return;
        }
      }

      hideGlobalLoading();
      if (result && result.success) {
        showToast(t("toast.upload_success"), "success");
        await refreshSftp();
      } else {
        showToast(t("toast.upload_folder_fail", { error: result?.message || "Unknown error" }), "error");
      }
    } else {
      // Local folder upload
      const folderName = file.name.replace(/\.zip$/i, '');
      const localFolderPath = buildUploadedFolderPath(targetPath, folderName);
      let data = await fetchWithAuth(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upload_folder",
          path: localFolderPath,
          zip_data: base64Data,
          mode: "merge",
          overwrite: false
        }),
      });

      if (data && data.status === 409) {
        const mode = await promptFolderConflict(data.folder_name || folderName);
        if (mode) {
          data = await fetchWithAuth(API_BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upload_folder",
              path: localFolderPath,
              zip_data: base64Data,
              mode,
              overwrite: true
            }),
          });
        } else {
          hideGlobalLoading();
          event.target.value = "";
          return;
        }
      }

      hideGlobalLoading();
      if (data.success) {
        showToast(t("toast.upload_success"), "success");
        eventBus.emit("ui:reload-files", { force: true });
      } else {
        showToast(t("toast.upload_folder_fail", { error: data.message || "Unknown error" }), "error");
      }
    }
  } catch (error) {
    hideGlobalLoading();
    showToast(t("toast.upload_folder_fail", { error: error.message }), "error");
  } finally {
    event.target.value = "";
  }
}

/** Utility to read file as text */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/** Utility to read file as base64 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Basic single file upload (JSON body — for text files) */
export async function uploadFile(path, content, overwrite = false, is_base64 = false) {
  return fetchWithAuth(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "upload_file", path, content, overwrite, is_base64 }),
  });
}

/**
 * Multipart file upload — streams raw binary to /api/blueprint_studio/upload.
 * Bypasses HA's 16MB JSON body limit. Used for binary files (images, video, etc.).
 */
export async function uploadFileMultipart(path, file, overwrite = false) {
  const formData = new FormData();
  formData.append("path", path);
  formData.append("overwrite", overwrite ? "true" : "false");
  formData.append("file", file);

  const token = await getAuthToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(UPLOAD_BASE, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: formData,
  });

  return await response.json();
}

/**
 * Multipart SFTP upload — sends raw binary + connection details to /api/blueprint_studio/upload.
 * Bypasses HA's 16MB JSON body limit for SFTP binary uploads.
 */
export async function uploadFileMultipartSftp(conn, remotePath, file, overwrite = false) {
  const formData = new FormData();
  formData.append("path", remotePath);
  formData.append("overwrite", overwrite ? "true" : "false");
  formData.append("connection", JSON.stringify({
    host: conn.host,
    port: conn.port || 22,
    username: conn.username,
    auth: conn.auth,
  }));
  formData.append("file", file);

  const token = await getAuthToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(UPLOAD_BASE, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: formData,
  });

  return await response.json();
}

/** Handles file input change */
export async function handleFileUpload(event) {
  const files = event.target.files;
  const target = state._nextUploadTarget;
  state._nextUploadTarget = null;
  await processUploads(files, target);
  event.target.value = "";
}
