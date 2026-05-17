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
export function homeAssistantHint(editor, options) {
  const cursor = editor.getCursor();
  const currentLine = editor.getLine(cursor.line);
  const token = editor.getTokenAt(cursor);
  const start = token.start;
  const end = cursor.ch;
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

    suggestions = HA_SCHEMA.yamlTags.map(item => ({
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
  }

  const snipMatch = lineText.match(/(snip:[a-z0-9_]*|sni?p?:?)$/i);
  if (snipMatch) {
    const snipQuery = snipMatch[0].toLowerCase();
    const snipStart = cursor.ch - snipQuery.length;
    const snipMatches = HA_SCHEMA.snippets.filter(s => s.text.startsWith(snipQuery) || snipQuery.startsWith(s.text.split(':')[0]));
    
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
    suggestions = HA_SCHEMA.configuration.map(item => ({
      text: item.text,
      displayText: item.text,
      className: 'ha-hint-domain',
      render: (elem, self, data) => {
        elem.innerHTML = `
          <span>${data.text}</span>
          <span class="ha-hint-description">${data.description}</span>
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

  suggestions = suggestions.filter(item =>
    item.text.toLowerCase().includes(currentWord.toLowerCase())
  );

  suggestions.sort((a, b) => {
    const aStarts = a.text.toLowerCase().startsWith(currentWord.toLowerCase());
    const bStarts = b.text.toLowerCase().startsWith(currentWord.toLowerCase());
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return a.text.localeCompare(b.text);
  });

  return {
    list: suggestions.slice(0, 20),
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

      if (line.includes('trigger:')) {
        context.inTrigger = true;
      } else if (line.includes('condition:')) {
        context.inCondition = true;
      } else if (line.includes('action:')) {
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
