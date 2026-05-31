"""SFTP Manager for Blueprint Studio."""
from __future__ import annotations

import io
import logging
import os
import stat
import base64
import mimetypes
import secrets
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable

_LOGGER = logging.getLogger(__name__)

from ..const import BINARY_EXTENSIONS, TEXT_EXTENSIONS


def _is_text_file(filename: str) -> bool:
    """Return True if the file extension is considered a text/edit-able file."""
    ext = os.path.splitext(filename)[1].lower()
    return ext in TEXT_EXTENSIONS


# ============================================================================
# SFTP Manager - Compression utilities
# ============================================================================

def _sftp_safe_exec(operation: str, operation_func: Callable) -> dict:
    """Unified SFTP operation executor - eliminates 70+ lines of try/except/finally."""
    try:
        return operation_func()
    except Exception as exc:
        _LOGGER.error("SFTP %s failed: %s", operation, exc)
        return {"success": False, "message": str(exc)}


class SftpManager:
    """SFTP client with connection pooling.

    Reuses authenticated connections to the same (host, port, username) to
    avoid redundant SSH handshakes.  Idle connections are cleaned up after
    ``_idle_timeout`` seconds.  The pool is capped at ``_max_pool_size``.
    """

    def __init__(self, config_dir=None):
        self._config_dir = config_dir
        self._pool: dict[tuple, dict] = {}  # key → {transport, sftp, last_used}
        self._pool_lock = threading.Lock()
        self._key_locks: dict[tuple, threading.Lock] = {}  # per-host serialization
        self._key_locks_lock = threading.Lock()  # protects _key_locks dict
        self._max_pool_size = 5
        self._idle_timeout = 300  # seconds
        self._stream_tokens: dict[str, dict] = {}
        self._stream_tokens_lock = threading.Lock()
        self._stream_token_ttl = 3600  # seconds

    # -- pool internals ------------------------------------------------------

    def _acquire(self, key: tuple, auth: dict):
        """Return a live (transport, sftp) for *key*, creating one if needed."""
        self._cleanup_stale()

        with self._pool_lock:
            entry = self._pool.pop(key, None)

        if entry is not None:
            transport = entry["transport"]
            sftp = entry["sftp"]
            if transport.is_active():
                _LOGGER.debug("SFTP pool: reusing connection to %s:%s@%s", *key)
                return transport, sftp
            # Dead connection – close quietly and fall through
            _LOGGER.debug("SFTP pool: cached connection dead, reconnecting")
            try:
                sftp.close()
            except Exception:
                pass
            try:
                transport.close()
            except Exception:
                pass

        _LOGGER.debug("SFTP pool: creating new connection to %s:%s@%s", *key)
        return self._make_client(key[0], key[1], key[2], auth)

    def _release(self, key: tuple, transport, sftp):
        """Return a healthy connection to the pool."""
        with self._pool_lock:
            if len(self._pool) >= self._max_pool_size:
                # Pool full – evict the oldest entry
                oldest_key = min(self._pool, key=lambda k: self._pool[k]["last_used"])
                evicted = self._pool.pop(oldest_key)
                _LOGGER.debug("SFTP pool: evicting connection to %s:%s@%s", *oldest_key)
                try:
                    evicted["sftp"].close()
                except Exception:
                    pass
                try:
                    evicted["transport"].close()
                except Exception:
                    pass

            self._pool[key] = {
                "transport": transport,
                "sftp": sftp,
                "last_used": time.monotonic(),
            }

    def _discard(self, key: tuple):
        """Close and remove a connection from the pool (after errors)."""
        with self._pool_lock:
            entry = self._pool.pop(key, None)
        if entry is not None:
            try:
                entry["sftp"].close()
            except Exception:
                pass
            try:
                entry["transport"].close()
            except Exception:
                pass

    def _cleanup_stale(self):
        """Close connections that have been idle longer than ``_idle_timeout``."""
        now = time.monotonic()
        stale: list[tuple] = []
        with self._pool_lock:
            for key, entry in list(self._pool.items()):
                if now - entry["last_used"] > self._idle_timeout:
                    stale.append(key)
            stale_entries = [self._pool.pop(k) for k in stale]

        for entry in stale_entries:
            _LOGGER.debug("SFTP pool: closing stale connection")
            try:
                entry["sftp"].close()
            except Exception:
                pass
            try:
                entry["transport"].close()
            except Exception:
                pass

    def close_all(self):
        """Close every pooled connection (for shutdown)."""
        with self._pool_lock:
            entries = list(self._pool.values())
            self._pool.clear()
        for entry in entries:
            try:
                entry["sftp"].close()
            except Exception:
                pass
            try:
                entry["transport"].close()
            except Exception:
                pass
        _LOGGER.info("SFTP pool: all connections closed")

    # -- streaming tokens ----------------------------------------------------

    def create_stream_token(self, host: str, port: int, username: str, auth: dict, path: str, stream_type: str = "file") -> dict:
        """Create a short-lived opaque token for GET-based media streaming."""
        token = secrets.token_urlsafe(32)
        expires_at = time.monotonic() + self._stream_token_ttl
        with self._stream_tokens_lock:
            self._stream_tokens[token] = {
                "host": host,
                "port": int(port),
                "username": username,
                "auth": auth,
                "path": path,
                "type": stream_type,
                "expires_at": expires_at,
            }
        return {
            "success": True,
            "stream_id": token,
            "expires_in": self._stream_token_ttl,
            "mime_type": "application/zip" if stream_type == "folder_zip" else mimetypes.guess_type(path)[0] or "application/octet-stream",
        }

    def get_stream_token(self, token: str) -> dict | None:
        """Return stream-token metadata and refresh its idle expiry."""
        now = time.monotonic()
        with self._stream_tokens_lock:
            stale = [key for key, value in self._stream_tokens.items() if value.get("expires_at", 0) <= now]
            for key in stale:
                self._stream_tokens.pop(key, None)

            value = self._stream_tokens.get(token)
            if not value:
                return None
            value["expires_at"] = now + self._stream_token_ttl
            return dict(value)

    # -- connection context manager ------------------------------------------

    def _get_key_lock(self, key: tuple) -> threading.Lock:
        """Get or create a per-host lock to serialize concurrent requests."""
        with self._key_locks_lock:
            if key not in self._key_locks:
                self._key_locks[key] = threading.Lock()
            return self._key_locks[key]

    @contextmanager
    def _get_connection(self, host: str, port: int, username: str, auth: dict):
        """Get a pooled or new SFTP connection.

        Serialized per (host, port, username) key to prevent SSH connection
        storms when the frontend fires multiple concurrent requests.
        """
        key = (host, int(port), username)
        lock = self._get_key_lock(key)
        lock.acquire()
        try:
            transport, sftp = self._acquire(key, auth)
            try:
                yield transport, sftp
            except Exception:
                # On error, destroy this connection (may be corrupted)
                self._discard(key)
                raise
            else:
                # Return to pool on success
                self._release(key, transport, sftp)
        finally:
            lock.release()

    def _known_hosts_path(self):
        """Return the path to the shared known_hosts file, or None if config_dir is unset."""
        if self._config_dir is None:
            return None
        import os
        return os.path.join(str(self._config_dir), ".ssh", "known_hosts")

    def _verify_host_key(self, transport, host: str, port: int):
        """Verify the server's host key against known_hosts (TOFU on first connect).

        Raises paramiko.SSHException if the key has changed since the last
        connection — this is the signal that a MITM may be present.
        Adds the key to known_hosts on first contact.
        """
        import paramiko

        known_hosts_path = self._known_hosts_path()
        server_key = transport.get_remote_server_key()
        host_id = f"[{host}]:{port}" if port != 22 else host

        if known_hosts_path is None:
            _LOGGER.warning(
                "SFTP: no config_dir set — cannot verify host key for %s. "
                "Proceeding without verification.",
                host_id,
            )
            return

        # Load existing known_hosts (file may not exist yet)
        host_keys = paramiko.HostKeys()
        try:
            host_keys.load(known_hosts_path)
        except FileNotFoundError:
            pass  # first run — file will be created below
        except Exception as exc:
            _LOGGER.warning("SFTP: could not load known_hosts (%s): %s", known_hosts_path, exc)

        key_type = server_key.get_name()
        existing = host_keys.lookup(host_id)

        if existing and key_type in existing:
            # Host is known — verify the key matches
            if existing[key_type] != server_key:
                raise paramiko.SSHException(
                    f"WARNING: Host key for '{host_id}' has changed! "
                    "This may indicate a man-in-the-middle attack. "
                    "If the server was legitimately re-keyed, remove its entry from "
                    f"{known_hosts_path} and reconnect."
                )
            _LOGGER.debug("SFTP: host key verified for %s", host_id)
        else:
            # First time seeing this host — trust and record (TOFU)
            _LOGGER.info(
                "SFTP: new host %s — trusting %s key (fingerprint: %s). "
                "Future connections will verify against this key.",
                host_id,
                key_type,
                server_key.get_fingerprint().hex(),
            )
            host_keys.add(host_id, key_type, server_key)
            try:
                import os
                os.makedirs(os.path.dirname(known_hosts_path), mode=0o700, exist_ok=True)
                host_keys.save(known_hosts_path)
            except Exception as exc:
                _LOGGER.warning("SFTP: could not save known_hosts: %s", exc)

    def _make_client(self, host: str, port: int, username: str, auth: dict):
        """Open and return a (transport, sftp_client) pair.

        The caller is responsible for closing both objects when done.
        Raises on connection / authentication failure.
        """
        import paramiko  # lazy import – installed by HA requirements

        _LOGGER.info(
            "Blueprint Studio SFTP: connecting to %s:%s as %s. Credentials are NOT logged.",
            host, port, username,
        )

        transport = paramiko.Transport((host, int(port)))
        transport.connect()  # bare TCP connect first

        # Verify host key before authenticating (TOFU on first connect, strict thereafter)
        self._verify_host_key(transport, host, int(port))

        # Authenticate
        auth_type = auth.get("type", "password")
        if auth_type == "password":
            transport.auth_password(username, auth.get("password", ""))
        else:
            key_text = auth.get("private_key", "")
            passphrase = auth.get("passphrase") or None
            # Try RSA first, then Ed25519, then ECDSA, then DSS
            pkey = None
            for key_class_name in ("RSAKey", "Ed25519Key", "ECDSAKey", "DSSKey"):
                try:
                    key_class = getattr(paramiko, key_class_name)
                    pkey = key_class.from_private_key(
                        io.StringIO(key_text), password=passphrase
                    )
                    break
                except Exception:
                    continue
            if pkey is None:
                raise ValueError("Could not parse private key (tried RSA, Ed25519, ECDSA, DSS)")
            transport.auth_publickey(username, pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)
        return transport, sftp

    # -------------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------------

    def test_connection(self, host: str, port: int, username: str, auth: dict) -> dict:
        """Test connectivity and authentication. Returns {success, message}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                sftp.listdir("/")
                return {"success": True, "message": f"Connected to {host}:{port} as {username}"}
        return _sftp_safe_exec("test_connection", op)

    def list_directory(self, host: str, port: int, username: str, auth: dict, path: str, show_hidden: bool = False) -> dict:
        """List a remote directory. Returns {success, folders, files}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                try:
                    entries = sftp.listdir_attr(path)
                except FileNotFoundError:
                    _LOGGER.debug("SFTP list_directory: path not found: %s", path)
                    return {"success": False, "message": f"Path not found: {path}"}
                folders, files = [], []
                for entry in sorted(entries, key=lambda e: e.filename.lower()):
                    if not show_hidden and entry.filename.startswith("."):
                        continue
                    is_dir = stat.S_ISDIR(entry.st_mode)
                    item = {"name": entry.filename, "path": os.path.join(path, entry.filename).replace("\\", "/"), "size": entry.st_size or 0}
                    if is_dir:
                        folders.append(item)
                    else:
                        item["is_text"] = _is_text_file(entry.filename)
                        item["is_binary"] = os.path.splitext(entry.filename)[1].lower() in BINARY_EXTENSIONS
                        files.append(item)
                return {"success": True, "folders": folders, "files": files, "path": path}
        return _sftp_safe_exec("list_directory", op)

    def read_file(self, host: str, port: int, username: str, auth: dict, path: str) -> dict:
        """Read a remote file. Returns {success, content, is_base64, mime_type}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                ext = os.path.splitext(path)[1].lower()
                is_binary = ext in BINARY_EXTENSIONS
                with sftp.open(path, "rb" if is_binary else "r") as fh:
                    content = fh.read()
                attr = sftp.stat(path)
                mime_type = mimetypes.guess_type(path)[0]
                if is_binary:
                    return {"success": True, "content": base64.b64encode(content).decode(), "is_base64": True, "mime_type": mime_type or "application/octet-stream", "mtime": attr.st_mtime}
                if isinstance(content, bytes):
                    content = content.decode("utf-8", errors="replace")
                return {"success": True, "content": content, "is_base64": False, "mime_type": mime_type or "text/plain;charset=utf-8", "mtime": attr.st_mtime}
        return _sftp_safe_exec("read_file", op)

    def write_file(self, host: str, port: int, username: str, auth: dict, path: str, content: str) -> dict:
        """Write content to a remote file. Returns {success}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                encoded = content.encode("utf-8") if isinstance(content, str) else content
                with sftp.open(path, "w") as fh:
                    fh.write(encoded)
                return {"success": True}
        return _sftp_safe_exec("write_file", op)

    def create_file(self, host: str, port: int, username: str, auth: dict, path: str, content: str = "", overwrite: bool = False, is_base64: bool = False) -> dict:
        """Create a new remote file. Returns {success}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                if not overwrite:
                    try:
                        sftp.stat(path)
                        return {"success": False, "message": f"File already exists: {path}", "status_code": 409}
                    except FileNotFoundError:
                        pass

                # Determine mode and data
                mode = "wb" if is_base64 else "w"
                data = base64.b64decode(content) if is_base64 else content

                with sftp.open(path, mode) as fh:
                    fh.write(data)
                return {"success": True}
        return _sftp_safe_exec("create_file", op)

    def create_file_raw(self, host: str, port: int, username: str, auth: dict, path: str, data: bytes, overwrite: bool = False) -> dict:
        """Create a remote file from raw bytes (no base64). Used by multipart upload."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                if not overwrite:
                    try:
                        sftp.stat(path)
                        return {"success": False, "message": f"File already exists: {path}", "status_code": 409}
                    except FileNotFoundError:
                        pass
                with sftp.open(path, "wb") as fh:
                    fh.write(data)
                return {"success": True}
        return _sftp_safe_exec("create_file_raw", op)

    def upload_folder(self, host: str, port: int, username: str, auth: dict, path: str, zip_data: str, mode: str = "merge", overwrite: bool = False) -> dict:
        """Upload ZIP and extract to remote folder. Returns {success, files_extracted}."""
        def op():
            import zipfile
            zip_bytes = base64.b64decode(zip_data)
            buf = io.BytesIO(zip_bytes)
            files_extracted = 0
            
            with self._get_connection(host, port, username, auth) as (_, sftp):
                # If it exists and we haven't confirmed a mode yet, return 409
                if not overwrite:
                    try:
                        sftp.stat(path)
                        return {
                            "success": False, 
                            "message": "Folder already exists",
                            "folder_name": os.path.basename(path),
                            "status_code": 409
                        }
                    except FileNotFoundError:
                        pass

                # Handle Replace mode: delete existing first
                if mode == "replace":
                    try:
                        # Only try to remove if it might exist
                        sftp.stat(path)
                        self._rmtree(sftp, path)
                    except FileNotFoundError:
                        pass

                # Ensure base directory exists
                self._mkdir_recursive(sftp, path)
                
                with zipfile.ZipFile(buf) as zf:
                    for member in zf.namelist():
                        # Skip macOS metadata
                        if "__MACOSX" in member or ".DS_Store" in member:
                            continue
                            
                        # If it is a directory entry, ensure it exists
                        if member.endswith("/"):
                            self._mkdir_recursive(sftp, os.path.join(path, member).replace("\\", "/"))
                            continue
                            
                        # It is a file - ensure parent exists
                        remote_file_path = os.path.join(path, member).replace("\\", "/")
                        remote_parent = os.path.dirname(remote_file_path)
                        self._mkdir_recursive(sftp, remote_parent)
                        
                        # Extract/Write file
                        with zf.open(member) as zf_file:
                            with sftp.open(remote_file_path, "wb") as remote_fh:
                                remote_fh.write(zf_file.read())
                        files_extracted += 1
                        
                return {"success": True, "files_extracted": files_extracted}
        return _sftp_safe_exec("upload_folder", op)

    def download_folder(self, host: str, port: int, username: str, auth: dict, path: str) -> dict:
        """Download a remote folder as a base64-encoded ZIP. Returns {success, data}."""
        def op():
            import zipfile
            buf = io.BytesIO()
            with self._get_connection(host, port, username, auth) as (_, sftp):
                # Verify path exists and is a directory
                attr = sftp.stat(path)
                if not stat.S_ISDIR(attr.st_mode):
                    return {"success": False, "message": "Path is not a directory", "status_code": 400}

                with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
                    self._zip_remote_dir(sftp, path, path, zf)

            zip_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return {"success": True, "data": zip_b64}
        return _sftp_safe_exec("download_folder", op)

    def _zip_remote_dir(self, sftp, base_path: str, current_path: str, zf):
        """Recursively add remote directory contents to a ZipFile."""
        for entry in sftp.listdir_attr(current_path):
            full_path = current_path.rstrip('/') + '/' + entry.filename
            # Relative path inside the ZIP (preserves folder name)
            rel_path = os.path.relpath(full_path, os.path.dirname(base_path)).replace("\\", "/")
            if stat.S_ISDIR(entry.st_mode):
                self._zip_remote_dir(sftp, base_path, full_path, zf)
            else:
                try:
                    with sftp.open(full_path, 'rb') as fh:
                        data = fh.read()
                    zf.writestr(rel_path, data)
                except Exception as e:
                    _LOGGER.warning("Skipping file %s in download_folder: %s", full_path, e)

    def stream_folder_zip(self, host: str, port: int, username: str, auth: dict, path: str, write_chunk: Callable[[bytes], None]) -> dict:
        """Write a remote folder ZIP incrementally to *write_chunk*."""
        def op():
            import zipfile

            class _ChunkWriter:
                def __init__(self, callback):
                    self._callback = callback
                    self._position = 0

                def write(self, data):
                    if data:
                        self._callback(data)
                        self._position += len(data)
                    return len(data)

                def tell(self):
                    return self._position

                def flush(self):
                    return None

            with self._get_connection(host, port, username, auth) as (_, sftp):
                attr = sftp.stat(path)
                if not stat.S_ISDIR(attr.st_mode):
                    return {"success": False, "message": "Path is not a directory", "status_code": 400}

                with zipfile.ZipFile(_ChunkWriter(write_chunk), "w", zipfile.ZIP_DEFLATED) as zf:
                    self._zip_remote_dir_stream(sftp, path, path, zf)

            return {"success": True}
        return _sftp_safe_exec("stream_folder_zip", op)

    def _zip_remote_dir_stream(self, sftp, base_path: str, current_path: str, zf):
        """Recursively add remote directory contents to a streaming ZipFile."""
        try:
            entries = sftp.listdir_attr(current_path)
        except Exception as e:
            _LOGGER.warning("Skipping directory %s in stream_folder_zip: %s", current_path, e)
            return

        if not entries:
            rel_dir = os.path.relpath(current_path, os.path.dirname(base_path)).replace("\\", "/").rstrip("/")
            if rel_dir and rel_dir != ".":
                zf.writestr(rel_dir + "/", b"")
            return

        for entry in entries:
            full_path = current_path.rstrip("/") + "/" + entry.filename
            rel_path = os.path.relpath(full_path, os.path.dirname(base_path)).replace("\\", "/")
            if stat.S_ISDIR(entry.st_mode):
                self._zip_remote_dir_stream(sftp, base_path, full_path, zf)
                continue

            try:
                with sftp.open(full_path, "rb") as remote_fh:
                    with zf.open(rel_path, "w") as zip_fh:
                        while True:
                            chunk = remote_fh.read(1024 * 1024)
                            if not chunk:
                                break
                            zip_fh.write(chunk)
            except Exception as e:
                _LOGGER.warning("Skipping file %s in stream_folder_zip: %s", full_path, e)

    def _mkdir_recursive(self, sftp, path):
        """Helper to create remote directory recursively."""
        if not path or path == "/": return
        parts = [p for p in path.split('/') if p]
        current = ""
        for part in parts:
            current += "/" + part
            try:
                sftp.stat(current)
            except FileNotFoundError:
                sftp.mkdir(current)

    def delete_path(self, host: str, port: int, username: str, auth: dict, path: str) -> dict:
        """Delete a remote file or directory (recursively). Returns {success}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                attr = sftp.stat(path)
                if stat.S_ISDIR(attr.st_mode):
                    self._rmtree(sftp, path)
                else:
                    sftp.remove(path)
                return {"success": True}
        return _sftp_safe_exec("delete_path", op)

    def delete_multi(self, host: str, port: int, username: str, auth: dict, paths: list[str]) -> dict:
        """Delete multiple remote paths. Returns {success}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                for path in paths:
                    try:
                        attr = sftp.stat(path)
                        if stat.S_ISDIR(attr.st_mode):
                            self._rmtree(sftp, path)
                        else:
                            sftp.remove(path)
                    except Exception as e:
                        logging.getLogger(__name__).error(f"SFTP delete_multi failed for {path}: {str(e)}")
                return {"success": True}
        return _sftp_safe_exec("delete_multi", op)

    def _rmtree(self, sftp, path):
        """Recursively delete a remote directory."""
        for entry in sftp.listdir_attr(path):
            full_path = os.path.join(path, entry.filename).replace("\\", "/")
            if stat.S_ISDIR(entry.st_mode):
                self._rmtree(sftp, full_path)
            else:
                sftp.remove(full_path)
        sftp.rmdir(path)

    def rename_path(self, host: str, port: int, username: str, auth: dict, src: str, dest: str, overwrite: bool = False) -> dict:
        """Rename/move a remote path. Returns {success}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                if overwrite:
                    try:
                        attr = sftp.stat(dest)
                        if stat.S_ISDIR(attr.st_mode):
                            self._rmtree(sftp, dest)
                        else:
                            sftp.remove(dest)
                    except FileNotFoundError:
                        pass
                sftp.rename(src, dest)
                return {"success": True}
        return _sftp_safe_exec("rename_path", op)

    def copy_path(self, host: str, port: int, username: str, auth: dict, src: str, dest: str, overwrite: bool = False) -> dict:
        """Copy a remote path (file or directory). Returns {success}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                if overwrite:
                    try:
                        attr = sftp.stat(dest)
                        if stat.S_ISDIR(attr.st_mode):
                            self._rmtree(sftp, dest)
                        else:
                            sftp.remove(dest)
                    except FileNotFoundError:
                        pass
                
                attr = sftp.stat(src)
                if stat.S_ISDIR(attr.st_mode):
                    self._copytree(sftp, src, dest)
                else:
                    self._copyfile(sftp, src, dest)
                return {"success": True}
        return _sftp_safe_exec("copy_path", op)

    def _copyfile(self, sftp, src, dest):
        """Copy a remote file."""
        with sftp.open(src, "rb") as fsrc:
            with sftp.open(dest, "wb") as fdest:
                fdest.write(fsrc.read())

    def _copytree(self, sftp, src, dest):
        """Recursively copy a remote directory."""
        try:
            sftp.mkdir(dest)
        except OSError:
            pass # Already exists
        for entry in sftp.listdir_attr(src):
            s_path = os.path.join(src, entry.filename).replace("\\", "/")
            d_path = os.path.join(dest, entry.filename).replace("\\", "/")
            if stat.S_ISDIR(entry.st_mode):
                self._copytree(sftp, s_path, d_path)
            else:
                self._copyfile(sftp, s_path, d_path)

    def read_file_raw(self, host: str, port: int, username: str, auth: dict, path: str) -> dict:
        """Read a remote file as raw bytes. Returns {success, data, size, mime_type}.

        Unlike read_file(), this returns raw bytes (no base64) for streaming.
        """
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                with sftp.open(path, "rb") as fh:
                    data = fh.read()
                mime_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
                return {"success": True, "data": data, "size": len(data), "mime_type": mime_type}
        return _sftp_safe_exec("read_file_raw", op)

    def get_file_info(self, host: str, port: int, username: str, auth: dict, path: str) -> dict:
        """Return size and MIME metadata for a remote file."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                attr = sftp.stat(path)
                if stat.S_ISDIR(attr.st_mode):
                    return {"success": False, "message": "Path is a directory", "status_code": 400}
                return {
                    "success": True,
                    "size": attr.st_size or 0,
                    "mime_type": mimetypes.guess_type(path)[0] or "application/octet-stream",
                }
        return _sftp_safe_exec("get_file_info", op)

    def read_file_range(self, host: str, port: int, username: str, auth: dict, path: str,
                        start: int, length: int) -> dict:
        """Read a bounded byte range from a remote file."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                with sftp.open(path, "rb") as fh:
                    fh.seek(start)
                    data = fh.read(length)
                return {"success": True, "data": data}
        return _sftp_safe_exec("read_file_range", op)

    def make_directory(self, host: str, port: int, username: str, auth: dict, path: str) -> dict:
        """Create a remote directory (including parents). Returns {success}."""
        def op():
            with self._get_connection(host, port, username, auth) as (_, sftp):
                parts = [p for p in path.split('/') if p]
                current = ''
                for part in parts:
                    current += '/' + part
                    try:
                        sftp.stat(current)
                    except FileNotFoundError:
                        sftp.mkdir(current)
                return {"success": True}
        return _sftp_safe_exec("make_directory", op)
