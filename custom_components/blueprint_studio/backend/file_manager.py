"""File management for Blueprint Studio."""
from __future__ import annotations

import asyncio
import base64
import fnmatch
import hashlib
import io
import logging
import os
import queue
import re
import shutil
import threading
import zipfile
import mimetypes
import time
from pathlib import Path
from typing import Any

from aiohttp import web
from homeassistant.core import HomeAssistant

from ..const import (
    BINARY_EXTENSIONS, EXCLUDED_PATTERNS, PROTECTED_PATHS
)
from .util import json_response, json_message, get_safe_path

_LOGGER = logging.getLogger(__name__)


class _ZipChunkWriter:
    """Minimal unseekable file object that forwards ZIP bytes to a callback."""

    def __init__(self, callback) -> None:
        self._callback = callback
        self._position = 0

    def write(self, data: bytes) -> int:
        if data:
            self._callback(data)
            self._position += len(data)
        return len(data)

    def tell(self) -> int:
        return self._position

    def flush(self) -> None:
        return None


class FileManager:
    """Class to handle file operations."""

    def __init__(self, hass: HomeAssistant, config_dir: Path) -> None:
        """Initialize file manager.

        Args:
            hass: Home Assistant instance
            config_dir: Base configuration directory
        """
        self.hass = hass
        self.config_dir = config_dir
        self._file_cache: dict[bool, list[dict]] = {}
        self._last_cache_update: float = 0
        self._cache_lock = threading.Lock()  # 🔒 Thread safety for concurrent requests

    def _get_root_dir(self) -> Path:
        """Get the root directory (always config_dir).

        Returns:
            self.config_dir
        """
        return self.config_dir

    def _is_listed_file(self, path: Path) -> bool:
        """Check if a file should appear in directory listings."""
        return True

    def _is_protected(self, path: str) -> bool:
        """Check if path is protected."""
        parts = path.strip("/").split("/")
        return parts[0] in PROTECTED_PATHS or path.strip("/") in PROTECTED_PATHS

    def _filter_dirs(self, dirs: list, show_hidden: bool) -> None:
        """Filter directories by excluded patterns and hidden status."""
        dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS and (show_hidden or not d.startswith("."))]

    def _format_rel_path(self, rel_root: Path, name: str) -> str:
        """Format relative path consistently."""
        return str(rel_root / name if str(rel_root) != "." else name)

    def _build_symlink_info(self, path: Path) -> dict:
        """Build symlink info dict if path is a symlink."""
        info = {}
        try:
            if path.is_symlink():
                info["isSymlink"] = True
                info["symlinkTarget"] = str(path.resolve())
        except (OSError, RuntimeError):
            pass
        return info

    def _parse_patterns(self, pattern_str: str) -> list[str]:
        """Parse comma/semicolon-separated patterns."""
        if not pattern_str:
            return []
        return [p.strip() for p in re.split(r'[,;]', pattern_str) if p.strip()]

    def _should_include_file(self, rel_path_str: str, includes: list, excludes: list) -> bool:
        """Check if file matches include/exclude patterns."""
        if excludes and any(fnmatch.fnmatch(rel_path_str, ex) for ex in excludes):
            return False
        if includes and not any(fnmatch.fnmatch(rel_path_str, inc) for inc in includes):
            return False
        return True

    def _validate_file_access(self, safe_path: Path) -> tuple[bool, web.Response | None]:
        """Validate file exists. Returns (is_valid, error_response)."""
        if not safe_path or not safe_path.is_file():
            return False, json_message("File not found", status_code=404)
        return True, None

    def _fire_update(self, action: str, path: str | None = None):
        """Fire a websocket update event (thread-safe)."""
        # 🔒 THREAD SAFETY: Protect cache invalidation from race conditions
        with self._cache_lock:
            # Invalidate both caches on any change
            self._file_cache = {}

        if self.hass:
            # Use add_job to ensure async_fire is called on the event loop
            # even if this method is called from a ThreadPoolExecutor
            self.hass.add_job(
                self.hass.bus.async_fire,
                "blueprint_studio_update",
                {
                    "action": action,
                    "path": path,
                    "timestamp": time.time()
                }
            )

    def clear_cache(self):
        """Safely clear the file cache (thread-safe)."""
        with self._cache_lock:
            self._file_cache = {}
            self._last_cache_update = 0

    def subscribe_to_ha_events(self) -> None:
        """Listen for HA filesystem events and invalidate the cache immediately.

        HA fires 'folder_watcher' events when files in config_dir change.
        This is more responsive than waiting for the 30s TTL to expire.
        """
        if not self.hass:
            return

        def _on_folder_watcher(event) -> None:
            """Invalidate cache on any file-system change detected by HA."""
            _LOGGER.debug(
                "FileManager: folder_watcher event received (%s), invalidating cache",
                event.data.get("event_type", "unknown"),
            )
            self._fire_update("external_change", event.data.get("path"))

        self.hass.bus.async_listen("folder_watcher", _on_folder_watcher)
        _LOGGER.debug("FileManager: subscribed to folder_watcher events for cache invalidation")

    def get_tree_snapshot(self, show_hidden: bool = False) -> dict:
        """Return a lightweight signature for visible file-tree contents."""
        root_dir = self._get_root_dir()
        digest = hashlib.blake2b(digest_size=16)
        count = 0
        latest_mtime = 0

        for root, dirs, files in os.walk(root_dir):
            if not show_hidden:
                dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS and not d.startswith(".")]
            else:
                dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS]

            rel_root = Path(root).relative_to(root_dir)

            for name in sorted(dirs):
                item_path = Path(root) / name
                rel_path = str(rel_root / name if str(rel_root) != "." else name)
                try:
                    stat_result = item_path.stat()
                except OSError:
                    continue
                digest.update(f"d:{rel_path}:{stat_result.st_mtime_ns}".encode("utf-8", "surrogateescape"))
                count += 1
                latest_mtime = max(latest_mtime, stat_result.st_mtime_ns)

            for name in sorted(files):
                if (not show_hidden and name.startswith(".")):
                    continue
                item_path = Path(root) / name
                if not self._is_listed_file(item_path):
                    continue
                rel_path = str(rel_root / name if str(rel_root) != "." else name)
                try:
                    stat_result = item_path.stat()
                except OSError:
                    continue
                digest.update(
                    f"f:{rel_path}:{stat_result.st_mtime_ns}:{stat_result.st_size}".encode(
                        "utf-8", "surrogateescape"
                    )
                )
                count += 1
                latest_mtime = max(latest_mtime, stat_result.st_mtime_ns)

        return {
            "success": True,
            "signature": digest.hexdigest(),
            "count": count,
            "latest_mtime": latest_mtime,
        }

    def list_files(self, show_hidden: bool = False) -> list[dict]:
        """List files recursively."""
        res = []
        root_dir = self._get_root_dir()
        for root, dirs, files in os.walk(root_dir):
            if not show_hidden: dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS and not d.startswith(".")]
            else: dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS]
            rel_root = Path(root).relative_to(root_dir)
            for name in sorted(files):
                file_path = Path(root) / name
                if (not show_hidden and name.startswith(".")) or not self._is_listed_file(file_path): continue
                res.append({"path": str(rel_root / name if str(rel_root) != "." else name), "name": name, "type": "file"})
        return sorted(res, key=lambda x: x["path"])

    def list_all(self, show_hidden: bool = False, force: bool = False) -> list[dict]:
        """List all files and folders."""
        # 🔒 THREAD SAFETY: Acquire lock to prevent concurrent access corruption
        # This is the DEFINITIVE FIX for Python 3.13 race condition issues
        with self._cache_lock:
            # 🛡️ ULTRA-DEFENSIVE: Ensure cache attributes exist (handles None, missing attrs, etc.)
            # This fixes the "argument of type 'NoneType' is not iterable" error from logs
            if not hasattr(self, '_file_cache') or self._file_cache is None or not isinstance(self._file_cache, dict):
                _LOGGER.warning("File cache was corrupted or None (type: %s), reinitializing...",
                              type(getattr(self, '_file_cache', None)).__name__)
                self._file_cache = {}
                self._last_cache_update = 0

            # Defensive: Ensure _last_cache_update is a valid number
            if not hasattr(self, '_last_cache_update') or not isinstance(self._last_cache_update, (int, float)):
                _LOGGER.warning("Cache timestamp was corrupted (type: %s), reinitializing...",
                              type(getattr(self, '_last_cache_update', None)).__name__)
                self._file_cache = {}
                self._last_cache_update = 0

            # Get root directory
            root_dir = self._get_root_dir()

            # Use cache if available and not too old (30s TTL as fallback) and not forced
            cache_key = show_hidden
            if not force and cache_key in self._file_cache and (time.time() - self._last_cache_update < 30):
                return self._file_cache[cache_key]

            # 🛡️ CRITICAL FIX: Wrap entire filesystem operation in try-except
            # Prevents HTTP 500 crashes from permission errors, corrupted files, symlink loops, etc.
            try:
                res = []
                file_count = 0
                max_files = 50000  # Safety limit to prevent memory exhaustion
                max_depth = 20  # Limit recursion depth

                for root, dirs, files in os.walk(root_dir):
                    # Calculate current depth
                    try:
                        depth = len(Path(root).relative_to(root_dir).parts)
                    except (ValueError, OSError):
                        depth = 0

                    # Safety: Stop if we've scanned too many files
                    if file_count >= max_files:
                        _LOGGER.warning(
                            "Hit file count limit (%d files) during scan - stopping early. "
                            "Some files may not be visible. Consider excluding large directories.",
                            max_files
                        )
                        break

                    # Safety: Don't recurse too deep (prevents symlink loops and performance issues)
                    if depth >= max_depth:
                        dirs[:] = []  # Don't recurse deeper
                        continue
                    # 🛡️ DEFENSIVE: Handle corrupted os.walk() results (dirs/files should never be None)
                    if dirs is None or files is None:
                        _LOGGER.error("os.walk() returned None for dirs or files in %s - filesystem corruption?", root)
                        continue  # Skip this directory

                    # Control recursion and filter directories
                    all_exclusions = EXCLUDED_PATTERNS

                    if not show_hidden:
                        dirs[:] = [d for d in dirs if d not in all_exclusions and not d.startswith(".")]
                    else:
                        dirs[:] = [d for d in dirs if d not in all_exclusions]

                    rel_root = Path(root).relative_to(root_dir)
                    for name in sorted(dirs):
                        try:
                            dir_path = Path(root) / name
                            is_symlink = dir_path.is_symlink()
                            symlink_target = None
                            if is_symlink:
                                try:
                                    symlink_target = str(dir_path.readlink())
                                except (OSError, ValueError):
                                    symlink_target = None
                            size = self._get_dir_size(dir_path)
                        except Exception as e:
                            _LOGGER.debug("Failed to get size for directory %s: %s", name, e)
                            size = 0
                            is_symlink = False
                            symlink_target = None

                        folder_data = {"path": str(rel_root / name if str(rel_root) != "." else name), "name": name, "type": "folder", "size": size}
                        if is_symlink:
                            folder_data["isSymlink"] = True
                            if symlink_target:
                                folder_data["symlinkTarget"] = symlink_target
                        res.append(folder_data)

                    for name in sorted(files):
                        # Safety: Check file count limit
                        file_count += 1
                        if file_count > max_files:
                            break

                        file_path = Path(root) / name
                        if (not show_hidden and name.startswith(".")) or not self._is_listed_file(file_path): continue

                        try:
                            is_symlink = file_path.is_symlink()
                            symlink_target = None
                            if is_symlink:
                                try:
                                    symlink_target = str(file_path.readlink())
                                except (OSError, ValueError):
                                    symlink_target = None
                            size = file_path.stat().st_size
                        except OSError as e:
                            _LOGGER.debug("Failed to stat file %s: %s", name, e)
                            size = 0
                            is_symlink = False
                            symlink_target = None

                        file_data = {"path": str(rel_root / name if str(rel_root) != "." else name), "name": name, "type": "file", "size": size}
                        if is_symlink:
                            file_data["isSymlink"] = True
                            if symlink_target:
                                file_data["symlinkTarget"] = symlink_target
                        res.append(file_data)

                # Save to cache
                self._file_cache[cache_key] = sorted(res, key=lambda x: x["path"])
                self._last_cache_update = time.time()

                return self._file_cache[cache_key]

            except Exception as e:
                # 🚨 CRITICAL ERROR: Filesystem operation failed completely
                _LOGGER.error(
                    "CRITICAL: list_all() failed with filesystem error: %s (type: %s)\n"
                    "Config dir: %s\n"
                    "This usually indicates:\n"
                    "  1. Permission issues reading config directory\n"
                    "  2. Corrupted filesystem or symlink loops\n"
                    "  3. Network mount timeout (if config is on network storage)\n"
                    "  4. Disk full or I/O errors\n"
                    "Please check Home Assistant logs and fix filesystem issues.",
                    str(e), type(e).__name__, self.config_dir
                )

                # Return cached data if available (degraded mode)
                if cache_key in self._file_cache:
                    _LOGGER.warning("Returning stale cached data due to filesystem error")
                    return self._file_cache[cache_key]

                # Last resort: return empty list to prevent HTTP 500
                _LOGGER.error("No cache available - returning empty file list!")
                return []

    def list_directory(self, path: str = "", show_hidden: bool = False) -> dict:
        """
        List contents of a single directory (non-recursive) - LAZY LOADING.
        This is much faster than list_all() as it only lists one folder.

        Args:
            path: Relative path to directory (empty string = root)
            show_hidden: Whether to show hidden files/folders

        Returns:
            {
                "path": "relative/path",
                "folders": [{"name": "folder1", "path": "relative/path/folder1", "size": 0}],
                "files": [{"name": "file.yaml", "path": "relative/path/file.yaml", "size": 1234}]
            }
        """
        try:
            # Get root directory
            root_dir = self._get_root_dir()

            # Get safe path (validates path is allowed)
            if path:
                # Use root_dir as base for path resolution
                target_path = get_safe_path(root_dir, path)
                if target_path is None:
                    _LOGGER.error("Path blocked by safety check: %s", path)
                    return {"path": path, "folders": [], "files": [], "error": f"Access denied: {path}"}
            else:
                # Empty path = root directory
                target_path = root_dir

            if not target_path or not target_path.exists():
                return {"path": path, "folders": [], "files": [], "error": "Directory not found"}

            if not target_path.is_dir():
                return {"path": path, "folders": [], "files": [], "error": "Not a directory"}

            folders = []
            files = []

            # Standard exclusions only
            all_exclusions = EXCLUDED_PATTERNS

            # List directory contents (NON-RECURSIVE - just immediate children)
            for item in sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                item_name = item.name

                # Skip hidden files if not showing hidden
                if not show_hidden and item_name.startswith("."):
                    continue

                # Skip excluded patterns
                if item_name in all_exclusions:
                    continue

                # Calculate relative path
                try:
                    if path:
                        rel_path = f"{path}/{item_name}"
                    else:
                        # Root level - relative to root_dir
                        rel_path = str(item.relative_to(root_dir))
                except (ValueError, OSError):
                    rel_path = item_name

                try:
                    # Check if item is a symlink
                    is_symlink = item.is_symlink()
                    symlink_target = None
                    if is_symlink:
                        try:
                            # Get symlink target (relative or absolute)
                            symlink_target = str(item.readlink())
                        except (OSError, ValueError, AttributeError):
                            try:
                                import os
                                symlink_target = os.readlink(str(item))
                            except OSError:
                                symlink_target = None
                    if item.is_dir():
                        # Count immediate children for folder badge (fast)
                        try:
                            child_count = sum(1 for _ in item.iterdir())
                        except (PermissionError, OSError):
                            child_count = 0

                        folder_data = {
                            "name": item_name,
                            "path": rel_path,
                            "size": 0,  # Don't calculate size for lazy loading (too slow)
                            "childCount": child_count
                        }
                        if is_symlink:
                            folder_data["isSymlink"] = True
                            if symlink_target:
                                folder_data["symlinkTarget"] = symlink_target
                        folders.append(folder_data)
                    elif item.is_file():
                        # Check if file is allowed for listing (symlinks always shown regardless of extension)
                        if is_symlink or self._is_listed_file(item):
                            try:
                                size = item.stat().st_size
                            except (PermissionError, OSError):
                                size = 0

                            file_data = {
                                "name": item_name,
                                "path": rel_path,
                                "size": size,
                                "type": "file"
                            }
                            if is_symlink:
                                file_data["isSymlink"] = True
                                if symlink_target:
                                    file_data["symlinkTarget"] = symlink_target
                            files.append(file_data)
                    elif is_symlink:
                        # Broken symlink - show it as a file with broken indicator
                        files.append({
                            "name": item_name,
                            "path": rel_path,
                            "size": 0,
                            "type": "file",
                            "isSymlink": True,
                            "symlinkTarget": symlink_target or "",
                            "isBroken": True
                        })
                except (PermissionError, OSError) as e:
                    _LOGGER.debug("Permission denied or error accessing %s: %s", item, e)
                    continue

            return {
                "path": path,
                "folders": folders,
                "files": files
            }

        except PermissionError:
            _LOGGER.warning("Permission denied accessing directory: %s", path)
            return {"path": path, "folders": [], "files": [], "error": "Permission denied"}
        except Exception as e:
            _LOGGER.error("list_directory() failed for path '%s': %s", path, e)
            return {"path": path, "folders": [], "files": [], "error": str(e)}

    def list_git_files(self) -> list[dict]:
        """List all files for git management."""
        try:
            res = []
            for root, dirs, files in os.walk(self.config_dir):
                if ".git" in dirs: dirs.remove(".git")
                rel_root = Path(root).relative_to(self.config_dir)
                for name in sorted(dirs):
                    try:
                        size = self._get_dir_size(Path(root) / name)
                    except Exception as e:
                        _LOGGER.debug("Failed to get size for directory %s: %s", name, e)
                        size = 0
                    res.append({"path": str(rel_root / name if str(rel_root) != "." else name), "name": name, "type": "folder", "size": size})
                for name in sorted(files):
                    file_path = Path(root) / name
                    try: size = file_path.stat().st_size
                    except OSError: size = 0
                    res.append({"path": str(rel_root / name if str(rel_root) != "." else name), "name": name, "type": "file", "size": size})
            return sorted(res, key=lambda x: x["path"])
        except Exception as e:
            _LOGGER.error("list_git_files() failed with filesystem error: %s", e)
            return []  # Return empty list instead of crashing

    def global_search(self, query: str, case_sensitive: bool = False, use_regex: bool = False, match_word: bool = False, include: str = "", exclude: str = "") -> list[dict]:
        """Perform global search across allowed config files."""
        import re
        import fnmatch
        import concurrent.futures

        results = []
        try:
            # Prepare pattern
            flags = 0 if case_sensitive else re.IGNORECASE
            search_pattern = query
            if not use_regex:
                search_pattern = re.escape(query)
            if match_word:
                search_pattern = rf"\b{search_pattern}\b"
            
            pattern = re.compile(search_pattern, flags)

            # Prepare include/exclude filters
            include_patterns = [p.strip() for p in include.split(',') if p.strip()]
            exclude_patterns = [p.strip() for p in exclude.split(',') if p.strip()]

            # Collect files first
            search_files = []
            root_dir = self._get_root_dir()
            for root, dirs, files in os.walk(root_dir):
                dirs[:] = [d for d in dirs if not d.startswith(".") and d not in EXCLUDED_PATTERNS]
                for name in files:
                    file_path = Path(root) / name
                    rel_path = str(file_path.relative_to(root_dir))

                    # 1. Skip binary files (not searchable)
                    if file_path.suffix.lower() in BINARY_EXTENSIONS: continue

                    # 2. Filter Include
                    if include_patterns:
                        if not any(fnmatch.fnmatch(rel_path, p) or fnmatch.fnmatch(name, p) for p in include_patterns):
                            continue
                    
                    # 3. Filter Exclude
                    if exclude_patterns:
                        if any(fnmatch.fnmatch(rel_path, p) or fnmatch.fnmatch(name, p) for p in exclude_patterns):
                            continue
                    
                    search_files.append((file_path, rel_path))

            # Helper for single file search
            def search_single_file(args):
                f_path, r_path = args
                local_results = []
                try:
                    with open(f_path, "r", encoding="utf-8", errors="ignore") as f:
                        for i, line in enumerate(f):
                            if pattern.search(line):
                                local_results.append({
                                    "path": r_path,
                                    "line": i + 1,
                                    "content": line.strip()
                                })
                                if len(local_results) > 100: break # Limit matches per file
                except (OSError, UnicodeDecodeError) as e:
                    _LOGGER.debug("Search skipped %s: %s", r_path, e)

            # Execute in parallel
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                futures = [executor.submit(search_single_file, f) for f in search_files]
                for future in concurrent.futures.as_completed(futures):
                    res = future.result()
                    if res:
                        results.extend(res)
                        if len(results) >= 2000: break # Hard limit total results

        except Exception as e:
            _LOGGER.error("Global search error: %s", e)
        return results[:2000]

    async def global_search_stream(self, request: web.Request, query: str, case_sensitive: bool = False,
                                    use_regex: bool = False, match_word: bool = False,
                                    include: str = "", exclude: str = "") -> web.StreamResponse:
        """Stream global search results as NDJSON (newline-delimited JSON).

        Results are written to the response as each file is searched, so the
        frontend receives and renders matches immediately rather than waiting
        for the full scan to complete.
        """
        import json as _json
        import re as _re
        import fnmatch as _fnmatch

        response = web.StreamResponse()
        response.content_type = "application/x-ndjson"
        response.headers["Cache-Control"] = "no-cache"
        await response.prepare(request)

        try:
            flags = 0 if case_sensitive else _re.IGNORECASE
            search_pattern = query if use_regex else _re.escape(query)
            if match_word:
                search_pattern = rf"\b{search_pattern}\b"
            pattern = _re.compile(search_pattern, flags)

            include_patterns = [p.strip() for p in include.split(",") if p.strip()]
            exclude_patterns = [p.strip() for p in exclude.split(",") if p.strip()]

            root_dir = self._get_root_dir()

            def _collect_files():
                collected = []
                for root, dirs, files in os.walk(root_dir):
                    dirs[:] = [d for d in dirs if not d.startswith(".") and d not in EXCLUDED_PATTERNS]
                    for name in files:
                        file_path = Path(root) / name
                        rel_path = str(file_path.relative_to(root_dir))
                        if file_path.suffix.lower() in BINARY_EXTENSIONS:
                            continue
                        if include_patterns and not any(_fnmatch.fnmatch(rel_path, p) or _fnmatch.fnmatch(name, p) for p in include_patterns):
                            continue
                        if exclude_patterns and any(_fnmatch.fnmatch(rel_path, p) or _fnmatch.fnmatch(name, p) for p in exclude_patterns):
                            continue
                        collected.append((file_path, rel_path))
                return collected

            search_files = await self.hass.async_add_executor_job(_collect_files)

            def search_single_file(args):
                f_path, r_path = args
                local_results = []
                try:
                    with open(f_path, "r", encoding="utf-8", errors="ignore") as f:
                        for i, line in enumerate(f):
                            if pattern.search(line):
                                local_results.append({
                                    "path": r_path,
                                    "line": i + 1,
                                    "content": line.strip()
                                })
                                if len(local_results) >= 100:
                                    break
                except (OSError, UnicodeDecodeError):
                    pass
                return local_results

            total_sent = 0
            max_results = 2000

            loop = asyncio.get_event_loop()
            futures = [loop.run_in_executor(None, search_single_file, f) for f in search_files]
            for coro in asyncio.as_completed(futures):
                if total_sent >= max_results:
                    break
                file_results = await coro
                if not file_results:
                    continue
                for result in file_results:
                    if total_sent >= max_results:
                        break
                    line = _json.dumps(result) + "\n"
                    await response.write(line.encode())
                    total_sent += 1

        except Exception as e:
            _LOGGER.error("Streaming search error: %s", e)

        await response.write_eof()
        return response

    def global_replace(self, query: str, replacement: str, case_sensitive: bool = False, use_regex: bool = False, match_word: bool = False, include: str = "", exclude: str = "") -> dict:
        """Perform global find and replace across files."""
        import re
        import fnmatch
        import concurrent.futures

        files_updated = 0
        occurrences = 0
        
        try:
            flags = 0 if case_sensitive else re.IGNORECASE
            search_pattern = query
            if not use_regex:
                search_pattern = re.escape(query)
            if match_word:
                search_pattern = rf"\b{search_pattern}\b"
            
            pattern = re.compile(search_pattern, flags)

            include_patterns = [p.strip() for p in include.split(',') if p.strip()]
            exclude_patterns = [p.strip() for p in exclude.split(',') if p.strip()]

            # Collect files
            target_files = []
            root_dir = self._get_root_dir()
            for root, dirs, files in os.walk(root_dir):
                dirs[:] = [d for d in dirs if not d.startswith(".") and d not in EXCLUDED_PATTERNS]
                for name in files:
                    file_path = Path(root) / name
                    rel_path = str(file_path.relative_to(root_dir))

                    if file_path.suffix.lower() in BINARY_EXTENSIONS: continue
                    if rel_path in PROTECTED_PATHS: continue

                    if include_patterns:
                        if not any(fnmatch.fnmatch(rel_path, p) or fnmatch.fnmatch(name, p) for p in include_patterns):
                            continue
                    if exclude_patterns:
                        if any(fnmatch.fnmatch(rel_path, p) or fnmatch.fnmatch(name, p) for p in exclude_patterns):
                            continue
                    
                    target_files.append((file_path, rel_path))

            # Helper for single file replace
            def replace_single_file(args):
                f_path, r_path = args
                try:
                    content = f_path.read_text("utf-8")
                    if pattern.search(content):
                        new_content, count = pattern.subn(replacement, content)
                        if count > 0:
                            f_path.write_text(new_content, "utf-8")
                            return (r_path, count)
                except (OSError, UnicodeDecodeError) as e:
                    _LOGGER.debug("Replace skipped %s: %s", r_path, e)

            # Execute in parallel
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                futures = [executor.submit(replace_single_file, f) for f in target_files]
                for future in concurrent.futures.as_completed(futures):
                    res = future.result()
                    if res:
                        r_path, count = res
                        files_updated += 1
                        occurrences += count
                        self._fire_update("write", r_path)

            return {"success": True, "files_updated": files_updated, "occurrences": occurrences}
        except Exception as e:
            return {"success": False, "message": str(e)}

    async def read_file(self, path: str, optional: bool = False) -> web.Response:
        """Read file content."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path or not safe_path.is_file():
            if optional:
                return json_response({"content": None, "is_base64": False, "missing": True})
            return json_message("File not found", status_code=404)
        try:
            if safe_path.suffix.lower() in BINARY_EXTENSIONS:
                content = await self.hass.async_add_executor_job(safe_path.read_bytes)
                return json_response({"content": base64.b64encode(content).decode(), "is_base64": True, "mime_type": mimetypes.guess_type(safe_path.name)[0] or "application/octet-stream", "mtime": safe_path.stat().st_mtime})
            # Hard backend limit for text files — only blocks truly extreme sizes.
            # The frontend handles the 2–10 MB range with its own warning dialog
            # that lets the user choose to open anyway. This guard is a safety net
            # for files so large they would crash the server response or the browser
            # regardless of user intent.
            max_text_size = 10 * 1024 * 1024  # 10 MB
            file_size = safe_path.stat().st_size
            if file_size > max_text_size:
                return json_message(
                    f"File is too large to open in the editor ({file_size // 1024} KB). "
                    f"Maximum supported size for text files is {max_text_size // 1024} KB.",
                    status_code=413,
                )
            content = await self.hass.async_add_executor_job(safe_path.read_text, "utf-8")
            return json_response({"content": content, "is_base64": False, "mime_type": mimetypes.guess_type(safe_path.name)[0] or "text/plain;charset=utf-8", "mtime": safe_path.stat().st_mtime})
        except Exception as e: return json_message(str(e), status_code=500)

    async def serve_file(self, path: str) -> web.StreamResponse:
        """Serve raw file content using zero-copy FileResponse with Range support."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path or not safe_path.is_file():
            return web.Response(status=404, text="File not found")
        headers = {"Content-Disposition": f'inline; filename="{safe_path.name}"'}
        return web.FileResponse(safe_path, headers=headers)

    async def get_file_stat(self, path: str) -> web.Response:
        """Get file statistics."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path or not safe_path.is_file(): return json_message("File not found", status_code=404)
        try:
            stat = safe_path.stat()
            return json_response({"success": True, "mtime": stat.st_mtime, "size": stat.st_size})
        except Exception as e: return json_message(str(e), status_code=500)

    async def write_file(self, path: str, content: str) -> web.Response:
        """Write file content."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path: return json_message("Not allowed", status_code=403)
        try:
            await self.hass.async_add_executor_job(safe_path.write_text, content, "utf-8")
            self._fire_update("write", path)
            return json_response({"success": True, "mtime": safe_path.stat().st_mtime})
        except Exception as e: return json_message(str(e), status_code=500)

    async def create_file(self, path: str, content: str, is_base64: bool = False, overwrite: bool = False) -> web.Response:
        """Create a new file."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path: return json_message("Not allowed", status_code=403)
        if safe_path.exists() and not overwrite: return json_message("Exists", status_code=409)
        try:
            # Create parent directories if they don't exist
            if not safe_path.parent.exists():
                await self.hass.async_add_executor_job(safe_path.parent.mkdir, 0o755, True, True)

            if is_base64: await self.hass.async_add_executor_job(safe_path.write_bytes, base64.b64decode(content))
            else: await self.hass.async_add_executor_job(safe_path.write_text, content, "utf-8")
            self._fire_update("create", path)
            return json_response({"success": True, "path": path})
        except Exception as e: return json_message(str(e), status_code=500)

    async def create_folder(self, path: str) -> web.Response:
        """Create a new folder."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path or safe_path.exists(): return json_message("Not allowed or exists", status_code=403)
        try:
            await self.hass.async_add_executor_job(safe_path.mkdir, 0o755, True, True)
            self._fire_update("create_folder", path)
            return json_response({"success": True, "path": path})
        except Exception as e: return json_message(str(e), status_code=500)

    async def delete(self, path: str) -> web.Response:
        """Delete a file or folder."""
        if self._is_protected(path): return json_message("Protected", status_code=403)
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path or not safe_path.exists() or safe_path == self._get_root_dir(): return json_message("Not found or not allowed", status_code=404)
        try:
            if safe_path.is_dir(): await self.hass.async_add_executor_job(shutil.rmtree, safe_path)
            else: await self.hass.async_add_executor_job(safe_path.unlink)
            self._fire_update("delete", path)
            return json_response({"success": True})
        except Exception as e: return json_message(str(e), status_code=500)

    async def delete_multi(self, paths: list[str]) -> web.Response:
        """Delete multiple files or folders."""
        for path in paths:
            if self._is_protected(path): continue # Skip protected
            safe_path = get_safe_path(self._get_root_dir(), path)
            if not safe_path or not safe_path.exists() or safe_path == self._get_root_dir(): continue
            try:
                if safe_path.is_dir(): await self.hass.async_add_executor_job(shutil.rmtree, safe_path)
                else: await self.hass.async_add_executor_job(safe_path.unlink)
            except Exception as e:
                _LOGGER.error("Error deleting %s: %s", path, e)
        
        self._fire_update("delete_multi")
        return json_response({"success": True})

    async def move_multi(self, paths: list[str], destination: str | None) -> web.Response:
        """Move multiple files or folders to a destination."""
        dest_folder = get_safe_path(self._get_root_dir(), destination or "")
        if not dest_folder or not dest_folder.is_dir():
            return json_message("Invalid destination", status_code=400)

        for path in paths:
            if self._is_protected(path): continue
            src = get_safe_path(self._get_root_dir(), path)
            if not src or not src.exists(): continue
            
            # Destination path: dest_folder / original_filename
            dest = dest_folder / src.name
            
            if dest.exists():
                _LOGGER.warning("Move skipped: %s already exists in %s", src.name, destination)
                continue

            try:
                await self.hass.async_add_executor_job(src.rename, dest)
            except Exception as e:
                _LOGGER.error("Error moving %s to %s: %s", path, destination, e)

        self._fire_update("move_multi")
        return json_response({"success": True})

    async def copy(self, source: str, destination: str, overwrite: bool = False) -> web.Response:
        """Copy a file or folder."""
        src, dest = get_safe_path(self._get_root_dir(), source), get_safe_path(self._get_root_dir(), destination)
        if not src or not dest or not src.exists(): return json_message("Invalid path", status_code=403)
        if dest.exists() and not overwrite: return json_message("Destination exists", status_code=409)
        try:
            if src.is_dir(): await self.hass.async_add_executor_job(shutil.copytree, src, dest)
            else: await self.hass.async_add_executor_job(shutil.copy2, src, dest)
            self._fire_update("copy", destination)
            return json_response({"success": True, "path": destination})
        except Exception as e: return json_message(str(e), status_code=500)

    async def rename(self, source: str, destination: str, overwrite: bool = False) -> web.Response:
        """Rename a file or folder."""
        if self._is_protected(source): return json_message("Protected", status_code=403)
        src, dest = get_safe_path(self._get_root_dir(), source), get_safe_path(self._get_root_dir(), destination)
        if not src or not dest or not src.exists(): return json_message("Invalid path", status_code=403)
        if dest.exists() and not overwrite: return json_message("Destination exists", status_code=409)
        try:
            await self.hass.async_add_executor_job(src.rename, dest)
            self._fire_update("rename", destination)
            return json_response({"success": True, "path": destination})
        except Exception as e: return json_message(str(e), status_code=500)

    async def download_folder(self, path: str, request: web.Request) -> web.StreamResponse:
        """Download folder as ZIP via streaming response."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path or not safe_path.is_dir():
            return json_message("Not found", status_code=404)
        return await self._stream_zip_response(
            request,
            f'{safe_path.name}.zip',
            lambda write_chunk: self._write_folder_zip(safe_path, write_chunk),
        )

    async def download_multi(self, paths: list[str], request: web.Request) -> web.StreamResponse:
        """Download multiple items as ZIP via streaming response."""
        return await self._stream_zip_response(
            request,
            "download.zip",
            lambda write_chunk: self._write_multi_zip(paths, write_chunk),
        )

    async def _stream_zip_response(self, request: web.Request, filename: str, zip_writer) -> web.StreamResponse:
        """Stream a ZIP response generated by *zip_writer* without buffering it."""
        loop = asyncio.get_running_loop()
        chunks: queue.Queue[bytes | None] = queue.Queue(maxsize=8)
        result_holder: dict[str, Any] = {}
        stopped = threading.Event()

        def write_chunk(chunk: bytes) -> None:
            while not stopped.is_set():
                try:
                    chunks.put(bytes(chunk), timeout=0.5)
                    return
                except queue.Full:
                    continue
            raise RuntimeError("ZIP stream cancelled")

        def worker() -> None:
            try:
                zip_writer(write_chunk)
                result_holder["success"] = True
            except Exception as exc:
                result_holder["success"] = False
                result_holder["error"] = exc
                _LOGGER.error("ZIP stream generation failed: %s", exc, exc_info=True)
            finally:
                while not stopped.is_set():
                    try:
                        chunks.put(None, timeout=0.5)
                        return
                    except queue.Full:
                        continue

        thread = threading.Thread(target=worker, name="blueprint-local-zip-stream", daemon=True)
        thread.start()

        try:
            first_chunk = await loop.run_in_executor(None, chunks.get)
            if first_chunk is None:
                thread.join(timeout=1)
                if not result_holder.get("success"):
                    return json_message(str(result_holder.get("error", "ZIP stream failed")), status_code=500)
                first_chunk = b""

            response = web.StreamResponse(headers={
                "Content-Type": "application/zip",
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-store",
            })
            await response.prepare(request)
            if first_chunk:
                await response.write(first_chunk)

            while True:
                chunk = await loop.run_in_executor(None, chunks.get)
                if chunk is None:
                    break
                await response.write(chunk)

            thread.join(timeout=1)
            if not result_holder.get("success"):
                _LOGGER.error("ZIP stream ended with error: %s", result_holder.get("error"))
            await response.write_eof()
            return response
        finally:
            stopped.set()

    def _write_folder_zip(self, folder_path: Path, write_chunk) -> None:
        """Write a folder ZIP incrementally to *write_chunk*."""
        with zipfile.ZipFile(_ZipChunkWriter(write_chunk), "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(folder_path):
                dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS and not d.startswith(".")]
                for f in files:
                    if f.startswith("."):
                        continue
                    file_path = Path(root) / f
                    zf.write(file_path, file_path.relative_to(folder_path))

    def _write_multi_zip(self, paths: list[str], write_chunk) -> None:
        """Write a multi-item ZIP incrementally to *write_chunk*."""
        with zipfile.ZipFile(_ZipChunkWriter(write_chunk), "w", zipfile.ZIP_DEFLATED) as zf:
            for p in paths:
                safe = get_safe_path(self._get_root_dir(), p)
                if not safe or not safe.exists():
                    continue
                if safe.is_file():
                    zf.write(safe, safe.name)
                elif safe.is_dir():
                    for root, dirs, files in os.walk(safe):
                        dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS and not d.startswith(".")]
                        for f in files:
                            if f.startswith("."):
                                continue
                            file_path = Path(root) / f
                            zf.write(file_path, file_path.relative_to(safe.parent))

    def _create_zip(self, folder_path: Path) -> io.BytesIO:
        """Create ZIP from folder, returns BytesIO buffer."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(folder_path):
                dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS and not d.startswith(".")]
                for f in files:
                    if f.startswith("."): continue
                    zf.write(Path(root) / f, (Path(root) / f).relative_to(folder_path))
        buf.seek(0)
        return buf

    def _create_multi_zip(self, paths: list[str]) -> io.BytesIO:
        """Create ZIP from multiple paths, returns BytesIO buffer."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in paths:
                safe = get_safe_path(self._get_root_dir(), p)
                if not safe or not safe.exists(): continue
                if safe.is_file():
                    zf.write(safe, safe.name)
                elif safe.is_dir():
                    for root, dirs, files in os.walk(safe):
                        dirs[:] = [d for d in dirs if d not in EXCLUDED_PATTERNS and not d.startswith(".")]
                        for f in files:
                            if f.startswith("."): continue
                            zf.write(Path(root) / f, (Path(root) / f).relative_to(safe.parent))
        buf.seek(0)
        return buf

    async def upload_file(self, path: str, content: str, overwrite: bool, is_base64: bool = False) -> web.Response:
        """Upload/create a file with content."""
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path: return json_message("Not allowed", status_code=403)
        if safe_path.exists() and not overwrite: return json_message("File already exists", status_code=409)
        try:
            if is_base64: await self.hass.async_add_executor_job(safe_path.write_bytes, base64.b64decode(content))
            else: await self.hass.async_add_executor_job(safe_path.write_text, content, "utf-8")
            self._fire_update("upload", path)
            return json_response({"success": True, "path": path})
        except Exception as e: return json_message(str(e), status_code=500)

    async def upload_folder(self, path: str, zip_data: str, mode: str = "merge", overwrite: bool = False) -> web.Response:
        """Upload ZIP and extract to folder. 
        Modes: 'merge' (default), 'replace' (deletes existing first)
        """
        safe_path = get_safe_path(self._get_root_dir(), path)
        if not safe_path: return json_message("Invalid path", status_code=400)

        # If it exists and we haven't confirmed a mode yet, return 409
        if safe_path.exists() and not overwrite:
            return json_response({
                "success": False, 
                "message": "Folder already exists",
                "folder_name": safe_path.name
            }, status_code=409)

        # Handle Replace mode: delete existing first
        if safe_path.exists() and mode == "replace":
            try:
                import shutil
                await self.hass.async_add_executor_job(shutil.rmtree, safe_path)
            except Exception as e:
                return json_message(f"Failed to clear existing folder: {str(e)}", status_code=500)

        # Create the folder
        if not safe_path.exists():
            try:
                await self.hass.async_add_executor_job(lambda: safe_path.mkdir(parents=True, exist_ok=True))
            except Exception as e:
                return json_message(f"Failed to create folder: {str(e)}", status_code=500)

        try:
            import io
            import zipfile
            zip_bytes = base64.b64decode(zip_data)
            buf = io.BytesIO(zip_bytes)
            files_extracted = 0
            with zipfile.ZipFile(buf) as zf:
                for member in zf.namelist():
                    # Skip macOS metadata files and folders
                    if "__MACOSX" in member or ".DS_Store" in member:
                        continue
                        
                    if not member.endswith("/"):
                        # Ensure parent directory exists for the member
                        target_path = safe_path / member
                        await self.hass.async_add_executor_job(lambda p=target_path: p.parent.mkdir(parents=True, exist_ok=True))
                        await self.hass.async_add_executor_job(zf.extract, member, safe_path)
                        files_extracted += 1
            self._fire_update("upload_folder", path)
            return json_response({"success": True, "files_extracted": files_extracted})
        except Exception as e: return json_message(str(e), status_code=500)
