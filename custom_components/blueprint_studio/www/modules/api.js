/** API.JS | Purpose: * Provides the core API communication layer for Blueprint Studio. Handles */
import { state, elements, gitState, giteaState } from './state.js';
import { API_BASE, STREAM_BASE } from './constants.js';
import { eventBus } from './event-bus.js';
import { t } from './translations.js';
import { 
  showToast, 
  showGlobalLoading, 
  hideGlobalLoading, 
  showConfirmDialog 
} from './ui.js';
import { saveSettings } from './settings.js';

// Import PWA auth - will be available after main.js loads it
let pwaAuth = null;
if (window.pwaAuth) {
  pwaAuth = window.pwaAuth;
} else {
  // Wait for pwaAuth to be available
  setTimeout(() => {
    pwaAuth = window.pwaAuth;
  }, 100);
}

export async function fetchWithAuth(url, options = {}) {
  let headers = { ...options.headers };
  let token = null;
  let isHassEnvironment = false;

  // Try Home Assistant auth first (when in iframe)
  try {
    if (window.parent && window.parent.hassConnection) {
      isHassEnvironment = true;
      const conn = await window.parent.hassConnection;
      if (conn && conn.auth) {
          if (conn.auth.expired) {
              await conn.auth.refreshAccessToken();
          }
          token = conn.auth.accessToken;
      }
    }
  } catch (e) {
    console.error("❌ Auth Error:", e);
    if (isHassEnvironment) {
        console.warn("HA auth failed, trying PWA auth...");
    }
  }

  // Fallback to PWA auth if HA auth not available
  if (!token && window.pwaAuth && window.pwaAuth.isAuthenticated()) {
    const pwaToken = await window.pwaAuth.getToken();
    if (pwaToken) {
      token = pwaToken;
    }
  }

  if (token) {
      headers["Authorization"] = `Bearer ${token}`;
  }

  let response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  // Try to refresh token on 401
  if (response.status === 401) {
      try {
          // Try HA token refresh first
          if (window.parent && window.parent.hassConnection) {
              const conn = await window.parent.hassConnection;
              if (conn && conn.auth) {
                  await conn.auth.refreshAccessToken();
                  token = conn.auth.accessToken;
                  if (token) {
                      headers["Authorization"] = `Bearer ${token}`;
                      response = await fetch(url, {
                          ...options,
                          headers,
                          credentials: "same-origin",
                      });
                  }
              }
          }

          // If still 401 and we have PWA auth, try refreshing the token
          if (response.status === 401 && window.pwaAuth && window.pwaAuth.isStandalone()) {
            const newToken = await window.pwaAuth.refreshAccessToken();
            if (newToken) {
              headers["Authorization"] = `Bearer ${newToken}`;
              response = await fetch(url, {
                ...options,
                headers,
                credentials: "same-origin",
              });
            }
            // If still 401 after refresh, session is gone
            if (response.status === 401) {
              window.pwaAuth._clearTokens();
              throw new Error("Session expired. Please login again.");
            }
          }
      } catch (e) {
          console.error("❌ Failed to refresh token:", e);
          throw e;
      }
  }

  if (!response.ok) {
    if (response.status === 409) {
        try {
            const result = await response.json();
            return { ...result, status: 409 };
        } catch (e) {
            return { success: false, message: "Conflict", status: 409 };
        }
    }

    let errorMessage = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.message || errorMessage;
    } catch (e) {}
    throw new Error(errorMessage);
  }

  const result = await response.json();
  if (Array.isArray(result)) return result;
  return { ...result, status: response.status };
}

/**
 * Gets authentication token for direct WebSocket or API usage
 */
export async function getAuthToken() {
    try {
      if (window.parent) {
        let auth = null;
        if (window.parent.hassConnection) {
            const result = await window.parent.hassConnection;
            auth = result.auth || (result.accessToken ? result : null);
        } else if (window.parent.hass && window.parent.hass.auth) {
            auth = window.parent.hass.auth;
        }
        
        if (auth) {
            if (auth.expired) {
                await auth.refreshAccessToken();
            }
            return auth.accessToken;
        }
      }
      
      // Fallback to PWA token
      if (window.pwaAuth && window.pwaAuth.isAuthenticated()) {
          return await window.pwaAuth.getToken();
      }
    } catch (e) {
      console.error("Failed to get auth token", e);
    }
    return null;
}

// Module-level state to avoid duplicate ready listeners across retries
let _wsConn = null;
let _wsUnsubscribe = null;

async function _subscribeToUpdates(conn, retries = 0) {
  // Clean up any previous subscription before re-subscribing
  if (_wsUnsubscribe) {
    try { _wsUnsubscribe(); } catch (e) {}
    _wsUnsubscribe = null;
  }

  try {
    _wsUnsubscribe = await conn.subscribeMessage(
      (event) => {
        if (state._wsUpdateTimer) clearTimeout(state._wsUpdateTimer);
        state._wsUpdateTimer = setTimeout(() => {
          eventBus.emit('file:check-updates');
          eventBus.emit('git:status-check', { fetch: false, silent: true });

          if (event && ["create", "delete", "rename", "create_folder", "upload", "upload_folder", "external_change"].includes(event.action)) {
            eventBus.emit('ui:reload-files', { force: event.action === "external_change" });
          }
        }, 500);
      },
      { type: "blueprint_studio/subscribe_updates" }
    );
  } catch (subError) {
    // Integration may still be loading — retry a few times
    if (subError.code === 'unknown_command' && retries < 5) {
      console.warn(`Blueprint Studio: Backend not ready yet (retry ${retries + 1}/5)...`);
      setTimeout(() => _subscribeToUpdates(conn, retries + 1), 2000);
      return;
    }
    throw subError;
  }
}

/**
 * Initialize WebSocket subscription for real-time updates.
 * Re-subscribes automatically whenever the HA connection reconnects.
 */
export async function initWebSocketSubscription() {
  try {
    if (window.parent && window.parent.hassConnection) {
      const result = await window.parent.hassConnection;
      const conn = result.conn || (typeof result.subscribeMessage === 'function' ? result : null);

      if (!conn || typeof conn.subscribeMessage !== 'function') {
        throw new Error("WebSocket connection not found");
      }

      // Register the ready listener only once per connection object.
      // On reconnect HA fires "ready" — we clean up the dead subscription
      // and create a fresh one so updates resume without a page reload.
      if (_wsConn !== conn) {
        _wsConn = conn;
        conn.addEventListener("ready", () => _subscribeToUpdates(conn));
      }

      await _subscribeToUpdates(conn);
    } else {
      eventBus.emit('polling:start');
    }
  } catch (e) {
    console.error("Blueprint Studio: WebSocket subscription failed", e);
    eventBus.emit('polling:start');
  }
}

/**
 * Builds a serve_file URL for streaming media/downloads.
 * @param {string} path - Relative file path
 * @returns {string} URL string (without auth token)
 */
export function serveFileUrl(path) {
  return `${STREAM_BASE}?action=serve_file&path=${encodeURIComponent(path)}&_t=${Date.now()}`;
}

/**
 * Appends the HA access token as a query parameter to a URL.
 * Used for <video src>, <audio src>, and direct download links
 * where Authorization headers cannot be sent.
 * @param {string} url - The URL to authenticate
 * @returns {Promise<string>} URL with token appended
 */
export async function urlWithToken(url) {
  const token = await getAuthToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}authorization=${encodeURIComponent(token)}`;
}

/**
 * Builds an authenticated serve_file download URL with Content-Disposition: attachment.
 * @param {string} path - Relative file path
 * @returns {Promise<string>} Authenticated URL for download
 */
export async function downloadFileUrl(path) {
  return await urlWithToken(serveFileUrl(path));
}

/**
 * Builds an authenticated download_folder URL for streaming ZIP downloads.
 * @param {string} path - Relative folder path
 * @returns {Promise<string>} Authenticated URL for folder ZIP download
 */
export async function downloadFolderUrl(path) {
  return await urlWithToken(`${STREAM_BASE}?action=download_folder&path=${encodeURIComponent(path)}&_t=${Date.now()}`);
}

/**
 * RESTARTS HOME ASSISTANT
 */
export async function restartHomeAssistant() {
    const confirmed = await showConfirmDialog({
        title: t("modal.restart_ha_title"),
        message: t("modal.restart_ha_message"),
        confirmText: t("modal.restart_ha_confirm"),
        cancelText: t("modal.cancel"),
        isDanger: true
    });

    if (confirmed) {
        // Save current state before restart
        await saveSettings();

        try {
            const data = await fetchWithAuth(API_BASE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "restart_home_assistant" }),
            });
            if (data.success) {
                showGlobalLoading("Restarting Home Assistant...");

                // Function to check if HA is back online
                const checkOnline = async () => {
                    try {
                        const data = await fetchWithAuth(`${API_BASE}?action=get_version`);
                        if (data) {
                            setTimeout(() => {
                                window.location.reload();
                            }, 2000);
                            return;
                        }
                    } catch (e) {}
                    setTimeout(checkOnline, 2000);
                };
                
                setTimeout(checkOnline, 5000);
            } else {
                showToast(t("toast.restart_ha_fail", { error: data.error || "Unknown error" }), "error");
            }
        } catch (error) {
            showToast(t("toast.restart_ha_error"), "error");
            console.error(error);
        }
    }
}
