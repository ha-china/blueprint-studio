"""Typed, compatibility-preserving contracts for public transports."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlparse


class TransportError(Exception):
    """Base exception carrying a stable client-facing error category."""

    code = "operation_failed"
    status = 500


class ValidationError(TransportError):
    """Raised when public transport input does not match its contract."""

    code = "validation_error"
    status = 400


class ConflictError(TransportError):
    code = "conflict"
    status = 409


class UnavailableError(TransportError):
    code = "unavailable"
    status = 503


class OperationTimeoutError(TransportError):
    code = "timeout"
    status = 504


class OperationCancelledError(TransportError):
    code = "cancelled"
    status = 499


@dataclass(frozen=True)
class ActionSchema:
    """Small schema definition suited to the existing dictionary API."""

    required: tuple[str, ...] = ()


GET_ACTIONS = frozenset(
    {
        "list_files",
        "list_all",
        "list_directory",
        "list_git_files",
        "read_file",
        "global_search",
        "get_file_stat",
        "get_tree_snapshot",
        "get_settings",
        "get_version",
        "get_devices",
        "get_areas",
        "get_labels",
        "get_floors",
        "get_themes",
        "get_addons",
        "get_services",
        "get_metadata",
        "zip_progress",
        "run_config_check",
        "list_hass_agents",
    }
)

POST_ACTIONS = frozenset(
    {
        "issue_connection_ticket",
        "save_settings",
        "write_file",
        "create_file",
        "create_folder",
        "delete",
        "copy",
        "rename",
        "upload_file",
        "upload_folder",
        "prepare_download_multi",
        "cancel_zip",
        "download_multi",
        "delete_multi",
        "move_multi",
        "global_search",
        "global_replace",
        "check_yaml",
        "check_jinja",
        "check_json",
        "check_python",
        "check_javascript",
        "check_syntax",
        "terminal_exec",
        "git_status",
        "git_log",
        "git_diff_commit",
        "git_pull",
        "git_push",
        "git_push_only",
        "git_commit",
        "git_show",
        "git_init",
        "git_add_remote",
        "git_remove_remote",
        "git_delete_repo",
        "git_repair_index",
        "git_rename_branch",
        "git_merge_unrelated",
        "git_force_push",
        "git_hard_reset",
        "git_delete_remote_branch",
        "git_checkout_branch",
        "git_create_branch",
        "git_delete_local_branch",
        "git_merge_branch",
        "git_get_conflict_files",
        "git_resolve_conflict",
        "git_abort",
        "git_stage",
        "git_unstage",
        "git_reset",
        "git_clean_locks",
        "git_stop_tracking",
        "git_get_remotes",
        "git_get_credentials",
        "git_set_credentials",
        "git_clear_credentials",
        "git_test_connection",
        "gitea_status",
        "gitea_pull",
        "gitea_push",
        "gitea_push_only",
        "gitea_get_credentials",
        "gitea_set_credentials",
        "gitea_clear_credentials",
        "gitea_test_connection",
        "gitea_add_remote",
        "gitea_remove_remote",
        "gitea_create_repo",
        "ai_query",
        "ai_preview_context",
        "ai_get_models",
        "ai_apply_proposal",
        "ai_undo_proposal",
        "ai_cancel",
        "ai_revise_proposal",
        "ai_reject_proposal",
        "github_create_repo",
        "github_set_default_branch",
        "github_device_flow_start",
        "github_device_flow_poll",
        "github_star",
        "github_follow",
        "restart_home_assistant",
        "get_entities",
        "get_device_automations",
        "render_template",
        "call_service",
        "convert_to_blueprint",
        "parse_blueprint_inputs",
        "instantiate_blueprint",
        "reload_automations",
        "reload_yaml",
    }
)

SFTP_ACTIONS = frozenset(
    {
        "sftp_test",
        "sftp_list",
        "sftp_read",
        "sftp_write",
        "sftp_create",
        "sftp_delete",
        "sftp_delete_multi",
        "sftp_rename",
        "sftp_mkdir",
        "sftp_copy",
        "sftp_upload_folder",
        "sftp_download_folder",
        "sftp_prepare_stream",
        "sftp_serve_file",
    }
)

STREAM_ACTIONS = frozenset(
    {
        "serve_file",
        "download_folder",
        "download_multi",
        "search_stream",
        "sftp_serve_file",
    }
)
STREAM_SCHEMAS = {
    "serve_file": ActionSchema(("path",)),
    "download_folder": ActionSchema(("path",)),
    "download_multi": ActionSchema(("stream_id",)),
    "search_stream": ActionSchema(("query",)),
    "sftp_serve_file": ActionSchema(("stream_id",)),
}

_REQUIRED = {
    "read_file": ("path",),
    "get_file_stat": ("path",),
    "zip_progress": ("progress_id",),
    "write_file": ("path", "content"),
    "create_file": ("path",),
    "create_folder": ("path",),
    "delete": ("path",),
    "copy": ("source", "destination"),
    "rename": ("source", "destination"),
    "upload_file": ("path", "content"),
    "upload_folder": ("path", "zip_data"),
    "prepare_download_multi": ("paths",),
    "cancel_zip": ("progress_id",),
    "download_multi": ("paths",),
    "delete_multi": ("paths",),
    "move_multi": ("paths", "destination"),
    "global_search": ("query",),
    "global_replace": ("query", "replacement"),
    "check_yaml": ("content",),
    "check_jinja": ("content",),
    "check_json": ("content",),
    "check_python": ("content",),
    "check_javascript": ("content",),
    "check_syntax": ("content", "file_path"),
    "terminal_exec": ("command",),
    "git_diff_commit": ("hash",),
    "git_push": ("commit_message",),
    "git_commit": ("commit_message",),
    "git_show": ("path",),
    "git_add_remote": ("name", "url"),
    "git_remove_remote": ("name",),
    "git_rename_branch": ("old_name", "new_name"),
    "git_merge_unrelated": ("remote", "branch"),
    "git_hard_reset": ("remote", "branch"),
    "git_delete_remote_branch": ("branch",),
    "git_checkout_branch": ("branch",),
    "git_create_branch": ("name",),
    "git_delete_local_branch": ("branch",),
    "git_merge_branch": ("branch",),
    "git_resolve_conflict": ("path", "resolution"),
    "git_stage": ("files",),
    "git_unstage": ("files",),
    "git_reset": ("files",),
    "git_stop_tracking": ("files",),
    "git_set_credentials": ("username", "token"),
    "gitea_push": ("commit_message",),
    "gitea_set_credentials": ("username", "token"),
    "gitea_add_remote": ("url",),
    "gitea_create_repo": ("repo_name",),
    "ai_query": ("query", "ai_type"),
    "ai_preview_context": ("ai_type",),
    "ai_get_models": ("ai_type",),
    "ai_apply_proposal": ("proposal_id",),
    "ai_undo_proposal": ("undo_id",),
    "ai_cancel": ("request_id",),
    "ai_revise_proposal": ("proposal_id",),
    "ai_reject_proposal": ("proposal_id",),
    "github_create_repo": ("repo_name",),
    "github_set_default_branch": ("branch",),
    "github_device_flow_start": ("client_id",),
    "github_device_flow_poll": ("client_id", "device_code"),
    "render_template": ("template",),
    "call_service": ("domain", "service"),
    "get_device_automations": ("device_id",),
    "convert_to_blueprint": ("content",),
    "parse_blueprint_inputs": ("content",),
    "instantiate_blueprint": ("content", "input_values", "name"),
    "reload_yaml": ("domain",),
    "sftp_read": ("path",),
    "sftp_write": ("path", "content"),
    "sftp_create": ("path",),
    "sftp_delete": ("path",),
    "sftp_delete_multi": ("paths",),
    "sftp_rename": ("source", "destination"),
    "sftp_mkdir": ("path",),
    "sftp_copy": ("source", "destination"),
    "sftp_upload_folder": ("path", "zip_data"),
    "sftp_download_folder": ("path",),
    "sftp_serve_file": ("path",),
}

ACTION_SCHEMAS = {
    action: ActionSchema(_REQUIRED.get(action, ()))
    for action in GET_ACTIONS | POST_ACTIONS | SFTP_ACTIONS
}

_BOOL_FIELDS = frozenset(
    {
        "show_hidden",
        "force",
        "optional",
        "overwrite",
        "is_base64",
        "case_sensitive",
        "use_regex",
        "match_word",
        "checkout",
        "private",
        "is_private",
        "extract_zip",
        "include_file_context",
        "include_metadata",
    }
)
_LIST_FIELDS = frozenset({"paths", "files", "domains", "selected_paths"})
_DICT_FIELDS = frozenset(
    {"settings", "service_data", "input_values", "auth", "connection"}
)
_INT_FIELDS = frozenset({"port", "rows", "cols", "limit", "max_results"})
# These fields are required to be present, but an empty string is valid data.
# Empty editor buffers must be writable and validatable, an empty replacement
# deletes matches, and rendering an empty template is a valid HA operation.
_EMPTY_STRING_FIELDS = frozenset({"content", "new_content", "replacement", "template"})
_ENUM_FIELDS = {
    "mode": frozenset({"merge", "replace"}),
    "resolution": frozenset({"ours", "theirs", "resolved"}),
    "stream_type": frozenset({"file", "folder", "folder_zip", "selected_zip"}),
    "ai_type": frozenset(
        {"none", "rule-based", "local-ai", "cloud", "hass-agent", "hass"}
    ),
    "cloud_provider": frozenset({"gemini", "openai", "claude"}),
    "local_ai_provider": frozenset({"ollama", "lm-studio", "custom"}),
    "task_mode": frozenset({"ask", "explain", "generate", "fix", "refactor"}),
}

_BRANCH_FIELDS = frozenset({"branch", "old_name", "new_name"})


def validate_action(
    action: Any, values: Mapping[str, Any], *, transport: str
) -> dict[str, Any]:
    """Validate an action and return a normalized, handler-compatible dictionary."""
    allowed = (
        GET_ACTIONS
        if transport == "get"
        else SFTP_ACTIONS
        if transport == "sftp"
        else POST_ACTIONS
    )
    if not isinstance(action, str) or action not in allowed:
        raise ValidationError("Unknown action")
    data = dict(values)
    schema = ACTION_SCHEMAS[action]
    for field in schema.required:
        if (
            field not in data
            or data[field] is None
            or (data[field] == "" and field not in _EMPTY_STRING_FIELDS)
        ):
            raise ValidationError(f"Missing required field: {field}")
        if field not in _LIST_FIELDS | _DICT_FIELDS and not isinstance(
            data[field], str
        ):
            raise ValidationError(f"Field '{field}' must be a string")

    for field, value in tuple(data.items()):
        if field in _BOOL_FIELDS:
            parsed = _boolean(value, field)
            data[field] = value if transport == "get" else parsed
        elif field in _LIST_FIELDS:
            if not isinstance(value, list) or any(
                not isinstance(item, str) or not item for item in value
            ):
                raise ValidationError(
                    f"Field '{field}' must be a list of non-empty strings"
                )
            if field in schema.required and not value:
                raise ValidationError(f"Field '{field}' must not be empty")
        elif field in _DICT_FIELDS and not isinstance(value, dict):
            raise ValidationError(f"Field '{field}' must be an object")
        elif field in _INT_FIELDS:
            data[field] = _integer(value, field)
        elif field in _ENUM_FIELDS and value not in _ENUM_FIELDS[field]:
            raise ValidationError(f"Field '{field}' has an unsupported value")
        elif field in _BRANCH_FIELDS and not _valid_git_name(value):
            raise ValidationError(f"Field '{field}' is not a valid branch name")
        elif field == "hash" and not _valid_commit_reference(value):
            raise ValidationError("Field 'hash' is not a valid commit reference")
        elif (
            field == "name"
            and action == "instantiate_blueprint"
            and (
                not isinstance(value, str)
                or not value.strip()
                or len(value) > 255
                or any(char in value for char in "\r\n\x00")
            )
        ):
            raise ValidationError("Field 'name' is not a valid display name")
        elif (
            field in {"name", "remote"}
            and action != "instantiate_blueprint"
            and (
                not isinstance(value, str)
                or not value
                or len(value) > 255
                or any(char.isspace() for char in value)
            )
        ):
            raise ValidationError(f"Field '{field}' is not a valid name")

    if action == "issue_connection_ticket":
        ticket_action = data.get("ticket_action")
        if ticket_action == "terminal":
            pass
        elif ticket_action in STREAM_ACTIONS:
            validate_stream(ticket_action, data)
        else:
            raise ValidationError("Invalid ticket scope")

    if action == "sftp_prepare_stream":
        if data.get("stream_type", "file") == "selected_zip":
            if not data.get("paths"):
                raise ValidationError("Missing required field: paths")
        elif not data.get("path"):
            raise ValidationError("Missing required field: path")

    if (
        action == "ai_apply_proposal"
        and "selected_paths" in data
        and not data["selected_paths"]
    ):
        raise ValidationError("Field 'selected_paths' must not be empty")

    if transport == "sftp":
        _validate_connection(data.get("connection"))
    return data


def validate_terminal_message(value: Any) -> dict[str, Any]:
    """Validate a decoded terminal WebSocket control message."""
    if not isinstance(value, dict):
        raise ValidationError("Terminal message must be an object")
    kind = value.get("type")
    if kind == "input":
        if not isinstance(value.get("data"), str):
            raise ValidationError("Terminal input data must be a string")
    elif kind == "resize":
        rows = _integer(value.get("rows"), "rows")
        cols = _integer(value.get("cols"), "cols")
        if not 1 <= rows <= 1000 or not 1 <= cols <= 1000:
            raise ValidationError("Terminal dimensions are out of range")
    elif kind in {"ssh_password", "ssh_key"}:
        for field in ("host", "username"):
            if not isinstance(value.get(field), str) or not value[field]:
                raise ValidationError(f"Missing required field: {field}")
        port = _integer(value.get("port", 22), "port")
        if not 1 <= port <= 65535:
            raise ValidationError("Field 'port' must be between 1 and 65535")
    else:
        raise ValidationError("Unknown terminal message type")
    return dict(value)


def validate_stream(action: Any, values: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the query contract for a ticket-authenticated stream."""
    if not isinstance(action, str) or action not in STREAM_ACTIONS:
        raise ValidationError("Unknown streaming action")
    data = dict(values)
    for field in STREAM_SCHEMAS[action].required:
        if not isinstance(data.get(field), str) or not data[field]:
            raise ValidationError(f"Missing required field: {field}")
    for field in ("case_sensitive", "use_regex", "match_word"):
        if field in data:
            _boolean(data[field], field)
    return data


def validate_upload_metadata(
    path: Any, overwrite: Any, extract_zip: Any, mode: Any, connection: Any
) -> None:
    """Validate multipart metadata after bounded parsing and before dispatch."""
    if not isinstance(path, str) or not path:
        raise ValidationError("Missing required field: path")
    _boolean(overwrite, "overwrite")
    _boolean(extract_zip, "extract_zip")
    if mode not in _ENUM_FIELDS["mode"]:
        raise ValidationError("Field 'mode' has an unsupported value")
    if connection is not None:
        _validate_connection(connection)


def _validate_connection(connection: Any) -> None:
    if not isinstance(connection, dict):
        raise ValidationError("Field 'connection' must be an object")
    for field in ("host", "username"):
        if not isinstance(connection.get(field), str) or not connection[field]:
            raise ValidationError(f"Missing connection field: {field}")
    port = _integer(connection.get("port", 22), "port")
    if not 1 <= port <= 65535:
        raise ValidationError("Connection port must be between 1 and 65535")
    if not isinstance(connection.get("auth", {}), dict):
        raise ValidationError("Connection auth must be an object")


def _boolean(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    raise ValidationError(f"Field '{field}' must be a boolean")


def _integer(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise ValidationError(f"Field '{field}' must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError) as err:
        raise ValidationError(f"Field '{field}' must be an integer") from err


def _valid_git_name(value: Any) -> bool:
    """Apply Git's important ref-name constraints before invoking Git."""
    if not isinstance(value, str) or not value or len(value) > 255:
        return False
    if value in {"@", ".", ".."} or value.startswith(("/", ".")):
        return False
    if value.endswith(("/", ".", ".lock")) or ".." in value or "//" in value:
        return False
    return not any(char.isspace() or char in "~^:?*[\\" for char in value)


def _valid_commit_reference(value: Any) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= 255
        and "\x00" not in value
        and not any(char in "\r\n" for char in value)
    )


def validate_terminal_origin(
    origin: str | None,
    request_scheme: str,
    request_host: str,
    headers: Mapping[str, str] | None = None,
    hass: Any = None,
) -> bool:
    """Validate whether the Origin header is authorized to access the terminal WebSocket.

    Accepts the origin if:
    1. It matches the request scheme and host (http(s)://<host>[:port]).
    2. Home Assistant recognizes the origin as pointing to this instance (via
       `is_hass_url`, or configured `external_url` / `internal_url`).
    3. The origin matches the request's host/authority or reverse-proxy forwarding
       headers (X-Forwarded-Host, Host, X-Forwarded-Port) for standard web schemes.
    """
    if not origin:
        return False

    clean_origin = origin.strip().rstrip("/")
    if not clean_origin:
        return False

    # 1. Exact match with request scheme and host
    expected_origin = f"{request_scheme}://{request_host}".rstrip("/")
    if clean_origin == expected_origin:
        return True

    # 2. Check if the URL belongs to this Home Assistant instance
    if hass is not None:
        try:
            from homeassistant.helpers.network import is_hass_url

            if is_hass_url(hass, clean_origin):
                return True
        except Exception:
            pass

        config = getattr(hass, "config", None)
        if config is not None:
            for configured_url in (
                getattr(config, "external_url", None),
                getattr(config, "internal_url", None),
            ):
                if configured_url and clean_origin == str(configured_url).rstrip("/"):
                    return True

    # 3. Parse origin URL and validate hostname/scheme against request context
    try:
        origin_parsed = urlparse(clean_origin)
    except Exception:
        return False

    if origin_parsed.scheme not in ("http", "https"):
        return False

    origin_host = origin_parsed.hostname
    if not origin_host:
        return False
    origin_host = origin_host.lower()

    # Collect allowed hosts and authorities from the request and forwarding headers
    allowed_hosts: set[str] = set()
    allowed_netlocs: set[str] = set()

    headers_map = headers or {}
    headers_lower = {k.lower(): v for k, v in headers_map.items()}

    for host_value in (
        request_host,
        headers_lower.get("host"),
        headers_lower.get("x-forwarded-host"),
    ):
        if not host_value:
            continue
        for item in host_value.split(","):
            item_str = item.strip().lower()
            if not item_str:
                continue
            allowed_netlocs.add(item_str)
            if ":" in item_str:
                allowed_hosts.add(item_str.split(":", 1)[0])
            else:
                allowed_hosts.add(item_str)

    fwd_port = headers_lower.get("x-forwarded-port")
    if fwd_port:
        port_str = fwd_port.strip()
        for h in list(allowed_hosts):
            allowed_netlocs.add(f"{h}:{port_str}")

    origin_netloc = origin_parsed.netloc.lower()
    if origin_netloc in allowed_netlocs:
        return True

    # For default ports (80 for http, 443 for https) or omitted ports,
    # match against hostname to accommodate reverse proxies that rewrite or drop the port.
    if (
        origin_parsed.port is None or origin_parsed.port in (80, 443)
    ) and origin_host in allowed_hosts:
        return True

    return False
