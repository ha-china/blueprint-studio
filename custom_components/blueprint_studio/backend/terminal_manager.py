"""Terminal Manager for Blueprint Studio."""
from __future__ import annotations

import logging
import re
import subprocess
import shlex
import os
import shutil
import select
import sys
import io
import threading
import time
from pathlib import Path

# PTY support (Linux only)
try:
    import pty
    import fcntl
    import termios
    import struct
    HAS_PTY = True
except ImportError:
    HAS_PTY = False

_LOGGER = logging.getLogger(__name__)

# Strict allow-list of commands (Legacy stateless mode)
ALLOWED_COMMANDS = {
    "ha": "Home Assistant CLI",
    "hass": "Home Assistant Core",
    "python3": "Python 3 Interpreter",
    "pip": "Python Package Installer",
    "ls": "List directory",
    "cat": "Read file",
    "cd": "Change directory",
    "pwd": "Print working directory",
    "echo": "Echo text",
    "whoami": "Current user",
    "id": "User identity",
    "ssh": "Secure Shell (Non-interactive)",
    "git": "Git Version Control",
    "grep": "Search text",
    "find": "Search files",
    "du": "Disk usage",
    "df": "Disk free",
    "free": "Memory usage",
    "top": "Process monitor (batch mode)",
    "ps": "Process status",
    "date": "System date",
    "uptime": "System uptime",
    "ping": "Network check",
    "curl": "Network request",
    "wget": "Network download",
    "head": "Read first lines",
    "tail": "Read last lines",
}

# Blocked arguments for safety (Legacy stateless mode)
BLOCKED_ARGS = [
    ">", ">>", "|", "&", ";", "$", "`",  # Shell operators
    "/dev", "/sys", "/proc",             # System paths
    "rm", "mv", "dd", "mkfs", "fdisk",   # Destructive commands
    "reboot", "shutdown", "poweroff",    # System power
]

class _TofuHostKeyPolicy:
    """Paramiko MissingHostKeyPolicy implementing Trust-On-First-Use (TOFU).

    - First connection to a host: key is trusted and saved to known_hosts.
    - Subsequent connections: Paramiko's own key lookup handles verification;
      this policy is only invoked for *missing* keys, so a changed key raises
      SSHException before we even get here.
    """

    def __init__(self, known_hosts_path: str) -> None:
        self._path = known_hosts_path

    def missing_host_key(self, client, hostname, key):
        try:
            import paramiko
        except ImportError:
            return  # can't do much without paramiko

        key_type = key.get_name()
        fingerprint = key.get_fingerprint().hex()
        _LOGGER.info(
            "Terminal SSH: new host '%s' — trusting %s key (fingerprint: %s). "
            "Future connections will verify against this key.",
            hostname, key_type, fingerprint,
        )
        # Add to the client's in-memory host keys and persist
        client.get_host_keys().add(hostname, key_type, key)
        try:
            os.makedirs(os.path.dirname(self._path), mode=0o700, exist_ok=True)
            client.save_host_keys(self._path)
        except Exception as exc:
            _LOGGER.warning("Terminal SSH: could not save known_hosts: %s", exc)


class TerminalManager:
    """Manages secure terminal command execution."""

    def __init__(self, hass):
        """Initialize the terminal manager."""
        self.hass = hass

    def _parse_ssh_key(self, key_text: str, passphrase: str = None) -> tuple:
        """Parse SSH private key and return (key_object, key_type) tuple.

        Tries multiple key types: RSA, Ed25519, ECDSA, DSS.
        Returns (pkey_object, key_type_name) or raises ValueError if invalid.
        """
        try:
            import paramiko
        except ImportError:
            _LOGGER.error("Paramiko not available for SSH key authentication")
            raise ValueError("SSH key authentication requires Paramiko library")

        passphrase_bytes = passphrase.encode() if passphrase else None

        for key_class_name in ("RSAKey", "Ed25519Key", "ECDSAKey", "DSSKey"):
            try:
                key_class = getattr(paramiko, key_class_name)
                pkey = key_class.from_private_key(
                    io.StringIO(key_text), password=passphrase_bytes
                )
                _LOGGER.info("Parsed %s SSH key successfully", key_class_name)
                return pkey, key_class_name
            except Exception as e:
                _LOGGER.debug("Failed to parse %s key: %s", key_class_name, str(e))
                continue

        raise ValueError("Could not parse private key (tried RSA, Ed25519, ECDSA, DSS)")


    def _setup_ssh_file(self, ssh_dir: str, filename: str, content: str, mode: int = 0o600) -> bool:
        """Consolidate SSH file setup - eliminates 80 lines of duplication."""
        filepath = os.path.join(ssh_dir, filename)
        if os.path.exists(filepath):
            return True
        try:
            os.makedirs(ssh_dir, mode=0o700, exist_ok=True)
            with open(filepath, 'w') as f:
                f.write(content)
            os.chmod(filepath, mode)
            _LOGGER.info("Created SSH file: %s", filepath)
            return True
        except Exception as e:
            _LOGGER.warning("Failed to create SSH file %s: %s", filename, e)
            return False

    # Shell metacharacters that must not appear in SSH usernames or hostnames
    _SHELL_META = re.compile(r'[;&|$`><\n\r\x00\'\"\\(){}!\[\]~*?#]')

    def _validate_ssh_input(self, username: str, host: str, port: int) -> None:
        """Validate SSH connection parameters to prevent injection attacks."""
        if self._SHELL_META.search(username):
            raise ValueError(f"Invalid SSH username: contains disallowed characters")
        if self._SHELL_META.search(host):
            raise ValueError(f"Invalid SSH hostname: contains disallowed characters")
        if not isinstance(port, int) or not (1 <= port <= 65535):
            raise ValueError(f"Invalid SSH port: must be integer 1-65535")

    def _cleanup_temp_key(self, key_path: str, delay: float = 5.0) -> None:
        """Schedule deletion of a temporary SSH key file after a delay."""
        def _delete():
            time.sleep(delay)
            try:
                if os.path.exists(key_path):
                    os.remove(key_path)
                    _LOGGER.info("Cleaned up temporary SSH key: %s", key_path)
            except OSError as e:
                _LOGGER.warning("Failed to clean up SSH key %s: %s", key_path, e)
        t = threading.Thread(target=_delete, daemon=True)
        t.start()

    def spawn(self, rows=24, cols=80):
        """Spawn a PTY session. Returns (master_fd, pid)."""
        if not HAS_PTY:
            raise RuntimeError("PTY is not supported on this platform (Linux required).")

        # Determine shell
        shell = shutil.which("bash") or shutil.which("sh") or "/bin/sh"

        # Determine Env
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["HOME"] = self.hass.config.config_dir

        # Set locale variables to prevent SSH issues with some servers
        env["LANG"] = env.get("LANG", "C.UTF-8")
        env["LC_ALL"] = env.get("LC_ALL", "C.UTF-8")

        # Ensure PATH includes common binary locations for SSH and other tools
        path_additions = ["/usr/bin", "/usr/local/bin", "/bin", "/usr/sbin", "/sbin"]
        current_path = env.get("PATH", "")
        for path_dir in path_additions:
            if path_dir not in current_path:
                current_path = f"{path_dir}:{current_path}" if current_path else path_dir
        env["PATH"] = current_path

        # Setup SSH directory and configuration
        ssh_dir = os.path.join(self.hass.config.config_dir, ".ssh")

        ssh_config_content = """# Auto-generated SSH config for Blueprint Studio Terminal
# Place your SSH private keys in ~/.ssh/ (id_rsa, id_ed25519, etc.)
# For passwordless access, copy your public key to remote: ssh-copy-id user@host

Host *
    # Automatically accept new host keys (but reject changed keys for security)
    StrictHostKeyChecking accept-new

    # Force TTY allocation for proper interactive sessions
    RequestTTY yes

    # Keep connections alive to prevent timeouts
    ServerAliveInterval 60
    ServerAliveCountMax 3
    TCPKeepAlive yes

    # Connection timeouts
    ConnectTimeout 30

    # Try common key types
    IdentityFile ~/.ssh/id_rsa
    IdentityFile ~/.ssh/id_ed25519
    IdentityFile ~/.ssh/id_ecdsa

    # Disable problematic options that may not work in containers
    AddKeysToAgent no

    # Enable compression for slow connections
    Compression yes

    # Ensure proper session handling
    SessionType default

# Example host-specific configuration:
# Host myserver
#     HostName 192.168.1.100
#     User myusername
#     Port 22
#     IdentityFile ~/.ssh/myserver_key
"""
        self._setup_ssh_file(ssh_dir, "config", ssh_config_content, 0o600)

        known_hosts_content = ""
        self._setup_ssh_file(ssh_dir, "known_hosts", known_hosts_content, 0o600)

        readme_content = """Blueprint Studio Terminal - SSH Setup Guide
==========================================

This directory stores SSH configuration and keys for secure remote access.

PASSWORDLESS SSH ACCESS:
1. Generate a key pair (if you don't have one):
   ssh-keygen -t ed25519 -C "homeassistant@blueprintstudio"

2. Copy your public key to the remote server:
   ssh-copy-id user@remote-server

3. Your private key will be automatically used from this directory

SSH KEY FILES:
- id_rsa / id_rsa.pub (RSA keys - older, still supported)
- id_ed25519 / id_ed25519.pub (Ed25519 keys - recommended, more secure)
- id_ecdsa / id_ecdsa.pub (ECDSA keys)
- config (SSH client configuration)
- known_hosts (Fingerprints of servers you've connected to)

SECURITY NOTES:
- Never share your private keys (files without .pub extension)
- Private keys should have 600 permissions (read/write for owner only)
- Public keys (.pub files) can be safely shared
- Host key verification protects against man-in-the-middle attacks

TROUBLESHOOTING:
- If connection is slow, check ServerAliveInterval in config
- If key is rejected, ensure proper permissions: chmod 600 ~/.ssh/id_*
- For debugging, use: ssh -v user@host (verbose mode)
"""
        self._setup_ssh_file(ssh_dir, "README.txt", readme_content, 0o600)

        # Verify SSH client availability
        ssh_client = shutil.which("ssh")
        if ssh_client:
            _LOGGER.info("Blueprint Studio Terminal: SSH client found at %s", ssh_client)
        else:
            _LOGGER.warning(
                "Blueprint Studio Terminal: SSH client not found in PATH. "
                "SSH connections will not work. Please install openssh-client in your Home Assistant environment."
            )

        # Create PTY pair
        master_fd, slave_fd = pty.openpty()
        
        try:
            p = subprocess.Popen(
                [shell],
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=self.hass.config.config_dir,
                env=env,
                start_new_session=True,
                close_fds=True
            )
        except Exception:
            os.close(slave_fd)
            os.close(master_fd)
            raise

        # Close slave_fd in parent process
        os.close(slave_fd)
        
        self.resize(master_fd, rows, cols)
        return master_fd, p.pid

    def resize(self, fd, rows, cols):
        """Resize the PTY window."""
        if not HAS_PTY:
            return
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass

    def spawn_ssh_paramiko(self, username: str, host: str, port: int = 22,
                          password: str = None, private_key: str = None,
                          key_passphrase: str = None, rows: int = 24, cols: int = 80) -> tuple:
        """Spawn SSH session using Paramiko with interactive PTY.

        Returns (master_fd, pseudo_pid) - in-process Paramiko SSH channel bridged
        to a PTY pair.  No credentials are written to disk.
        """
        if not HAS_PTY:
            raise RuntimeError("PTY is not supported on this platform (Linux required).")

        try:
            import paramiko
        except ImportError:
            raise RuntimeError("Paramiko not available (should be installed with Home Assistant)")

        # Validate inputs
        self._validate_ssh_input(username, host, int(port))

        # Load known_hosts and apply TOFU host key verification
        ssh = paramiko.SSHClient()
        known_hosts_path = os.path.join(self.hass.config.config_dir, ".ssh", "known_hosts")
        try:
            ssh.load_host_keys(known_hosts_path)
        except FileNotFoundError:
            pass  # first run — file will be created on connect
        except Exception as exc:
            _LOGGER.warning("Terminal: could not load known_hosts: %s", exc)

        # RejectPolicy raises SSHException on unknown/changed keys.
        # load_system_host_keys() is NOT called — we manage our own file only.
        ssh.set_missing_host_key_policy(_TofuHostKeyPolicy(known_hosts_path))

        if private_key:
            pkey, key_type = self._parse_ssh_key(private_key, key_passphrase)
            _LOGGER.info("Paramiko SSH connecting with %s key to %s@%s:%d", key_type, username, host, port)
            ssh.connect(host, port=port, username=username, pkey=pkey, timeout=30)
        else:
            _LOGGER.info("Paramiko SSH connecting with password to %s@%s:%d", username, host, port)
            ssh.connect(host, port=port, username=username, password=password, timeout=30)

        # Open interactive shell channel with PTY
        channel = ssh.get_transport().open_session()
        channel.get_pty('xterm-256color', cols, rows)
        channel.invoke_shell()

        # Create a local PTY pair to bridge with the Paramiko channel
        master_fd, slave_fd = pty.openpty()

        # Put the slave end into raw mode so the local PTY line discipline
        # passes all bytes through unmodified in both directions.  Without this,
        # the discipline mangles escape sequences (e.g. arrow keys in application
        # cursor key mode) that the remote shell sends or expects.
        import tty
        tty.setraw(slave_fd)

        # Use -1 as a sentinel pid — there is no child process for a Paramiko session.
        # Callers must NOT send signals to this value.
        pseudo_pid = -1

        def _bridge_io():
            """Bridge I/O between slave_fd and Paramiko channel in a background thread."""
            try:
                while not channel.closed:
                    r, _, _ = select.select([slave_fd, channel], [], [], 0.5)
                    if slave_fd in r:
                        try:
                            data = os.read(slave_fd, 4096)
                            if data:
                                channel.sendall(data)
                            else:
                                break
                        except OSError:
                            break
                    if channel in r:
                        try:
                            data = channel.recv(4096)
                            if data:
                                os.write(slave_fd, data)
                            else:
                                break
                        except (OSError, EOFError):
                            break
            except Exception as e:
                _LOGGER.debug("Paramiko bridge thread ending: %s", e)
            finally:
                try:
                    channel.close()
                except Exception:
                    pass
                try:
                    ssh.close()
                except Exception:
                    pass
                try:
                    os.close(slave_fd)
                except OSError:
                    pass
                _LOGGER.info("Paramiko SSH session to %s@%s closed", username, host)

        bridge_thread = threading.Thread(target=_bridge_io, daemon=True, name=f"paramiko-bridge-{host}")
        bridge_thread.start()

        self.resize(master_fd, rows, cols)
        return master_fd, pseudo_pid

    def spawn_ssh_pty(self, username: str, host: str, port: int = 22,
                      password: str = None, private_key: str = None,
                      key_passphrase: str = None, rows: int = 24, cols: int = 80) -> tuple:
        """Spawn an SSH PTY session with either password or key authentication.

        Args:
            username: SSH username
            host: SSH host/IP
            port: SSH port (default 22)
            password: Password for authentication (used if private_key is None)
            private_key: PEM-formatted SSH private key (if using key auth)
            key_passphrase: Optional passphrase for encrypted keys
            rows: Terminal rows
            cols: Terminal columns

        Returns:
            (master_fd, pid) tuple for PTY session

        Raises:
            ValueError: If authentication details are invalid
            RuntimeError: If SSH setup fails
        """
        if not HAS_PTY:
            raise RuntimeError("PTY is not supported on this platform (Linux required).")

        # Validate inputs to prevent injection
        self._validate_ssh_input(username, host, int(port))

        # Setup SSH directory and ensure config exists
        ssh_dir = os.path.join(self.hass.config.config_dir, ".ssh")
        os.makedirs(ssh_dir, mode=0o700, exist_ok=True)

        # If private key is provided, use SSH key authentication
        if private_key:
            try:
                # Validate the key format
                pkey, key_type = self._parse_ssh_key(private_key, key_passphrase)
                _LOGGER.info("Using %s authentication for SSH %s@%s:%d",
                           key_type, username, host, port)
                return self.spawn_ssh_paramiko(
                    username=username,
                    host=host,
                    port=port,
                    private_key=private_key,
                    key_passphrase=key_passphrase,
                    rows=rows,
                    cols=cols
                )
            except ValueError as e:
                _LOGGER.error("SSH key validation failed: %s", e)
                raise RuntimeError(f"Invalid SSH key: {str(e)}")
        elif password:
            # Use password authentication via Paramiko (reusing SFTP pattern)
            _LOGGER.info("Using Paramiko password authentication for SSH %s@%s:%d",
                       username, host, port)
            return self.spawn_ssh_paramiko(
                username=username,
                host=host,
                port=port,
                password=password,
                rows=rows,
                cols=cols
            )
        else:
            # No auth method provided, use interactive SSH
            _LOGGER.info("Using interactive authentication for SSH %s@%s:%d",
                       username, host, port)
            cmd_args = ["ssh", f"{username}@{host}", "-p", str(port)]

        # Prepare environment - use config_dir as HOME so SSH can find .ssh
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["HOME"] = self.hass.config.config_dir
        env["LANG"] = env.get("LANG", "C.UTF-8")
        env["LC_ALL"] = env.get("LC_ALL", "C.UTF-8")

        # Ensure PATH includes SSH
        path_additions = ["/usr/bin", "/usr/local/bin", "/bin", "/usr/sbin", "/sbin"]
        current_path = env.get("PATH", "")
        for path_dir in path_additions:
            if path_dir not in current_path:
                current_path = f"{path_dir}:{current_path}" if current_path else path_dir
        env["PATH"] = current_path

        _LOGGER.debug("SSH PTY environment: HOME=%s", env["HOME"])

        # Create PTY pair
        master_fd, slave_fd = pty.openpty()

        try:
            p = subprocess.Popen(
                cmd_args,  # Direct argument list, no shell
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=self.hass.config.config_dir,
                env=env,
                start_new_session=True,
                close_fds=True
            )
        except Exception as e:
            os.close(slave_fd)
            os.close(master_fd)
            _LOGGER.error("Failed to spawn SSH PTY: %s", e)
            raise

        # Close slave_fd in parent process
        os.close(slave_fd)

        self.resize(master_fd, rows, cols)

        return master_fd, p.pid


    async def execute_command(self, command_str: str, user: str = "Unknown", cwd: str = None) -> dict:
        """Execute a command safely (Legacy Stateless Mode)."""
        if not command_str or not command_str.strip():
            return {"output": "", "retval": 0}

        # Log command for audit
        _LOGGER.info("Terminal command by %s: %s (cwd: %s)", user, command_str, cwd)

        # Determine effective CWD
        base_dir = Path(self.hass.config.config_dir).resolve()
        if cwd:
            try:
                resolved_cwd = Path(cwd).resolve()
            except OSError:
                return {"output": f"Error: Working directory '{cwd}' does not exist.", "retval": 1}
            if not resolved_cwd.is_dir():
                return {"output": f"Error: Working directory '{cwd}' does not exist.", "retval": 1}
            if not resolved_cwd.is_relative_to(base_dir):
                return {"output": "Error: Working directory must be within the config directory.", "retval": 1}
            effective_cwd = str(resolved_cwd)
        else:
            effective_cwd = str(base_dir)

        try:
            # 1. Basic safety checks
            for blocked in BLOCKED_ARGS:
                if blocked in command_str:
                    return {
                        "output": f"Error: Command contains blocked character/path: '{blocked}'",
                        "retval": 1
                    }

            # 2. Parse arguments
            args = shlex.split(command_str)
            if not args:
                return {"output": "", "retval": 0}

            cmd = args[0]

            # 3. Check allow-list
            if cmd not in ALLOWED_COMMANDS:
                return {
                    "output": f"Error: Command '{cmd}' is not in the allow-list.\nAllowed: {', '.join(sorted(ALLOWED_COMMANDS.keys()))}",
                    "retval": 127
                }

            # Handle SSH - require PTY terminal
            if cmd == "ssh":
                return {
                    "output": "⚠️  SSH requires an interactive terminal.\n\nPlease use the PTY Terminal (WebSocket mode) for SSH connections.\nSSH needs interactive password prompts and host key verification.\n\nTip: If you need passwordless SSH, add your private key to ~/.ssh/ directory.",
                    "retval": 1
                }

            # Handle 'cd' internally
            if cmd == "cd":
                target = args[1] if len(args) > 1 else str(base_dir)
                # Resolve path
                new_path = os.path.abspath(os.path.join(effective_cwd, target))
                try:
                    resolved_new_path = Path(new_path).resolve()
                except OSError:
                    resolved_new_path = None
                if resolved_new_path and resolved_new_path.is_dir() and resolved_new_path.is_relative_to(base_dir):
                    return {"output": "", "retval": 0, "new_cwd": new_path}
                else:
                    return {"output": f"cd: {target}: No such file or directory", "retval": 1}

            # 4. Special handling for specific commands
            if cmd == "top":
                # Force batch mode for top to avoid hanging
                if "-b" not in args:
                    args.append("-b")
                if "-n" not in args:
                    args.extend(["-n", "1"])

            if cmd == "ping":
                # Limit ping count
                if "-c" not in args:
                    args.extend(["-c", "3"])

            # 5. Resolve executable
            executable = shutil.which(cmd)
            if not executable:
                if cmd == "ha":
                    return {
                        "output": "Error: 'ha' CLI not found. The Home Assistant Core container typically does not include the Supervisor CLI. Use the UI for Supervisor tasks.",
                        "retval": 127
                    }
                return {
                    "output": f"Error: Command '{cmd}' not found in system PATH.",
                    "retval": 127
                }

            # 6. Execute
            # Run in executor to avoid blocking the event loop
            def run_proc():
                # Use resolved executable for the first argument
                run_args = [executable] + args[1:]
                return subprocess.run(
                    run_args,
                    capture_output=True,
                    text=True,
                    cwd=effective_cwd,
                    timeout=30  # 30s timeout
                )

            result = await self.hass.async_add_executor_job(run_proc)

            output = result.stdout
            if result.stderr:
                output += "\n" + result.stderr

            return {
                "output": output,
                "retval": result.returncode
            }

        except subprocess.TimeoutExpired:
            return {"output": "Error: Command timed out (30s limit).", "retval": 124}
        except Exception as e:
            _LOGGER.error("Terminal execution error: %s", e)
            return {"output": f"Execution Error: {str(e)}", "retval": 1}
