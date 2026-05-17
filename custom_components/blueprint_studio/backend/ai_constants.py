"Lookup tables and error patterns for AI modules."
from __future__ import annotations

# Domain synonym mapping - maps natural language to HA domains
DOMAIN_SYNONYMS = {
    "light": ["light", "lights", "bulb", "bulbs", "lamp", "lamps", "lighting", "chandelier", "spotlight", "led strip", "led", "strip light"],
    "switch": ["switch", "switches", "plug", "plugs", "outlet", "outlets", "socket", "wall switch", "power strip"],
    "cover": ["cover", "covers", "blind", "blinds", "shade", "shades", "curtain", "curtains", "shutter", "shutters", "garage door", "gate", "roller", "awning"],
    "climate": ["climate", "thermostat", "heater", "heating", "ac", "air conditioning", "hvac", "temperature control", "cooling", "heat pump"],
    "lock": ["lock", "locks", "door lock", "deadbolt", "smart lock"],
    "fan": ["fan", "fans", "ceiling fan", "exhaust fan", "ventilator"],
    "media_player": ["media", "player", "tv", "television", "speaker", "speakers", "music", "audio", "stereo", "soundbar", "chromecast", "roku", "apple tv"],
    "camera": ["camera", "cameras", "cam", "cams", "security camera", "webcam", "doorbell"],
    "vacuum": ["vacuum", "vacuums", "cleaner", "robot vacuum", "roomba", "mop"],
    "sensor": ["sensor", "sensors", "temperature sensor", "humidity sensor", "light sensor", "power sensor", "energy sensor"],
    "binary_sensor": ["motion sensor", "motion", "door sensor", "window sensor", "leak sensor", "water sensor", "smoke detector", "smoke", "occupancy", "presence"],
    "alarm_control_panel": ["alarm", "security system", "alarm panel", "security panel"],
    "input_boolean": ["input boolean", "toggle", "virtual switch", "helper toggle"],
    "input_number": ["input number", "slider", "number helper"],
    "input_select": ["input select", "dropdown", "select helper"],
    "input_datetime": ["input datetime", "date helper", "time helper"],
    "input_text": ["input text", "text helper", "text input"],
    "automation": ["automation", "automations", "auto"],
    "script": ["script", "scripts"],
    "scene": ["scene", "scenes"],
    "notify": ["notify", "notification", "alert", "message"],
    "timer": ["timer", "timers", "countdown"],
    "counter": ["counter", "counters"],
    "button": ["button", "buttons", "press button"],
    "number": ["number", "numbers"],
    "select": ["select", "selection"],
    "siren": ["siren", "sirens", "alarm siren"],
    "humidifier": ["humidifier", "dehumidifier"],
    "water_heater": ["water heater", "boiler"],
    "remote": ["remote", "remotes", "remote control"],
    "device_tracker": ["device tracker", "phone", "tracker", "location"],
    "person": ["person", "people", "user"],
    "zone": ["zone", "zones", "area", "geofence"],
    "group": ["group", "groups"],
}

# Sun trigger phrase patterns
SUN_TRIGGER_PHRASES = {
    "sunset": ["at sunset", "when sun sets", "when the sun sets", "after sunset", "before sunset", "sunset time"],
    "sunrise": ["at sunrise", "when sun rises", "when the sun rises", "after sunrise", "before sunrise", "sunrise time"],
}

# Zone trigger phrase patterns
ZONE_TRIGGER_PHRASES = {
    "enter": ["arrive home", "arrive at home", "get home", "reach home", "enter home", "enter zone", "arrives home", "i arrive"],
    "leave": ["leave home", "leave work", "depart home", "exit home", "exit zone", "i leave", "when i go"],
}

# Webhook trigger phrases
WEBHOOK_TRIGGER_PHRASES = ["webhook", "via webhook", "webhook called", "when webhook", "on webhook"]

# MQTT trigger phrases
MQTT_TRIGGER_PHRASES = ["mqtt", "on mqtt", "when mqtt", "mqtt topic", "mqtt message"]

# Interval trigger phrases (for time_pattern triggers)
INTERVAL_TRIGGER_PHRASES = {
    "minutes": r"every\s+(\d+)\s*(?:minute|minutes|min|mins)",
    "hours": r"every\s+(\d+)\s*(?:hour|hours|hr|hrs)",
    "seconds": r"every\s+(\d+)\s*(?:second|seconds|sec|secs)",
}

# Fan speed name-to-percentage mapping
FAN_SPEED_NAMES = {
    "low": 33,
    "medium": 66,
    "med": 66,
    "high": 100,
    "full": 100,
    "turbo": 100,
    "quiet": 20,
    "silent": 10,
}

# Action verb vocabulary for extract_automation_name
ACTION_VERB_MAP = {
    "set": "Set",
    "adjust": "Adjust",
    "dim": "Dim",
    "brighten": "Brighten",
    "lock": "Lock",
    "unlock": "Unlock",
    "arm": "Arm",
    "disarm": "Disarm",
    "open": "Open",
    "close": "Close",
    "play": "Play",
    "pause": "Pause",
    "stop": "Stop",
    "notify": "Notify",
    "alert": "Notify",
    "send": "Notify",
    "activate": "Activate",
    "run": "Activate",
    "start": "Activate",
    "toggle": "Toggle",
    "turn on": "Turn On",
    "turn off": "Turn Off",
}

# Conjunction words for splitting multi-domain queries
MULTI_DOMAIN_CONJUNCTIONS = [" and ", " also ", " plus ", " as well as ", " & "]

# Action mapping for different domains
DOMAIN_ACTIONS = {
    "light": {"on": "turn_on", "off": "turn_off", "toggle": "toggle"},
    "switch": {"on": "turn_on", "off": "turn_off", "toggle": "toggle"},
    "cover": {"on": "open_cover", "off": "close_cover", "stop": "stop_cover", "toggle": "toggle"},
    "lock": {"on": "unlock", "off": "lock"},
    "fan": {"on": "turn_on", "off": "turn_off", "toggle": "toggle"},
    "climate": {"on": "turn_on", "off": "turn_off", "set_temp": "set_temperature", "set_hvac": "set_hvac_mode"},
    "media_player": {"on": "turn_on", "off": "turn_off", "play": "media_play", "pause": "media_pause", "stop": "media_stop", "volume_up": "volume_up", "volume_down": "volume_down", "mute": "volume_mute"},
    "vacuum": {"on": "start", "off": "return_to_base", "pause": "pause", "stop": "stop"},
    "input_boolean": {"on": "turn_on", "off": "turn_off", "toggle": "toggle"},
    "automation": {"on": "turn_on", "off": "turn_off", "toggle": "toggle", "trigger": "trigger"},
    "script": {"on": "turn_on"},
    "scene": {"on": "turn_on"},
    "notify": {"send": "send_message"},
    "button": {"press": "press"},
    "siren": {"on": "turn_on", "off": "turn_off"},
    "alarm_control_panel": {"arm_away": "alarm_arm_away", "arm_home": "alarm_arm_home", "disarm": "alarm_disarm"},
}

# Common YAML errors and their solutions
YAML_ERROR_PATTERNS = {
    "legacy_service": {
        "pattern": r"^\s*-?\s*service:\s*(\w+\.\w+)",
        "message": "Legacy 'service:' syntax detected",
        "solution": "Replace 'service:' with 'action:' (modern 2024+ syntax)",
        "example": "service: light.turn_on  →  action: light.turn_on"
    },
    "missing_id": {
        "pattern": r"^-\s+alias:",
        "message": "Automation missing unique 'id:' field",
        "solution": "Add 'id: \"XXXXXXXXXXXXX\"' (13-digit timestamp) before 'alias:'",
        "example": "- alias: My Auto  →  - id: '1738012345678'\n  alias: My Auto"
    },
    "singular_trigger": {
        "pattern": r"^\s*trigger:\s*$",
        "message": "Legacy singular 'trigger:' key detected",
        "solution": "Use modern plural 'triggers:' instead",
        "example": "trigger:  →  triggers:"
    },
    "singular_condition": {
        "pattern": r"^\s*condition:\s*$",
        "message": "Legacy singular 'condition:' key detected",
        "solution": "Use modern plural 'conditions:' instead",
        "example": "condition:  →  conditions:"
    },
    "singular_action": {
        "pattern": r"^\s*action:\s*$",
        "message": "Legacy singular 'action:' key detected at top level",
        "solution": "Use modern plural 'actions:' at automation level",
        "example": "action:  →  actions:"
    },
    "old_trigger_syntax": {
        "pattern": r"^\s*-\s+platform:\s+(\w+)",
        "message": "Legacy 'platform:' trigger syntax detected",
        "solution": "Use modern '- trigger: platform' syntax",
        "example": "- platform: time  →  - trigger: time"
    },
    "missing_metadata": {
        "pattern": r"(action:\s+\w+\.\w+)(?!.*metadata:)",
        "message": "Action missing 'metadata: {}' field",
        "solution": "Add 'metadata: {}' after action declaration",
        "example": "action: light.turn_on\ntarget:  →  action: light.turn_on\nmetadata: {}\ntarget:"
    },
    "malformed_entity_id": {
        "pattern": r"entity_id:\s+([a-zA-Z_]+)(?!\.[a-zA-Z_])",
        "message": "Malformed entity_id (missing domain or entity name)",
        "solution": "Entity IDs must follow format: domain.entity_name",
        "example": "entity_id: kitchen  →  entity_id: light.kitchen"
    },
    "invalid_domain": {
        "pattern": r"entity_id:\s+([a-zA-Z0-9_]+)\.",
        "message": "Potentially invalid domain in entity_id",
        "solution": "Check if domain exists in Home Assistant",
        "example": "Common domains: light, switch, sensor, binary_sensor, climate, etc."
    },
    "deprecated_data_template": {
        "pattern": r"^\s*-?\s*data_template\s*:",
        "message": "'data_template:' is deprecated",
        "solution": "Use 'data:' instead (templates work directly in data:)",
        "example": "data_template:\n  message: '{{ value }}'  →  data:\n  message: '{{ value }}'"
    },
    "deprecated_service_template": {
        "pattern": r"^\s*-?\s*service_template\s*:",
        "message": "'service_template:' is deprecated",
        "solution": "Use 'action:' with direct template instead",
        "example": "service_template: '{{ svc }}'  →  action: '{{ svc }}'"
    },
    "deprecated_platform_template": {
        "pattern": r"^\s*-?\s*platform:\s*template\s*$",
        "message": "Legacy 'platform: template' is deprecated (removed in 2026.6)",
        "solution": "Use top-level 'template:' integration instead",
        "example": "sensor:\n  - platform: template  →  template:\n  - sensor:\n      - name: ..."
    },
}

# Blueprint selector types
BLUEPRINT_SELECTOR_TYPES = {
    'entity', 'device', 'area', 'target', 'number', 'text', 'boolean',
    'select', 'time', 'date', 'datetime', 'color_temp', 'color_rgb',
    'action', 'object', 'template', 'icon', 'duration', 'trigger',
    'condition', 'theme', 'addon', 'floor', 'label', 'location',
    'media', 'attribute', 'state', 'country', 'currency',
}

# Valid blueprint domains
BLUEPRINT_VALID_DOMAINS = {'automation', 'script'}

# Known Home Assistant domains for validation
HA_KNOWN_DOMAINS = {
    'light', 'switch', 'sensor', 'binary_sensor', 'climate', 'lock',
    'cover', 'fan', 'media_player', 'camera', 'vacuum', 'alarm_control_panel',
    'notify', 'script', 'automation', 'scene', 'input_boolean', 'input_number',
    'input_select', 'input_datetime', 'timer', 'counter', 'weather', 'sun',
    'person', 'group', 'calendar', 'todo', 'number', 'select', 'button',
    'update', 'device_tracker', 'remote', 'tts', 'stt', 'image',
    'lawn_mower', 'event', 'valve', 'date', 'datetime', 'time', 'text',
    'conversation', 'air_quality', 'image_processing', 'geo_location', 'tag',
    'wake_word', 'assist_satellite', 'ai_task', 'siren', 'humidifier',
    'water_heater', 'input_text',
}

# Common Jinja2 template patterns for Home Assistant
JINJA_PATTERNS = {
    "state": {
        "templates": [
            "{{ states('sensor.temperature') }}",
            "{{ states('light.kitchen') }}",
            "{{ state_attr('light.kitchen', 'brightness') }}",
        ],
        "description": "Get entity state or attribute"
    },
    "condition": {
        "templates": [
            "{% if states('light.kitchen') == 'on' %}...{% endif %}",
            "{% if is_state('light.kitchen', 'on') %}...{% endif %}",
            "{% if state_attr('light.kitchen', 'brightness') > 100 %}...{% endif %}",
        ],
        "description": "Conditional logic"
    },
    "loop": {
        "templates": [
            "{% for state in states.light %}{{ state.name }}{% endfor %}",
            "{% for entity in expand('group.all_lights') %}...{% endfor %}",
        ],
        "description": "Loop through entities"
    },
    "time": {
        "templates": [
            "{{ now() }}",
            "{{ now().strftime('%H:%M') }}",
            "{{ as_timestamp(now()) }}",
            "{{ today_at('19:00') }}",
        ],
        "description": "Time and date functions"
    },
    "math": {
        "templates": [
            "{{ (states('sensor.temp') | float) * 1.8 + 32 }}",
            "{{ states('sensor.value') | float | round(2) }}",
        ],
        "description": "Mathematical operations"
    },
    "filters": {
        "templates": [
            "{{ value | default(0) }}",
            "{{ value | float }}",
            "{{ value | int }}",
            "{{ value | round(2) }}",
            "{{ value | lower }}",
            "{{ value | upper }}",
            "{{ value | title }}",
        ],
        "description": "Common Jinja filters"
    },
}

# Common Jinja errors and solutions
JINJA_ERROR_PATTERNS = {
    "missing_quotes": {
        "pattern": r"states\((\w+\.\w+)\)",
        "message": "Entity ID should be in quotes",
        "solution": "Wrap entity_id in quotes",
        "example": "states(sensor.temp) → states('sensor.temp')"
    },
    "wrong_brackets": {
        "pattern": r"\{\{\s*\{",
        "message": "Too many opening brackets",
        "solution": "Use {{ for expressions, not {{{",
        "example": "{{{ value }}} → {{ value }}"
    },
    "missing_pipe": {
        "pattern": r"states\(['\"][\w\.]+['\"]\)\s*(float|int|round|default)",
        "message": "Missing pipe | for filter",
        "solution": "Use | before filter name",
        "example": "states('sensor.temp') float → states('sensor.temp') | float"
    },
}

# JSON error patterns
JSON_ERROR_PATTERNS = {
    "trailing_comma": {
        "pattern": r",\s*[}\]]",
        "message": "Trailing comma in object or array",
        "solution": "Remove the comma before the closing bracket",
        "example": '{"name": "value",} → {"name": "value"}'
    },
    "unquoted_keys": {
        "pattern": r"{\s*([a-zA-Z_]\w*)\s*:",
        "message": "Unquoted object keys",
        "solution": "Wrap keys in double quotes",
        "example": '{name: "value"} → {"name": "value"}'
    },
    "single_quotes": {
        "pattern": r"'[^']*'",
        "message": "Single quotes used instead of double quotes",
        "solution": "Use double quotes for JSON strings",
        "example": "{'name': 'value'} → {\"name\": \"value\"}"
    },
}

# Python error patterns
PYTHON_ERROR_PATTERNS = {
    "missing_colon": {
        "pattern": r"^(def|class|if|for|while|try|except|with)\s+.+(?<!:)\s*$",
        "message": "Missing colon at end of statement",
        "solution": "Add ':' at the end of the line",
        "example": "if condition\n    pass → if condition:\n    pass"
    },
    "indentation_error": {
        "pattern": r"^[ \t]+[^ \t]",
        "message": "Indentation error",
        "solution": "Check indentation is consistent (use 4 spaces or tabs, not mixed)",
        "example": "Indent with 4 spaces per level"
    },
    "invalid_import": {
        "pattern": r"^import\s+([a-zA-Z_]\w*)",
        "message": "Potentially invalid import",
        "solution": "Verify module name is spelled correctly",
        "example": "import homeassistant\nimport yaml"
    },
}

# JavaScript error patterns
JAVASCRIPT_ERROR_PATTERNS = {
    "unmatched_bracket": {
        "pattern": r"(?:^\s*\[|(?<!=)\[)(?!.*\])",
        "message": "Unmatched opening bracket",
        "solution": "Check all brackets are closed",
        "example": "const arr = [1, 2, 3 → const arr = [1, 2, 3]"
    },
    "unmatched_brace": {
        "pattern": r"(?:^\s*\{|(?<!=)\{)(?!.*\})",
        "message": "Unmatched opening brace",
        "solution": "Check all braces are closed",
        "example": "if (true) { → if (true) { }"
    },
    "unmatched_paren": {
        "pattern": r"(?:^\s*\(|(?<!=)\()(?!.*\))",
        "message": "Unmatched opening parenthesis",
        "solution": "Check all parentheses are closed",
        "example": "function() { → function() { }"
    },
    "invalid_template_literal": {
        "pattern": r"`(?!.*`)",
        "message": "Unclosed template literal",
        "solution": "Close template literals with backtick `",
        "example": "`Hello ${name} → `Hello ${name}`"
    },
}
