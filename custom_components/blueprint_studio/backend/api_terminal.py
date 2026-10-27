"""Terminal WebSocket and exec handlers for Blueprint Studio API."""
from __future__ import annotations

import json
import logging
import os

from aiohttp import web
from homeassistant.components.http import HomeAssistantView

from .util import json_message, json_response
from .terminal_manager import TerminalManager
from .ticket_manager import TicketManager
from .transport_contracts import ValidationError, validate_terminal_message

_LOGGER = logging.getLogger(__name__)


class TerminalWebSocketView(HomeAssistantView):
    """Dedicated view for terminal WebSocket connections.

    Browser WebSockets cannot send Authorization headers, so this route consumes
    a short-lived, single-use ticket issued through the authenticated API.
    """

    url = "/api/blueprint_studio/terminal_ws"
    name = "api:blueprint_studio:terminal_ws"
    requires_auth = False

    def __init__(self, terminal: TerminalManager | None = None, tickets: TicketManager | None = None) -> None:
        """Initialize the view."""
        self.terminal = terminal
        self._active = terminal is not None
        self.tickets = tickets or TicketManager()

    def activate(self, terminal: TerminalManager, tickets: TicketManager) -> None:
        """Bind this route to the active entry runtime."""
        self.terminal = terminal
        self._active = True
        self.tickets = tickets

    def deactivate(self) -> None:
        """Reject new terminal sessions while the entry is unloaded."""
        self._active = False
        self.terminal = None
        self.tickets = None

    async def get(self, request: web.Request) -> web.WebSocketResponse:
        """Validate origin and consume a scoped ticket before upgrading."""
        if not self._active or self.terminal is None:
            return web.Response(status=503, text="Blueprint Studio is unavailable")
        hass = request.app["hass"]

        origin = request.headers.get("Origin")
        expected_origin = f"{request.scheme}://{request.host}"
        if not origin or origin.rstrip("/") != expected_origin:
            return web.Response(status=403, text="Invalid origin")

        ticket = self.tickets.consume(request.query.get("ticket", ""), {"action": "terminal"})
        if ticket is None:
            return web.Response(status=401, text="Invalid or expired ticket")
        user = await hass.auth.async_get_user(ticket.user_id)
        if not user or not user.is_active or not user.is_admin:
            return web.Response(status=403, text="Admin access required")

        self.terminal.hass = hass

        return await handle_terminal_ws(request, user, hass, self.terminal)


async def handle_terminal_ws(request, user, hass, terminal_manager):
    """Handle terminal WebSocket upgrade."""

    _LOGGER.debug("Blueprint Studio: Starting Terminal WebSocket for %s", user.name)
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = getattr(hass, "loop", None)
    try:
        session = terminal_manager.create_session(ws)
    except RuntimeError:
        await ws.close(code=1001, message=b"Integration unloading")
        return ws

    async def spawn_pty(username=None, host=None, port=22, password=None, private_key=None, key_passphrase=None):
        """Spawn a PTY session - either regular shell or SSH."""
        try:
            if username and host and private_key:
                _LOGGER.info("Spawning SSH PTY with key auth for %s@%s", username, host)
                master_fd, pid = await hass.async_add_executor_job(
                    terminal_manager.spawn_ssh_pty,
                    username, host, port, None, private_key, key_passphrase
                )
            elif username and host:
                _LOGGER.info("Spawning SSH PTY with password auth for %s@%s", username, host)
                master_fd, pid = await hass.async_add_executor_job(
                    terminal_manager.spawn_ssh_pty,
                    username, host, port, password or ""
                )
            else:
                _LOGGER.debug("Blueprint Studio: Spawning regular shell PTY")
                master_fd, pid = await hass.async_add_executor_job(terminal_manager.spawn)
            return master_fd, pid
        except Exception as e:
            _LOGGER.error("Failed to spawn PTY: %s", e)
            raise

    # Initial PTY spawn
    try:
        master_fd, pid = await spawn_pty()
        session.set_pty(master_fd, pid)
        _LOGGER.debug("Blueprint Studio: PTY spawned (pid %s)", pid)
    except Exception as e:
        _LOGGER.error("Failed to spawn terminal: %s", e)
        terminal_manager.release_session(session)
        await ws.close()
        return ws

    def forward_output():
        try:
            data = os.read(master_fd, 1024)
            if data:
                try:
                    hass.async_create_task(ws.send_bytes(data))
                except Exception as e:
                    _LOGGER.warning("Failed to send terminal data to WS: %s", e)
                    loop.remove_reader(master_fd)
                    hass.async_create_task(ws.close())
            else:
                _LOGGER.info("Terminal PTY EOF - shell process has exited")
                loop.remove_reader(master_fd)
                hass.async_create_task(ws.close())
        except OSError as e:
            if e.errno != 5:
                _LOGGER.warning("Terminal PTY Read Error (errno %s): %s", e.errno, e)
            loop.remove_reader(master_fd)
            hass.async_create_task(ws.close())
        except Exception as e:
            _LOGGER.error("Unexpected error in terminal reader: %s", e)
            loop.remove_reader(master_fd)
            hass.async_create_task(ws.close())

    loop.add_reader(master_fd, forward_output)
    try:
        async for msg in ws:
            try:
                if msg.type == web.WSMsgType.BINARY:
                    os.write(master_fd, msg.data)
                elif msg.type == web.WSMsgType.TEXT:
                    try:
                        # Check if this is an SSH key authentication marker
                        if msg.data.startswith("__SSH_KEY__"):
                            try:
                                json_str = msg.data[len("__SSH_KEY__"):]
                                ssh_config = json.loads(json_str)
                                validate_terminal_message({"type": "ssh_key", **ssh_config})

                                old_master_fd = master_fd
                                old_pid = pid

                                loop.remove_reader(old_master_fd)
                                session.close_pty()

                                try:
                                    master_fd, pid = await spawn_pty(
                                        username=ssh_config.get('username'),
                                        host=ssh_config.get('host'),
                                        port=ssh_config.get('port', 22),
                                        private_key=ssh_config.get('privateKey'),
                                        key_passphrase=ssh_config.get('privateKeyPassphrase')
                                    )
                                    session.set_pty(master_fd, pid)
                                    loop.add_reader(master_fd, forward_output)
                                    # Reset application cursor key mode so arrow keys work correctly
                                    await ws.send_str('\x1b[?1l\x1b[?7h')
                                    _LOGGER.info("SSH PTY spawned successfully")
                                except Exception as spawn_error:
                                    _LOGGER.error("Failed to spawn SSH PTY: %s", spawn_error)
                                    await ws.send_str(f"Error: SSH connection failed: {str(spawn_error)}\r\n")
                                    master_fd, pid = await spawn_pty()
                                    session.set_pty(master_fd, pid)
                                    loop.add_reader(master_fd, forward_output)
                            except (json.JSONDecodeError, ValueError) as e:
                                _LOGGER.error("Invalid SSH key command format: %s", e)
                                await ws.send_str("Error: Invalid SSH authentication configuration\r\n")
                        # Check if this is an SSH password authentication marker
                        elif msg.data.startswith("__SSH_PASSWORD__"):
                            try:
                                json_str = msg.data[len("__SSH_PASSWORD__"):]
                                ssh_config = json.loads(json_str)
                                validate_terminal_message({"type": "ssh_password", **ssh_config})

                                old_master_fd = master_fd
                                old_pid = pid

                                loop.remove_reader(old_master_fd)
                                session.close_pty()

                                try:
                                    master_fd, pid = await spawn_pty(
                                        username=ssh_config.get('username'),
                                        host=ssh_config.get('host'),
                                        port=ssh_config.get('port', 22),
                                        password=ssh_config.get('password')
                                    )
                                    session.set_pty(master_fd, pid)
                                    loop.add_reader(master_fd, forward_output)
                                    # Reset application cursor key mode so arrow keys work correctly
                                    await ws.send_str('\x1b[?1l\x1b[?7h')
                                    _LOGGER.info("SSH PTY with password spawned successfully")
                                except Exception as spawn_error:
                                    _LOGGER.error("Failed to spawn SSH PTY with password: %s", spawn_error)
                                    await ws.send_str(f"Error: SSH connection failed: {str(spawn_error)}\r\n")
                                    master_fd, pid = await spawn_pty()
                                    session.set_pty(master_fd, pid)
                                    loop.add_reader(master_fd, forward_output)
                            except (json.JSONDecodeError, ValueError) as e:
                                _LOGGER.error("Invalid SSH password command format: %s", e)
                                await ws.send_str("Error: Invalid SSH authentication configuration\r\n")
                        else:
                            # Regular input
                            data = msg.json() if isinstance(msg.data, str) else json.loads(msg.data)
                            if isinstance(data, dict):
                                data = validate_terminal_message(data)
                                if data.get('type') == 'resize':
                                    await hass.async_add_executor_job(terminal_manager.resize, master_fd, data['rows'], data['cols'])
                                elif data.get('type') == 'input':
                                    os.write(master_fd, data['data'].encode())
                                else:
                                    os.write(master_fd, msg.data.encode())
                            else:
                                os.write(master_fd, msg.data.encode())
                    except (ValueError, json.JSONDecodeError):
                        os.write(master_fd, msg.data.encode())
                    except ValidationError as err:
                        _LOGGER.warning("Rejected invalid terminal control message: %s", err)
                        await ws.send_str(f"Error: {err}\r\n")
            except OSError as e:
                _LOGGER.warning("Terminal PTY Write Error: %s", e)
                break
            except Exception as e:
                _LOGGER.error("Unexpected error in terminal writer: %s", e)
                break
            if msg.type == web.WSMsgType.ERROR:
                _LOGGER.error('Terminal WS error: %s', ws.exception())
    finally:
        terminal_manager.release_session(session)
    return ws


async def terminal_exec(terminal_manager, data, user):
    """Execute a non-interactive terminal command."""
    if not terminal_manager:
        return json_message("Terminal not initialized", status_code=500)
    if not user.is_admin:
        return json_message("Unauthorized: Admin access required", status_code=403)
    result = await terminal_manager.execute_command(
        data.get("command", ""), user=user.name or "Unknown", cwd=data.get("cwd")
    )
    return json_response(result)
