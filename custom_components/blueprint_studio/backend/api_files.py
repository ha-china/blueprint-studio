"""File operation handlers for Blueprint Studio API."""
from __future__ import annotations

import logging

from aiohttp import web

from .util import json_response, json_message

_LOGGER = logging.getLogger(__name__)


# ========== GET Handlers ==========

async def list_files(file_manager, params, hass):
    """List files in config directory."""
    show_hidden = params.get("show_hidden", "false").lower() == "true"
    files = await hass.async_add_executor_job(file_manager.list_files, show_hidden)
    return json_response(files)


async def list_all(file_manager, params, hass):
    """List all files recursively."""
    show_hidden = params.get("show_hidden", "false").lower() == "true"
    force_refresh = params.get("force", "false").lower() == "true"
    items = await hass.async_add_executor_job(file_manager.list_all, show_hidden, force_refresh)
    return json_response(items)


async def list_directory(file_manager, params, hass):
    """List a specific directory."""
    path = params.get("path", "")
    show_hidden = params.get("show_hidden", "false").lower() == "true"
    result = await hass.async_add_executor_job(file_manager.list_directory, path, show_hidden)
    return json_response(result)


async def list_git_files(file_manager, hass):
    """List git-tracked files."""
    items = await hass.async_add_executor_job(file_manager.list_git_files)
    return json_response(items)


async def read_file(file_manager, params):
    """Read a file."""
    path = params.get("path")
    if not path:
        return json_message("Missing path", status_code=400)
    optional = params.get("optional", "false").lower() == "true"
    return await file_manager.read_file(path, optional=optional)


async def serve_file(file_manager, params):
    """Serve a file for download/preview."""
    path = params.get("path")
    if not path:
        return web.Response(status=400, text="Missing path")
    return await file_manager.serve_file(path)


async def global_search(file_manager, params, hass):
    """Search files (GET version)."""
    results = await hass.async_add_executor_job(
        file_manager.global_search, params.get("query"),
        params.get("case_sensitive", "false").lower() == "true",
        params.get("use_regex", "false").lower() == "true",
        params.get("match_word", "false").lower() == "true",
        params.get("include", ""), params.get("exclude", "")
    )
    return json_response(results)


async def get_file_stat(file_manager, params):
    """Get file stat info."""
    path = params.get("path")
    if not path:
        return json_message("Missing path", status_code=400)
    return await file_manager.get_file_stat(path)


async def get_tree_snapshot(file_manager, params, hass):
    """Get a lightweight signature for the visible file tree."""
    show_hidden = params.get("show_hidden", "false").lower() == "true"
    snapshot = await hass.async_add_executor_job(file_manager.get_tree_snapshot, show_hidden)
    return json_response(snapshot)


async def download_folder(file_manager, params, request):
    """Download a folder as zip."""
    path = params.get("path")
    if not path:
        return json_message("Missing path", status_code=400)
    return await file_manager.download_folder(path, request)


async def search_stream(file_manager, params, request):
    """Stream search results as NDJSON — first result arrives before scan is complete."""
    query = params.get("query", "")
    if not query:
        return json_message("Missing query", status_code=400)
    return await file_manager.global_search_stream(
        request, query,
        params.get("case_sensitive", "false").lower() == "true",
        params.get("use_regex", "false").lower() == "true",
        params.get("match_word", "false").lower() == "true",
        params.get("include", ""),
        params.get("exclude", ""),
    )


# ========== POST Handlers ==========

async def write_file(file_manager, data, hass):
    """Write file content, with YAML reload hooks."""
    path, content = data.get("path"), data.get("content")
    response = await file_manager.write_file(path, content)
    if path and "/" not in path:
        if path == "automations.yaml":
            await hass.services.async_call("automation", "reload")
        elif path == "scripts.yaml":
            await hass.services.async_call("script", "reload")
        elif path == "scenes.yaml":
            await hass.services.async_call("scene", "reload")
        elif path == "groups.yaml":
            await hass.services.async_call("group", "reload")
    return response


async def create_file(file_manager, data):
    """Create a new file."""
    return await file_manager.create_file(
        data.get("path"), data.get("content", ""),
        data.get("is_base64", False), data.get("overwrite", False)
    )


async def create_folder(file_manager, data):
    """Create a new folder."""
    return await file_manager.create_folder(data.get("path"))


async def delete(file_manager, data):
    """Delete a file or folder."""
    return await file_manager.delete(data.get("path"))


async def copy(file_manager, data):
    """Copy a file or folder."""
    return await file_manager.copy(
        data.get("source"), data.get("destination"), data.get("overwrite", False)
    )


async def rename(file_manager, data):
    """Rename a file or folder."""
    return await file_manager.rename(
        data.get("source"), data.get("destination"), data.get("overwrite", False)
    )


async def upload_file(file_manager, data):
    """Upload a file."""
    path = data.get("path")
    content = data.get("content")
    if path is None or content is None:
        _LOGGER.error("Blueprint Studio: upload_file missing path or content")
        return json_message("Missing path or content", status_code=400)
    return await file_manager.upload_file(
        path, content, data.get("overwrite", False), data.get("is_base64", False)
    )


async def upload_folder(file_manager, data):
    """Upload a folder from zip."""
    return await file_manager.upload_folder(
        data.get("path"), data.get("zip_data"),
        data.get("mode", "merge"), data.get("overwrite", False)
    )


async def download_multi(file_manager, data, request):
    """Download multiple files as zip."""
    return await file_manager.download_multi(data.get("paths", []), request)


async def delete_multi(file_manager, data):
    """Delete multiple files."""
    return await file_manager.delete_multi(data.get("paths", []))


async def move_multi(file_manager, data):
    """Move multiple files."""
    return await file_manager.move_multi(data.get("paths", []), data.get("destination"))


async def post_global_search(file_manager, data, hass):
    """Search files (POST version)."""
    results = await hass.async_add_executor_job(
        file_manager.global_search, data.get("query"),
        data.get("case_sensitive", False), data.get("use_regex", False),
        data.get("match_word", False), data.get("include", ""),
        data.get("exclude", "")
    )
    return json_response(results)


async def global_replace(file_manager, data, hass):
    """Search and replace across files."""
    results = await hass.async_add_executor_job(
        file_manager.global_replace, data.get("query"), data.get("replacement"),
        data.get("case_sensitive", False), data.get("use_regex", False),
        data.get("match_word", False), data.get("include", ""),
        data.get("exclude", "")
    )
    return json_response(results)
