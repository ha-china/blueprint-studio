"Syntax validation for YAML, Jinja, JSON, Python, and JavaScript."
from __future__ import annotations

import logging
import re
import yaml
import json
import ast
import time

from aiohttp import web

from .util import json_response
from .ai_constants import (
    HA_KNOWN_DOMAINS,
    BLUEPRINT_SELECTOR_TYPES,
    BLUEPRINT_VALID_DOMAINS,
    YAML_ERROR_PATTERNS,
    JINJA_ERROR_PATTERNS,
    JINJA_PATTERNS,
    JSON_ERROR_PATTERNS,
    PYTHON_ERROR_PATTERNS,
    JAVASCRIPT_ERROR_PATTERNS,
)

_LOGGER = logging.getLogger(__name__)


def _is_comment_line(line: str) -> bool:
    """Check if line is a comment or empty."""
    stripped = line.strip()
    return not stripped or stripped.startswith('#')


def _is_nested_trigger_group(line: str) -> bool:
    """Return True if line is a nested trigger group declaration (HA 2024.10+).

    Nested trigger groups use ``- trigger: or`` / ``- trigger: and`` / ``- trigger: not``
    to combine multiple sub-triggers with logical operators.  These are *not* legacy
    ``platform:`` syntax and must not be flagged as such.
    """
    return bool(re.match(r"^\s*-\s+trigger:\s+(or|and|not)\s*$", line))


def _has_jinja_template(value: str) -> bool:
    """Check if value contains Jinja2 template syntax."""
    return '{{' in value or '{%' in value


def _is_yaml_block_scalar_indicator(value: str) -> bool:
    """Return True when a YAML value is a block scalar marker such as ``>`` or ``|-.``"""
    return bool(re.fullmatch(r"[>|][+-]?", value))


def _detect_file_type(file_path: str, content: str) -> str:
    """Detect file type like VS Code does.

    Returns: 'yaml-homeassistant', 'yaml-esphome', 'json', 'python', 'javascript', 'generic'
    """
    try:
        ext = ""
        if file_path and '.' in file_path:
            ext = file_path.split('.')[-1].lower()

        if ext == 'json':
            return 'json'
        elif ext == 'py':
            return 'python'
        elif ext == 'js':
            return 'javascript'
        elif ext in ('yaml', 'yml'):
            return _detect_yaml_variant(file_path, content)

        content_stripped = content.strip()
        if content_stripped.startswith('{'):
            return 'json'
        elif content_stripped.startswith('def ') or 'import ' in content:
            return 'python'
        elif 'const ' in content or 'function ' in content:
            return 'javascript'

        return 'generic'
    except Exception as e:
        _LOGGER.warning("Error detecting file type: %s", e)
        return 'generic'


def _detect_yaml_variant(file_path: str, content: str) -> str:
    """Detect if YAML is for Home Assistant or ESPHome."""
    try:
        filename = ""
        if file_path:
            filename = file_path.split('/')[-1].lower()

        if filename and any(x in filename for x in ['esphome', 'device', 'esp32', 'esp8266']):
            if 'esphome:' in content:
                return 'yaml-esphome'

        # Blueprint detection — only trigger on standalone `blueprint:` key at the
        # start of a line, not on `use_blueprint:` inside automation files.
        if re.search(r'(?:^|\n)blueprint\s*:', content):
            return 'yaml-blueprint'

        if filename and any(x in filename for x in ['automation', 'script', 'scene', 'schedule']):
            return 'yaml-homeassistant'

        if 'esphome:' in content:
            return 'yaml-esphome'

        if any(x in content for x in ['triggers:', 'automations:', 'scripts:', 'scenes:', 'packages:']):
            return 'yaml-homeassistant'

        if any(x in content for x in ['climate:', 'switch:', 'sensor:', 'light:', 'binary_sensor:', 'cover:', 'lock:', 'media_player:']):
            return 'yaml-homeassistant'

        return 'yaml-homeassistant'
    except Exception as e:
        _LOGGER.warning("Error detecting YAML variant: %s", e)
        return 'yaml-homeassistant'


def _is_in_triggers_context(lines: list[str], current_line_num: int) -> bool:
    """Determine if current line is in a triggers: context."""
    current_line = lines[current_line_num - 1]
    current_indent = len(current_line) - len(current_line.lstrip())

    for i in range(current_line_num - 2, -1, -1):
        prev_line = lines[i].strip()
        if not prev_line or prev_line.startswith('#'):
            continue
        prev_indent = len(lines[i]) - len(lines[i].lstrip())
        if prev_indent < current_indent:
            if prev_line.endswith('triggers:') or prev_line == 'triggers:':
                return True
            if ':' in prev_line:
                return False

    return False


def _validate_entity_id(entity_id: str, line_num: int, original_line: str) -> dict | None:
    """Validate entity_id format. Returns error dict if invalid, None if valid."""
    if entity_id.startswith('!') or entity_id.startswith('*') or entity_id.startswith('&'):
        return None

    # Device registry UUIDs (32 hex chars) are valid in device triggers
    if re.fullmatch(r'[0-9a-f]{32}', entity_id):
        return None

    if _has_jinja_template(entity_id) or entity_id.startswith('['):
        return None

    if '.' not in entity_id:
        return {
            "line": line_num,
            "type": "malformed_entity_id",
            "message": f"Malformed entity_id: '{entity_id}'",
            "solution": "Entity IDs must follow format: domain.entity_name",
            "example": f"entity_id: light.{entity_id}",
            "original": original_line.strip()
        }

    domain = entity_id.split('.')[0]
    if domain not in HA_KNOWN_DOMAINS:
        return {
            "line": line_num,
            "type": "invalid_domain",
            "message": f"Unknown domain in entity_id: '{domain}'",
            "solution": f"Check if '{domain}' is a valid Home Assistant domain",
            "example": "Common domains: light, switch, sensor, binary_sensor, climate",
            "original": original_line.strip()
        }

    return None


def _validate_automation(item: dict, lines: list[str]) -> list[dict]:
    """Validate automation-specific rules."""
    errors = []

    if 'id' not in item and 'alias' not in item:
        for line_num, line in enumerate(lines, 1):
            if line.strip().startswith('- '):
                errors.append({
                    "line": line_num,
                    "type": "missing_automation_id",
                    "message": "Automation missing both 'id:' and 'alias:' fields",
                    "solution": "Add 'id:' (required) or 'alias:' (recommended)",
                    "example": "- id: '1738012345678'\n  alias: My Automation",
                    "original": line.strip()
                })
                break

    if 'trigger' not in item and 'triggers' not in item:
        for line_num, line in enumerate(lines, 1):
            if 'alias' in item and item['alias'] in line:
                errors.append({
                    "line": line_num,
                    "type": "missing_trigger",
                    "message": "Automation missing 'trigger:' or 'triggers:'",
                    "solution": "Add at least one trigger",
                    "example": "trigger:\n  platform: time\n  at: '10:00:00'",
                    "original": line.strip()
                })
                break

    if 'action' not in item and 'actions' not in item:
        for line_num, line in enumerate(lines, 1):
            if 'alias' in item and item['alias'] in line:
                errors.append({
                    "line": line_num,
                    "type": "missing_action",
                    "message": "Automation missing 'action:' or 'actions:'",
                    "solution": "Add at least one action",
                    "example": "action:\n  - action: light.turn_on",
                    "original": line.strip()
                })
                break

    if 'mode' in item:
        valid_modes = {'single', 'restart', 'queued', 'parallel'}
        if item['mode'] not in valid_modes:
            for line_num, line in enumerate(lines, 1):
                if f"mode: {item['mode']}" in line:
                    errors.append({
                        "line": line_num,
                        "type": "invalid_automation_mode",
                        "message": f"Invalid automation mode: '{item['mode']}'",
                        "solution": f"Use one of: {', '.join(valid_modes)}",
                        "example": "mode: single",
                        "original": line.strip()
                    })
                    break

    return errors


def _validate_scene(item: dict, lines: list[str], line_num: int) -> list[dict]:
    """Validate scene-specific rules."""
    errors = []

    if 'name' not in item:
        errors.append({
            "line": line_num,
            "type": "missing_scene_name",
            "message": "Scene missing 'name:' field",
            "solution": "Add 'name:' field to identify the scene",
            "example": "- name: Evening Mode\n  entities:\n    light.bedroom: on",
            "original": lines[line_num - 1].strip() if line_num <= len(lines) else "scene"
        })

    if 'entities' not in item or (isinstance(item.get('entities'), dict) and not item['entities']):
        errors.append({
            "line": line_num,
            "type": "empty_scene_entities",
            "message": "Scene has no entities defined",
            "solution": "Add entities to the scene",
            "example": "entities:\n  light.bedroom: 'on'\n  light.brightness: 254",
            "original": lines[line_num - 1].strip() if line_num <= len(lines) else "scene"
        })

    return errors


def _validate_script(item: dict, lines: list[str], line_num: int) -> list[dict]:
    """Validate script-specific rules."""
    errors = []

    has_sequence = 'sequence' in item
    has_action = 'action' in item or 'actions' in item

    if not has_sequence and not has_action:
        errors.append({
            "line": line_num,
            "type": "missing_script_sequence",
            "message": "Script missing 'sequence:' or 'action:' field",
            "solution": "Add 'sequence:' or 'action:' with script steps",
            "example": "sequence:\n  - action: light.turn_on\n    target:\n      entity_id: light.bedroom",
            "original": lines[line_num - 1].strip() if line_num <= len(lines) else "script"
        })

    return errors


def _find_parent_section(lines: list[str], current_line_num: int) -> str:
    """Find the top-level YAML section (indent 0) that contains the current line."""
    for i in range(current_line_num - 2, -1, -1):
        prev_line = lines[i]
        stripped = prev_line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        indent = len(prev_line) - len(prev_line.lstrip())
        if indent == 0 and stripped.endswith(':'):
            return stripped[:-1]
    return ""


def _check_entity_id_in_data(lines: list[str], warnings: list[dict]) -> None:
    """Detect entity_id: inside a data: block (should be in target:)."""
    in_data_block = False
    data_indent = -1

    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        indent = len(line) - len(line.lstrip())

        # Check if we're entering a data: block
        if re.match(r'^-?\s*data\s*:', stripped):
            in_data_block = True
            data_indent = indent
            continue

        # Check if we're entering a target: block (reset data context)
        if re.match(r'^-?\s*target\s*:', stripped):
            in_data_block = False
            data_indent = -1
            continue

        # If at same or shallower indent, we've left the data block
        if in_data_block and indent <= data_indent:
            in_data_block = False
            data_indent = -1

        # Check for entity_id inside data block
        if in_data_block and re.match(r'^-?\s*entity_id\s*:', stripped):
            warnings.append({
                "line": line_num,
                "type": "deprecated_syntax",
                "message": "'entity_id:' inside 'data:' is deprecated",
                "solution": "Move 'entity_id:' to a 'target:' block instead",
                "example": "data:\n  entity_id: light.kitchen  →  target:\n  entity_id: light.kitchen\ndata: ...",
                "original": stripped
            })


def check_yaml(content: str, strict_mode: bool = True) -> web.Response:
    """Check for YAML syntax errors and provide smart solutions."""
    syntax_errors = []
    best_practice_warnings = []

    try:
        class HAYamlLoader(yaml.SafeLoader): pass
        def ha_constructor(loader, node): return loader.construct_scalar(node)
        tags = [
            '!include', '!include_dir_list', '!include_dir_named',
            '!include_dir_merge_list', '!include_dir_merge_named',
            '!secret', '!env_var', '!input',
            '!lambda', '!extend',
        ]
        for tag in tags: HAYamlLoader.add_constructor(tag, ha_constructor)
        parsed = yaml.load(content, Loader=HAYamlLoader)
    except yaml.YAMLError as e:
        return json_response({
            "valid": False,
            "error": str(e),
            "type": "syntax_error",
            "suggestions": [
                "Check for proper indentation (use 2 spaces, not tabs)",
                "Ensure all quotes are properly closed",
                "Verify that list items start with '-' followed by a space",
                "Check for special characters that need quoting"
            ]
        })
    except Exception as e:
        return json_response({"valid": False, "error": str(e)})

    if parsed is None:
        return json_response({
            "valid": True,
            "message": "Empty or null YAML file"
        })

    lines = content.split('\n')

    for line_num, line in enumerate(lines, 1):
        if _is_comment_line(line):
            continue

        if re.search(YAML_ERROR_PATTERNS["legacy_service"]["pattern"], line):
            best_practice_warnings.append({
                "line": line_num,
                "type": "legacy_syntax",
                "message": YAML_ERROR_PATTERNS["legacy_service"]["message"],
                "solution": YAML_ERROR_PATTERNS["legacy_service"]["solution"],
                "example": YAML_ERROR_PATTERNS["legacy_service"]["example"],
                "original": line.strip()
            })

        if re.search(YAML_ERROR_PATTERNS["old_trigger_syntax"]["pattern"], line):
            # Nested trigger groups (- trigger: or/and/not) are valid HA 2024.10+ syntax.
            if not _is_nested_trigger_group(line):
                is_in_triggers = _is_in_triggers_context(lines, line_num)
                if is_in_triggers:
                    best_practice_warnings.append({
                        "line": line_num,
                        "type": "legacy_trigger",
                        "message": YAML_ERROR_PATTERNS["old_trigger_syntax"]["message"],
                        "solution": YAML_ERROR_PATTERNS["old_trigger_syntax"]["solution"],
                        "example": YAML_ERROR_PATTERNS["old_trigger_syntax"]["example"],
                        "original": line.strip()
                    })

        if strict_mode and re.match(r"^\s*trigger:\s*$", line):
            indent = len(line) - len(line.lstrip())
            if indent <= 4:
                best_practice_warnings.append({
                    "line": line_num,
                    "type": "singular_key",
                    "message": YAML_ERROR_PATTERNS["singular_trigger"]["message"],
                    "solution": YAML_ERROR_PATTERNS["singular_trigger"]["solution"],
                    "example": YAML_ERROR_PATTERNS["singular_trigger"]["example"],
                    "original": line.strip()
                })

        if strict_mode and re.match(r"^\s*condition:\s*$", line):
            indent = len(line) - len(line.lstrip())
            if indent <= 4:
                best_practice_warnings.append({
                    "line": line_num,
                    "type": "singular_key",
                    "message": YAML_ERROR_PATTERNS["singular_condition"]["message"],
                    "solution": YAML_ERROR_PATTERNS["singular_condition"]["solution"],
                    "example": YAML_ERROR_PATTERNS["singular_condition"]["example"],
                    "original": line.strip()
                })

        if strict_mode and re.match(r"^\s*action:\s*$", line):
            indent = len(line) - len(line.lstrip())
            if indent <= 4:
                if line_num > 1:
                    prev_line = lines[line_num - 2].strip()
                    if not prev_line.endswith(':'):
                        best_practice_warnings.append({
                            "line": line_num,
                            "type": "singular_key",
                            "message": YAML_ERROR_PATTERNS["singular_action"]["message"],
                            "solution": YAML_ERROR_PATTERNS["singular_action"]["solution"],
                            "example": YAML_ERROR_PATTERNS["singular_action"]["example"],
                            "original": line.strip()
                        })

        entity_match = re.search(r"entity_id:\s+([^\s\n]+)", line)
        if entity_match:
            entity_id = entity_match.group(1).strip('"\'')
            if not _is_yaml_block_scalar_indicator(entity_id):
                error = _validate_entity_id(entity_id, line_num, line)
                if error:
                    if error["type"] == "malformed_entity_id":
                        syntax_errors.append(error)
                    else:
                        best_practice_warnings.append(error)

        # NEW-1: data_template: deprecated
        if re.search(YAML_ERROR_PATTERNS["deprecated_data_template"]["pattern"], line):
            best_practice_warnings.append({
                "line": line_num,
                "type": "deprecated_syntax",
                "message": YAML_ERROR_PATTERNS["deprecated_data_template"]["message"],
                "solution": YAML_ERROR_PATTERNS["deprecated_data_template"]["solution"],
                "example": YAML_ERROR_PATTERNS["deprecated_data_template"]["example"],
                "original": line.strip()
            })

        # NEW-4: service_template: deprecated
        if re.search(YAML_ERROR_PATTERNS["deprecated_service_template"]["pattern"], line):
            best_practice_warnings.append({
                "line": line_num,
                "type": "deprecated_syntax",
                "message": YAML_ERROR_PATTERNS["deprecated_service_template"]["message"],
                "solution": YAML_ERROR_PATTERNS["deprecated_service_template"]["solution"],
                "example": YAML_ERROR_PATTERNS["deprecated_service_template"]["example"],
                "original": line.strip()
            })

        # NEW-3: platform: template under sensor/switch etc.
        if re.search(YAML_ERROR_PATTERNS["deprecated_platform_template"]["pattern"], line):
            template_parent_domains = {
                'sensor', 'binary_sensor', 'switch', 'cover', 'fan',
                'light', 'lock', 'vacuum', 'weather', 'alarm_control_panel',
            }
            parent_domain = _find_parent_section(lines, line_num)
            if parent_domain in template_parent_domains:
                best_practice_warnings.append({
                    "line": line_num,
                    "type": "deprecated_syntax",
                    "message": YAML_ERROR_PATTERNS["deprecated_platform_template"]["message"],
                    "solution": YAML_ERROR_PATTERNS["deprecated_platform_template"]["solution"],
                    "example": YAML_ERROR_PATTERNS["deprecated_platform_template"]["example"],
                    "original": line.strip()
                })

    # NEW-2: entity_id inside data: block
    _check_entity_id_in_data(lines, best_practice_warnings)

    if isinstance(parsed, list):
        for idx, item in enumerate(parsed):
            if isinstance(item, dict) and ('alias' in item or 'id' in item):
                if 'use_blueprint' in item:
                    continue
                auto_errors = _validate_automation(item, lines)
                for error in auto_errors:
                    if error["type"] == "missing_automation_id":
                        best_practice_warnings.append(error)
                    else:
                        syntax_errors.append(error)

                if 'alias' in item and 'id' not in item:
                    alias_value = item['alias']
                    for line_num, line in enumerate(lines, 1):
                        if f"alias: {alias_value}" in line or f'alias: "{alias_value}"' in line or f"alias: '{alias_value}'" in line:
                            best_practice_warnings.append({
                                "line": line_num,
                                "type": "missing_id",
                                "message": f"Automation '{alias_value}' missing unique 'id:' field",
                                "solution": YAML_ERROR_PATTERNS["missing_id"]["solution"],
                                "example": f"- id: '{int(time.time() * 1000)}'\n  alias: {alias_value}",
                                "original": line.strip()
                            })
                            break

    if syntax_errors:
        return json_response({
            "valid": False,
            "errors": syntax_errors,
            "error_count": len(syntax_errors),
            "message": f"Found {len(syntax_errors)} syntax error(s)"
        })

    if best_practice_warnings:
        return json_response({
            "valid": True,
            "warnings": best_practice_warnings,
            "warning_count": len(best_practice_warnings),
            "message": f"YAML is valid but found {len(best_practice_warnings)} best practice issue(s)"
        })

    return json_response({
        "valid": True,
        "message": "YAML is valid and follows best practices!"
    })


def check_blueprint(content: str) -> web.Response:
    """Validate a Home Assistant blueprint YAML file."""
    errors = []
    warnings = []

    # Parse YAML
    try:
        class HAYamlLoader(yaml.SafeLoader): pass
        def ha_constructor(loader, node): return loader.construct_scalar(node)
        for tag in ['!include', '!secret', '!env_var', '!input', '!lambda', '!extend']:
            HAYamlLoader.add_constructor(tag, ha_constructor)
        parsed = yaml.load(content, Loader=HAYamlLoader)
    except yaml.YAMLError as e:
        return json_response({
            "valid": False,
            "error": str(e),
            "type": "syntax_error",
            "suggestions": ["Check for proper indentation (use 2 spaces, not tabs)"]
        })
    except Exception as e:
        return json_response({"valid": False, "error": str(e)})

    if not isinstance(parsed, dict):
        return json_response({"valid": False, "error": "Blueprint must be a YAML mapping (dict)", "type": "syntax_error"})

    lines = content.split('\n')

    # --- Blueprint header checks ---
    bp = parsed.get('blueprint')
    if not isinstance(bp, dict):
        errors.append({
            "line": 1, "type": "missing_blueprint_key",
            "message": "Missing top-level 'blueprint:' key",
            "solution": "Add 'blueprint:' with name, domain, and description",
            "example": "blueprint:\n  name: My Blueprint\n  domain: automation",
            "original": lines[0].strip() if lines else ""
        })
        return json_response({"valid": False, "errors": errors, "error_count": len(errors),
                              "message": f"Found {len(errors)} error(s)"})

    # Required: name
    if not bp.get('name'):
        for ln, line in enumerate(lines, 1):
            if 'blueprint:' in line:
                errors.append({
                    "line": ln, "type": "missing_blueprint_name",
                    "message": "Blueprint missing required 'name:' field",
                    "solution": "Add 'name:' inside the blueprint: block",
                    "example": "blueprint:\n  name: My Blueprint",
                    "original": line.strip()
                })
                break

    # Required: domain
    domain = bp.get('domain')
    if not domain:
        for ln, line in enumerate(lines, 1):
            if 'blueprint:' in line:
                errors.append({
                    "line": ln, "type": "missing_blueprint_domain",
                    "message": "Blueprint missing required 'domain:' field",
                    "solution": "Add 'domain: automation' or 'domain: script'",
                    "example": "blueprint:\n  domain: automation",
                    "original": line.strip()
                })
                break
    elif domain not in BLUEPRINT_VALID_DOMAINS:
        for ln, line in enumerate(lines, 1):
            if f'domain:' in line and domain in line:
                errors.append({
                    "line": ln, "type": "invalid_blueprint_domain",
                    "message": f"Invalid blueprint domain: '{domain}'",
                    "solution": f"Use one of: {', '.join(sorted(BLUEPRINT_VALID_DOMAINS))}",
                    "example": "domain: automation",
                    "original": line.strip()
                })
                break

    # Recommended: description
    if not bp.get('description'):
        warnings.append({
            "line": 1, "type": "missing_blueprint_description",
            "message": "Blueprint missing recommended 'description:' field",
            "solution": "Add a description to help users understand the blueprint",
            "example": "blueprint:\n  description: 'This blueprint does...'",
            "original": ""
        })

    # Recommended: author
    if not bp.get('author'):
        warnings.append({
            "line": 1, "type": "missing_blueprint_author",
            "message": "Blueprint missing recommended 'author:' field",
            "solution": "Add your name or username as the author",
            "example": "blueprint:\n  author: your_name",
            "original": ""
        })

    # --- Input validation ---
    # HA blueprints support nested sections: a top-level input key may itself
    # have an `input:` sub-block (collapsible section). Inputs inside those
    # sections are still referenced by their bare key (e.g. !input telegram_base_url),
    # not prefixed with the section name. We must collect them recursively.

    def _collect_inputs(input_dict: dict, defined: set) -> None:
        """Recursively collect all input names, descending into sections."""
        for key, val in input_dict.items():
            if isinstance(val, dict) and 'input' in val and isinstance(val['input'], dict):
                # This is a section — recurse into its nested inputs
                _collect_inputs(val['input'], defined)
            else:
                # This is a real input
                defined.add(key)
                # Check selector type
                if isinstance(val, dict) and 'selector' in val:
                    sel = val['selector']
                    if isinstance(sel, dict):
                        for sel_type in sel.keys():
                            if sel_type not in BLUEPRINT_SELECTOR_TYPES:
                                for ln, line in enumerate(lines, 1):
                                    if sel_type + ':' in line or sel_type in line:
                                        errors.append({
                                            "line": ln, "type": "invalid_selector_type",
                                            "message": f"Unknown selector type: '{sel_type}'",
                                            "solution": "Use a valid selector type",
                                            "example": f"Valid selectors: {', '.join(sorted(list(BLUEPRINT_SELECTOR_TYPES)[:8]))}...",
                                            "original": line.strip()
                                        })
                                        break

    defined_inputs: set = set()
    if isinstance(bp.get('input'), dict):
        _collect_inputs(bp['input'], defined_inputs)

    # --- !input reference checks ---
    used_inputs = set()
    input_pattern = re.compile(r'!input\s+([a-zA-Z0-9_]+)')
    for ln, line in enumerate(lines, 1):
        if _is_comment_line(line):
            continue
        for match in input_pattern.finditer(line):
            ref = match.group(1)
            used_inputs.add(ref)
            if defined_inputs and ref not in defined_inputs:
                errors.append({
                    "line": ln, "type": "undefined_input_ref",
                    "message": f"'!input {ref}' references undefined input",
                    "solution": f"Add '{ref}:' to the blueprint.input: block, or fix the name",
                    "example": f"blueprint:\n  input:\n    {ref}:\n      name: ...",
                    "original": line.strip()
                })

    # Defined but never used inputs
    for input_name in defined_inputs:
        if input_name not in used_inputs:
            warnings.append({
                "line": 1, "type": "unused_input",
                "message": f"Input '{input_name}' is defined but never referenced with !input",
                "solution": f"Use '!input {input_name}' somewhere in the blueprint body, or remove it",
                "example": f"entity_id: !input {input_name}",
                "original": ""
            })

    # --- Body validation by domain ---
    if domain == 'automation':
        has_triggers = 'triggers' in parsed or 'trigger' in parsed
        has_actions = 'actions' in parsed or 'action' in parsed
        if not has_triggers:
            errors.append({
                "line": 1, "type": "missing_triggers",
                "message": "Automation blueprint missing 'triggers:' block",
                "solution": "Add a 'triggers:' block with at least one trigger",
                "example": "triggers:\n  - trigger: state\n    entity_id: !input trigger_entity",
                "original": ""
            })
        if not has_actions:
            errors.append({
                "line": 1, "type": "missing_actions",
                "message": "Automation blueprint missing 'actions:' block",
                "solution": "Add an 'actions:' block with at least one action",
                "example": "actions:\n  - action: homeassistant.turn_on",
                "original": ""
            })
        # Legacy key warnings
        for ln, line in enumerate(lines, 1):
            if re.search(YAML_ERROR_PATTERNS["legacy_service"]["pattern"], line):
                warnings.append({
                    "line": ln, "type": "legacy_syntax",
                    "message": YAML_ERROR_PATTERNS["legacy_service"]["message"],
                    "solution": YAML_ERROR_PATTERNS["legacy_service"]["solution"],
                    "example": YAML_ERROR_PATTERNS["legacy_service"]["example"],
                    "original": line.strip()
                })
            if re.match(r"^\s*trigger:\s*$", line):
                warnings.append({
                    "line": ln, "type": "singular_key",
                    "message": YAML_ERROR_PATTERNS["singular_trigger"]["message"],
                    "solution": YAML_ERROR_PATTERNS["singular_trigger"]["solution"],
                    "example": YAML_ERROR_PATTERNS["singular_trigger"]["example"],
                    "original": line.strip()
                })

    elif domain == 'script':
        has_sequence = 'sequence' in parsed
        if not has_sequence:
            errors.append({
                "line": 1, "type": "missing_sequence",
                "message": "Script blueprint missing 'sequence:' block",
                "solution": "Add a 'sequence:' block with the script steps",
                "example": "sequence:\n  - action: homeassistant.turn_on",
                "original": ""
            })

    if errors:
        return json_response({
            "valid": False,
            "errors": errors,
            "warnings": warnings if warnings else None,
            "error_count": len(errors),
            "message": f"Found {len(errors)} blueprint error(s)"
        })

    if warnings:
        return json_response({
            "valid": True,
            "warnings": warnings,
            "warning_count": len(warnings),
            "message": f"Blueprint is valid but found {len(warnings)} recommendation(s)"
        })

    return json_response({
        "valid": True,
        "message": "Blueprint is valid and follows best practices!"
    })


def check_syntax(content: str, file_path: str = "") -> web.Response:
    """Universal syntax checker - detects file type and applies correct validator."""
    file_type = _detect_file_type(file_path, content)

    if file_type == 'yaml-blueprint':
        return check_blueprint(content)
    elif file_type == 'yaml-homeassistant':
        return check_yaml(content, strict_mode=True)
    elif file_type == 'yaml-esphome':
        return check_yaml(content, strict_mode=False)
    elif file_type == 'json':
        return check_json(content)
    elif file_type == 'python':
        return check_python(content)
    elif file_type == 'javascript':
        return check_javascript(content)
    else:
        return check_yaml(content, strict_mode=False)


def check_jinja(content: str) -> web.Response:
    """Check Jinja2 template syntax and provide intelligent suggestions."""
    errors = []
    suggestions = []

    lines = content.split('\n')

    for line_num, line in enumerate(lines, 1):
        if re.search(JINJA_ERROR_PATTERNS["missing_quotes"]["pattern"], line):
            errors.append({
                "line": line_num,
                "type": "syntax_error",
                "message": JINJA_ERROR_PATTERNS["missing_quotes"]["message"],
                "solution": JINJA_ERROR_PATTERNS["missing_quotes"]["solution"],
                "example": JINJA_ERROR_PATTERNS["missing_quotes"]["example"],
                "original": line.strip()
            })

        if re.search(JINJA_ERROR_PATTERNS["wrong_brackets"]["pattern"], line):
            errors.append({
                "line": line_num,
                "type": "syntax_error",
                "message": JINJA_ERROR_PATTERNS["wrong_brackets"]["message"],
                "solution": JINJA_ERROR_PATTERNS["wrong_brackets"]["solution"],
                "example": JINJA_ERROR_PATTERNS["wrong_brackets"]["example"],
                "original": line.strip()
            })

        if re.search(JINJA_ERROR_PATTERNS["missing_pipe"]["pattern"], line):
            errors.append({
                "line": line_num,
                "type": "syntax_error",
                "message": JINJA_ERROR_PATTERNS["missing_pipe"]["message"],
                "solution": JINJA_ERROR_PATTERNS["missing_pipe"]["solution"],
                "example": JINJA_ERROR_PATTERNS["missing_pipe"]["example"],
                "original": line.strip()
            })

    if "states(" in content:
        suggestions.append({
            "type": "tip",
            "message": "Using states() function",
            "examples": JINJA_PATTERNS["state"]["templates"]
        })

    if "{% if" in content or "{% for" in content:
        suggestions.append({
            "type": "tip",
            "message": "Control structures detected",
            "examples": JINJA_PATTERNS["condition"]["templates"] if "{% if" in content else JINJA_PATTERNS["loop"]["templates"]
        })

    if "now()" in content or "timestamp" in content:
        suggestions.append({
            "type": "tip",
            "message": "Time functions available",
            "examples": JINJA_PATTERNS["time"]["templates"]
        })

    if errors:
        return json_response({
            "valid": False,
            "errors": errors,
            "suggestions": suggestions,
            "error_count": len(errors),
            "message": f"Found {len(errors)} error(s) in Jinja template"
        })

    return json_response({
        "valid": True,
        "suggestions": suggestions,
        "message": "Jinja template syntax looks good!",
        "tip": "Use {{ }} for expressions and {% %} for statements"
    })


def check_json(content: str) -> web.Response:
    """Check JSON syntax using Python's built-in json.loads() parser."""
    if not content or not content.strip():
        return json_response({
            "valid": True,
            "message": "Empty JSON file"
        })

    try:
        parsed = json.loads(content)
        formatted = json.dumps(parsed, indent=2)
        return json_response({
            "valid": True,
            "message": "JSON is valid!",
            "formatted": formatted
        })
    except json.JSONDecodeError as e:
        line_num = e.lineno if e.lineno else 1
        col_num = e.colno if e.colno else 1

        lines = content.split('\n')
        original_line = lines[line_num - 1].strip() if line_num <= len(lines) else ""

        errors = [{
            "line": line_num,
            "column": col_num,
            "type": "syntax_error",
            "message": f"Invalid JSON: {e.msg}",
            "solution": "Check JSON syntax at the indicated position",
            "example": '{"key": "value"} is valid, but {"key": "value",} is not (no trailing commas)',
            "original": original_line
        }]

        return json_response({
            "valid": False,
            "errors": errors,
            "error_count": len(errors),
            "message": f"Found {len(errors)} JSON error(s)"
        })


def check_python(content: str) -> web.Response:
    """Check Python syntax and provide smart solutions."""
    errors = []
    warnings = []

    if not content or not content.strip():
        return json_response({
            "valid": True,
            "message": "Empty Python file"
        })

    try:
        ast.parse(content)
    except SyntaxError as e:
        line_num = e.lineno if e.lineno else 1
        col_num = e.offset if e.offset else 1

        errors.append({
            "line": line_num,
            "column": col_num,
            "type": "syntax_error",
            "message": e.msg,
            "solution": "Check Python syntax at the indicated line",
            "example": "Proper syntax: if condition:\n    pass",
            "original": e.text.strip() if e.text else ""
        })
        return json_response({
            "valid": False,
            "errors": errors,
            "error_count": len(errors),
            "message": f"Found {len(errors)} Python syntax error(s)"
        })
    except Exception as e:
        errors.append({
            "line": 1,
            "type": "syntax_error",
            "message": f"Python parse error: {str(e)}",
            "solution": "Check Python syntax",
            "example": "Use proper Python syntax",
            "original": ""
        })
        return json_response({
            "valid": False,
            "errors": errors,
            "error_count": len(errors),
            "message": f"Found {len(errors)} Python error(s)"
        })

    # Check for common Python issues
    lines = content.split('\n')
    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

    if errors:
        return json_response({
            "valid": False,
            "errors": errors,
            "error_count": len(errors),
            "message": f"Found {len(errors)} Python error(s)"
        })

    if warnings:
        return json_response({
            "valid": True,
            "warnings": warnings,
            "warning_count": len(warnings),
            "message": f"Python is valid but has {len(warnings)} warning(s)"
        })

    return json_response({
        "valid": True,
        "message": "Python syntax is valid!"
    })


def check_javascript(content: str) -> web.Response:
    """Check JavaScript syntax - Server-side FALLBACK ONLY."""
    errors = []
    warnings = []

    if not content or not content.strip():
        return json_response({
            "valid": True,
            "message": "Empty JavaScript file"
        })

    bracket_errors = _check_javascript_brackets(content)
    errors.extend(bracket_errors)

    string_errors = _check_javascript_strings(content)
    errors.extend(string_errors)

    lines = content.split('\n')
    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()

        if not stripped or stripped.startswith('//') or stripped.startswith('/*'):
            continue

        if re.search(r'\b(funtion|constt|lett|varr|conts|lettt)\b', line):
            errors.append({
                "line": line_num,
                "type": "syntax_error",
                "message": "Keyword typo detected",
                "solution": "Check spelling of JavaScript keywords",
                "example": "Use 'function', 'const', 'let', 'var'",
                "original": stripped
            })

        if 'console.log' in line or 'console.error' in line or 'debugger' in line:
            warnings.append({
                "line": line_num,
                "type": "debug_code",
                "message": "Debug code found in file",
                "solution": "Remove console.log, console.error, or debugger before deploying",
                "example": "Remove or comment out: console.log(...)",
                "original": stripped
            })

    if errors:
        return json_response({
            "valid": False,
            "errors": errors,
            "error_count": len(errors),
            "message": f"Found {len(errors)} JavaScript error(s)"
        })

    if warnings:
        return json_response({
            "valid": True,
            "warnings": warnings,
            "warning_count": len(warnings),
            "message": f"JavaScript is valid but has {len(warnings)} warning(s)"
        })

    return json_response({
        "valid": True,
        "message": "JavaScript syntax is valid!"
    })


def _extract_json_error_location(error_msg: str) -> dict:
    """Extract line and column from JSON error message."""
    result = {"line": 1, "column": 1}
    match = re.search(r'line (\d+) column (\d+)', error_msg)
    if match:
        result["line"] = int(match.group(1))
        result["column"] = int(match.group(2))
    return result


def _check_javascript_strings(content: str) -> list:
    """Check for unclosed strings and template literals."""
    errors = []
    in_string = False
    in_template = False
    string_char = None
    string_start_line = 1

    i = 0
    line_num = 1
    while i < len(content):
        char = content[i]
        next_char = content[i + 1] if i + 1 < len(content) else ''

        if char == '\n':
            line_num += 1

        if not in_string and not in_template and char == '/' and next_char == '/':
            i = content.find('\n', i)
            if i == -1:
                break
            i += 1
            line_num += 1
            continue

        if not in_string and not in_template and char == '/' and next_char == '*':
            i = content.find('*/', i + 2)
            if i == -1:
                break
            i += 2
            continue

        if char == '\\' and (in_string or in_template) and i + 1 < len(content):
            i += 2
            continue

        if char in ('"', "'") and not in_template:
            if not in_string:
                in_string = True
                string_char = char
                string_start_line = line_num
            elif char == string_char:
                in_string = False

        if char == '`' and not in_string:
            if not in_template:
                in_template = True
                string_start_line = line_num
            else:
                in_template = False

        i += 1

    if in_string:
        errors.append({
            "line": string_start_line,
            "type": "unclosed_string",
            "message": f"Unclosed string (started with {string_char})",
            "solution": f"Close string with {string_char}",
            "example": f"{string_char}Hello World{string_char}",
            "original": content.split('\n')[string_start_line - 1].strip() if string_start_line <= len(content.split('\n')) else ""
        })

    if in_template:
        errors.append({
            "line": string_start_line,
            "type": "unclosed_template_literal",
            "message": "Unclosed template literal",
            "solution": "Close template literal with backtick `",
            "example": "`Hello ${name}`",
            "original": content.split('\n')[string_start_line - 1].strip() if string_start_line <= len(content.split('\n')) else ""
        })

    return errors


def _check_javascript_brackets(content: str) -> list:
    """Check for unmatched brackets, braces, and parentheses."""
    errors = []

    brackets = {'(': ')', '[': ']', '{': '}'}
    stack = []
    in_string = False
    in_template = False
    in_block_comment = False
    string_char = None

    i = 0
    while i < len(content):
        char = content[i]
        next_char = content[i + 1] if i + 1 < len(content) else ''

        if not in_string and not in_template and not in_block_comment and char == '/' and next_char == '/':
            i = content.find('\n', i)
            if i == -1:
                break
            i += 1
            continue

        if not in_string and not in_template and char == '/' and next_char == '*':
            in_block_comment = True
            i += 2
            continue

        if in_block_comment and char == '*' and next_char == '/':
            in_block_comment = False
            i += 2
            continue

        if in_block_comment:
            i += 1
            continue

        if char == '\\' and (in_string or in_template) and i + 1 < len(content):
            i += 2
            continue

        if char in ('"', "'") and not in_template:
            if not in_string:
                in_string = True
                string_char = char
            elif char == string_char:
                in_string = False

        if char == '`' and not in_string:
            in_template = not in_template

        if not in_string and not in_template and not in_block_comment:
            if char in brackets:
                line_num = len(content[:i].split('\n'))
                stack.append((char, line_num, i))
            elif char in brackets.values():
                line_num = len(content[:i].split('\n'))
                if stack:
                    opening_char, opening_line, opening_col = stack.pop()
                    if brackets[opening_char] != char:
                        errors.append({
                            "line": line_num,
                            "column": i,
                            "type": "mismatched_bracket",
                            "message": f"Mismatched bracket: expected '{brackets[opening_char]}' but found '{char}'",
                            "solution": "Check all opening and closing brackets match",
                            "example": "[1, 2, 3] is correct",
                            "original": content.split('\n')[line_num - 1].strip() if line_num <= len(content.split('\n')) else ""
                        })
                else:
                    errors.append({
                        "line": line_num,
                        "column": i,
                        "type": "unmatched_bracket",
                        "message": f"Unmatched closing bracket '{char}'",
                        "solution": "Check bracket/brace/parenthesis pairs are balanced",
                        "example": "[1, 2, 3] is correct",
                        "original": content.split('\n')[line_num - 1].strip() if line_num <= len(content.split('\n')) else ""
                    })

        i += 1

    if stack:
        opening_char, line_num, col = stack.pop()
        errors.append({
            "line": line_num,
            "column": col,
            "type": "unclosed_bracket",
            "message": f"Unclosed bracket '{opening_char}'",
            "solution": f"Close with '{brackets[opening_char]}'",
            "example": "[1, 2, 3] is correct",
            "original": content.split('\n')[line_num - 1].strip() if line_num <= len(content.split('\n')) else ""
        })

    return errors
