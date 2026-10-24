"""Entry-scoped Home Assistant metadata used by editor and AI consumers."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any, TypedDict


SELECTOR_TYPES = frozenset(
    {
        "action",
        "addon",
        "app",
        "area",
        "assist_pipeline",
        "attribute",
        "automation_behavior",
        "backup_location",
        "boolean",
        "choose",
        "color_rgb",
        "color_temp",
        "condition",
        "config_entry",
        "constant",
        "conversation_agent",
        "country",
        "date",
        "datetime",
        "device",
        "duration",
        "entity",
        "file",
        "floor",
        "icon",
        "label",
        "language",
        "location",
        "media",
        "number",
        "numeric_threshold",
        "object",
        "qr_code",
        "select",
        "serial_port",
        "state",
        "statistic",
        "target",
        "template",
        "text",
        "theme",
        "time",
        "trigger",
    }
)

MAX_RECORDS = {
    "actions": 5000,
    "entities": 20000,
    "devices": 10000,
    "areas": 2000,
    "labels": 2000,
    "floors": 500,
}


class MetadataSnapshot(TypedDict):
    """Stable aggregate metadata response contract."""

    success: bool
    schema_version: int
    ha_version: str
    generated_at: float
    partial: bool
    failures: dict[str, str]
    capabilities: dict[str, bool]
    selector_types: list[str]
    domains: list[str]
    actions: list[dict[str, Any]]
    entities: list[dict[str, Any]]
    devices: list[dict[str, Any]]
    areas: list[dict[str, Any]]
    labels: list[dict[str, Any]]
    floors: list[dict[str, Any]]


def _bounded(
    records: list[dict[str, Any]], section: str, key: str
) -> list[dict[str, Any]]:
    records.sort(key=lambda item: str(item.get(key, "")).casefold())
    return records[: MAX_RECORDS[section]]


def normalize_actions(descriptions: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize Home Assistant action descriptions without losing selectors."""
    actions: list[dict[str, Any]] = []
    for domain, domain_actions in descriptions.items():
        if not isinstance(domain_actions, dict):
            continue
        for action_name, raw_meta in domain_actions.items():
            meta = raw_meta if isinstance(raw_meta, dict) else {}
            fields: dict[str, dict[str, Any]] = {}
            for field_name, raw_field in (meta.get("fields") or {}).items():
                if not isinstance(raw_field, dict):
                    continue
                candidates = (
                    raw_field.get("fields")
                    if "fields" in raw_field and "selector" not in raw_field
                    else {field_name: raw_field}
                )
                for nested_name, nested in (candidates or {}).items():
                    if not isinstance(nested, dict):
                        continue
                    fields[nested_name] = {
                        "name": nested.get("name") or nested_name,
                        "description": nested.get("description")
                        or nested.get("name")
                        or "",
                        "required": bool(nested.get("required", False)),
                        "example": nested.get("example", nested.get("default")),
                        "default": nested.get("default"),
                        "selector": nested.get("selector"),
                    }
            action_id = f"{domain}.{action_name}"
            target = meta.get("target")
            actions.append(
                {
                    "id": action_id,
                    "service": action_id,
                    "domain": domain,
                    "name": meta.get("name") or action_name,
                    "description": meta.get("description") or "",
                    "supports_target": bool(target),
                    "target": target,
                    "fields": fields,
                }
            )
    return _bounded(actions, "actions", "id")


def _selector_name(class_name: str) -> str:
    stem = class_name[:-8]
    if stem == "DateTime":
        return "datetime"
    return re.sub(r"(?<!^)(?=[A-Z])", "_", stem).lower().replace("r_g_b", "rgb")


def _version_at_least(version: str, minimum: tuple[int, int]) -> bool:
    match = re.match(r"^(\d+)\.(\d+)", version)
    return bool(match and (int(match.group(1)), int(match.group(2))) >= minimum)


class HAMetadataManager:
    """Own a bounded metadata snapshot and refresh it after HA changes."""

    _ttl = 60.0
    _event_types = (
        "entity_registry_updated",
        "device_registry_updated",
        "area_registry_updated",
        "label_registry_updated",
        "floor_registry_updated",
        "service_registered",
        "service_removed",
    )

    def __init__(self, hass) -> None:
        self.hass = hass
        self.snapshot: MetadataSnapshot | None = None
        self._updated = 0.0
        self._lock = asyncio.Lock()
        self._unsubscribers: list[Any] = []
        self._refresh_task = None

    def subscribe(self) -> None:
        """Refresh shortly after registry or action metadata changes."""
        if self._unsubscribers or self.hass is None:
            return
        for event_type in self._event_types:
            self._unsubscribers.append(
                self.hass.bus.async_listen(event_type, self._handle_event)
            )

    def _handle_event(self, _event) -> None:
        self._updated = 0.0
        self.hass.loop.call_soon_threadsafe(self._schedule_refresh)

    def _schedule_refresh(self) -> None:
        """Create one refresh task after crossing onto Home Assistant's loop."""
        if self._refresh_task is None or self._refresh_task.done():
            self._refresh_task = self.hass.async_create_task(self.async_get(force=True))

    async def async_get(self, force: bool = False) -> MetadataSnapshot:
        if (
            not force
            and self.snapshot is not None
            and time.monotonic() - self._updated < self._ttl
        ):
            return self.snapshot
        async with self._lock:
            if (
                not force
                and self.snapshot is not None
                and time.monotonic() - self._updated < self._ttl
            ):
                return self.snapshot
            self.snapshot = await self._build_snapshot()
            self._updated = time.monotonic()
            return self.snapshot

    async def _build_snapshot(self) -> MetadataSnapshot:
        failures: dict[str, str] = {}
        previous: dict[str, Any] = (
            dict(self.snapshot) if self.snapshot is not None else {}
        )

        async def section(name: str, builder):
            try:
                return await builder()
            except Exception:
                failures[name] = f"{name} metadata is unavailable"
                return previous.get(name, [])

        async def actions():
            from homeassistant.helpers.service import async_get_all_descriptions

            return normalize_actions(await async_get_all_descriptions(self.hass))

        async def entities():
            platform_map: dict[str, str | None] = {}
            from homeassistant.helpers import entity_registry as er

            registry = er.async_get(self.hass)
            for entry in registry.entities.values():
                platform_map[entry.entity_id] = entry.platform
            values = [
                {
                    "id": state.entity_id,
                    "entity_id": state.entity_id,
                    "name": state.attributes.get("friendly_name") or state.entity_id,
                    "friendly_name": state.attributes.get("friendly_name"),
                    "domain": state.entity_id.partition(".")[0],
                    "state": state.state,
                    "icon": state.attributes.get("icon"),
                    "device_class": state.attributes.get("device_class"),
                    "integration": platform_map.get(state.entity_id),
                }
                for state in self.hass.states.async_all()
            ]
            return _bounded(values, "entities", "id")

        async def registry(name: str):
            if name == "devices":
                from homeassistant.helpers import device_registry as module

                dev_reg = module.async_get(self.hass)
                records = [
                    {
                        "id": item.id,
                        "name": item.name_by_user or item.name or item.id,
                        "manufacturer": item.manufacturer,
                        "model": item.model,
                    }
                    for item in (
                        dev_reg.async_get(d) if isinstance(d, str) else d
                        for d in dev_reg.devices
                    )
                    if item is not None
                ]
            elif name == "areas":
                from homeassistant.helpers import area_registry as module

                values = module.async_get(self.hass).areas.values()
                records = [{"id": item.id, "name": item.name} for item in values]
            elif name == "labels":
                from homeassistant.helpers import label_registry as module

                values = module.async_get(self.hass).labels.values()
                records = [{"id": item.label_id, "name": item.name} for item in values]
            else:
                from homeassistant.helpers import floor_registry as module

                values = module.async_get(self.hass).floors.values()
                records = [{"id": item.floor_id, "name": item.name} for item in values]
            return _bounded(records, name, "id")

        (
            action_data,
            entity_data,
            device_data,
            area_data,
            label_data,
            floor_data,
        ) = await asyncio.gather(
            section("actions", actions),
            section("entities", entities),
            section("devices", lambda: registry("devices")),
            section("areas", lambda: registry("areas")),
            section("labels", lambda: registry("labels")),
            section("floors", lambda: registry("floors")),
        )
        try:
            from homeassistant.const import __version__ as ha_version
        except Exception:
            ha_version = "unknown"
        selector_types = set(SELECTOR_TYPES)
        try:
            import homeassistant.helpers.selector as selectors

            selector_types = {
                _selector_name(name)
                for name in dir(selectors)
                if name.endswith("Selector") and name != "Selector"
            } or selector_types
        except Exception:
            failures["selectors"] = (
                "live selector metadata is unavailable; using fallback catalog"
            )
        domains = {item["domain"] for item in action_data}
        domains.update(item["domain"] for item in entity_data)
        return {
            "success": True,
            "schema_version": 1,
            "ha_version": ha_version,
            "generated_at": time.time(),
            "partial": bool(failures),
            "failures": failures,
            "capabilities": {
                "plural_automation_keys": _version_at_least(ha_version, (2024, 10)),
                "action_key": _version_at_least(ha_version, (2024, 10)),
                "app_selector": "app" in selector_types,
                "addon_selector": "addon" in selector_types,
                "floor_selector": "floor" in selector_types,
                "label_selector": "label" in selector_types,
            },
            "selector_types": sorted(selector_types),
            "domains": sorted(domains),
            "actions": action_data,
            "entities": entity_data,
            "devices": device_data,
            "areas": area_data,
            "labels": label_data,
            "floors": floor_data,
        }

    async def async_close(self) -> None:
        for unsubscribe in self._unsubscribers:
            unsubscribe()
        self._unsubscribers.clear()
        if self._refresh_task is not None and not self._refresh_task.done():
            self._refresh_task.cancel()
            await asyncio.gather(self._refresh_task, return_exceptions=True)
        self._refresh_task = None
        self.snapshot = None
        self._updated = 0.0
