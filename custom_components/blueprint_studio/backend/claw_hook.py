"""Route Blueprint Studio AI queries through Home Assistant conversation agents.

This module is completely standalone — zero imports from any specific agent
integration. It discovers conversation agents via the HA entity registry
and calls them through the standard ``async_converse`` API.

When the agent's response contains ``\`\`\`edit:<path>`` fenced blocks the
file is written to disk and a ``blueprint_studio_update`` event with
``action=ai_edit`` is fired so the editor frontend can show a diff.
"""
from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import Any

from aiohttp import web
from homeassistant.core import Context, HomeAssistant

from .util import json_response

_LOGGER = logging.getLogger(__name__)

_EDIT_BLOCK_RE = re.compile(
    r"```edit:([^\n]+)\n(.*?)```",
    re.DOTALL,
)


def list_conversation_agents(hass: HomeAssistant) -> list[dict[str, str]]:
    """Return ``[{id, name, platform}]`` for every conversation agent entity."""
    agents: list[dict[str, str]] = []
    try:
        from homeassistant.helpers import entity_registry as er
        entity_reg = er.async_get(hass)
        for entry in entity_reg.entities.values():
            if entry.domain == "conversation":
                agents.append({
                    "id": entry.entity_id,
                    "name": entry.name or entry.original_name or entry.entity_id,
                    "platform": entry.platform,
                })
    except Exception:
        pass
    return agents


def _resolve_agent_id(hass: HomeAssistant, agent_entity_id: str | None) -> str | None:
    """Pick a conversation agent: explicit id > first claw > first any."""
    if agent_entity_id:
        return agent_entity_id
    agents = list_conversation_agents(hass)
    for a in agents:
        if a["platform"] == "claw_assistant":
            return a["id"]
    return agents[0]["id"] if agents else None


async def try_claw_query(
    hass: HomeAssistant,
    query: str,
    current_file: str | None,
    file_content: str | None,
    agent_entity_id: str | None = None,
) -> web.Response | None:
    """Route the query through a HA conversation agent.

    Returns an aiohttp Response on success, or None if no agent is available.
    """
    agent_id = _resolve_agent_id(hass, agent_entity_id)
    if not agent_id:
        return None

    context_parts: list[str] = []
    if current_file:
        context_parts.append(f"[Current open file: {current_file}]")
    if file_content is not None:
        preview = file_content[:6000]
        context_parts.append(f"[File content ({len(file_content)} chars)]:\n```\n{preview}\n```")

    context_parts.append(
        "[You are operating inside Blueprint Studio, the HA config file editor. "
        "When you want to edit a file, output a fenced code block with the tag "
        "`edit:<relative_path>` containing the FULL new file content. Example:\n"
        "```edit:configuration.yaml\n<full file content>\n```\n"
        "Multiple edit blocks are allowed. The editor will show a diff to the user.]"
    )

    full_query = "\n".join(context_parts) + "\n\n" + query

    try:
        from homeassistant.components.conversation import async_converse

        result = await async_converse(
            hass=hass,
            text=full_query,
            conversation_id=None,
            context=Context(),
            agent_id=agent_id,
        )

        response_text = result.response.speech.get("plain", {}).get("speech", "")
        if not response_text:
            return None

        edits = _extract_and_apply_edits(hass, response_text)

        clean_text = response_text
        for edit_info in edits:
            clean_text = clean_text.replace(edit_info["raw_block"], "")
        clean_text = clean_text.strip()

        if edits:
            edit_summary_parts = []
            for ei in edits:
                status = "✅" if ei["success"] else "❌"
                edit_summary_parts.append(f"{status} `{ei['path']}`")
            edit_summary = "\n".join(edit_summary_parts)
            if clean_text:
                clean_text = f"{clean_text}\n\n---\n**File changes (diff shown in editor):**\n{edit_summary}"
            else:
                clean_text = f"**File changes (diff shown in editor):**\n{edit_summary}"

        return json_response({"success": True, "response": clean_text})

    except ImportError:
        _LOGGER.debug("conversation component not available")
        return None
    except Exception as err:
        _LOGGER.warning("claw_hook: conversation call failed: %s", err)
        return None


def _extract_and_apply_edits(hass: HomeAssistant, text: str) -> list[dict[str, Any]]:
    """Parse ```edit:path blocks, write files, fire diff events."""
    config_dir = Path(hass.config.config_dir)
    edits: list[dict[str, Any]] = []

    for match in _EDIT_BLOCK_RE.finditer(text):
        raw_path = match.group(1).strip()
        new_content = match.group(2)
        raw_block = match.group(0)

        full = (config_dir / raw_path).resolve()
        if not str(full).startswith(str(config_dir.resolve())):
            edits.append({"path": raw_path, "success": False, "error": "path escape", "raw_block": raw_block})
            continue

        old_content = ""
        if full.is_file():
            try:
                old_content = full.read_text("utf-8")
            except Exception:
                old_content = ""

        try:
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(new_content, "utf-8")
        except Exception as err:
            edits.append({"path": raw_path, "success": False, "error": str(err), "raw_block": raw_block})
            continue

        hass.bus.async_fire("blueprint_studio_update", {
            "action": "ai_edit",
            "path": raw_path,
            "old_content": old_content,
            "new_content": new_content,
            "timestamp": time.time(),
        })

        edits.append({"path": raw_path, "success": True, "raw_block": raw_block})

    return edits
