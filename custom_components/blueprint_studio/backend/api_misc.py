"""Settings, AI, syntax check, and utility handlers for Blueprint Studio API."""
from __future__ import annotations

import logging
import subprocess
import time

from ..const import VERSION
from .util import json_response

_LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Short-lived in-memory cache for expensive HA state/registry reads.
# These endpoints are called on every page load and panel open, but the
# underlying data rarely changes within a few seconds.
# ---------------------------------------------------------------------------
class _HassCache:
    """Simple TTL cache for HA state queries."""

    _store: dict[str, tuple[float, object]] = {}
    _ttl: float = 5.0  # seconds

    @classmethod
    def get(cls, key: str) -> object | None:
        entry = cls._store.get(key)
        if entry and (time.monotonic() - entry[0]) < cls._ttl:
            return entry[1]
        return None

    @classmethod
    def set(cls, key: str, value: object) -> None:
        cls._store[key] = (time.monotonic(), value)

    @classmethod
    def invalidate(cls, key: str) -> None:
        cls._store.pop(key, None)

    @classmethod
    def invalidate_all(cls) -> None:
        cls._store.clear()


# ========== Settings ==========

async def save_settings(data, store, hass, stored_data):
    """Save settings and broadcast change."""
    stored_data["settings"] = data.get("settings", {})
    await store.async_save(stored_data)
    hass.bus.async_fire("blueprint_studio_settings_changed", {
        "action": "settings_updated"
    })
    return json_response({"success": True})


# ========== Syntax Checkers ==========

async def check_yaml(ai_manager, data, hass):
    return await hass.async_add_executor_job(ai_manager.check_yaml, data.get("content", ""))


async def check_jinja(ai_manager, data, hass):
    return await hass.async_add_executor_job(ai_manager.check_jinja, data.get("content", ""))


async def check_json(ai_manager, data, hass):
    return await hass.async_add_executor_job(ai_manager.check_json, data.get("content", ""))


async def check_python(ai_manager, data, hass):
    return await hass.async_add_executor_job(ai_manager.check_python, data.get("content", ""))


async def check_javascript(ai_manager, data, hass):
    return await hass.async_add_executor_job(ai_manager.check_javascript, data.get("content", ""))


async def check_syntax(ai_manager, data, hass):
    """Universal syntax checker - detects file type and applies appropriate validator."""
    content = data.get("content", "")
    file_path = data.get("file_path", "")
    return await hass.async_add_executor_job(ai_manager.check_syntax, content, file_path)


async def convert_to_blueprint(ai_manager, data, hass):
    """Convert automation YAML to blueprint format."""
    from .ai_generators import convert_automation_to_blueprint
    content = data.get("content", "")
    blueprint_name = data.get("blueprint_name", "")
    result = await hass.async_add_executor_job(convert_automation_to_blueprint, content, blueprint_name)
    return json_response({"success": True, "blueprint": result})


async def parse_blueprint_inputs(ai_manager, data, hass):
    """Parse blueprint YAML and return structured input description for the Use Blueprint form."""
    from .ai_generators import parse_blueprint_inputs as _parse
    content = data.get("content", "")
    result = await hass.async_add_executor_job(_parse, content)
    return json_response({"success": True, "inputs": result})


async def instantiate_blueprint(ai_manager, data, hass):
    """Substitute !input references in a blueprint and return ready-to-use automation YAML."""
    from .ai_generators import instantiate_blueprint as _inst
    content = data.get("content", "")
    input_values = data.get("input_values", {})
    name = data.get("name", "My Automation")
    description = data.get("description", "")
    result = await hass.async_add_executor_job(_inst, content, input_values, name, description)
    return json_response({"success": True, "automation": result})


# ========== AI ==========

async def ai_query(ai_manager, data):
    """Handle AI query."""
    return await ai_manager.query(
        data.get("query"), data.get("current_file"),
        data.get("file_content"), data.get("ai_type"),
        data.get("cloud_provider"), data.get("ai_model")
    )


async def list_hass_agents(hass):
    """Return available Home Assistant conversation agents."""
    from .claw_hook import list_conversation_agents
    agents = list_conversation_agents(hass)
    return json_response({"success": True, "agents": agents})


async def ai_get_models(ai_manager, data):
    """Return model options for the current AI configuration."""
    settings_override = data.get("settings") if isinstance(data.get("settings"), dict) else data
    return await ai_manager.get_models(
        data.get("ai_type"),
        data.get("cloud_provider"),
        data.get("ai_model"),
        settings_override,
    )


# ========== Utility ==========

async def restart_home_assistant(hass):
    """Restart Home Assistant."""
    await hass.services.async_call("homeassistant", "restart")
    return json_response({"success": True, "message": "Restarting..."})


async def get_entities(hass, data):
    """Get HA entities, optionally filtered by query, domains, and/or device_class.

    Parameters:
        domains       – If set, only return entities from these domains.
        device_classes – If set, only return entities with these device_class values.
        ensure_domains – Domains whose entities are *always* included before the cap,
                         even when 'domains' is unset (mixed restricted/unrestricted case).
        query         – Text filter on entity_id / friendly_name.
    """
    query = data.get("query", "").lower()
    domains = data.get("domains")           # e.g. ["camera", "light"]
    device_classes = data.get("device_classes")  # e.g. ["motion", "door"]
    ensure_domains = data.get("ensure_domains")  # e.g. ["camera", "device_tracker"]

    # Only use the cache for unfiltered requests (the common page-load case).
    # Filtered requests (AI autocomplete, entity pickers) are always fresh.
    use_cache = not query and not domains and not device_classes and not ensure_domains
    cache_key = "entities_all"
    if use_cache:
        cached = _HassCache.get(cache_key)
        if cached is not None:
            return json_response({"entities": cached})

    # Build entity_id → platform (integration) lookup from entity registry
    platform_map = {}
    try:
        from homeassistant.helpers import entity_registry as er
        ent_reg = er.async_get(hass)
        for entry in ent_reg.entities.values():
            platform_map[entry.entity_id] = entry.platform
    except Exception:
        pass  # Graceful fallback — entities just won't have integration info

    ensured = []   # entities from ensure_domains — always included
    general = []   # everything else — capped

    for s in hass.states.async_all():
        eid = s.entity_id
        eid_lower = eid.lower()
        if domains and not any(eid_lower.startswith(d + ".") for d in domains):
            continue
        if device_classes:
            dc = (s.attributes.get("device_class") or "").lower()
            if dc not in device_classes:
                continue
        fname = str(s.attributes.get("friendly_name", "")).lower()
        if query and query not in eid_lower and query not in fname:
            continue
        entry = {
            "entity_id": eid,
            "friendly_name": s.attributes.get("friendly_name"),
            "icon": s.attributes.get("icon"),
            "state": s.state,
            "device_class": s.attributes.get("device_class"),
            "integration": platform_map.get(eid),
        }
        if data.get("with_attributes"):
            # Exclude very large / unserializable attributes
            attrs = {}
            for ak, av in s.attributes.items():
                try:
                    import json as _json
                    _json.dumps(av)
                    attrs[ak] = av
                except Exception:
                    attrs[ak] = str(av)
            entry["attributes"] = attrs
        if ensure_domains and not domains and any(eid_lower.startswith(d + ".") for d in ensure_domains):
            ensured.append(entry)
        else:
            general.append(entry)

    # Always include all ensured entities, fill remaining cap with general entities
    cap = 1000
    remaining = max(0, cap - len(ensured))
    entities = ensured + general[:remaining]

    if use_cache:
        _HassCache.set(cache_key, entities)

    return json_response({"entities": entities})


async def get_version(hass):
    """Get version info."""
    from homeassistant.const import __version__ as ha_version_const

    is_haos = False
    try:
        is_haos = hass.data.get('supervisor', {}).get('addon_info') is not None or \
                  hass.data.get('homeassistant', {}).get('installation_type') == 'hassio'
    except Exception as e:
        _LOGGER.debug("Could not detect HAOS: %s", e)

    return json_response({
        "ha_version": ha_version_const,
        "integration_version": VERSION,
        "is_haos": is_haos
    })


async def get_devices(hass):
    """Return all registered devices with integration, manufacturer, and model."""
    cached = _HassCache.get("devices")
    if cached is not None:
        return json_response({"success": True, "devices": cached})
    try:
        from homeassistant.helpers import device_registry as dr
        dev_reg = dr.async_get(hass)
        devices = []
        for d in dev_reg.devices.values():
            identifiers = list(d.identifiers) if d.identifiers else []
            integration = identifiers[0][0] if identifiers else None
            devices.append({
                "id": d.id,
                "name": d.name_by_user or d.name or d.id,
                "manufacturer": d.manufacturer,
                "model": d.model,
                "integration": integration,
            })
        _HassCache.set("devices", devices)
        return json_response({"success": True, "devices": devices})
    except Exception as e:
        _LOGGER.debug("get_devices failed: %s", e)
        return json_response({"success": True, "devices": []})


async def get_areas(hass):
    """Return all registered areas as id/name pairs."""
    cached = _HassCache.get("areas")
    if cached is not None:
        return json_response({"success": True, "areas": cached})
    try:
        from homeassistant.helpers import area_registry as ar
        area_reg = ar.async_get(hass)
        areas = [{"id": a.id, "name": a.name} for a in area_reg.areas.values()]
        _HassCache.set("areas", areas)
        return json_response({"success": True, "areas": areas})
    except Exception as e:
        _LOGGER.debug("get_areas failed: %s", e)
        return json_response({"success": True, "areas": []})


async def get_labels(hass):
    """Return all registered labels as id/name pairs."""
    try:
        from homeassistant.helpers import label_registry as lr
        label_reg = lr.async_get(hass)
        labels = [{"id": lb.label_id, "name": lb.name} for lb in label_reg.labels.values()]
        return json_response({"success": True, "labels": labels})
    except Exception as e:
        _LOGGER.debug("get_labels failed: %s", e)
        return json_response({"success": True, "labels": []})


async def get_floors(hass):
    """Return all registered floors as id/name pairs."""
    try:
        from homeassistant.helpers import floor_registry as fr
        floor_reg = fr.async_get(hass)
        floors = [{"id": f.floor_id, "name": f.name} for f in floor_reg.floors.values()]
        return json_response({"success": True, "floors": floors})
    except Exception as e:
        _LOGGER.debug("get_floors failed: %s", e)
        return json_response({"success": True, "floors": []})


async def reload_automations(hass):
    """Reload automations without restarting HA."""
    try:
        await hass.services.async_call("automation", "reload")
        return json_response({"success": True, "message": "Automations reloaded"})
    except Exception as e:
        _LOGGER.error("reload_automations failed: %s", e)
        return json_response({"success": False, "message": str(e)})


async def reload_yaml(hass, data):
    """Reload a specific HA YAML domain (scripts, scenes, groups, etc.)."""
    RELOADABLE = {
        "automation":       ("automation", "reload"),
        "script":           ("script",     "reload"),
        "scene":            ("scene",      "reload"),
        "group":            ("group",      "reload"),
        "input_boolean":    ("input_boolean", "reload"),
        "input_number":     ("input_number",  "reload"),
        "input_select":     ("input_select",  "reload"),
        "input_text":       ("input_text",    "reload"),
        "input_datetime":   ("input_datetime","reload"),
        "input_button":     ("input_button",  "reload"),
        "timer":            ("timer",         "reload"),
        "counter":          ("counter",       "reload"),
        "schedule":         ("schedule",      "reload"),
        "template":         ("template",      "reload"),
        "rest":             ("rest",          "reload"),
        "homeassistant":    ("homeassistant", "reload_config_entry"),
        "core":             ("homeassistant", "reload_all"),
    }
    domain = (data.get("domain") or "").strip().lower()
    if not domain:
        return json_response({"success": False, "message": "domain is required"})
    entry = RELOADABLE.get(domain)
    if not entry:
        return json_response({"success": False, "message": f"'{domain}' is not reloadable via this tool"})
    try:
        await hass.services.async_call(entry[0], entry[1])
        return json_response({"success": True, "message": f"{domain} reloaded"})
    except Exception as e:
        return json_response({"success": False, "message": str(e)})


async def get_themes(hass):
    """Return all installed theme names."""
    try:
        themes = list(getattr(hass.data.get('frontend_storage', {}), 'themes', {}).keys())
        # Fallback: try hass.themes directly
        if not themes:
            themes_obj = getattr(hass, 'themes', None)
            if themes_obj:
                themes = list(getattr(themes_obj, 'themes', {}).keys())
        return json_response({"success": True, "themes": themes})
    except Exception as e:
        _LOGGER.debug("get_themes failed: %s", e)
        return json_response({"success": True, "themes": []})


async def get_addons(hass):
    """Return installed Supervisor add-ons (HAOS only)."""
    try:
        hassio = hass.components.hassio
        if not hassio.is_hassio():
            return json_response({"success": True, "addons": []})
        addons = await hassio.async_get_addon_store_info()
        result = [{"slug": a["slug"], "name": a["name"]} for a in addons if a.get("installed")]
        return json_response({"success": True, "addons": result})
    except Exception as e:
        _LOGGER.debug("get_addons failed: %s", e)
        return json_response({"success": True, "addons": []})


async def get_services(hass):
    """Return all registered HA services with full metadata from services.yaml.

    Uses async_get_all_descriptions() — the same source the HA frontend uses —
    so fields, selectors, descriptions and examples are always complete.
    """
    cached = _HassCache.get("services")
    if cached is not None:
        return json_response({"success": True, "services": cached})

    try:
        from homeassistant.helpers.service import async_get_all_descriptions

        # async_get_all_descriptions returns:
        # { domain: { service_name: { name, description, fields: { key: { description, example, selector, required } } } } }
        descriptions = await async_get_all_descriptions(hass)

        services = []
        for domain, domain_services in descriptions.items():
            for service_name, meta in domain_services.items():
                if meta is None:
                    meta = {}
                raw_fields = meta.get("fields") or {}
                fields = {}
                for k, v in raw_fields.items():
                    if not isinstance(v, dict):
                        continue
                    # Skip collapsed section headers (they have a "fields" subkey but no selector)
                    if "fields" in v and "selector" not in v:
                        # Flatten advanced/collapsed sections into top-level fields
                        for sk, sv in v["fields"].items():
                            if isinstance(sv, dict):
                                fields[sk] = {
                                    "description": sv.get("description") or sv.get("name") or "",
                                    "required": bool(sv.get("required", False)),
                                    "example": sv.get("example"),
                                    "selector": sv.get("selector"),
                                }
                    else:
                        fields[k] = {
                            "description": v.get("description") or v.get("name") or "",
                            "required": bool(v.get("required", False)),
                            "example": v.get("example"),
                            "selector": v.get("selector"),
                        }
                services.append({
                    "service": f"{domain}.{service_name}",
                    "domain": domain,
                    "name": meta.get("name") or service_name,
                    "description": meta.get("description") or "",
                    "fields": fields,
                })

        services.sort(key=lambda s: s["service"])
        # Cache for 60 seconds — services rarely change
        _HassCache._store["services"] = (time.monotonic() - _HassCache._ttl + 60.0, services)
        return json_response({"success": True, "services": services})
    except Exception as e:
        _LOGGER.debug("get_services failed: %s", e)
        return json_response({"success": True, "services": []})


async def render_template(hass, data):
    """Render a Jinja2 template string using HA's template engine."""
    template_str = data.get("template", "")
    if not template_str:
        return json_response({"success": True, "result": ""})
    try:
        from homeassistant.helpers import template as tpl
        tmpl = tpl.Template(template_str, hass)
        result = await hass.async_add_executor_job(tmpl.async_render)
        return json_response({"success": True, "result": str(result)})
    except Exception as e:
        return json_response({"success": False, "error": str(e)})


async def call_service(hass, data):
    """Call a HA service with optional target and service data."""
    domain = data.get("domain", "")
    service = data.get("service", "")
    service_data = data.get("service_data") or {}
    target = data.get("target") or {}

    if not domain or not service:
        return json_response({"success": False, "error": "domain and service are required"})

    try:
        await hass.services.async_call(
            domain,
            service,
            service_data=service_data,
            target=target,
            blocking=True,
            return_response=False,
        )
        return json_response({"success": True})
    except Exception as e:
        return json_response({"success": False, "error": str(e)})


async def run_config_check(hass):
    """Run HA config check and return structured results.

    Tries (in order):
    1. ``hass --script check_config`` — works in all HA environments.
    2. ``ha core check`` — works on HAOS with the Supervisor CLI.

    Returns a dict with:
        success  – True if the check passed (no errors)
        output   – raw combined stdout+stderr text
        errors   – list of {file, line, message} dicts parsed from the output
    """
    import shutil
    import os

    config_dir = hass.config.config_dir

    def _run() -> dict:
        # Strategy 1: hass --script check_config
        hass_bin = shutil.which("hass")
        if hass_bin:
            try:
                result = subprocess.run(
                    [hass_bin, "--script", "check_config", "--config", config_dir],
                    capture_output=True, text=True, timeout=60
                )
                output = (result.stdout or "") + (result.stderr or "")
                return _parse_check_output(output, result.returncode, config_dir)
            except Exception as exc:
                _LOGGER.debug("hass check_config failed: %s", exc)

        # Strategy 2: ha core check (HAOS Supervisor)
        ha_bin = shutil.which("ha")
        if ha_bin:
            try:
                result = subprocess.run(
                    [ha_bin, "core", "check"],
                    capture_output=True, text=True, timeout=30
                )
                output = (result.stdout or "") + (result.stderr or "")
                return _parse_check_output(output, result.returncode, config_dir)
            except Exception as exc:
                _LOGGER.debug("ha core check failed: %s", exc)

        return {
            "success": False,
            "output": "Config check is not available in this environment.\n"
                      "Neither 'hass --script check_config' nor 'ha core check' could be run.",
            "errors": [],
        }

    result = await hass.async_add_executor_job(_run)
    return json_response({"success": True, "result": result})


def _parse_check_output(output: str, returncode: int, config_dir: str = "") -> dict:
    """Parse the raw text output from hass/ha config check into structured errors."""
    import re

    # Normalise config_dir so we can strip it from absolute paths
    config_prefix = config_dir.rstrip("/") + "/" if config_dir else ""

    def _rel(path: str) -> str:
        """Return path relative to config dir, or as-is if outside."""
        if config_prefix and path.startswith(config_prefix):
            return path[len(config_prefix):]
        return path

    errors = []
    lines = output.splitlines()

    # Two formats produced by hass --script check_config:
    #
    # Format A (inline):
    #   ERROR: ... (configuration.yaml, line 42)
    #
    # Format B (YAML parser — multi-line block):
    #   ERROR:annotatedyaml.loader:while parsing a block collection
    #     in "/config/configuration.yaml", line 16, column 3
    #   expected <block end>, but found ...
    #     in "/config/configuration.yaml", line 17, column 5
    #
    # Strategy: scan for `in "...", line N` lines (Format B) and pair each with
    # the nearest preceding error/message text that isn't itself a location line.

    # Regex for Format B location lines: in "path", line N[, column M]
    loc_re = re.compile(r'^\s*in\s+"([^"]+)",\s*line\s+(\d+)', re.IGNORECASE)
    # Regex for Format A: (path, line N) at end of line
    inline_re = re.compile(r'\(([^,)]+),\s*line\s*(\d+)\)')

    seen = set()  # deduplicate by (file, line)

    for i, line in enumerate(lines):
        # Format A
        m = inline_re.search(line)
        if m:
            key = (_rel(m.group(1).strip()), int(m.group(2)))
            if key not in seen:
                seen.add(key)
                errors.append({
                    "file": _rel(m.group(1).strip()),
                    "line": int(m.group(2)),
                    "message": line.strip(),
                })
            continue

        # Format B — location line
        m = loc_re.match(line)
        if m:
            fpath = _rel(m.group(1).strip())
            lineno = int(m.group(2))
            key = (fpath, lineno)
            if key in seen:
                continue
            seen.add(key)

            # Find nearest preceding non-location, non-empty line as the message
            msg = ""
            for j in range(i - 1, max(i - 5, -1), -1):
                candidate = lines[j].strip()
                if candidate and not loc_re.match(lines[j]):
                    msg = candidate
                    break

            errors.append({
                "file": fpath,
                "line": lineno,
                "message": msg or line.strip(),
            })

    # Deduplicate: keep only first occurrence of each (file, line) pair
    # (already handled via `seen` above)

    passed = returncode == 0 and not errors
    if "no errors found" in output.lower() or "all good" in output.lower():
        passed = True
        errors = []

    return {
        "success": passed,
        "output": output,
        "errors": errors,
    }

