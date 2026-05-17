"YAML generation helpers for automations, scripts, and scenes."
from __future__ import annotations

import re


def build_data_block(values: dict, domain: str, ind: str) -> str:
    """Build data block from extracted values."""
    if not values:
        return f"\n{ind}    data: {{}}"

    data_lines = []
    for key, value in values.items():
        if isinstance(value, list):
            data_lines.append(f"{ind}      {key}: {value}")
        else:
            data_lines.append(f"{ind}      {key}: {value}")

    if data_lines:
        return f"\n{ind}    data:\n" + "\n".join(data_lines)
    return f"\n{ind}    data: {{}}"


def build_conditions_yaml(conditions: list[dict], ind: str) -> str:
    """Build conditions YAML block."""
    if not conditions:
        return f"{ind}  conditions: []"

    cond_lines = [f"{ind}  conditions:"]
    for cond in conditions:
        ctype = cond.get("condition")
        if ctype == "state":
            cond_lines.append(f"{ind}  - condition: state")
            cond_lines.append(f"{ind}    entity_id: {cond['entity_id']}")
            cond_lines.append(f"{ind}    state: '{cond['state']}'")
        elif ctype == "time":
            cond_lines.append(f"{ind}  - condition: time")
            if "weekday" in cond:
                cond_lines.append(f"{ind}    weekday:")
                for day in cond["weekday"]:
                    cond_lines.append(f"{ind}    - {day}")
            if "after" in cond:
                cond_lines.append(f"{ind}    after: '{cond['after']}'")
            if "before" in cond:
                cond_lines.append(f"{ind}    before: '{cond['before']}'")
        elif ctype == "numeric_state":
            cond_lines.append(f"{ind}  - condition: numeric_state")
            cond_lines.append(f"{ind}    entity_id: {cond['entity_id']}")
            if "above" in cond:
                cond_lines.append(f"{ind}    above: {cond['above']}")
            if "below" in cond:
                cond_lines.append(f"{ind}    below: {cond['below']}")
        elif ctype == "zone":
            cond_lines.append(f"{ind}  - condition: zone")
            cond_lines.append(f"{ind}    entity_id: {cond['entity_id']}")
            cond_lines.append(f"{ind}    zone: {cond['zone']}")
        elif ctype in ("or", "and"):
            cond_lines.append(f"{ind}  - condition: {ctype}")
            cond_lines.append(f"{ind}    conditions:")
            for sub in cond.get("conditions", []):
                sub_type = sub.get("condition")
                if sub_type == "state":
                    cond_lines.append(f"{ind}    - condition: state")
                    cond_lines.append(f"{ind}      entity_id: {sub['entity_id']}")
                    cond_lines.append(f"{ind}      state: '{sub['state']}'")

    return "\n".join(cond_lines)


def build_target_yaml(entities: list[str], ind: str) -> str:
    """Build target YAML (single entity or multiple)."""
    if len(entities) == 1:
        return f"target:\n{ind}          entity_id: {entities[0]}"
    else:
        entity_list = "\n".join([f"{ind}          - {ent}" for ent in entities])
        return f"target:\n{ind}          entity_id:\n{entity_list}"


def generate_multi_intent_automation(uid, name, domain, actions, entities, times, values, conditions, ind, hdr):
    """Generate automation with multiple intents (on/off at different times)."""
    on_data = build_data_block(values, domain, ind)
    target_yaml = build_target_yaml(entities, ind)

    triggers_yaml = f"""{ind}  triggers:
{ind}  - trigger: time
{ind}    at: '{times[0]}'
{ind}    id: 'on'
{ind}  - trigger: time
{ind}    at: '{times[1]}'
{ind}    id: 'off'"""

    conditions_yaml = build_conditions_yaml(conditions, ind)

    actions_yaml = f"""{ind}  actions:
{ind}  - choose:
{ind}    - conditions:
{ind}      - condition: trigger
{ind}        id: 'on'
{ind}      sequence:
{ind}      - action: {domain}.{actions['on']}
{ind}        metadata: {{}}
{ind}        {target_yaml}{on_data}
{ind}    - conditions:
{ind}      - condition: trigger
{ind}        id: 'off'
{ind}      sequence:
{ind}      - action: {domain}.{actions['off']}
{ind}        metadata: {{}}
{ind}        {target_yaml}
{ind}        data: {{}}"""

    return f"""{hdr}- id: '{uid}'
{ind}  alias: {name}
{ind}  description: Multi-intent automation
{triggers_yaml}
{conditions_yaml}
{actions_yaml}
{ind}  mode: single"""


def generate_single_intent_automation(uid, name, domain, actions, entities, trigger_info, values, conditions, ind, hdr, query_lower, detect_additional_actions_fn):
    """Generate single intent automation."""
    action_type = "on"
    if "off" in query_lower or "close" in query_lower:
        action_type = "off"

    action_name = actions.get(action_type, "turn_on")

    ttype = trigger_info.get("type", "time")
    if ttype == "sun":
        triggers_yaml = build_sun_trigger_yaml(trigger_info, ind)
    elif ttype == "time_pattern":
        triggers_yaml = build_time_pattern_trigger_yaml(trigger_info, ind)
    elif ttype == "zone":
        triggers_yaml = build_zone_trigger_yaml(trigger_info, ind)
    elif ttype == "webhook":
        triggers_yaml = build_webhook_trigger_yaml(trigger_info, ind)
    elif ttype == "mqtt":
        triggers_yaml = build_mqtt_trigger_yaml(trigger_info, ind)
    elif ttype == "time":
        time_val = trigger_info["times"][0] if trigger_info.get("times") else "12:00:00"
        triggers_yaml = f"{ind}  triggers:\n{ind}  - trigger: time\n{ind}    at: '{time_val}'"
    elif ttype == "state":
        triggers_yaml = (
            f"{ind}  triggers:\n"
            f"{ind}  - trigger: state\n"
            f"{ind}    entity_id: {trigger_info['entity_id']}\n"
            f"{ind}    to: '{trigger_info['to']}'"
        )
    elif ttype == "numeric_state":
        threshold_key = "above" if "above" in trigger_info else "below"
        threshold_val = trigger_info[threshold_key]
        triggers_yaml = (
            f"{ind}  triggers:\n"
            f"{ind}  - trigger: numeric_state\n"
            f"{ind}    entity_id: {trigger_info['entity_id']}\n"
            f"{ind}    {threshold_key}: {threshold_val}"
        )
    else:
        triggers_yaml = (
            f"{ind}  triggers:\n"
            f"{ind}  - trigger: state\n"
            f"{ind}    entity_id: {trigger_info.get('entity_id', 'binary_sensor.your_sensor')}\n"
            f"{ind}    to: 'on'"
        )

    conditions_yaml = build_conditions_yaml(conditions, ind)
    data_block = build_data_block(values, domain, ind)
    target_yaml = build_target_yaml(entities, ind)

    additional_actions = detect_additional_actions_fn(query_lower)

    actions_yaml_lines = [f"{ind}  actions:"]
    actions_yaml_lines.append(f"{ind}  - action: {domain}.{action_name}")
    actions_yaml_lines.append(f"{ind}    metadata: {{}}")
    actions_yaml_lines.append(f"{ind}    {target_yaml}{data_block}")

    for add_action in additional_actions:
        if add_action["type"] == "notify":
            actions_yaml_lines.append(f"{ind}  - action: notify.notify")
            actions_yaml_lines.append(f"{ind}    metadata: {{}}")
            actions_yaml_lines.append(f"{ind}    data:")
            actions_yaml_lines.append(f"{ind}      message: \"{add_action['message']}\"")
        elif add_action["type"] == "delay":
            duration_parts = add_action["duration"].split(":")
            hours, minutes, seconds = int(duration_parts[0]), int(duration_parts[1]), int(duration_parts[2])
            actions_yaml_lines.append(f"{ind}  - delay:")
            actions_yaml_lines.append(f"{ind}      hours: {hours}")
            actions_yaml_lines.append(f"{ind}      minutes: {minutes}")
            actions_yaml_lines.append(f"{ind}      seconds: {seconds}")
        elif add_action["type"] == "scene":
            actions_yaml_lines.append(f"{ind}  - action: scene.turn_on")
            actions_yaml_lines.append(f"{ind}    metadata: {{}}")
            actions_yaml_lines.append(f"{ind}    target:")
            actions_yaml_lines.append(f"{ind}      entity_id: {add_action['scene_id']}")
        elif add_action["type"] == "script":
            actions_yaml_lines.append(f"{ind}  - action: script.turn_on")
            actions_yaml_lines.append(f"{ind}    metadata: {{}}")
            actions_yaml_lines.append(f"{ind}    target:")
            actions_yaml_lines.append(f"{ind}      entity_id: {add_action['script_id']}")
        elif add_action["type"] == "wait_template":
            actions_yaml_lines.append(f"{ind}  - wait_template: \"{add_action['template']}\"")
            actions_yaml_lines.append(f"{ind}    timeout: '{add_action.get('timeout', '00:05:00')}'")
            actions_yaml_lines.append(f"{ind}    continue_on_timeout: true")
        elif add_action["type"] == "repeat":
            actions_yaml_lines.append(f"{ind}  - repeat:")
            actions_yaml_lines.append(f"{ind}      count: {add_action['count']}")
            actions_yaml_lines.append(f"{ind}      sequence:")
            actions_yaml_lines.append(f"{ind}      - action: {domain}.{action_name}")
            actions_yaml_lines.append(f"{ind}        metadata: {{}}")
            actions_yaml_lines.append(f"{ind}        {target_yaml}")
            actions_yaml_lines.append(f"{ind}        data: {{}}")

    actions_yaml = "\n".join(actions_yaml_lines)

    return f"""{hdr}- id: '{uid}'
{ind}  alias: {name}
{ind}  description: Automated control
{triggers_yaml}
{conditions_yaml}
{actions_yaml}
{ind}  mode: single"""


def build_sun_trigger_yaml(trigger_info: dict, ind: str) -> str:
    """Build sun trigger YAML block."""
    event = trigger_info.get("event", "sunset")
    offset = trigger_info.get("offset", "+00:00:00")
    lines = [
        f"{ind}  triggers:",
        f"{ind}  - trigger: sun",
        f"{ind}    event: {event}",
    ]
    if offset and offset not in ("+00:00:00", "-00:00:00"):
        lines.append(f"{ind}    offset: '{offset}'")
    return "\n".join(lines)


def build_time_pattern_trigger_yaml(trigger_info: dict, ind: str) -> str:
    """Build time_pattern trigger YAML block."""
    lines = [
        f"{ind}  triggers:",
        f"{ind}  - trigger: time_pattern",
    ]
    for key in ("hours", "minutes", "seconds"):
        if key in trigger_info:
            lines.append(f"{ind}    {key}: '{trigger_info[key]}'")
    return "\n".join(lines)


def build_zone_trigger_yaml(trigger_info: dict, ind: str) -> str:
    """Build zone trigger YAML block."""
    return "\n".join([
        f"{ind}  triggers:",
        f"{ind}  - trigger: zone",
        f"{ind}    entity_id: {trigger_info.get('entity_id', 'person.your_person')}",
        f"{ind}    zone: {trigger_info.get('zone', 'zone.home')}",
        f"{ind}    event: {trigger_info.get('event', 'enter')}",
    ])


def build_webhook_trigger_yaml(trigger_info: dict, ind: str) -> str:
    """Build webhook trigger YAML block."""
    return "\n".join([
        f"{ind}  triggers:",
        f"{ind}  - trigger: webhook",
        f"{ind}    webhook_id: {trigger_info.get('webhook_id', 'blueprint_studio_webhook')}",
        f"{ind}    allowed_methods:",
        f"{ind}    - POST",
        f"{ind}    local_only: true",
    ])


def build_mqtt_trigger_yaml(trigger_info: dict, ind: str) -> str:
    """Build MQTT trigger YAML block."""
    return "\n".join([
        f"{ind}  triggers:",
        f"{ind}  - trigger: mqtt",
        f"{ind}    topic: {trigger_info.get('topic', 'homeassistant/sensor/your_device/state')}",
    ])


def generate_multi_domain_automation(uid, name, domain_intents, trigger_info, conditions, ind, hdr):
    """Generate automation with actions across multiple domains.

    domain_intents: list of {domain, entities, action} dicts
    """
    # Build trigger YAML based on trigger type
    ttype = trigger_info.get("type", "time")
    if ttype == "sun":
        triggers_yaml = build_sun_trigger_yaml(trigger_info, ind)
    elif ttype == "time_pattern":
        triggers_yaml = build_time_pattern_trigger_yaml(trigger_info, ind)
    elif ttype == "zone":
        triggers_yaml = build_zone_trigger_yaml(trigger_info, ind)
    elif ttype == "webhook":
        triggers_yaml = build_webhook_trigger_yaml(trigger_info, ind)
    elif ttype == "mqtt":
        triggers_yaml = build_mqtt_trigger_yaml(trigger_info, ind)
    elif ttype == "time":
        time_val = trigger_info.get("times", ["12:00:00"])[0]
        triggers_yaml = f"{ind}  triggers:\n{ind}  - trigger: time\n{ind}    at: '{time_val}'"
    elif ttype == "state":
        triggers_yaml = (
            f"{ind}  triggers:\n"
            f"{ind}  - trigger: state\n"
            f"{ind}    entity_id: {trigger_info.get('entity_id', 'binary_sensor.your_sensor')}\n"
            f"{ind}    to: '{trigger_info.get('to', 'on')}'"
        )
    elif ttype == "numeric_state":
        threshold_key = "above" if "above" in trigger_info else "below"
        triggers_yaml = (
            f"{ind}  triggers:\n"
            f"{ind}  - trigger: numeric_state\n"
            f"{ind}    entity_id: {trigger_info.get('entity_id', 'sensor.your_sensor')}\n"
            f"{ind}    {threshold_key}: {trigger_info[threshold_key]}"
        )
    else:
        triggers_yaml = f"{ind}  triggers:\n{ind}  - trigger: state\n{ind}    entity_id: binary_sensor.your_sensor\n{ind}    to: 'on'"

    conditions_yaml = build_conditions_yaml(conditions, ind)

    # Build multi-domain action list
    action_lines = [f"{ind}  actions:"]
    for intent in domain_intents:
        domain = intent["domain"]
        action = intent["action"]
        entities = intent["entities"]

        if len(entities) == 1:
            target_block = f"target:\n{ind}      entity_id: {entities[0]}"
        else:
            entity_list = "\n".join([f"{ind}        - {e}" for e in entities])
            target_block = f"target:\n{ind}      entity_id:\n{entity_list}"

        action_lines.append(f"{ind}  - action: {domain}.{action}")
        action_lines.append(f"{ind}    metadata: {{}}")
        action_lines.append(f"{ind}    {target_block}")
        action_lines.append(f"{ind}    data: {{}}")

    actions_yaml = "\n".join(action_lines)

    domain_summary = " + ".join(i["domain"] for i in domain_intents)

    return f"""{hdr}- id: '{uid}'
{ind}  alias: {name}
{ind}  description: Multi-domain automation ({domain_summary})
{triggers_yaml}
{conditions_yaml}
{actions_yaml}
{ind}  mode: single"""


def get_scene_defaults(scene_type: str | None) -> dict:
    """Get default values for different scene types."""
    scene_presets = {
        "morning": {
            "brightness": 100,
            "kelvin": 4000,
            "description": "Energizing morning ambiance"
        },
        "evening": {
            "brightness": 40,
            "kelvin": 2700,
            "color": [255, 147, 41],
            "description": "Relaxing evening atmosphere"
        },
        "movie": {
            "brightness": 10,
            "color": [0, 0, 100],
            "description": "Perfect for watching movies"
        },
        "reading": {
            "brightness": 80,
            "kelvin": 4000,
            "description": "Comfortable reading light"
        },
        "romantic": {
            "brightness": 20,
            "color": [255, 0, 100],
            "description": "Romantic mood lighting"
        },
        "party": {
            "brightness": 100,
            "color": [255, 0, 255],
            "description": "Energetic party atmosphere"
        },
        "relax": {
            "brightness": 50,
            "kelvin": 2700,
            "description": "Calm and relaxing environment"
        }
    }
    return scene_presets.get(scene_type, {})


def get_scene_icon(scene_type: str | None, query: str) -> str:
    """Get appropriate icon for scene."""
    icon_map = {
        "morning": "mdi:weather-sunny",
        "evening": "mdi:weather-night",
        "movie": "mdi:movie",
        "reading": "mdi:book-open",
        "romantic": "mdi:heart",
        "party": "mdi:party-popper",
        "relax": "mdi:sofa",
    }

    if scene_type and scene_type in icon_map:
        return icon_map[scene_type]

    if any(word in query for word in ["bright", "day"]):
        return "mdi:lightbulb-on"
    elif any(word in query for word in ["dim", "dark"]):
        return "mdi:lightbulb-outline"
    elif any(word in query for word in ["work", "office"]):
        return "mdi:desk"
    elif any(word in query for word in ["sleep", "bed"]):
        return "mdi:sleep"

    return "mdi:lightbulb-group"


def get_scene_description(scene_type: str | None, name: str) -> str:
    """Get scene description."""
    if scene_type:
        defaults = get_scene_defaults(scene_type)
        return defaults.get("description", f"{name} scene")
    return f"Custom {name.lower()} scene"


def convert_automation_to_blueprint(content: str, name: str = "") -> str:
    """Convert an automation YAML to a blueprint.

    Algorithm:
    1. Parse the automation
    2. Extract hardcoded entity IDs → entity selector inputs
    3. Build blueprint: header with extracted inputs
    4. String-replace entity IDs with !input references
    5. Strip id: and alias: top-level keys
    6. Return complete blueprint YAML
    """
    import yaml as _yaml
    import re as _re

    # --- Parse with HA-aware loader ---
    class HALoader(_yaml.SafeLoader): pass
    def _ha_ctor(loader, node): return loader.construct_scalar(node)
    for _tag in ['!include', '!secret', '!env_var', '!input', '!lambda', '!extend']:
        HALoader.add_constructor(_tag, _ha_ctor)

    try:
        parsed = _yaml.load(content, Loader=HALoader)
    except Exception:
        parsed = None

    # Resolve: automation may be a list item or a direct dict
    is_list_item = isinstance(parsed, list) and bool(parsed)
    if is_list_item:
        auto = parsed[0]
    elif isinstance(parsed, dict):
        auto = parsed
    else:
        auto = {}

    bp_name = name or (auto.get('alias') or auto.get('id') or 'My Blueprint')
    # Carry the automation description into the blueprint header; collapse block scalars to one line
    _raw_desc = auto.get('description') or ''
    bp_description = ' '.join(str(_raw_desc).split())

    # --- Extract entity IDs from content (regex — safer than YAML traversal) ---
    # Pattern A: inline form  →  entity_id: domain.entity
    entity_inline_pat = _re.compile(r'(?:entity_id|entities):\s*([a-z0-9_]+\.[a-z0-9_]+)', _re.IGNORECASE)
    # Pattern B: list form   →  entity_id:\n  - domain.entity
    entity_list_pat = _re.compile(
        r'(?:entity_id|entities):\s*\n((?:[ \t]+-[ \t]+[a-z0-9_]+\.[a-z0-9_]+[ \t]*\n?)+)',
        _re.IGNORECASE | _re.MULTILINE
    )
    found_entities = []
    seen_entities: set = set()

    def _add_entity(eid: str) -> None:
        if eid not in seen_entities:
            seen_entities.add(eid)
            found_entities.append(eid)

    for m in entity_inline_pat.finditer(content):
        _add_entity(m.group(1))
    for m in entity_list_pat.finditer(content):
        for eid in _re.findall(r'[a-z0-9_]+\.[a-z0-9_]+', m.group(1)):
            _add_entity(eid)

    # Build input map: entity_id → input_name
    input_map: dict[str, str] = {}
    input_block_lines: list[str] = []
    # Count how many entities per domain so we can make generic names
    _domain_counter: dict[str, int] = {}
    for eid in found_entities:
        domain_part = eid.split('.')[0]
        _domain_counter[domain_part] = _domain_counter.get(domain_part, 0) + 1
    _domain_seen: dict[str, int] = {}
    for eid in found_entities:
        parts = eid.split('.')
        domain_part = parts[0]
        # Use generic "domain_entity" name; append counter only when multiple of same domain
        _domain_seen[domain_part] = _domain_seen.get(domain_part, 0) + 1
        count = _domain_seen[domain_part]
        total = _domain_counter[domain_part]
        base_name = f"{domain_part}_entity"
        input_name = base_name if total == 1 else f"{base_name}_{count}"
        input_map[eid] = input_name
        # Domain is always valid — it comes from the entity_id itself
        sel_block = f"        entity:\n          domain: {domain_part}"
        friendly = f"{domain_part.replace('_', ' ').title()} Entity" if total == 1 else f"{domain_part.replace('_', ' ').title()} Entity {count}"
        domain_label = domain_part.replace('_', ' ')
        input_block_lines.append(
            f"    {input_name}:\n"
            f"      name: {friendly}\n"
            f"      description: The {domain_label} entity for this automation\n"
            f"      selector:\n"
            f"{sel_block}"
        )

    # --- Pass 2: Extract numeric values ---
    NUMERIC_KEYS = {
        'above':              {'min': -50,  'max': 1000, 'step': 0.5},
        'below':              {'min': -50,  'max': 1000, 'step': 0.5},
        'temperature':        {'min': 0,    'max': 100,  'step': 0.5, 'unit_of_measurement': '°C'},
        'brightness':         {'min': 0,    'max': 255,  'step': 1},
        'brightness_pct':     {'min': 0,    'max': 100,  'step': 1, 'unit_of_measurement': '%'},
        'position':           {'min': 0,    'max': 100,  'step': 1, 'unit_of_measurement': '%'},
        'volume_level':       {'min': 0,    'max': 1,    'step': 0.01},
        'percentage':         {'min': 0,    'max': 100,  'step': 1, 'unit_of_measurement': '%'},
        'humidity':           {'min': 0,    'max': 100,  'step': 1, 'unit_of_measurement': '%'},
    }
    # color_temp / color_temp_kelvin use dedicated selectors, not number
    COLOR_TEMP_KEYS = {
        'color_temp':        {'min': 153,  'max': 500},
        'color_temp_kelvin': {'min': 1500, 'max': 8000},
    }
    NUMERIC_DESCRIPTIONS = {
        'above':              'Upper threshold value',
        'below':              'Lower threshold value',
        'temperature':        'Target temperature to set',
        'brightness':         'Target brightness level (0-255)',
        'brightness_pct':     'Target brightness percentage',
        'position':           'Target position percentage',
        'volume_level':       'Target volume level',
        'percentage':         'Target percentage value',
        'humidity':           'Target humidity percentage',
    }
    TARGET_KEYS = {'temperature', 'brightness', 'brightness_pct', 'position',
                   'volume_level', 'percentage', 'humidity'}
    used_names: set = set(input_map.values())
    numeric_inputs = []  # (input_name, key, value)

    for key, sel_config in NUMERIC_KEYS.items():
        pattern = _re.compile(rf'^\s+{key}:\s*(-?\d+(?:\.\d+)?)\s*$', _re.MULTILINE)
        for match in pattern.finditer(content):
            line_text = match.group(0)
            # Skip lines inside templates
            if '{{' in line_text or '}}' in line_text:
                continue
            value = match.group(1)
            fval = float(value)
            # Skip 0 and 1 unless they have a decimal point (often boolean-like)
            if abs(fval) <= 1 and '.' not in value:
                continue
            # Build input name
            if key in ('above', 'below'):
                base_name = f"{key}_threshold"
            elif key in TARGET_KEYS:
                base_name = f"target_{key}"
            else:
                base_name = key
            input_name = base_name
            suffix = 2
            while input_name in used_names:
                input_name = f"{base_name}_{suffix}"
                suffix += 1
            used_names.add(input_name)
            numeric_inputs.append((input_name, key, value))
            # Build selector block (quote string values that contain YAML special chars)
            sel_lines = "        number:\n"
            for sk, sv in sel_config.items():
                if isinstance(sv, str) and any(c in sv for c in ('%', '°', ':', '#', '&', '*', '!', '|', '>', "'", '"', '{', '}')):
                    sel_lines += f'          {sk}: "{sv}"\n'
                else:
                    sel_lines += f"          {sk}: {sv}\n"
            friendly_name = input_name.replace('_', ' ').title()
            description = NUMERIC_DESCRIPTIONS.get(key, f'{key.replace("_", " ").title()} value')
            input_block_lines.append(
                f"    {input_name}:\n"
                f"      name: {friendly_name}\n"
                f"      description: {description}\n"
                f"      default: {value}\n"
                f"      selector:\n"
                f"{sel_lines.rstrip()}"
            )

    # --- Pass 2b: Extract color_temp values (use color_temp selector, not number) ---
    for ct_key, ct_config in COLOR_TEMP_KEYS.items():
        ct_pattern = _re.compile(rf'^\s+{ct_key}:\s*(-?\d+(?:\.\d+)?)\s*$', _re.MULTILINE)
        for match in ct_pattern.finditer(content):
            line_text = match.group(0)
            if '{{' in line_text or '}}' in line_text:
                continue
            value = match.group(1)
            fval = float(value)
            base_name = f"target_{ct_key}"
            input_name = base_name
            suffix = 2
            while input_name in used_names:
                input_name = f"{base_name}_{suffix}"
                suffix += 1
            used_names.add(input_name)
            numeric_inputs.append((input_name, ct_key, value))
            desc = 'Target color temperature in mireds' if ct_key == 'color_temp' else 'Target color temperature in Kelvin'
            friendly_name = input_name.replace('_', ' ').title()
            input_block_lines.append(
                f"    {input_name}:\n"
                f"      name: {friendly_name}\n"
                f"      description: {desc}\n"
                f"      default: {value}\n"
                f"      selector:\n"
                f"        color_temp:\n"
                f"          min: {ct_config['min']}\n"
                f"          max: {ct_config['max']}"
            )

    # --- Pass 3: Extract delay/for durations ---
    delay_n = 0
    # Block-form: delay:\n  seconds: 10  OR  for:\n  seconds: 10
    delay_block_pat = _re.compile(
        r'((?:delay|for):\s*\n(?:\s+(?:hours|minutes|seconds):\s*\d+\s*\n?)+)', _re.MULTILINE
    )
    for match in delay_block_pat.finditer(content):
        block = match.group(1)
        is_for = block.lstrip().startswith('for:')
        _none = type('', (), {'group': lambda s, n: '0'})()
        hours = int((_re.search(r'hours:\s*(\d+)', block) or _none).group(1))
        minutes = int((_re.search(r'minutes:\s*(\d+)', block) or _none).group(1))
        seconds = int((_re.search(r'seconds:\s*(\d+)', block) or _none).group(1))
        total = hours * 3600 + minutes * 60 + seconds
        if total == 0:
            continue
        delay_n += 1
        prefix = "duration_seconds" if is_for else "delay_seconds"
        input_name = prefix if delay_n == 1 else f"{prefix}_{delay_n}"
        while input_name in used_names:
            delay_n += 1
            input_name = f"{prefix}_{delay_n}"
        used_names.add(input_name)
        # Replace the full block with a single-line form
        if hours == 0 and minutes == 0:
            # Simple case: only seconds — replace value with !input
            replacement = block
            replacement = _re.sub(r'(seconds:\s*)\d+', rf'\g<1>!input {input_name}', replacement)
            content = content.replace(block, replacement, 1)
        else:
            # Multi-field: replace each sub-key
            for sub_key in ('hours', 'minutes', 'seconds'):
                sub_match = _re.search(rf'{sub_key}:\s*(\d+)', block)
                if sub_match:
                    content = content.replace(
                        f'{sub_key}: {sub_match.group(1)}',
                        f'{sub_key}: !input {input_name}' if sub_key == 'seconds' else f'{sub_key}: 0',
                        1
                    )
        label = "Wait Duration" if is_for else "Delay"
        input_block_lines.append(
            f"    {input_name}:\n"
            f"      name: {label} {delay_n}\n"
            f"      description: How long to wait (in seconds)\n"
            f"      default: {total}\n"
            f"      selector:\n"
            f"        number:\n"
            f"          min: 0\n"
            f"          max: 3600\n"
            f"          step: 1\n"
            f"          unit_of_measurement: seconds"
        )

    # String-form: delay: "00:05:10"
    delay_str_pat = _re.compile(r'delay:\s*[\'"](\d{2}):(\d{2}):(\d{2})[\'"]', _re.MULTILINE)
    for match in delay_str_pat.finditer(content):
        h, m, s = int(match.group(1)), int(match.group(2)), int(match.group(3))
        total = h * 3600 + m * 60 + s
        if total == 0:
            continue
        delay_n += 1
        input_name = f"delay_seconds" if delay_n == 1 else f"delay_seconds_{delay_n}"
        while input_name in used_names:
            delay_n += 1
            input_name = f"delay_seconds_{delay_n}"
        used_names.add(input_name)
        content = content.replace(match.group(0), f'delay: !input {input_name}', 1)
        input_block_lines.append(
            f"    {input_name}:\n"
            f"      name: Delay {delay_n}\n"
            f"      description: How long to wait (in seconds)\n"
            f"      default: {total}\n"
            f"      selector:\n"
            f"        number:\n"
            f"          min: 0\n"
            f"          max: 3600\n"
            f"          step: 1\n"
            f"          unit_of_measurement: seconds"
        )

    # String-form: for: "00:02:30"
    for_str_pat = _re.compile(r'for:\s*[\'"](\d{2}):(\d{2}):(\d{2})[\'"]', _re.MULTILINE)
    for match in for_str_pat.finditer(content):
        h, m, s = int(match.group(1)), int(match.group(2)), int(match.group(3))
        total = h * 3600 + m * 60 + s
        if total == 0:
            continue
        delay_n += 1
        input_name = f"duration_seconds" if delay_n == 1 else f"duration_seconds_{delay_n}"
        while input_name in used_names:
            delay_n += 1
            input_name = f"duration_seconds_{delay_n}"
        used_names.add(input_name)
        content = content.replace(match.group(0), f'for: !input {input_name}', 1)
        input_block_lines.append(
            f"    {input_name}:\n"
            f"      name: Wait Duration {delay_n}\n"
            f"      description: How long the condition must be true (in seconds)\n"
            f"      default: {total}\n"
            f"      selector:\n"
            f"        number:\n"
            f"          min: 0\n"
            f"          max: 3600\n"
            f"          step: 1\n"
            f"          unit_of_measurement: seconds"
        )

    # --- Pass 4: Extract time triggers ---
    # When a trigger has a neighbouring `id:` key (e.g. `id: mon_off`), the
    # input is named after that id (e.g. `mon_off_time`) so the blueprint is
    # self-documenting.  Generic sequential names are used as fallback.
    time_n = 0
    time_pat = _re.compile(r'^(\s+)at:\s*[\'"]?(\d{1,2}:\d{2}(?::\d{2})?)[\'"]?', _re.MULTILINE)
    _lines = content.splitlines()

    for match in list(time_pat.finditer(content)):
        time_val = match.group(2)
        # Locate the line index of this match within content
        match_line_idx = content.count('\n', 0, match.start())
        # Search ±6 lines for a sibling `id:` key (single-value form only)
        id_val = None
        for li in range(max(0, match_line_idx - 6), min(len(_lines), match_line_idx + 7)):
            id_m = _re.match(r'^\s+id:\s*[\'"]?([a-zA-Z0-9_]+)[\'"]?\s*$', _lines[li])
            if id_m:
                id_val = id_m.group(1)
                break

        if id_val:
            input_name = f"{id_val}_time"
            sfx = 2
            while input_name in used_names:
                input_name = f"{id_val}_time_{sfx}"; sfx += 1
        else:
            time_n += 1
            base_name = "trigger_time"
            input_name = base_name if time_n == 1 else f"{base_name}_{time_n}"
            while input_name in used_names:
                time_n += 1
                input_name = f"{base_name}_{time_n}"

        used_names.add(input_name)
        # Normalize to HH:MM:SS
        if len(time_val.split(':')) == 2:
            time_val_full = f"{time_val}:00"
        else:
            time_val_full = time_val
        content = content.replace(f'at: {match.group(2)}', f'at: !input {input_name}', 1)
        content = content.replace(f"at: '{match.group(2)}'", f'at: !input {input_name}', 1)
        content = content.replace(f'at: "{match.group(2)}"', f'at: !input {input_name}', 1)
        # Rebuild _lines after mutation so subsequent line-index lookups stay correct
        _lines = content.splitlines()
        friendly = input_name.replace('_', ' ').title()
        input_block_lines.append(
            f"    {input_name}:\n"
            f"      name: {friendly}\n"
            f"      description: Time to trigger\n"
            f"      default: \"{time_val_full}\"\n"
            f"      selector:\n"
            f"        time: {{}}"
        )

    # --- Pass 5: Extract automation mode ---
    mode_match = _re.search(r'^mode:\s*(single|restart|queued|parallel)\s*$', content, _re.MULTILINE)
    automation_mode_val = mode_match.group(1) if mode_match else 'single'
    input_block_lines.append(
        f"    automation_mode:\n"
        f"      name: Automation Mode\n"
        f"      description: How to handle triggering when already running\n"
        f"      default: {automation_mode_val}\n"
        f"      selector:\n"
        f"        select:\n"
        f"          options:\n"
        f"            - single\n"
        f"            - restart\n"
        f"            - queued\n"
        f"            - parallel"
    )
    used_names.add('automation_mode')

    # --- Pass 5b: Extract hvac_mode values ---
    _HVAC_MODES = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only']
    hvac_mode_pat = _re.compile(r'^(\s+hvac_mode:\s*)([a-z_]+)\s*$', _re.MULTILINE)
    hvac_n = 0
    for match in hvac_mode_pat.finditer(content):
        val = match.group(2)
        if val not in _HVAC_MODES:
            continue  # skip template or unknown values
        hvac_n += 1
        base_name = 'hvac_mode'
        iname = base_name if hvac_n == 1 else f'{base_name}_{hvac_n}'
        while iname in used_names:
            hvac_n += 1; iname = f'{base_name}_{hvac_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: {'HVAC Mode' if hvac_n == 1 else f'HVAC Mode {hvac_n}'}\n"
            f"      description: Climate mode to set\n"
            f"      default: {val}\n"
            f"      selector:\n"
            f"        select:\n"
            f"          options:\n"
            + '\n'.join(f'            - "{m}"' if m in ('off', 'on', 'true', 'false', 'yes', 'no') else f"            - {m}" for m in _HVAC_MODES)
        )


    state_n = 0
    # Match "state:" lines that follow a "condition: state" block
    cond_state_pat = _re.compile(
        r'(condition:\s*state\s*\n(?:\s+\S+:.*\n)*?\s+state:\s*)([\'"]?)(\w+)\2',
        _re.MULTILINE
    )
    for match in cond_state_pat.finditer(content):
        state_val = match.group(3)
        # Skip generic on/off (boolean-like) — leave as hardcoded
        if state_val in ('on', 'off', 'true', 'false', 'unknown', 'unavailable'):
            continue
        state_n += 1
        base_name = f"condition_state_{state_n}"
        input_name = base_name
        while input_name in used_names:
            state_n += 1
            input_name = f"condition_state_{state_n}"
        used_names.add(input_name)
        # Replace in content
        content = content.replace(
            match.group(1) + match.group(2) + state_val + match.group(2),
            match.group(1) + f'!input {input_name}',
            1
        )
        input_block_lines.append(
            f"    {input_name}:\n"
            f"      name: Condition State {state_n}\n"
            f"      description: State value to check against\n"
            f"      default: \"{state_val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # --- Pass 6b: Extract on/off states from binary entity condition blocks ---
    _BINARY_DOMAINS = {'binary_sensor', 'input_boolean', 'switch', 'light', 'fan', 'cover'}
    _bool_cond_pat = _re.compile(
        r'(condition:\s*state\s*\n(?:\s+\S+:.*\n)*?\s+entity_id:\s*(?:'
        + '|'.join(_BINARY_DOMAINS)
        + r')[a-z0-9_.]*\s*\n(?:\s+\S+:.*\n)*?\s+state:\s*)([\'"]?)(on|off)\2',
        _re.MULTILINE
    )
    bool_n = 0
    for match in _bool_cond_pat.finditer(content):
        val = match.group(3)
        bool_n += 1
        base_name = 'condition_boolean'
        iname = base_name if bool_n == 1 else f'{base_name}_{bool_n}'
        while iname in used_names:
            bool_n += 1; iname = f'{base_name}_{bool_n}'
        used_names.add(iname)
        content = content.replace(
            match.group(1) + match.group(2) + val + match.group(2),
            match.group(1) + f'!input {iname}',
            1
        )
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Condition State {bool_n}\n"
            f"      description: Whether the entity should be on or off\n"
            f"      default: {val == 'on'}\n"
            f"      selector:\n"
            f"        boolean: {{}}"
        )

    # --- Pass 7: Extract webhook_id, tag_id, device_id ---
    # webhook_id: some-webhook-slug
    webhook_pat = _re.compile(r'^(\s+webhook_id:\s*)(\S+)\s*$', _re.MULTILINE)
    for match in webhook_pat.finditer(content):
        val = match.group(2).strip('\'"')
        iname = 'webhook_id'
        sfx = 2
        while iname in used_names:
            iname = f'webhook_id_{sfx}'; sfx += 1
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Webhook ID\n"
            f"      description: The webhook ID that triggers this automation\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # tag_id: some-tag-uuid
    tag_pat = _re.compile(r'^(\s+tag_id:\s*)(\S+)\s*$', _re.MULTILINE)
    for match in tag_pat.finditer(content):
        val = match.group(2).strip('\'"')
        iname = 'tag_id'
        sfx = 2
        while iname in used_names:
            iname = f'tag_id_{sfx}'; sfx += 1
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: NFC Tag ID\n"
            f"      description: The NFC tag ID that triggers this automation\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # device_id: UUID (trigger or action device actions; also handles list-item form "  - device_id:")
    device_id_pat = _re.compile(r'^(\s+(?:-\s+)?device_id:\s*)([0-9a-fA-F\-]{8,})\s*$', _re.MULTILINE)
    dev_n = 0
    for match in device_id_pat.finditer(content):
        val = match.group(2).strip()
        dev_n += 1
        iname = 'device_id' if dev_n == 1 else f'device_id_{dev_n}'
        while iname in used_names:
            dev_n += 1; iname = f'device_id_{dev_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Device {dev_n}\n"
            f"      description: The device to use\n"
            f"      selector:\n"
            f"        device: {{}}"
        )

    # --- Pass 8: Extract zone entity references, preset_mode, and message strings ---

    # zone: zone.something  (zone trigger / zone condition)
    zone_entity_pat = _re.compile(r'^(\s+zone:\s*)([a-z0-9_]+\.[a-z0-9_]+)\s*$', _re.MULTILINE)
    zone_n = 0
    for match in zone_entity_pat.finditer(content):
        val = match.group(2)
        zone_n += 1
        base_name = 'zone_entity'
        iname = base_name if zone_n == 1 else f'{base_name}_{zone_n}'
        while iname in used_names:
            zone_n += 1; iname = f'{base_name}_{zone_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Zone\n"
            f"      description: The zone to check (e.g. zone.home, zone.work)\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        entity:\n"
            f"          domain: zone"
        )

    # preset_mode: <string>  (fan, climate preset modes)
    preset_pat = _re.compile(r'^(\s+preset_mode:\s*)([\'"]?)([^\'\"\{\n][^\n]*?)\2\s*$', _re.MULTILINE)
    preset_n = 0
    for match in preset_pat.finditer(content):
        val = match.group(3).strip()
        if '{{' in val:
            continue  # skip templates
        preset_n += 1
        base_name = 'preset_mode'
        iname = base_name if preset_n == 1 else f'{base_name}_{preset_n}'
        while iname in used_names:
            preset_n += 1; iname = f'{base_name}_{preset_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Preset Mode\n"
            f"      description: The preset mode to activate\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # message: "..."  (notify, tts.speak, etc. — skip templates and multi-line)
    message_pat = _re.compile(r'^(\s+message:\s*)(["\'])([^\{\n][^\n]*?)\2\s*$', _re.MULTILINE)
    msg_n = 0
    for match in message_pat.finditer(content):
        val = match.group(3)
        if '{{' in val:
            continue  # skip template messages
        msg_n += 1
        base_name = 'message'
        iname = base_name if msg_n == 1 else f'{base_name}_{msg_n}'
        while iname in used_names:
            msg_n += 1; iname = f'{base_name}_{msg_n}'
        used_names.add(iname)
        quote = match.group(2)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: {'Message' if msg_n == 1 else f'Message {msg_n}'}\n"
            f"      description: The message text to send\n"
            f"      default: {quote}{val}{quote}\n"
            f"      selector:\n"
            f"        text:\n"
            f"          multiline: true"
        )

    # area_id: <slug>  (target blocks — inline scalar form)
    area_id_pat = _re.compile(r'^(\s+area_id:\s*)([a-z0-9_]+)\s*$', _re.MULTILINE)
    area_n = 0
    for match in area_id_pat.finditer(content):
        val = match.group(2)
        area_n += 1
        base_name = 'area_id'
        iname = base_name if area_n == 1 else f'{base_name}_{area_n}'
        while iname in used_names:
            area_n += 1; iname = f'{base_name}_{area_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: {'Area' if area_n == 1 else f'Area {area_n}'}\n"
            f"      description: The area to target\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        area: {{}}"
        )

    # MQTT topic: and payload:  (mqtt trigger — skip templates)
    for _key, _base, _desc in [
        ('topic',   'mqtt_topic',   'The MQTT topic to subscribe to'),
        ('payload', 'mqtt_payload', 'The MQTT payload that triggers the automation'),
    ]:
        _pat = _re.compile(rf'^(\s+{_key}:\s*)(["\']?)([^\{{\n][^\n]*?)\2\s*$', _re.MULTILINE)
        _n = 0
        for match in _pat.finditer(content):
            val = match.group(3)
            if '{{' in val:
                continue
            _n += 1
            iname = _base if _n == 1 else f'{_base}_{_n}'
            while iname in used_names:
                _n += 1; iname = f'{_base}_{_n}'
            used_names.add(iname)
            content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
            input_block_lines.append(
                f"    {iname}:\n"
                f"      name: {iname.replace('_', ' ').title()}\n"
                f"      description: {_desc}\n"
                f"      default: \"{val}\"\n"
                f"      selector:\n"
                f"        text: {{}}"
            )

    # label_id: <slug>  (target blocks — inline scalar form)
    label_id_pat = _re.compile(r'^(\s+label_id:\s*)([a-z0-9_]+)\s*$', _re.MULTILINE)
    label_n = 0
    for match in label_id_pat.finditer(content):
        val = match.group(2)
        label_n += 1
        base_name = 'label_id'
        iname = base_name if label_n == 1 else f'{base_name}_{label_n}'
        while iname in used_names:
            label_n += 1; iname = f'{base_name}_{label_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: {'Label' if label_n == 1 else f'Label {label_n}'}\n"
            f"      description: The label to target\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        label: {{}}"
        )


    # --- Pass 9: Service data value extraction (data-driven) ---
    _AUTOMATION_MODES = {'single', 'restart', 'queued', 'parallel'}
    _ALL_HVAC_MODES = set(_HVAC_MODES)

    # Text-type service data keys
    _SERVICE_DATA_TEXT = {
        'effect':             ('light_effect',      'Light effect name'),
        'tone':               ('siren_tone',        'Siren tone'),
        'item':               ('todo_item',         'To-do item text'),
        'language':           ('tts_language',       'TTS language code'),
        'command':            ('remote_command',     'Command to send'),
        'source':             ('media_source',       'Media source/input'),
        'media_content_id':   ('media_content_id',   'Media content ID/URL'),
        'media_content_type': ('media_content_type', 'Media content type'),
        'code':               ('access_code',        'Lock/alarm access code'),
        'option':             ('select_option',      'Option to select'),
        'filename':           ('snapshot_filename',   'Snapshot file path'),
        'title':              ('notify_title',        'Notification title'),
        'fan_mode':           ('fan_mode',            'Climate fan mode'),
        'swing_mode':         ('swing_mode',          'Climate swing mode'),
        'direction':          ('fan_direction',        'Fan direction'),
        'addon':              ('addon_id',             'Add-on ID (slug) to target'),
    }
    # Number-type service data keys: (base_name, description, min, max, step, unit)
    _SERVICE_DATA_NUMBER = {
        'value':             ('set_value',          'Value to set',                 0,    1000, 1,   ''),
        'num_repeats':       ('num_repeats',        'Number of repeats',            1,    100,  1,   ''),
        'target_temp_high':  ('target_temp_high',   'Upper target temperature',     0,    50,   0.5, '°C'),
        'target_temp_low':   ('target_temp_low',    'Lower target temperature',     0,    50,   0.5, '°C'),
        'tilt_position':     ('tilt_position',      'Cover tilt position',          0,    100,  1,   '%'),
        'transition':        ('transition',         'Light/scene transition',       0,    300,  0.5, 's'),
        'delay_secs':        ('delay_secs',         'Remote delay between commands', 0,   60,   0.1, 's'),
    }

    # Text-type extraction
    for yaml_key, (base_name, desc) in _SERVICE_DATA_TEXT.items():
        _sd_pat = _re.compile(
            rf'^\s+{yaml_key}:\s*([\'"]?)([^\'\"\{{\n][^\n]*?)\1\s*$', _re.MULTILINE
        )
        _sd_n = 0
        for match in _sd_pat.finditer(content):
            val = match.group(2).strip()
            if '{{' in val or '}}' in val:
                continue
            # Guard for 'mode:' collision — skip automation modes and HVAC modes
            if yaml_key == 'mode' and val in (_AUTOMATION_MODES | _ALL_HVAC_MODES):
                continue
            _sd_n += 1
            iname = base_name if _sd_n == 1 else f'{base_name}_{_sd_n}'
            while iname in used_names:
                _sd_n += 1; iname = f'{base_name}_{_sd_n}'
            used_names.add(iname)
            # Replace: use the prefix up to the key, then the key with !input
            prefix = match.group(0)[:match.group(0).index(yaml_key + ':')]
            content = content.replace(match.group(0), f'{prefix}{yaml_key}: !input {iname}', 1)
            input_block_lines.append(
                f"    {iname}:\n"
                f"      name: {iname.replace('_', ' ').title()}\n"
                f"      description: {desc}\n"
                f"      default: \"{val}\"\n"
                f"      selector:\n"
                f"        text: {{}}"
            )

    # Number-type extraction
    for yaml_key, (base_name, desc, nmin, nmax, nstep, unit) in _SERVICE_DATA_NUMBER.items():
        _sd_pat = _re.compile(
            rf'^\s+{yaml_key}:\s*(-?\d+(?:\.\d+)?)\s*$', _re.MULTILINE
        )
        _sd_n = 0
        for match in _sd_pat.finditer(content):
            line_text = match.group(0)
            if '{{' in line_text or '}}' in line_text:
                continue
            val = match.group(1)
            _sd_n += 1
            iname = base_name if _sd_n == 1 else f'{base_name}_{_sd_n}'
            while iname in used_names:
                _sd_n += 1; iname = f'{base_name}_{_sd_n}'
            used_names.add(iname)
            numeric_inputs.append((iname, yaml_key, val))
            unit_line = f'\n          unit_of_measurement: "{unit}"' if unit else ''
            input_block_lines.append(
                f"    {iname}:\n"
                f"      name: {iname.replace('_', ' ').title()}\n"
                f"      description: {desc}\n"
                f"      default: {val}\n"
                f"      selector:\n"
                f"        number:\n"
                f"          min: {nmin}\n"
                f"          max: {nmax}\n"
                f"          step: {nstep}{unit_line}"
            )

    # mode: (device/service mode — not automation mode or HVAC mode)
    _mode_pat = _re.compile(r'^\s+mode:\s*([\'"]?)([^\'\"\{\n][^\n]*?)\1\s*$', _re.MULTILINE)
    _mode_n = 0
    for match in _mode_pat.finditer(content):
        val = match.group(2).strip()
        if '{{' in val or '}}' in val:
            continue
        if val in (_AUTOMATION_MODES | _ALL_HVAC_MODES):
            continue
        _mode_n += 1
        base_name = 'device_mode'
        iname = base_name if _mode_n == 1 else f'{base_name}_{_mode_n}'
        while iname in used_names:
            _mode_n += 1; iname = f'{base_name}_{_mode_n}'
        used_names.add(iname)
        prefix = match.group(0)[:match.group(0).index('mode:')]
        content = content.replace(match.group(0),
            f'{prefix}mode: !input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Device Mode\n"
            f"      description: Device mode (fan/humidifier)\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # siren/timer duration: (number, not the block form handled in Pass 3)
    _siren_dur_pat = _re.compile(r'^\s+duration:\s*(-?\d+(?:\.\d+)?)\s*$', _re.MULTILINE)
    _siren_dur_n = 0
    for match in _siren_dur_pat.finditer(content):
        line_text = match.group(0)
        if '{{' in line_text or '}}' in line_text:
            continue
        val = match.group(1)
        _siren_dur_n += 1
        base_name = 'siren_duration'
        iname = base_name if _siren_dur_n == 1 else f'{base_name}_{_siren_dur_n}'
        while iname in used_names:
            _siren_dur_n += 1; iname = f'{base_name}_{_siren_dur_n}'
        used_names.add(iname)
        numeric_inputs.append((iname, 'duration', val))
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Duration (seconds)\n"
            f"      description: Duration in seconds\n"
            f"      default: {val}\n"
            f"      selector:\n"
            f"        number:\n"
            f"          min: 0\n"
            f"          max: 3600\n"
            f"          step: 1\n"
            f'          unit_of_measurement: "s"'
        )

    # --- Pass 10: Trigger value extraction ---

    # 10a. from: / to: state values
    _SKIP_STATES = {'on', 'off', 'true', 'false', 'yes', 'no', 'unknown', 'unavailable'}
    _from_to_n = {'from': 0, 'to': 0}
    for direction in ('from', 'to'):
        _ft_pat = _re.compile(
            rf'^\s+{direction}:\s*[\'"]?([a-z_0-9]+)[\'"]?\s*$', _re.MULTILINE
        )
        for match in _ft_pat.finditer(content):
            val = match.group(1)
            if val in _SKIP_STATES:
                continue
            _from_to_n[direction] += 1
            n = _from_to_n[direction]
            base_name = f'trigger_{direction}_state'
            iname = base_name if n == 1 else f'{base_name}_{n}'
            while iname in used_names:
                _from_to_n[direction] += 1
                n = _from_to_n[direction]
                iname = f'{base_name}_{n}'
            used_names.add(iname)
            prefix = match.group(0)[:match.group(0).index(direction + ':')]
            content = content.replace(match.group(0),
                f'{prefix}{direction}: !input {iname}', 1)
            input_block_lines.append(
                f"    {iname}:\n"
                f"      name: Trigger {direction.title()} State\n"
                f"      description: The state value to trigger {direction}\n"
                f"      default: \"{val}\"\n"
                f"      selector:\n"
                f"        text: {{}}"
            )

    # 10b. event_type: extraction
    _evt_pat = _re.compile(r'^\s+event_type:\s*(\S+)\s*$', _re.MULTILINE)
    _evt_n = 0
    for match in _evt_pat.finditer(content):
        val = match.group(1).strip('\'"')
        _evt_n += 1
        base_name = 'event_type'
        iname = base_name if _evt_n == 1 else f'{base_name}_{_evt_n}'
        while iname in used_names:
            _evt_n += 1; iname = f'{base_name}_{_evt_n}'
        used_names.add(iname)
        prefix = match.group(0)[:match.group(0).index('event_type:')]
        content = content.replace(match.group(0),
            f'{prefix}event_type: !input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Event Type\n"
            f"      description: The event type that triggers this automation\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # 10c. Sun offset: extraction
    _sun_offset_pat = _re.compile(r'^(\s+offset:\s*)[\'"]?([+-]?\d{2}:\d{2}:\d{2})[\'"]?\s*$', _re.MULTILINE)
    _sun_n = 0
    for match in _sun_offset_pat.finditer(content):
        val = match.group(2)
        _sun_n += 1
        base_name = 'sun_offset'
        iname = base_name if _sun_n == 1 else f'{base_name}_{_sun_n}'
        while iname in used_names:
            _sun_n += 1; iname = f'{base_name}_{_sun_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Sun Offset\n"
            f"      description: Time offset from sunrise/sunset (e.g. -00:30:00)\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # 10d. timeout: for wait_template
    _timeout_pat = _re.compile(r'^(\s+timeout:\s*)[\'"]?(\d{2}:\d{2}:\d{2})[\'"]?\s*$', _re.MULTILINE)
    _timeout_n = 0
    for match in _timeout_pat.finditer(content):
        val = match.group(2)
        _timeout_n += 1
        base_name = 'wait_timeout'
        iname = base_name if _timeout_n == 1 else f'{base_name}_{_timeout_n}'
        while iname in used_names:
            _timeout_n += 1; iname = f'{base_name}_{_timeout_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Wait Timeout\n"
            f"      description: How long to wait before timing out\n"
            f"      default: \"{val}\"\n"
            f"      selector:\n"
            f"        text: {{}}"
        )

    # --- Pass 11: Edge cases ---

    # 11a. rgb_color: [R, G, B] extraction
    _rgb_pat = _re.compile(r'^(\s+rgb_color:\s*)\[(\d+),\s*(\d+),\s*(\d+)\]\s*$', _re.MULTILINE)
    _rgb_n = 0
    for match in _rgb_pat.finditer(content):
        r, g, b = match.group(2), match.group(3), match.group(4)
        _rgb_n += 1
        base_name = 'rgb_color'
        iname = base_name if _rgb_n == 1 else f'{base_name}_{_rgb_n}'
        while iname in used_names:
            _rgb_n += 1; iname = f'{base_name}_{_rgb_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: RGB Color\n"
            f"      description: The RGB color to set\n"
            f"      default:\n"
            f"        - {r}\n"
            f"        - {g}\n"
            f"        - {b}\n"
            f"      selector:\n"
            f"        color_rgb: {{}}"
        )

    # 11b. oscillating: true/false (fan)
    _osc_pat = _re.compile(r'^(\s+oscillating:\s*)(true|false)\s*$', _re.MULTILINE)
    _osc_n = 0
    for match in _osc_pat.finditer(content):
        val = match.group(2)
        _osc_n += 1
        base_name = 'fan_oscillating'
        iname = base_name if _osc_n == 1 else f'{base_name}_{_osc_n}'
        while iname in used_names:
            _osc_n += 1; iname = f'{base_name}_{_osc_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Fan Oscillating\n"
            f"      description: Whether the fan should oscillate\n"
            f"      default: {val}\n"
            f"      selector:\n"
            f"        boolean: {{}}"
        )

    # 11c. enqueue: play/next/add/replace (media_player)
    _enq_pat = _re.compile(r'^(\s+enqueue:\s*)(play|next|add|replace)\s*$', _re.MULTILINE)
    _enq_n = 0
    for match in _enq_pat.finditer(content):
        val = match.group(2)
        _enq_n += 1
        base_name = 'media_enqueue'
        iname = base_name if _enq_n == 1 else f'{base_name}_{_enq_n}'
        while iname in used_names:
            _enq_n += 1; iname = f'{base_name}_{_enq_n}'
        used_names.add(iname)
        content = content.replace(match.group(0), f'{match.group(1)}!input {iname}', 1)
        input_block_lines.append(
            f"    {iname}:\n"
            f"      name: Media Enqueue Mode\n"
            f"      description: How to enqueue the media\n"
            f"      default: {val}\n"
            f"      selector:\n"
            f"        select:\n"
            f"          options:\n"
            f"            - play\n"
            f"            - next\n"
            f"            - add\n"
            f"            - replace"
        )

    # --- Build body: replace entity IDs and numeric values with !input refs ---
    body = content
    # Strip root-level metadata keys (0-indent: direct dict automations)
    body = _re.sub(r'^alias:.*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^  alias:.*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^id:.*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^  id:.*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^mode:.*\n', '', body, flags=_re.MULTILINE)  # stripped; added back as !input at footer
    body = _re.sub(r'^  mode:.*\n', '', body, flags=_re.MULTILINE)  # list-item indent variant
    # Strip description: both inline and block-scalar forms, at root and 2-space indent
    body = _re.sub(r'^description:[ \t]+[^\n]*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^description:[ \t]*[>|]?[ \t]*\n(?:[ \t]+.*\n)*', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^  description:[ \t]+[^\n]*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^  description:[ \t]*[>|]?[ \t]*\n(?:[ \t]+.*\n)*', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^max_exceeded:.*\n', '', body, flags=_re.MULTILINE)
    # Strip list-item alias/id (2-space prefix from list items)
    body = _re.sub(r'^- id:.*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^  id:.*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^- alias:.*\n', '', body, flags=_re.MULTILINE)
    body = _re.sub(r'^  alias:.*\n', '', body, flags=_re.MULTILINE)
    # Strip leading list marker if present
    body = _re.sub(r'^-\s*\n', '', body, flags=_re.MULTILINE)

    # Helper: replace text only outside Jinja2 {{ ... }} template blocks
    def _replace_outside_templates(text: str, old: str, new: str, count: int = 0) -> str:
        parts = _re.split(r'(\{\{[\s\S]*?\}\})', text)
        replaced = 0
        for i in range(0, len(parts), 2):  # even indices = non-template segments
            if count and replaced >= count:
                break
            new_part = parts[i].replace(old, new, (count - replaced) if count else -1)
            replaced += parts[i].count(old) - new_part.count(old)
            parts[i] = new_part
        return ''.join(parts)

    # Replace entity IDs with !input references (skip Jinja2 templates)
    for eid, iname in input_map.items():
        body = _replace_outside_templates(body, eid, f'!input {iname}')
    # Replace numeric values with !input references (first occurrence only)
    for input_name, key, value in numeric_inputs:
        body = _replace_outside_templates(body, f'{key}: {value}', f'{key}: !input {input_name}', 1)

    # Normalize indentation: only strip leading 2-space indent for list-item automations
    # (direct-dict automations already use root-level keys — no stripping needed)
    if is_list_item:
        body_lines = []
        for line in body.split('\n'):
            if line.startswith('  '):
                body_lines.append(line[2:])
            else:
                body_lines.append(line)
        body = '\n'.join(body_lines)
    body = body.strip()

    # --- Assemble blueprint ---
    inputs_yaml = '\n'.join(input_block_lines)
    if inputs_yaml:
        inputs_section = f"  input:\n{inputs_yaml}"
    else:
        inputs_section = "  input: {}"

    blueprint_yaml = (
        f"blueprint:\n"
        f"  name: \"{bp_name}\"\n"
        f"  description: \"{bp_description.replace(chr(34), chr(39))}\"\n"
        f"  domain: automation\n"
        f"  author: \"\"\n"
        f"{inputs_section}\n"
        f"\n"
        f"{body}\n"
        f"\n"
        f"mode: !input automation_mode\n"
    )

    return blueprint_yaml


def parse_blueprint_inputs(content: str) -> dict:
    """Parse a blueprint YAML and return structured JSON for the 'Use Blueprint' form.

    Returns:
      {
        "name": "My Blueprint",
        "description": "...",
        "domain": "automation",
        "sections": [
          {
            "name": "Section Label",   # None for top-level inputs
            "description": "...",
            "inputs": [
              {
                "key": "trigger_entity",
                "name": "Trigger Entity",
                "description": "...",
                "default": null,
                "required": true,
                "selector": {"entity": {}}
              }, ...
            ]
          }
        ]
      }
    """
    import yaml as _yaml

    class _HALoader(_yaml.SafeLoader): pass
    def _ha_ctor(loader, node): return loader.construct_scalar(node)
    for _tag in ['!include', '!secret', '!env_var', '!input', '!lambda', '!extend']:
        _HALoader.add_constructor(_tag, _ha_ctor)

    try:
        parsed = _yaml.load(content, Loader=_HALoader)
    except Exception:
        parsed = None

    if not isinstance(parsed, dict):
        return {"name": "Blueprint", "description": "", "domain": "automation", "sections": []}

    bp = parsed.get("blueprint") or {}
    name = bp.get("name", "Blueprint")
    description = bp.get("description", "")
    domain = bp.get("domain", "automation")
    raw_input = bp.get("input") or {}

    def _make_input(key, val):
        if not isinstance(val, dict):
            return None
        # Skip section containers (they have an "input" sub-key)
        if "input" in val and isinstance(val["input"], dict):
            return None
        has_default = "default" in val
        return {
            "key": key,
            "name": val.get("name", key.replace("_", " ").title()),
            "description": val.get("description", ""),
            "default": val.get("default", None),
            "required": not has_default,
            "selector": val.get("selector", {"text": {}}),
        }

    sections = []
    top_inputs = []

    for key, val in raw_input.items():
        if not isinstance(val, dict):
            continue
        if "input" in val and isinstance(val["input"], dict):
            # Named section
            section_inputs = []
            for ikey, ival in val["input"].items():
                inp = _make_input(ikey, ival)
                if inp:
                    section_inputs.append(inp)
            sections.append({
                "name": val.get("name", key.replace("_", " ").title()),
                "description": val.get("description", ""),
                "inputs": section_inputs,
            })
        else:
            inp = _make_input(key, val)
            if inp:
                top_inputs.append(inp)

    if top_inputs:
        sections.insert(0, {"name": None, "description": "", "inputs": top_inputs})

    return {
        "name": name,
        "description": description,
        "domain": domain,
        "sections": sections,
    }


def instantiate_blueprint(content: str, input_values: dict, name: str, description: str = "") -> str:
    """Instantiate a blueprint by substituting !input references with user-supplied values.

    Algorithm:
    1. Parse blueprint to collect input defaults.
    2. Strip the `blueprint:` header block from raw text.
    3. Replace each `!input key` with the user value, falling back to the input's default.
    4. Prepend `alias` and `id` fields.
    5. Return the final automation YAML string.
    """
    import yaml as _yaml
    import re as _re
    import uuid as _uuid

    class _HALoader(_yaml.SafeLoader): pass
    def _ha_ctor(loader, node): return loader.construct_scalar(node)
    for _tag in ['!include', '!secret', '!env_var', '!input', '!lambda', '!extend']:
        _HALoader.add_constructor(_tag, _ha_ctor)

    try:
        parsed = _yaml.load(content, Loader=_HALoader)
    except Exception:
        parsed = {}

    bp = (parsed or {}).get("blueprint") or {}
    raw_input = bp.get("input") or {}

    # Collect defaults from all inputs (including within named sections)
    defaults: dict = {}
    for key, val in raw_input.items():
        if not isinstance(val, dict):
            continue
        if "input" in val and isinstance(val["input"], dict):
            for ikey, ival in val["input"].items():
                if isinstance(ival, dict) and "default" in ival:
                    defaults[ikey] = ival["default"]
        else:
            if "default" in val:
                defaults[key] = val["default"]

    # Strip `blueprint:` header block (all indented lines following it)
    body = _re.sub(r'^blueprint:\n(?:[ \t]+[^\n]*\n)*', '', content, flags=_re.MULTILINE)
    body = body.strip()

    def _val_to_yaml(val) -> str:
        if isinstance(val, (list, dict)):
            return _yaml.dump(val, default_flow_style=True).strip()
        if isinstance(val, bool):
            return "true" if val else "false"
        s = str(val)
        # Quote strings containing YAML special characters
        if any(c in s for c in (':', '#', '{', '}', '[', ']', ',', '&', '*', '?', '|', '-', '<', '>', '=', '!', '%', '@', '`', '\n')):
            return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
        return s

    def _replace_input(m) -> str:
        key = m.group(1).strip()
        user_val = input_values.get(key)
        if user_val not in (None, "", [], {}):
            return _val_to_yaml(user_val)
        default = defaults.get(key)
        if default is not None:
            return _val_to_yaml(default)
        return m.group(0)  # Leave unreplaced if no value and no default

    body = _re.sub(r'!input\s+(\S+)', _replace_input, body)

    uid = str(_uuid.uuid4())
    header = f'alias: "{name}"\nid: "{uid}"\n'
    if description:
        header += f'description: "{description}"\n'
    return header + body + "\n"


def get_script_description(query: str) -> str:
    """Generate intelligent script description."""
    if "turn on" in query or "activate" in query:
        return "Activates devices with configured settings"
    elif "turn off" in query or "deactivate" in query:
        return "Deactivates specified devices"
    elif "toggle" in query:
        return "Toggles device states"
    elif "sequence" in query or "then" in query:
        return "Executes a sequence of actions"
    elif "notification" in query or "notify" in query:
        return "Sends notifications and controls devices"
    elif "climate" in query or "temperature" in query:
        return "Controls climate and temperature settings"
    else:
        return "Custom automation script"
