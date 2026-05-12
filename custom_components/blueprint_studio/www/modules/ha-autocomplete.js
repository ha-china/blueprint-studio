/** HA-AUTOCOMPLETE.JS | Purpose: Home Assistant entity autocomplete and YAML schema hints. */
import { API_BASE, HA_SCHEMA } from './constants.js';
import { fetchWithAuth } from './api.js';

export let HA_ENTITIES = [];
export let HA_SERVICES = [];

export async function loadEntities() {
  try {
    const data = await fetchWithAuth(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_entities" }),
    });
    if (data.entities) {
      HA_ENTITIES = data.entities;
    }
  } catch (e) {
    /*console.log*/ void("Failed to load entities for autocomplete", e);
  }
}

export async function loadServices() {
  try {
    const data = await fetchWithAuth(`${API_BASE}?action=get_services`, { method: "GET" });
    if (data.services) {
      HA_SERVICES = data.services;
    }
  } catch (e) {
    void("Failed to load services for autocomplete", e);
  }
}

/**
 * Home Assistant Autocomplete Function for CodeMirror
 */
/**
 * Find the parent service call (action: domain.service) the cursor is currently inside.
 * Walks backward from the cursor line, looking for an "action:" or "service:" line whose
 * indent is shallower than the cursor's. Returns the matching service object from HA_SERVICES,
 * or null if not inside one.
 */
function findEnclosingService(editor, cursorLine, cursorIndent) {
  if (!HA_SERVICES.length) return null;
  for (let i = cursorLine - 1; i >= 0 && i >= cursorLine - 50; i--) {
    const line = editor.getLine(i);
    if (!line || !line.trim()) continue;
    const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    if (indent >= cursorIndent) continue;
    const m = line.match(/^\s*-?\s*(?:action|service)\s*:\s*([a-z0-9_]+\.[a-z0-9_]+)\s*$/);
    if (m) {
      return HA_SERVICES.find(s => s.service === m[1]) || null;
    }
    if (indent === 0) return null;
  }
  return null;
}

/**
 * Returns the enum value list for the given key name, sourced from HA_SCHEMA.valueEnums
 * or from a service field's selector when applicable.
 */
function getValueEnumsForKey(keyName, enclosingService) {
  if (enclosingService && enclosingService.fields && enclosingService.fields[keyName]) {
    const field = enclosingService.fields[keyName];
    const sel = field.selector || {};
    if (sel.select && Array.isArray(sel.select.options)) {
      return sel.select.options.map(opt => {
        if (typeof opt === 'string') return { text: opt };
        return { text: opt.value || opt.label || '', description: opt.label || '' };
      }).filter(o => o.text);
    }
    if (sel.boolean) {
      return [{ text: 'true' }, { text: 'false' }];
    }
  }
  return (HA_SCHEMA.valueEnums && HA_SCHEMA.valueEnums[keyName]) || null;
}

export function homeAssistantHint(editor, options) {
  const cursor = editor.getCursor();
  const currentLine = editor.getLine(cursor.line);
  // Compute word boundaries by scanning backward from the cursor for identifier
  // characters. CodeMirror's getTokenAt sometimes returns sub-tokens mid-word
  // (especially in the ha-yaml mode), which would give the wrong `start` and
  // cause the filter to compare against just the last few characters typed.
  const end = cursor.ch;
  let start = end;
  while (start > 0 && /[a-zA-Z0-9_!]/.test(currentLine.charAt(start - 1))) {
    start--;
  }
  const currentWord = currentLine.slice(start, end);

  // Determine context from previous lines and indentation
  const context = getYamlContext(editor, cursor.line);

  let suggestions = [];

  // Entity autocompletion (e.g. light.kitchen) — skip on action:/service: lines
  const lineText = currentLine.slice(0, cursor.ch);
  const isServiceLine = /^\s*(action|service)\s*:\s*/.test(currentLine);
  const entityMatch = !isServiceLine && lineText.match(/([a-z0-9_]+)\.([a-z0-9_]*)$/);

  if (entityMatch) {
    const fullMatch = entityMatch[0];
    const matchStart = cursor.ch - fullMatch.length;
    const matchedEntities = HA_ENTITIES.filter(e => e.entity_id.startsWith(fullMatch));

    if (matchedEntities.length > 0) {
        suggestions = matchedEntities.map(e => ({
            text: e.entity_id,
            displayText: e.entity_id,
            className: 'ha-hint-entity',
            render: (elem, self, data) => {
                const iconName = e.icon ? e.icon.replace('mdi:', '') : 'help-circle';
                const iconHtml = `<span class="mdi mdi-${iconName}" style="margin-right: 6px; vertical-align: middle;"></span>`;

                elem.innerHTML = `
                  <div style="display: flex; align-items: center;">
                      ${iconHtml}
                      <span>${data.text}</span>
                      <span class="ha-hint-description" style="margin-left: auto; font-size: 0.8em; opacity: 0.7; padding-left: 10px;">${e.friendly_name || ''}</span>
                  </div>
                `;
            },
            hint: (cm, self, data) => {
                cm.replaceRange(data.text, { line: cursor.line, ch: matchStart }, { line: cursor.line, ch: end });
            }
        }));

        return {
            list: suggestions,
            from: CodeMirror.Pos(cursor.line, matchStart),
            to: CodeMirror.Pos(cursor.line, end)
        };
    }
  }

  // Value enum completion — when cursor is to the right of "key: " on the same line.
  // Suggests enum values from HA_SCHEMA.valueEnums or from an enclosing service's field selector.
  // Skip action:/service: lines (handled separately) and trigger:/condition:/platform: lines
  // (which take type values like "state", "numeric_state" — handled by the trigger/condition lists).
  const valueMatch = !isServiceLine && lineText.match(/^(\s*-?\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s+([a-zA-Z0-9_]*)$/);
  if (valueMatch) {
    const keyName = valueMatch[2];
    const valuePrefix = valueMatch[3];
    const valueStart = cursor.ch - valuePrefix.length;
    // Skip keys whose values are themselves a type-discriminator handled elsewhere
    const skipKeys = new Set(['trigger', 'condition', 'platform', 'action', 'service']);
    if (!skipKeys.has(keyName)) {
      const lineIndent = (currentLine.match(/^(\s*)/) || ['', ''])[1].length;
      const enclosingService = findEnclosingService(editor, cursor.line, lineIndent);
      const enums = getValueEnumsForKey(keyName, enclosingService);
      if (enums && enums.length > 0) {
        const filtered = enums.filter(v => v.text.toLowerCase().startsWith(valuePrefix.toLowerCase()));
        if (filtered.length > 0) {
          return {
            list: filtered.map(v => ({
              text: v.text,
              displayText: v.text,
              className: 'ha-hint-value',
              render: (elem) => {
                elem.innerHTML = `
                  <div style="display: flex; align-items: center; width: 100%;">
                    <span class="material-icons" style="font-size: 14px; margin-right: 6px; color: var(--success-color); flex-shrink: 0;">data_object</span>
                    <span>${v.text}</span>
                    ${v.description ? `<span class="ha-hint-description" style="margin-left: auto; font-size: 0.75em; opacity: 0.65; padding-left: 8px;">${v.description}</span>` : ''}
                  </div>
                `;
              },
              hint: (cm) => {
                cm.replaceRange(v.text, { line: cursor.line, ch: valueStart }, { line: cursor.line, ch: end });
              }
            })),
            from: CodeMirror.Pos(cursor.line, valueStart),
            to: CodeMirror.Pos(cursor.line, end)
          };
        }
      }
    }
  }

  // Service autocompletion — triggered when the line is an action:/service: key
  if (isServiceLine && HA_SERVICES.length > 0) {
    // The typed word starts after the colon
    const afterColon = lineText.replace(/^\s*(action|service)\s*:\s*/, '');
    const serviceQuery = afterColon.trimStart();
    const serviceStart = cursor.ch - afterColon.length;
    const matchedServices = HA_SERVICES.filter(s =>
      s.service.startsWith(serviceQuery) || (serviceQuery.length === 0)
    ).slice(0, 30);
    if (matchedServices.length > 0) {
      return {
        list: matchedServices.map(s => ({
          text: s.service,
          displayText: s.service,
          className: 'ha-hint-service',
          render: (elem) => {
            elem.innerHTML = `
              <div style="display: flex; align-items: center; width: 100%;">
                <span class="material-icons" style="font-size: 15px; margin-right: 6px; color: var(--accent-color); flex-shrink: 0;">play_circle</span>
                <span>${s.service}</span>
                ${s.description ? `<span class="ha-hint-description" style="margin-left: auto; font-size: 0.75em; opacity: 0.65; padding-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${s.description}</span>` : ''}
              </div>
            `;
          },
          hint: (cm) => {
            cm.replaceRange(s.service, { line: cursor.line, ch: serviceStart }, { line: cursor.line, ch: end });
          }
        })),
        from: CodeMirror.Pos(cursor.line, serviceStart),
        to: CodeMirror.Pos(cursor.line, end)
      };
    }
  }

  const trimmedLine = currentLine.trimStart();
  const isLineStart = currentLine.substring(0, cursor.ch).trim() === currentWord.trim();

  // Service-data field completion — when cursor is inside a `data:` block under an
  // `action: domain.service` call, suggest the service's field names (brightness:, transition:, etc.)
  // Only fires when the user is typing a key (not a value), at line start.
  if (isLineStart && !lineText.includes(':')) {
    const lineIndent = (currentLine.match(/^(\s*)/) || ['', ''])[1].length;
    const enclosingService = findEnclosingService(editor, cursor.line, lineIndent);
    if (enclosingService && enclosingService.fields && Object.keys(enclosingService.fields).length > 0) {
      const fieldEntries = Object.entries(enclosingService.fields);
      const filtered = fieldEntries.filter(([fieldName]) =>
        fieldName.toLowerCase().startsWith(currentWord.toLowerCase())
      );
      if (filtered.length > 0) {
        return {
          list: filtered.map(([fieldName, meta]) => {
            const required = meta.required ? ' (required)' : '';
            const description = meta.description || '';
            const example = meta.example !== undefined && meta.example !== null
              ? `e.g. ${typeof meta.example === 'object' ? JSON.stringify(meta.example) : meta.example}`
              : '';
            return {
              text: `${fieldName}:`,
              displayText: fieldName,
              className: 'ha-hint-field',
              render: (elem) => {
                elem.innerHTML = `
                  <div style="display: flex; align-items: center; width: 100%;">
                    <span class="material-icons" style="font-size: 14px; margin-right: 6px; color: var(--accent-color); flex-shrink: 0;">tune</span>
                    <span>${fieldName}${required}</span>
                    ${description ? `<span class="ha-hint-description" style="margin-left: auto; font-size: 0.75em; opacity: 0.65; padding-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;" title="${description.replace(/"/g, '&quot;')}">${example || description}</span>` : ''}
                  </div>
                `;
              },
              hint: (cm) => {
                cm.replaceRange(`${fieldName}: `, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
              }
            };
          }),
          from: CodeMirror.Pos(cursor.line, start),
          to: CodeMirror.Pos(cursor.line, end)
        };
      }
    }
  }

  if (currentWord.startsWith('!') || (isLineStart && currentWord === '!')) {
    // Dynamic !input completion for blueprint files
    const fullContent = editor.getValue();
    if (fullContent.includes('blueprint:') && lineText.match(/!input\s+\w*$/)) {
      const inputMatch = lineText.match(/!input\s+(\w*)$/);
      const inputPrefix = inputMatch ? inputMatch[1] : '';
      const inputMatchStart = cursor.ch - inputPrefix.length;
      // Extract defined input names from blueprint.input block
      const inputNames = [];
      const inputBlockMatch = fullContent.match(/blueprint:\s*\n(?:[ \t]+.*\n)*?[ \t]+input:\s*\n((?:[ \t]+.*\n?)*)/);
      if (inputBlockMatch) {
        const inputBlock = inputBlockMatch[1];
        const inputNameRe = /^[ \t]{4}([a-zA-Z0-9_]+):/gm;
        let im;
        while ((im = inputNameRe.exec(inputBlock)) !== null) {
          inputNames.push(im[1]);
        }
      }
      if (inputNames.length > 0) {
        const filtered = inputNames.filter(n => n.startsWith(inputPrefix));
        if (filtered.length > 0) {
          return {
            list: filtered.map(name => ({
              text: name,
              displayText: name,
              className: 'ha-hint-tag',
              render: (elem) => { elem.innerHTML = `<span>${name}</span><span class="ha-hint-type">!input</span>`; },
              hint: (cm) => { cm.replaceRange(name, { line: cursor.line, ch: inputMatchStart }, { line: cursor.line, ch: end }); }
            })),
            from: CodeMirror.Pos(cursor.line, inputMatchStart),
            to: CodeMirror.Pos(cursor.line, end)
          };
        }
      }
    }

    suggestions = HA_SCHEMA.yamlTags
      .filter(item => item.text.toLowerCase().startsWith(currentWord.toLowerCase()))
      .map(item => ({
        text: item.text,
        displayText: item.text,
        className: 'ha-hint-tag',
        render: (elem, self, data) => {
          elem.innerHTML = `
            <span>${data.text}</span>
            <span class="ha-hint-type">${data.type}</span>
          `;
        },
        hint: (cm, self, data) => {
          cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
        },
        ...item
      }));
    // Return early — !-tags should NOT fall through to schema completion
    return {
      list: suggestions.slice(0, 20),
      from: CodeMirror.Pos(cursor.line, start),
      to: CodeMirror.Pos(cursor.line, end)
    };
  }

  const snipMatch = lineText.match(/(snip:[a-z0-9_-]*)$/i);
  if (snipMatch) {
    const snipQuery = snipMatch[0].toLowerCase();
    const snipStart = cursor.ch - snipQuery.length;
    const snipMatches = HA_SCHEMA.snippets.filter(s => s.text.toLowerCase().startsWith(snipQuery));
    
    if (snipMatches.length > 0) {
        suggestions = snipMatches.map(item => ({
          text: item.text,
          displayText: item.label,
          className: 'ha-hint-snippet',
          render: (elem, self, data) => {
            elem.innerHTML = `
              <div style="display: flex; align-items: center; width: 100%;">
                  <span class="material-icons" style="font-size: 16px; margin-right: 6px; color: var(--warning-color);">auto_fix_high</span>
                  <span>${data.displayText}</span>
                  <span class="ha-hint-type" style="margin-left: auto;">${item.type}</span>
              </div>
            `;
          },
          hint: (cm, self, data) => {
            const indent = currentLine.match(/^\s*/)[0];
            const indentedContent = item.content.split('\n').map((line, i) => i === 0 ? line : indent + line).join('\n');
            cm.replaceRange(indentedContent, { line: cursor.line, ch: snipStart }, { line: cursor.line, ch: end });
          }
        }));
        
        return {
            list: suggestions,
            from: CodeMirror.Pos(cursor.line, snipStart),
            to: CodeMirror.Pos(cursor.line, end)
        };
    }
  }

  if (suggestions.length === 0 && context.indent === 0 && isLineStart) {
    suggestions = [
      ...HA_SCHEMA.configuration,
      ...HA_SCHEMA.automation,
      ...HA_SCHEMA.commonKeys,
    ].map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          <span class="ha-hint-description">${data.description || ''}</span>
        `;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.inBlueprint && context.inSelector) {
    // Inside a selector: block in a blueprint — suggest selector types
    suggestions = HA_SCHEMA.blueprintSelectors.map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-key',
      render: (elem, self, data) => {
        elem.innerHTML = `<span>${data.text}</span><span class="ha-hint-type">${data.type}</span>${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}`;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.inBlueprint) {
    // Inside a blueprint file — suggest blueprint keys + automation keys
    suggestions = [
      ...HA_SCHEMA.blueprintKeys,
      ...HA_SCHEMA.automation,
    ].map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => {
        elem.innerHTML = `<span>${data.text}</span><span class="ha-hint-type">${data.type}</span>${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}`;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.section === 'automation') {
    if (context.inTrigger) {
      suggestions = HA_SCHEMA.triggers;
    } else if (context.inCondition) {
      suggestions = HA_SCHEMA.conditions;
    } else if (context.inAction) {
      suggestions = [
        ...HA_SCHEMA.services,
        ...HA_SCHEMA.actionKeys,
        ...HA_SCHEMA.repeatKeys,
      ];
    } else {
      suggestions = HA_SCHEMA.automation;
    }

    suggestions = suggestions.map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          <span class="ha-hint-type">${data.type}</span>
          ${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}
        `;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else if (context.section === 'sensor' || context.section === 'binary_sensor') {
    if (context.inPlatform) {
      suggestions = HA_SCHEMA.sensorPlatforms;
    } else {
      suggestions = HA_SCHEMA.commonKeys;
    }

    suggestions = suggestions.map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          ${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}
        `;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }
  else {
    suggestions = [
      ...HA_SCHEMA.commonKeys,
      ...HA_SCHEMA.configuration,
    ].map(item => ({
      text: item.text,
      displayText: item.text,
      className: `ha-hint-${item.type}`,
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          ${data.description ? `<span class="ha-hint-description">${data.description}</span>` : ''}
        `;
      },
      hint: (cm, self, data) => {
        cm.replaceRange(data.text, { line: cursor.line, ch: start }, { line: cursor.line, ch: end });
      },
      ...item
    }));
  }

  // Deduplicate by `text` — when arrays are merged (e.g. configuration + automation),
  // the same key can appear twice and would show up twice in the dropdown.
  const seen = new Set();
  suggestions = suggestions.filter(item => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });

  // Two-tier filter: prefix matches first; substring matches only as fallback when
  // there are no prefix hits. This keeps the dropdown relevant — typing "i" should
  // not match every key containing the letter "i".
  const lcWord = currentWord.toLowerCase();
  if (lcWord) {
    const prefixHits = suggestions.filter(item => item.text.toLowerCase().startsWith(lcWord));
    if (prefixHits.length > 0) {
      suggestions = prefixHits;
    } else {
      // Word-boundary substring fallback: match where the word appears after a
      // non-letter (e.g. "trigger" matches "- trigger:"), but not arbitrary mid-word.
      const re = new RegExp(`(?:^|[^a-z])${lcWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      suggestions = suggestions.filter(item => re.test(item.text));
    }
  }

  suggestions.sort((a, b) => {
    const aStarts = a.text.toLowerCase().startsWith(lcWord);
    const bStarts = b.text.toLowerCase().startsWith(lcWord);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.text.localeCompare(b.text);
  });

  return {
    list: suggestions.slice(0, 30),
    from: { line: cursor.line, ch: start },
    to: { line: cursor.line, ch: end }
  };
}

export function getYamlContext(editor, lineNumber) {
  let context = {
    indent: 0,
    section: null,
    inTrigger: false,
    inCondition: false,
    inAction: false,
    inPlatform: false,
    inBlueprint: false,
    inSelector: false,
  };

  const currentLine = editor.getLine(lineNumber);
  const match = currentLine.match(/^(\s*)/);
  context.indent = match ? match[1].length : 0;

  // Check if this is a blueprint file by scanning top of doc
  for (let i = 0; i < Math.min(lineNumber, 15); i++) {
    const topLine = editor.getLine(i);
    if (topLine && topLine.startsWith('blueprint:')) {
      context.inBlueprint = true;
      break;
    }
  }

  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = editor.getLine(i);
    if (!line.trim()) continue;

    const lineIndent = line.match(/^(\s*)/)[1].length;

    if (lineIndent < context.indent) {
      if (line.includes('automation:')) {
        context.section = 'automation';
      } else if (line.includes('sensor:')) {
        context.section = 'sensor';
      } else if (line.includes('binary_sensor:')) {
        context.section = 'binary_sensor';
      } else if (line.includes('script:')) {
        context.section = 'script';
      }

      if (line.includes('trigger:') || line.includes('triggers:')) {
        context.inTrigger = true;
      } else if (line.includes('condition:') || line.includes('conditions:')) {
        context.inCondition = true;
      } else if (line.includes('action:') || line.includes('actions:')) {
        context.inAction = true;
      } else if (line.includes('platform:')) {
        context.inPlatform = true;
      } else if (line.trimStart().startsWith('selector:')) {
        context.inSelector = true;
      }

      if (lineIndent === 0 && context.indent > 0) {
        break;
      }
    }
  }

  // Flat automation heuristic: if section is still unknown but sibling lines in the
  // same block contain automation-specific keys, treat this as an automation context.
  if (context.section === null && context.indent <= 2) {
    const totalLines = editor.lineCount();
    const scanStart = Math.max(0, lineNumber - 30);
    const scanEnd = Math.min(totalLines - 1, lineNumber + 10);
    for (let i = scanStart; i <= scanEnd; i++) {
      const line = editor.getLine(i);
      if (!line) continue;
      if (/^\s*(alias|trigger|triggers|condition|conditions|action|actions|mode)\s*:/.test(line)) {
        context.section = 'automation';
        break;
      }
    }
  }

  return context;
}

export function defineHAYamlMode() {
  try {
    if (typeof CodeMirror === 'undefined') return;

    CodeMirror.defineMode("ha-yaml", function(config) {
      const yamlMode = CodeMirror.getMode(config, "yaml");

      return {
        startState: function() {
          return {
            yamlState: CodeMirror.startState(yamlMode),
            inJinja: false,
            jinjaType: null
          };
        },
        copyState: function(state) {
          return {
            yamlState: CodeMirror.copyState(yamlMode, state.yamlState),
            inJinja: state.inJinja,
            jinjaType: state.jinjaType
          };
        },
        token: function(stream, state) {
          if (!state.inJinja) {
            if (stream.match("{{")) {
              state.inJinja = true;
              state.jinjaType = "{{";
              return "jinja-bracket"; 
            }
            if (stream.match("{%")) {
              state.inJinja = true;
              state.jinjaType = "{%";
              return "jinja-bracket";
            }
            if (stream.match("{#")) {
              state.inJinja = true;
              state.jinjaType = "{#";
              return "comment";
            }

            const style = yamlMode.token(stream, state.yamlState);
            const current = stream.current();
            if (current.match(/^!(include(_dir_(list|named|merge_list|merge_named))?|secret|env_var|input)/)) {
              return "ha-include-tag";
            }

            if (style === "atom" || style === "tag" || !style) {
                if (current.match(/^[\s-]*(automation|script|sensor|binary_sensor|template|input_boolean|input_number|input_select|input_text|input_datetime|light|switch|climate|cover|scene|group|zone|person):/)) {
                  return style ? style + " ha-domain" : "ha-domain";
                }
                if (current.match(/^[\s-]*(id|alias|trigger|triggers|condition|conditions|action|actions|service|entity_id|platform|device_id|area_id):/)) {
                  return style ? style + " ha-key" : "ha-key";
                }
            }
            return style;
          }

          if (state.inJinja) {
            if ((state.jinjaType === "{{" && stream.match("}}")) ||
                (state.jinjaType === "{%" && stream.match("%}")) ||
                (state.jinjaType === "{#" && stream.match("#}"))) {
              state.inJinja = false;
              state.jinjaType = null;
              return "jinja-bracket";
            }
            
            if (state.jinjaType === "{#") {
              stream.next();
              return "comment";
            }
            
            if (stream.match(/^(if|else|elif|endif|for|endfor|in|is|and|or|not|true|false|none|null|block|endblock|extends|include|import|macro|endmacro|call|endcall|filter|endfilter|set|ns|namespace)\b/)) {
              return "jinja-keyword";
            }
            
            if (stream.match(/^(true|false|none|null)\b/)) {
              return "jinja-atom";
            }
            
            if (stream.match(/^'([^']|\\')*'/)) return "string";
            if (stream.match(/^"([^\"]|\\\")*"/)) return "string";
            if (stream.match(/^\d+(\.\d+)?/)) return "number";
            if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
               return "variable"; 
            }
            if (stream.match(/^(\+|\-|\*|\/|%|==|!=|<=|>=|<|>|=|\||\(|\)|\[|\]|\.|,)/)) {
              return "jinja-operator";
            }
            
            stream.next();
            return null;
          }
        },
        indent: function(state, textAfter) {
          return yamlMode.indent ? yamlMode.indent(state.yamlState, textAfter) : CodeMirror.Pass;
        },
        innerMode: function(state) {
          return {state: state.yamlState, mode: yamlMode};
        }
      };
    });
  } catch (error) {
    console.error("Error defining HA YAML mode:", error);
  }
}

export function defineCSVMode() {
  try {
    if (typeof CodeMirror === 'undefined') return;

    CodeMirror.defineMode("csv", function() {
      return {
        token: function(stream) {
          // Handle quoted strings
          if (stream.peek() === '"') {
            stream.next();
            let escaped = false;
            while (!stream.eol()) {
              const ch = stream.next();
              if (ch === '"' && !escaped) break;
              escaped = !escaped && ch === '\\';
            }
            return "string";
          }
          
          // Handle numbers
          if (stream.match(/^-?\d+(\.\d+)?/)) return "number";
          
          // Handle operators (commas)
          if (stream.match(/^[ \t]*,[ \t]*/)) return "operator";
          
          // Handle regular text/variables
          if (stream.match(/^[^,]+/)) return "variable";
          
          stream.next();
          return null;
        }
      };
    });
  } catch (error) {
    console.error("Error defining CSV mode:", error);
  }
}

export function defineShowWhitespaceMode() {
  try {
    CodeMirror.defineMode("show-whitespace", function(config, parserConfig) {
      return {
        token: function(stream, state) {
          const isIndentZone = !stream.string.slice(0, stream.start).trim();
          
          if (stream.eat("\t")) return "whitespace-tab";
          
          if (stream.eat(" ")) {
            if (isIndentZone) {
              // Toggle between start and end for every space in the indent zone
              // This prevents merging into a single span
              const isEven = Math.floor(stream.start / 1) % 2 === 0;
              return isEven ? "whitespace-indent-start" : "whitespace-indent-end";
            }
            return "whitespace-space";
          }
          
          stream.next();
          return null;
        }
      };
    });
  } catch (error) {
      console.error("Error defining whitespace mode:", error);
  }
}
