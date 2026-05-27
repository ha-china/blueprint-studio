"""API for Blueprint Studio — thin orchestrator.

Delegates to domain-specific handler modules:
  api_files.py    — file operations
  api_git.py      — git / gitea / github
  api_terminal.py — terminal WebSocket + exec
  api_sftp.py     — SFTP dispatcher
  api_misc.py     — settings, AI, syntax checkers, utilities
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .util import json_response, json_message
from .git_manager import GitManager
from .ai_manager import AIManager
from .file_manager import FileManager
from .sftp_manager import SftpManager
from .terminal_manager import TerminalManager

from . import api_files
from . import api_git
from . import api_terminal
from . import api_sftp
from . import api_misc

_LOGGER = logging.getLogger(__name__)

# Blueprint Studio is registered as an admin-only panel and exposes config files,
# git operations, SFTP, terminal helpers, and HA service calls. Keep the backend
# at the same privilege level as the UI instead of trying to maintain a denylist.
_ADMIN_ONLY_ACTIONS = frozenset({
    "call_service",
    "delete",
    "delete_multi",
    "global_replace",
    "git_force_push",
    "git_hard_reset",
    "git_delete_repo",
    "git_delete_remote_branch",
    "render_template",
    "restart_home_assistant",
})


class BlueprintStudioApiView(HomeAssistantView):
    """View to handle API requests for Blueprint Studio."""

    url = "/api/blueprint_studio"
    name = "api:blueprint_studio"
    requires_auth = True

    def __init__(self, config_dir: Path, store: Store, data: dict) -> None:
        """Initialize the view."""
        self.config_dir = config_dir
        self.store = store
        self.data = data
        self.hass = None
        self.git = GitManager(None, config_dir, data, store)
        self.ai = AIManager(None, data)
        self.file = FileManager(None, config_dir)
        self.sftp = SftpManager(config_dir)
        self.terminal = None

    async def _authenticate(self, request):
        """Authenticate request. With requires_auth = True, HA middleware
        handles token validation and sets hass_user for valid requests."""
        user = request.get("hass_user")
        if not user:
            _LOGGER.warning("Blueprint Studio: No authenticated user on request")
        return user

    def _require_admin(self, user) -> web.Response | None:
        """Return a 403 response unless the authenticated user is an admin."""
        if not user.is_admin:
            _LOGGER.warning(
                "Blueprint Studio: non-admin user '%s' attempted API access",
                user.name,
            )
            return json_message("Admin privileges required", status_code=403)
        return None

    def _update_hass(self, hass: HomeAssistant) -> None:
        """Update hass instance in managers."""
        self.hass = hass
        self.git.hass = hass
        self.ai.hass = hass
        self.file.hass = hass
        if not self.terminal:
            self.terminal = TerminalManager(hass)
        else:
            self.terminal.hass = hass

    # ========== GET ==========

    async def get(self, request: web.Request) -> web.Response:
        """Handle GET requests."""
        params = request.query
        action = params.get("action")

        user = await self._authenticate(request)
        if not user:
            return web.Response(status=401, text="Unauthorized")
        if admin_error := self._require_admin(user):
            return admin_error

        if not action:
            return json_message("Missing action", status_code=400)

        hass = request.app["hass"]
        self._update_hass(hass)

        get_handlers = {
            "list_files": lambda r, u, p, h: api_files.list_files(self.file, p, h),
            "list_all": lambda r, u, p, h: api_files.list_all(self.file, p, h),
            "list_directory": lambda r, u, p, h: api_files.list_directory(self.file, p, h),
            "list_git_files": lambda r, u, p, h: api_files.list_git_files(self.file, h),
            "read_file": lambda r, u, p, h: api_files.read_file(self.file, p),
            "global_search": lambda r, u, p, h: api_files.global_search(self.file, p, h),
            "get_file_stat": lambda r, u, p, h: api_files.get_file_stat(self.file, p),
            "get_tree_snapshot": lambda r, u, p, h: api_files.get_tree_snapshot(self.file, p, h),
            "get_settings": lambda r, u, p, h: json_response(self.data.get("settings", {})),
            "get_version": lambda r, u, p, h: api_misc.get_version(h),
            "get_devices": lambda r, u, p, h: api_misc.get_devices(h),
            "get_areas":   lambda r, u, p, h: api_misc.get_areas(h),
            "get_labels":  lambda r, u, p, h: api_misc.get_labels(h),
            "get_floors":  lambda r, u, p, h: api_misc.get_floors(h),
            "get_themes":   lambda r, u, p, h: api_misc.get_themes(h),
            "get_addons":   lambda r, u, p, h: api_misc.get_addons(h),
            "get_services": lambda r, u, p, h: api_misc.get_services(h),
            "run_config_check": lambda r, u, p, h: api_misc.run_config_check(h),
            "list_hass_agents": lambda r, u, p, h: api_misc.list_hass_agents(h),
        }

        handler = get_handlers.get(action)
        if not handler:
            return json_message("Unknown action", status_code=400)

        try:
            result = handler(request, user, params, hass)
            if asyncio.iscoroutine(result):
                return await result
            return result
        except Exception as err:
            _LOGGER.error("GET action %s failed: %s", action, err, exc_info=True)
            return json_message("Action failed. See server logs for details.", status_code=500)

    # ========== POST ==========

    async def post(self, request: web.Request) -> web.Response:
        """Handle POST requests."""
        user = await self._authenticate(request)
        if not user:
            return web.Response(status=401, text="Unauthorized")
        if admin_error := self._require_admin(user):
            return admin_error

        try:
            body = await request.read()
            data = json.loads(body)
        except Exception as e:
            _LOGGER.error("Blueprint Studio: Failed to parse POST JSON: %s", e)
            return json_message(f"Invalid JSON: {str(e)}", status_code=400)

        action = data.get("action")
        _LOGGER.debug("Blueprint Studio: POST action: %s", action)

        if not action:
            return json_message("Missing action", status_code=400)

        hass = request.app["hass"]
        self._update_hass(hass)

        # SFTP actions — handled by dedicated dispatcher
        if action in api_sftp.SFTP_ACTIONS:
            return await api_sftp.sftp_action(self.sftp, action, data, hass, request)

        post_handlers = {
            # Settings
            "save_settings": lambda d, h, u: api_misc.save_settings(d, self.store, h, self.data),
            # Files
            "write_file": lambda d, h, u: api_files.write_file(self.file, d, h),
            "create_file": lambda d, h, u: api_files.create_file(self.file, d),
            "create_folder": lambda d, h, u: api_files.create_folder(self.file, d),
            "delete": lambda d, h, u: api_files.delete(self.file, d),
            "copy": lambda d, h, u: api_files.copy(self.file, d),
            "rename": lambda d, h, u: api_files.rename(self.file, d),
            "upload_file": lambda d, h, u: api_files.upload_file(self.file, d),
            "upload_folder": lambda d, h, u: api_files.upload_folder(self.file, d),
            "download_multi": lambda d, h, u: api_files.download_multi(self.file, d, request),
            "delete_multi": lambda d, h, u: api_files.delete_multi(self.file, d),
            "move_multi": lambda d, h, u: api_files.move_multi(self.file, d),
            "global_search": lambda d, h, u: api_files.post_global_search(self.file, d, h),
            "global_replace": lambda d, h, u: api_files.global_replace(self.file, d, h),
            # Syntax checkers
            "check_yaml": lambda d, h, u: api_misc.check_yaml(self.ai, d, h),
            "check_jinja": lambda d, h, u: api_misc.check_jinja(self.ai, d, h),
            "check_json": lambda d, h, u: api_misc.check_json(self.ai, d, h),
            "check_python": lambda d, h, u: api_misc.check_python(self.ai, d, h),
            "check_javascript": lambda d, h, u: api_misc.check_javascript(self.ai, d, h),
            "check_syntax": lambda d, h, u: api_misc.check_syntax(self.ai, d, h),
            # Terminal
            "terminal_exec": lambda d, h, u: api_terminal.terminal_exec(self.terminal, d, u),
            # Git
            "git_status": lambda d, h, u: api_git.git_status(self.git, d),
            "git_log": lambda d, h, u: api_git.git_log(self.git, d),
            "git_diff_commit": lambda d, h, u: api_git.git_diff_commit(self.git, d),
            "git_pull": lambda d, h, u: api_git.git_pull(self.git, self.file),
            "git_push": lambda d, h, u: api_git.git_push(self.git, d),
            "git_push_only": lambda d, h, u: api_git.git_push_only(self.git),
            "git_commit": lambda d, h, u: api_git.git_commit(self.git, d),
            "git_show": lambda d, h, u: api_git.git_show(self.git, d),
            "git_init": lambda d, h, u: api_git.git_init(self.git, self.file),
            "git_add_remote": lambda d, h, u: api_git.git_add_remote(self.git, d),
            "git_remove_remote": lambda d, h, u: api_git.git_remove_remote(self.git, d),
            "git_delete_repo": lambda d, h, u: api_git.git_delete_repo(self.git),
            "git_repair_index": lambda d, h, u: api_git.git_repair_index(self.git),
            "git_rename_branch": lambda d, h, u: api_git.git_rename_branch(self.git, d),
            "git_merge_unrelated": lambda d, h, u: api_git.git_merge_unrelated(self.git, d),
            "git_force_push": lambda d, h, u: api_git.git_force_push(self.git, d),
            "git_hard_reset": lambda d, h, u: api_git.git_hard_reset(self.git, self.file, d),
            "git_delete_remote_branch": lambda d, h, u: api_git.git_delete_remote_branch(self.git, d),
            "git_checkout_branch": lambda d, h, u: api_git.git_checkout_branch(self.git, d),
            "git_create_branch": lambda d, h, u: api_git.git_create_branch(self.git, d),
            "git_delete_local_branch": lambda d, h, u: api_git.git_delete_local_branch(self.git, d),
            "git_merge_branch": lambda d, h, u: api_git.git_merge_branch(self.git, d),
            "git_get_conflict_files": lambda d, h, u: api_git.git_get_conflict_files(self.git),
            "git_resolve_conflict": lambda d, h, u: api_git.git_resolve_conflict(self.git, d),
            "git_abort": lambda d, h, u: api_git.git_abort(self.git),
            "git_stage": lambda d, h, u: api_git.git_stage(self.git, d),
            "git_unstage": lambda d, h, u: api_git.git_unstage(self.git, d),
            "git_reset": lambda d, h, u: api_git.git_reset(self.git, d),
            "git_clean_locks": lambda d, h, u: api_git.git_clean_locks(self.git),
            "git_stop_tracking": lambda d, h, u: api_git.git_stop_tracking(self.git, d),
            "git_get_remotes": lambda d, h, u: api_git.git_get_remotes(self.git),
            "git_get_credentials": lambda d, h, u: api_git.git_get_credentials(self.git),
            "git_set_credentials": lambda d, h, u: api_git.git_set_credentials(self.git, d),
            "git_clear_credentials": lambda d, h, u: api_git.git_clear_credentials(self.git),
            "git_test_connection": lambda d, h, u: api_git.git_test_connection(self.git),
            # Gitea
            "gitea_status": lambda d, h, u: api_git.gitea_status(self.git, d),
            "gitea_pull": lambda d, h, u: api_git.gitea_pull(self.git),
            "gitea_push": lambda d, h, u: api_git.gitea_push(self.git, d),
            "gitea_push_only": lambda d, h, u: api_git.gitea_push_only(self.git),
            "gitea_get_credentials": lambda d, h, u: api_git.gitea_get_credentials(self.git),
            "gitea_set_credentials": lambda d, h, u: api_git.gitea_set_credentials(self.git, d),
            "gitea_clear_credentials": lambda d, h, u: api_git.gitea_clear_credentials(self.git),
            "gitea_test_connection": lambda d, h, u: api_git.gitea_test_connection(self.git),
            "gitea_add_remote": lambda d, h, u: api_git.gitea_add_remote(self.git, d),
            "gitea_remove_remote": lambda d, h, u: api_git.gitea_remove_remote(self.git),
            "gitea_create_repo": lambda d, h, u: api_git.gitea_create_repo(self.git, d),
            # AI
            "ai_query": lambda d, h, u: api_misc.ai_query(self.ai, d),
            "ai_get_models": lambda d, h, u: api_misc.ai_get_models(self.ai, d),
            # GitHub
            "github_create_repo": lambda d, h, u: api_git.github_create_repo(self.git, d),
            "github_set_default_branch": lambda d, h, u: api_git.github_set_default_branch(self.git, d),
            "github_device_flow_start": lambda d, h, u: api_git.github_device_flow_start(self.git, d),
            "github_device_flow_poll": lambda d, h, u: api_git.github_device_flow_poll(self.git, d),
            "github_star": lambda d, h, u: api_git.github_star(self.git),
            "github_follow": lambda d, h, u: api_git.github_follow(self.git),
            # Misc
            "restart_home_assistant": lambda d, h, u: api_misc.restart_home_assistant(h),
            "get_entities": lambda d, h, u: api_misc.get_entities(h, d),
            "render_template": lambda d, h, u: api_misc.render_template(h, d),
            "call_service": lambda d, h, u: api_misc.call_service(h, d),
            "convert_to_blueprint": lambda d, h, u: api_misc.convert_to_blueprint(self.ai, d, h),
            "parse_blueprint_inputs": lambda d, h, u: api_misc.parse_blueprint_inputs(self.ai, d, h),
            "instantiate_blueprint":  lambda d, h, u: api_misc.instantiate_blueprint(self.ai, d, h),
            "reload_automations": lambda d, h, u: api_misc.reload_automations(h),
            "reload_yaml": lambda d, h, u: api_misc.reload_yaml(h, d),
        }

        handler = post_handlers.get(action)
        if not handler:
            _LOGGER.error("Blueprint Studio: Unknown POST action: %s", action)
            return json_message(f"Unknown action: {action}", status_code=400)

        # Guard: certain destructive actions require an admin user.
        if action in _ADMIN_ONLY_ACTIONS and not user.is_admin:
            _LOGGER.warning(
                "Blueprint Studio: non-admin user '%s' attempted restricted action '%s'",
                user.name,
                action,
            )
            return json_message("Admin privileges required for this action", status_code=403)

        try:
            result = handler(data, hass, user)
            return await result if asyncio.iscoroutine(result) else result
        except Exception as err:
            _LOGGER.error("POST action %s failed: %s", action, err, exc_info=True)
            return json_message("Action failed. See server logs for details.", status_code=500)


class BlueprintStudioStreamView(HomeAssistantView):
    """Dedicated view for streaming file content (serve_file, download_folder).

    Uses requires_auth = False because <video src>, <audio src>, and direct
    download links cannot send Authorization headers. Token is validated
    manually from the query string, same pattern as TerminalWebSocketView
    and HA's camera streams.

    Only supports read-only GET actions — no mutations.
    """

    url = "/api/blueprint_studio/stream"
    name = "api:blueprint_studio:stream"
    requires_auth = False

    def __init__(self, file_manager: FileManager, sftp_manager: SftpManager) -> None:
        """Initialize the view."""
        self.file = file_manager
        self.sftp = sftp_manager

    async def get(self, request: web.Request) -> web.Response:
        """Authenticate via query-param token, then serve the file."""
        hass = request.app["hass"]

        # Validate token from query string
        token = request.query.get("authorization", "")
        if not token:
            return web.Response(status=401, text="Missing token")

        # async_validate_access_token is sync despite its name (HA convention)
        refresh_token = hass.auth.async_validate_access_token(token)
        if refresh_token is None:
            return web.Response(status=401, text="Invalid token")

        user = refresh_token.user
        if not user or not user.is_active:
            return web.Response(status=401, text="User not active")
        if not user.is_admin:
            _LOGGER.warning("Blueprint Studio: non-admin user %s attempted stream access", user.name)
            return web.Response(status=403, text="Admin access required")

        action = request.query.get("action")
        params = request.query
        self.file.hass = hass

        if action == "serve_file":
            return await api_files.serve_file(self.file, params)
        elif action == "download_folder":
            return await api_files.download_folder(self.file, params, request)
        elif action == "search_stream":
            return await api_files.search_stream(self.file, params, request)
        elif action == "sftp_serve_file":
            stream_id = request.query.get("stream_id", "")
            stream_data = self.sftp.get_stream_token(stream_id)
            if not stream_data:
                return web.Response(status=404, text="Stream not found or expired")
            return await api_sftp.sftp_stream_file(
                self.sftp,
                hass,
                request,
                stream_data["host"],
                stream_data["port"],
                stream_data["username"],
                stream_data["auth"],
                stream_data["path"],
            )
        else:
            return web.Response(status=400, text="Unknown streaming action")


class BlueprintStudioUploadView(HomeAssistantView):
    """Multipart file upload view — streams directly to disk.

    Bypasses HA's 16MB client_max_size by reading the request body in
    chunks instead of using request.post(). Accepts multipart/form-data
    with fields: file (binary), path (text), overwrite (text, optional),
    and optionally connection (JSON text) for SFTP uploads.
    """

    url = "/api/blueprint_studio/upload"
    name = "api:blueprint_studio:upload"
    requires_auth = True

    def __init__(self, file_manager: FileManager, sftp_manager: SftpManager) -> None:
        """Initialize the view."""
        self.file = file_manager
        self.sftp = sftp_manager

    async def post(self, request: web.Request) -> web.Response:
        """Handle multipart file upload, streaming to disk or SFTP."""
        user = request.get("hass_user")
        if not user:
            return web.Response(status=401, text="Unauthorized")
        if not user.is_admin:
            _LOGGER.warning("Blueprint Studio: non-admin user %s attempted upload access", user.name)
            return json_message("Admin privileges required", status_code=403)

        hass = request.app["hass"]
        self.file.hass = hass

        # Bypass HA's 16MB client_max_size for this endpoint.
        request._client_max_size = 0  # 0 = no limit

        try:
            reader = await request.multipart()
        except Exception as e:
            _LOGGER.error("Upload: failed to parse multipart: %s", e)
            return json_message("Invalid multipart request", status_code=400)

        file_path = None
        overwrite = False
        file_data = None
        connection = None  # SFTP connection details (JSON string)

        while True:
            part = await reader.next()
            if part is None:
                break

            if part.name == "path":
                file_path = (await part.text()).strip()
            elif part.name == "overwrite":
                overwrite = (await part.text()).strip().lower() in ("true", "1")
            elif part.name == "connection":
                try:
                    connection = json.loads(await part.text())
                except Exception:
                    return json_message("Invalid connection JSON", status_code=400)
            elif part.name == "file":
                chunks = []
                while True:
                    chunk = await part.read_chunk()
                    if not chunk:
                        break
                    chunks.append(chunk)
                file_data = b"".join(chunks)

        if not file_path or file_data is None:
            return json_message("Missing file or path", status_code=400)

        # SFTP upload
        if connection:
            return await self._upload_sftp(hass, connection, file_path, file_data, overwrite)

        # Local upload
        return await self._upload_local(hass, file_path, file_data, overwrite)

    async def _upload_local(self, hass, file_path, file_data, overwrite):
        """Write uploaded bytes to local filesystem."""
        from .util import get_safe_path
        safe_path = get_safe_path(self.file._get_root_dir(), file_path)
        if not safe_path:
            return json_message("Not allowed", status_code=403)

        if safe_path.exists() and not overwrite:
            return json_response(
                {"success": False, "message": "File already exists"},
                status_code=409,
            )

        try:
            await hass.async_add_executor_job(safe_path.write_bytes, file_data)
            self.file._fire_update("upload", file_path)
            return json_response({"success": True, "path": file_path})
        except Exception as e:
            _LOGGER.error("Upload write failed: %s", e)
            return json_message(str(e), status_code=500)

    async def _upload_sftp(self, hass, connection, file_path, file_data, overwrite):
        """Write uploaded bytes to remote SFTP server."""
        host = connection.get("host", "")
        port = int(connection.get("port", 22))
        username = connection.get("username", "")
        auth = connection.get("auth", {})

        if not host or not username:
            return json_message("Missing SFTP connection parameters", status_code=400)

        def _write():
            return self.sftp.create_file_raw(host, port, username, auth, file_path, file_data, overwrite)

        try:
            result = await hass.async_add_executor_job(_write)
            status_code = result.pop("status_code", 200) if isinstance(result, dict) else 200
            return json_response(result, status_code=status_code)
        except Exception as e:
            _LOGGER.error("SFTP upload failed: %s", e)
            return json_response({"success": False, "message": str(e)})
