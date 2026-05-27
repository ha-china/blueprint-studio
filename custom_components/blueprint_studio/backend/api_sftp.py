"""SFTP action dispatcher for Blueprint Studio API."""
from __future__ import annotations

import logging
import os

from aiohttp import web

from .util import json_response, json_message

_LOGGER = logging.getLogger(__name__)

# All SFTP action names
SFTP_ACTIONS = frozenset({
    "sftp_test", "sftp_list", "sftp_read", "sftp_write", "sftp_create",
    "sftp_delete", "sftp_delete_multi", "sftp_rename", "sftp_mkdir",
    "sftp_copy", "sftp_upload_folder", "sftp_download_folder",
    "sftp_prepare_stream", "sftp_serve_file",
})


async def sftp_action(sftp_manager, action: str, data: dict, hass, request=None):
    """Dispatch an SFTP action."""
    conn = data.get("connection", {})
    host = conn.get("host", "")
    port = int(conn.get("port", 22))
    username = conn.get("username", "")
    auth = conn.get("auth", {})

    if not host or not username:
        return json_message("Missing connection parameters", status_code=400)

    if action == "sftp_prepare_stream":
        path = data.get("path")
        if not path:
            return json_message("Missing path", status_code=400)
        result = sftp_manager.create_stream_token(host, port, username, auth, path)
        return json_response(result)

    # --- sftp_serve_file: stream raw bytes with Range support ---
    if action == "sftp_serve_file":
        path = data.get("path")
        if not path:
            return json_message("Missing path", status_code=400)
        return await sftp_stream_file(sftp_manager, hass, request, host, port, username, auth, path)

    sftp_handlers = {
        "sftp_test":   lambda: hass.async_add_executor_job(sftp_manager.test_connection, host, port, username, auth),
        "sftp_list":   lambda: hass.async_add_executor_job(sftp_manager.list_directory, host, port, username, auth, data.get("path", "/"), data.get("show_hidden", False)),
        "sftp_read":   lambda: hass.async_add_executor_job(sftp_manager.read_file, host, port, username, auth, data.get("path")) if data.get("path") else None,
        "sftp_write":  lambda: hass.async_add_executor_job(sftp_manager.write_file, host, port, username, auth, data.get("path"), data.get("content", "")) if data.get("path") else None,
        "sftp_create": lambda: hass.async_add_executor_job(sftp_manager.create_file, host, port, username, auth, data.get("path"), data.get("content", ""), data.get("overwrite", False), data.get("is_base64", False)) if data.get("path") else None,
        "sftp_delete": lambda: hass.async_add_executor_job(sftp_manager.delete_path, host, port, username, auth, data.get("path")) if data.get("path") else None,
        "sftp_delete_multi": lambda: hass.async_add_executor_job(sftp_manager.delete_multi, host, port, username, auth, data.get("paths", [])) if data.get("paths") else None,
        "sftp_rename": lambda: hass.async_add_executor_job(sftp_manager.rename_path, host, port, username, auth, data.get("source"), data.get("destination"), data.get("overwrite", False)) if data.get("source") and data.get("destination") else None,
        "sftp_copy":   lambda: hass.async_add_executor_job(sftp_manager.copy_path, host, port, username, auth, data.get("source"), data.get("destination"), data.get("overwrite", False)) if data.get("source") and data.get("destination") else None,
        "sftp_mkdir":  lambda: hass.async_add_executor_job(sftp_manager.make_directory, host, port, username, auth, data.get("path")) if data.get("path") else None,
        "sftp_upload_folder": lambda: hass.async_add_executor_job(sftp_manager.upload_folder, host, port, username, auth, data.get("path"), data.get("zip_data"), data.get("mode", "merge"), data.get("overwrite", False)) if data.get("path") and data.get("zip_data") else None,
        "sftp_download_folder": lambda: hass.async_add_executor_job(sftp_manager.download_folder, host, port, username, auth, data.get("path")) if data.get("path") else None,
    }

    # Validate required params
    if action in ("sftp_read", "sftp_write", "sftp_create", "sftp_delete", "sftp_mkdir", "sftp_upload_folder", "sftp_download_folder"):
        if not data.get("path"):
            return json_message("Missing path", status_code=400)
    elif action in ("sftp_rename", "sftp_copy"):
        if not data.get("source") or not data.get("destination"):
            return json_message("Missing source or destination", status_code=400)

    try:
        handler = sftp_handlers.get(action)
        if not handler:
            return json_message("Unknown SFTP action", status_code=400)
        result = await handler()

        status_code = result.pop("status_code", 200) if isinstance(result, dict) else 200
        return json_response(result, status_code=status_code)
    except Exception as exc:
        _LOGGER.error("SFTP action %s failed: %s", action, exc)
        return json_response({"success": False, "message": str(exc)})


def _parse_range(range_header: str | None, file_size: int) -> tuple[int, int, int] | None:
    """Parse a single HTTP bytes range. Returns (start, end, status)."""
    if not range_header:
        return 0, max(file_size - 1, 0), 200
    if not range_header.startswith("bytes=") or "," in range_header:
        return None

    range_spec = range_header[6:].strip()
    start_str, sep, end_str = range_spec.partition("-")
    if not sep:
        return None

    try:
        if start_str:
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
        else:
            suffix_length = int(end_str)
            if suffix_length <= 0:
                return None
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
    except ValueError:
        return None

    if start < 0 or start >= file_size or end < start:
        return None
    return start, min(end, file_size - 1), 206


async def sftp_stream_file(sftp_manager, hass, request, host, port, username, auth, path):
    """Stream an SFTP file with HTTP Range support without loading it all into memory."""
    try:
        info = await hass.async_add_executor_job(
            sftp_manager.get_file_info, host, port, username, auth, path
        )
        if not info.get("success"):
            return json_message(info.get("message", "Read failed"), status_code=info.get("status_code", 500))

        file_size = int(info.get("size") or 0)
        mime_type = info.get("mime_type") or "application/octet-stream"
        filename = os.path.basename(path)

        if file_size <= 0:
            return web.Response(
                status=200,
                body=b"",
                headers={
                    "Content-Type": mime_type,
                    "Content-Disposition": f'inline; filename="{filename}"',
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "no-store",
                },
            )

        parsed_range = _parse_range(request.headers.get("Range") if request else None, file_size)
        if parsed_range is None:
            return web.Response(
                status=416,
                headers={
                    "Content-Range": f"bytes */{file_size}",
                    "Accept-Ranges": "bytes",
                },
            )
        start, end, status_code = parsed_range
        content_length = end - start + 1

        headers = {
            "Content-Type": mime_type,
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Length": str(content_length),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        }
        if status_code == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

        response = web.StreamResponse(status=status_code, headers=headers)
        await response.prepare(request)

        offset = start
        remaining = content_length
        chunk_size = 1024 * 1024
        while remaining > 0:
            read_len = min(chunk_size, remaining)
            chunk = await hass.async_add_executor_job(
                sftp_manager.read_file_range, host, port, username, auth, path, offset, read_len
            )
            if not chunk.get("success"):
                raise RuntimeError(chunk.get("message", "SFTP read failed"))
            data = chunk.get("data", b"")
            if not data:
                break
            await response.write(data)
            offset += len(data)
            remaining -= len(data)

        await response.write_eof()
        return response
    except Exception as exc:
        _LOGGER.error("sftp_stream_file failed: %s", exc, exc_info=True)
        return json_message("SFTP stream failed", status_code=500)
