"""The Blueprint Studio integration."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from homeassistant.components import frontend
try:
    from homeassistant.components.http import StaticPathConfig
except ImportError:
    # Fallback for HA < 2024.7
    class StaticPathConfig:
        """Shim for StaticPathConfig for older HA versions."""
        def __init__(self, url_path: str, path: str, cache_headers: bool) -> None:
            self.url_path = url_path
            self.path = path
            self.cache_headers = cache_headers

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store

from .const import DOMAIN, NAME, VERSION
from .backend.api import BlueprintStudioApiView, BlueprintStudioStreamView, BlueprintStudioUploadView
from .backend.api_terminal import TerminalWebSocketView
from .backend.websocket import async_register_websockets

# Import for service worker view
from aiohttp import web
from homeassistant.components.http import HomeAssistantView

_LOGGER = logging.getLogger(__name__)

# Storage version for credentials
STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.credentials"


def _read_and_replace(file_path: str) -> str:
    """Read file and replace version placeholder (runs in executor)."""
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    return content.replace("{{VERSION}}", VERSION)


async def _serve_file_with_headers(file_path: str, content_type: str, extra_headers: dict | None = None) -> web.Response:
    """Consolidated async file serving helper."""
    try:
        loop = asyncio.get_running_loop()
        content = await loop.run_in_executor(None, _read_and_replace, file_path)
        headers = extra_headers or {}
        return web.Response(text=content, content_type=content_type, headers=headers)
    except FileNotFoundError:
        _LOGGER.error("File not found: %s", file_path)
        return web.Response(status=404, text=f"{content_type} file not found")
    except Exception as err:
        _LOGGER.error("Error serving file: %s", err)
        return web.Response(status=500, text="Internal server error")


class ServiceWorkerView(HomeAssistantView):
    """Custom view to serve service worker with proper headers for PWA."""

    url = "/blueprint_studio/service-worker.js"
    name = "blueprint_studio:service_worker"
    requires_auth = False

    def __init__(self, file_path: str) -> None:
        """Initialize the view."""
        self.file_path = file_path

    async def get(self, request: web.Request) -> web.Response:
        """Serve service worker file with PWA-compatible headers."""
        return await _serve_file_with_headers(self.file_path, "application/javascript", {
            "Service-Worker-Allowed": "/blueprint_studio/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        })


class BlueprintStudioPWAView(HomeAssistantView):
    """Serve Blueprint Studio as a standalone PWA (not in iframe)."""

    url = "/blueprint_studio/"
    name = "blueprint_studio:pwa"
    requires_auth = False

    def __init__(self, html_path: str) -> None:
        """Initialize the view."""
        self.html_path = html_path

    async def get(self, request: web.Request) -> web.Response:
        """Serve the Blueprint Studio HTML directly for PWA installation."""
        return await _serve_file_with_headers(self.html_path, "text/html", {"Cache-Control": "no-cache"})


class BlueprintStudioPanelView(HomeAssistantView):
    """Serve Blueprint Studio panel HTML with version injection."""

    url = "/blueprint_studio/panel"
    name = "blueprint_studio:panel"
    requires_auth = False

    def __init__(self, html_path: str) -> None:
        """Initialize the view."""
        self.html_path = html_path

    async def get(self, request: web.Request) -> web.Response:
        """Serve panel HTML with {{VERSION}} replaced."""
        return await _serve_file_with_headers(self.html_path, "text/html", {"Cache-Control": "no-cache"})


# This integration is configured via config entries (UI)
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Blueprint Studio component."""
    hass.data.setdefault(DOMAIN, {})
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Blueprint Studio from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {}

    # Initialize credential storage
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or {}

    # Migrate legacy credentials (flat structure -> nested)
    if "username" in data and "credentials" not in data:
        data = {
            "credentials": {
                "username": data.pop("username"),
                "token": data.pop("token", None)
            },
            "settings": data.get("settings", {})
        }

    config_dir = Path(hass.config.config_dir)
    api_view = BlueprintStudioApiView(config_dir, store, data)
    hass.http.register_view(api_view)

    # Register streaming view for serve_file/download_folder (requires_auth=False, validates token manually)
    stream_view = BlueprintStudioStreamView(api_view.file, api_view.sftp)
    hass.http.register_view(stream_view)

    # Register multipart upload view for large binary files (bypasses 16MB JSON body limit)
    upload_view = BlueprintStudioUploadView(api_view.file, api_view.sftp)
    hass.http.register_view(upload_view)

    # Register terminal WebSocket on its own URL (requires_auth=False, validates token manually)
    terminal_ws_view = TerminalWebSocketView()
    hass.http.register_view(terminal_ws_view)

    # Register custom service worker view with PWA headers
    sw_path = str(hass.config.path("custom_components", DOMAIN, "www", "service-worker.js"))
    sw_view = ServiceWorkerView(sw_path)
    hass.http.register_view(sw_view)

    # Register PWA view (standalone, not iframe) for installability
    html_path = str(hass.config.path("custom_components", DOMAIN, "www", "panels", "panel_custom.html"))
    pwa_view = BlueprintStudioPWAView(html_path)
    hass.http.register_view(pwa_view)

    # Register panel view with version injection (used by iframe)
    panel_view = BlueprintStudioPanelView(html_path)
    hass.http.register_view(panel_view)
    _LOGGER.info("Blueprint Studio: PWA views registered (standalone mode enabled)")

    # Subscribe file manager to HA folder-watcher events so the list_all
    # cache is invalidated immediately on any file change, not just on TTL.
    api_view.file.hass = hass
    api_view.file.subscribe_to_ha_events()

    # Defer git status check — don't block HA startup waiting for git subprocess
    async def _deferred_git_check():
        try:
            api_view.git.hass = hass
            await api_view.git.get_status()
        except Exception:
            pass  # Non-critical; the panel will fetch status on first open

    hass.async_create_task(_deferred_git_check())

    # Register WebSocket commands
    async_register_websockets(hass)

    # Register Static Paths with fallback for different HA versions
    url_path = f"/local/{DOMAIN}"
    path_on_disk = str(hass.config.path("custom_components", DOMAIN, "www"))
    
    if hasattr(hass.http, "async_register_static_paths"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(
                url_path=url_path,
                path=path_on_disk,
                cache_headers=False,
            )
        ])
    elif hasattr(hass.http, "register_static_path"):
        hass.http.register_static_path(url_path, path_on_disk, False)
    else:
        _LOGGER.error("Failed to register static path: No registration method found on hass.http")

    frontend.async_register_built_in_panel(
        hass,
        component_name="iframe",
        sidebar_title=NAME,
        sidebar_icon="mdi:file-document-edit",
        frontend_url_path=DOMAIN,
        config={"url": f"/{DOMAIN}/panel"},
        require_admin=True,
    )

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    frontend.async_remove_panel(hass, DOMAIN)
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
