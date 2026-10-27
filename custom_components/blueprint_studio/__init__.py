"""The Blueprint Studio integration."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, NAME, VERSION
from .backend.api import BlueprintStudioApiView, BlueprintStudioStreamView, BlueprintStudioUploadView
from .backend.api_terminal import TerminalWebSocketView
from .backend.runtime import BlueprintStudioRuntime
from .backend.storage import CURRENT_STORAGE_VERSION
from .backend.websocket import async_register_websockets

# Import for service worker view
from aiohttp import web
from homeassistant.components.http import HomeAssistantView

_LOGGER = logging.getLogger(__name__)

# Storage version for credentials
STORAGE_VERSION = CURRENT_STORAGE_VERSION
STORAGE_KEY = f"{DOMAIN}.credentials"
_REGISTRATION_KEY = "_global_registration"


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
        headers = {
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            **(extra_headers or {}),
        }
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
        return await _serve_file_with_headers(self.html_path, "text/html")


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
        return await _serve_file_with_headers(self.html_path, "text/html")


class BlueprintStudioAssetView(HomeAssistantView):
    """Serve PWA assets without browser or service-worker caching."""

    url = "/blueprint_studio/assets/{path:.*}"
    name = "blueprint_studio:assets"
    requires_auth = False

    def __init__(self, asset_root: str) -> None:
        """Initialize the asset view."""
        self.asset_root = Path(asset_root).resolve()

    async def get(self, request: web.Request, path: str) -> web.StreamResponse:
        """Serve an asset only when it remains inside the integration directory."""
        asset_path = (self.asset_root / path).resolve()
        if not asset_path.is_relative_to(self.asset_root) or not asset_path.is_file():
            raise web.HTTPNotFound()

        response = web.FileResponse(asset_path)
        response.headers.update(
            {
                "Cache-Control": "no-store, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        )
        return response


class BlueprintStudioGlobalRegistration:
    """Own process-lifetime routes and bind them to the active runtime."""

    def __init__(
        self,
        api: BlueprintStudioApiView,
        stream: BlueprintStudioStreamView,
        upload: BlueprintStudioUploadView,
        terminal: TerminalWebSocketView,
    ) -> None:
        self.api = api
        self.stream = stream
        self.upload = upload
        self.terminal = terminal
        self.active_runtime: BlueprintStudioRuntime | None = None
        self.panel_registered = False

    def activate(self, runtime: BlueprintStudioRuntime) -> None:
        """Route new requests to the current config-entry runtime."""
        self.api.activate(
            runtime.store,
            runtime.data,
            runtime.git,
            runtime.ai,
            runtime.file,
            runtime.sftp,
            runtime.terminal,
            runtime.operations,
            runtime.tickets,
            runtime.coordinator,
            runtime.metadata,
        )
        self.stream.activate(runtime.file, runtime.sftp, runtime.operations, runtime.tickets)
        self.upload.activate(runtime.file, runtime.sftp, runtime.operations)
        self.terminal.activate(runtime.terminal, runtime.tickets)
        self.active_runtime = runtime

    def deactivate(self, runtime: BlueprintStudioRuntime) -> None:
        """Stop accepting requests for an unloading runtime."""
        if self.active_runtime is not runtime:
            return
        self.api.deactivate()
        self.stream.deactivate()
        self.upload.deactivate()
        self.terminal.deactivate()
        self.active_runtime = None


async def _async_get_or_register_global_routes(
    hass: HomeAssistant,
    runtime: BlueprintStudioRuntime,
) -> BlueprintStudioGlobalRegistration:
    """Register permanent HA routes once, then reuse them across reloads."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    existing = domain_data.get(_REGISTRATION_KEY)
    if isinstance(existing, BlueprintStudioGlobalRegistration):
        existing.activate(runtime)
        return existing

    config_dir = Path(hass.config.config_dir)
    api_view = BlueprintStudioApiView(
        config_dir,
        runtime.store,
        runtime.data,
        git=runtime.git,
        ai=runtime.ai,
        file=runtime.file,
        sftp=runtime.sftp,
        terminal=runtime.terminal,
        operations=runtime.operations,
        tickets=runtime.tickets,
        metadata=runtime.metadata,
    )
    stream_view = BlueprintStudioStreamView(runtime.file, runtime.sftp, runtime.operations, runtime.tickets)
    upload_view = BlueprintStudioUploadView(runtime.file, runtime.sftp, runtime.operations)
    terminal_view = TerminalWebSocketView(runtime.terminal, runtime.tickets)

    for view in (api_view, stream_view, upload_view, terminal_view):
        hass.http.register_view(view)

    sw_path = str(hass.config.path("custom_components", DOMAIN, "www", "service-worker.js"))
    html_path = str(hass.config.path("custom_components", DOMAIN, "www", "panels", "panel_custom.html"))
    asset_root = str(hass.config.path("custom_components", DOMAIN, "www"))
    hass.http.register_view(ServiceWorkerView(sw_path))
    hass.http.register_view(BlueprintStudioPWAView(html_path))
    hass.http.register_view(BlueprintStudioPanelView(html_path))
    hass.http.register_view(BlueprintStudioAssetView(asset_root))

    async_register_websockets(hass)

    url_path = f"/local/{DOMAIN}"
    path_on_disk = str(hass.config.path("custom_components", DOMAIN, "www"))
    if hasattr(hass.http, "async_register_static_paths"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(url_path=url_path, path=path_on_disk, cache_headers=False)
        ])
    elif hasattr(hass.http, "register_static_path"):
        hass.http.register_static_path(url_path, path_on_disk, False)
    else:
        _LOGGER.error("Failed to register static path: No registration method found on hass.http")

    registration = BlueprintStudioGlobalRegistration(
        api_view, stream_view, upload_view, terminal_view
    )
    registration.activate(runtime)
    domain_data[_REGISTRATION_KEY] = registration
    _LOGGER.info("Blueprint Studio: global HTTP, WebSocket, and static routes registered")
    return registration


# This integration is configured via config entries (UI)
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Blueprint Studio component."""
    hass.data.setdefault(DOMAIN, {})
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Blueprint Studio from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    runtime = await BlueprintStudioRuntime.async_create(hass, STORAGE_KEY)
    entry.runtime_data = runtime
    hass.data[DOMAIN][entry.entry_id] = runtime

    registration = await _async_get_or_register_global_routes(hass, runtime)

    # Subscribe file manager to HA folder-watcher events so the list_all
    # cache is invalidated immediately on any file change, not just on TTL.
    if unsubscribe := runtime.file.subscribe_to_ha_events():
        runtime.add_unsubscriber(unsubscribe)

    # Defer git status check — don't block HA startup waiting for git subprocess
    async def _deferred_git_check():
        try:
            await runtime.git.get_status()
        except Exception:
            pass  # Non-critical; the panel will fetch status on first open

    runtime.create_task(_deferred_git_check())

    if not registration.panel_registered:
        frontend.async_register_built_in_panel(
            hass,
            component_name="iframe",
            sidebar_title=NAME,
            sidebar_icon="mdi:file-document-edit",
            frontend_url_path=DOMAIN,
            config={"url": f"/{DOMAIN}/panel"},
            require_admin=True,
        )
        registration.panel_registered = True

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    runtime = getattr(entry, "runtime_data", None) or hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if isinstance(runtime, BlueprintStudioRuntime):
        registration = hass.data.get(DOMAIN, {}).get(_REGISTRATION_KEY)
        if isinstance(registration, BlueprintStudioGlobalRegistration):
            registration.deactivate(runtime)
            if registration.panel_registered:
                frontend.async_remove_panel(hass, DOMAIN)
                registration.panel_registered = False
        await runtime.async_shutdown()
    if DOMAIN in hass.data:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
