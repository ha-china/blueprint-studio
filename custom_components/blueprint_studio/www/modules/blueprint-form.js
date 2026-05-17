/**
 * blueprint-form.js
 * "Use Blueprint" — renders a beginner-friendly form to instantiate a blueprint
 * as a ready-to-use automation YAML, then saves it to automations.yaml or a new file.
 */
import { API_BASE } from './constants.js';
import { fetchWithAuth } from './api.js';
import { showToast } from './ui.js';
import { eventBus } from './event-bus.js';
import { state } from './state.js';

let _weEnabledSplitView = false;
let _mobileOverlayEl = null;
let _formData = null;
let _blueprintContent = null;
let _bpInfo = null;
let _livePreviewTimer = null;
let _markdownWasActive = false;
let _editorSyncHandler = null;
let _editorSyncTimer = null;

// ─── Public API ─────────────────────────────────────────────────────────────

export async function showBlueprintForm(blueprintContent) {
    if (!blueprintContent?.trim()) { showToast('No blueprint content', 'warning'); return; }
    closeBlueprintForm();
    _blueprintContent = blueprintContent;

    const isMobileView = window.innerWidth <= 768;

    if (isMobileView) {
        // Mobile: render in a full-screen fixed overlay instead of the secondary pane
        _injectStyles();
        const overlay = document.createElement('div');
        overlay.className = 'bf-mobile-overlay';
        overlay.id = 'bf-mobile-overlay';
        overlay.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;color:var(--text-secondary)">Parsing blueprint…</div>`;
        document.body.appendChild(overlay);
        _mobileOverlayEl = overlay;

        // Persist state
        state.blueprintFormActive = true;
        state.blueprintFormTabPath = state.activeTab?.path || null;
        eventBus.emit('settings:save');

        try {
            const res = await fetchWithAuth(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'parse_blueprint_inputs', content: blueprintContent }),
            });
            if (!res.success) throw new Error(res.message || 'Parse failed');
            await _renderFormMobile(blueprintContent, res.inputs);
            _attachEditorListener();
        } catch (e) {
            overlay.innerHTML = `<div style="padding:20px;color:var(--error-color,#ff6b6b)">${_esc(e.message)}</div>`;
        }
        return;
    }

    // Desktop: render in secondary pane (original behavior)
    const previewEl = document.getElementById('secondary-asset-preview');
    if (!previewEl) return;
    previewEl.style.cssText = 'padding:0;align-items:stretch;';
    previewEl.classList.add('visible', 'bf-active');
    previewEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;color:var(--text-secondary)">Parsing blueprint…</div>`;

    // Enable split view if not already active
    if (!state.splitView?.enabled) {
        _weEnabledSplitView = true;
        eventBus.emit('ui:toggle-split-view');
        await new Promise(r => setTimeout(r, 150)); // wait for split view to initialize
    }
    // Save markdown preview state
    _markdownWasActive = state.markdownPreviewActive || false;

    // Persist blueprint form state
    state.blueprintFormActive = true;
    state.blueprintFormTabPath = state.activeTab?.path || null;
    eventBus.emit('settings:save');

    _injectStyles();

    try {
        const res = await fetchWithAuth(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'parse_blueprint_inputs', content: blueprintContent }),
        });
        if (!res.success) throw new Error(res.message || 'Parse failed');
        await _renderForm(blueprintContent, res.inputs);
        _attachEditorListener();
    } catch (e) {
        previewEl.innerHTML = `<div style="padding:20px;color:var(--error-color,#ff6b6b)">${_esc(e.message)}</div>`;
    }
}

export function closeBlueprintForm() {
    clearTimeout(_livePreviewTimer);
    _detachEditorListener();

    // Remove mobile overlay if present
    if (_mobileOverlayEl) {
        _mobileOverlayEl.remove();
        _mobileOverlayEl = null;
    }

    const previewEl = document.getElementById('secondary-asset-preview');
    if (previewEl) {
        previewEl.classList.remove('visible', 'bf-active');
        previewEl.style.cssText = '';
        previewEl.innerHTML = '';
    }
    if (_weEnabledSplitView) {
        eventBus.emit('ui:toggle-split-view');
        _weEnabledSplitView = false;
    }
    _formData = null;
    _blueprintContent = null;
    _bpInfo = null;
    _markdownWasActive = false;

    // Clear persisted state
    state.blueprintFormActive = false;
    state.blueprintFormTabPath = null;
    eventBus.emit('settings:save');
}

// ─── Live editor→form sync ───────────────────────────────────────────────────

function _attachEditorListener() {
    _detachEditorListener(); // ensure no double-attach
    const editor = state.primaryEditor || state.editor;
    if (!editor) return;
    _editorSyncHandler = () => {
        clearTimeout(_editorSyncTimer);
        _editorSyncTimer = setTimeout(_syncFromEditor, 1000);
    };
    editor.on('change', _editorSyncHandler);
}

function _detachEditorListener() {
    clearTimeout(_editorSyncTimer);
    if (_editorSyncHandler) {
        const editor = state.primaryEditor || state.editor;
        if (editor) editor.off('change', _editorSyncHandler);
        _editorSyncHandler = null;
    }
}

async function _syncFromEditor() {
    if (!state.blueprintFormActive) return;
    const editor = state.primaryEditor || state.editor;
    if (!editor) return;
    const newContent = editor.getValue();
    if (!newContent?.trim() || newContent === _blueprintContent) return;

    const formContainer = _mobileOverlayEl || document.getElementById('secondary-asset-preview');
    const statusEl = formContainer?.querySelector('#bf-yaml-status');
    if (statusEl) statusEl.textContent = 'Re-parsing…';

    try {
        const res = await fetchWithAuth(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'parse_blueprint_inputs', content: newContent }),
        });
        if (!res.success) return;
        const preserved = { ..._formData };
        _blueprintContent = newContent;
        // Re-attach listener after re-render (renderForm replaces DOM)
        if (_mobileOverlayEl) {
            await _renderFormMobile(newContent, res.inputs, preserved);
        } else {
            await _renderForm(newContent, res.inputs, preserved);
        }
        _attachEditorListener();
    } catch (_) { /* non-fatal — keep existing form */ }
}

// ─── Form Rendering ──────────────────────────────────────────────────────────

async function _renderForm(blueprintContent, bpInfo, preservedValues = {}) {
    _bpInfo = bpInfo;
    const previewEl = document.getElementById('secondary-asset-preview');
    if (!previewEl) return;

    const allInputs = bpInfo.sections.flatMap(s => s.inputs);

    const needsEntities = allInputs.some(i => i.selector &&
        ('entity' in i.selector || 'target' in i.selector));

    // Collect all domains requested by entity selectors so the backend can pre-filter.
    // If any selector has no domain restriction, we must fetch all domains (pass null).
    // In that case, we still send ensure_domains so the backend prioritises those domains.
    let entityDomains = null;
    let ensureDomains = null;
    if (needsEntities) {
        const domainSets = allInputs
            .filter(i => i.selector && 'entity' in i.selector)
            .map(i => {
                const eCfg = i.selector.entity || {};
                // Collect domains from both direct config and filter: array
                let collected = [];
                if (eCfg.domain) {
                    const d = eCfg.domain;
                    collected = collected.concat(Array.isArray(d) ? d : [d]);
                }
                if (eCfg.filter && Array.isArray(eCfg.filter)) {
                    eCfg.filter.forEach(f => {
                        if (f.domain) {
                            const d = f.domain;
                            collected = collected.concat(Array.isArray(d) ? d : [d]);
                        }
                        // For integration-only filters (no domain), use integration name as
                        // a domain hint — works for HA helpers (input_text, counter, timer, etc.)
                        if (f.integration && !f.domain) {
                            const ig = Array.isArray(f.integration) ? f.integration : [f.integration];
                            collected = collected.concat(ig);
                        }
                    });
                }
                return collected.length ? collected : null; // null = no restriction
            });
        if (domainSets.every(d => d !== null)) {
            entityDomains = [...new Set(domainSets.flat())];
        } else {
            // Mixed: some selectors have domain restrictions, some don't.
            // Collect all restricted domains so the backend can ensure they're included.
            const restricted = domainSets.filter(d => d !== null).flat();
            if (restricted.length) {
                ensureDomains = [...new Set(restricted)];
            }
        }

        // Collect device_class restrictions from direct config and filter: arrays
        const dcSets = allInputs
            .filter(i => i.selector && 'entity' in i.selector)
            .map(i => {
                const eCfg = i.selector.entity || {};
                let collected = [];
                if (eCfg.device_class) {
                    const dc = eCfg.device_class;
                    collected = collected.concat(Array.isArray(dc) ? dc : [dc]);
                }
                if (eCfg.filter && Array.isArray(eCfg.filter)) {
                    eCfg.filter.forEach(f => {
                        if (f.device_class) {
                            const dc = f.device_class;
                            collected = collected.concat(Array.isArray(dc) ? dc : [dc]);
                        }
                    });
                }
                return collected;
            })
            .filter(arr => arr.length > 0);
        var entityDeviceClasses = dcSets.length ? [...new Set(dcSets.flat())] : null;
    }
    const needsDevices = allInputs.some(i => i.selector && 'device' in i.selector);
    const needsAreas   = allInputs.some(i => i.selector && 'area' in i.selector);
    const needsLabels  = allInputs.some(i => i.selector && 'label' in i.selector);
    const needsFloors  = allInputs.some(i => i.selector && 'floor' in i.selector);
    const needsThemes  = allInputs.some(i => i.selector && 'theme' in i.selector);
    const needsAddons  = allInputs.some(i => i.selector && 'addon' in i.selector);

    let entities = [], devices = [], areas = [], labels = [], floors = [], themes = [], addons = [];
    try {
        if (needsEntities) {
            const r = await fetchWithAuth(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'get_entities', query: '',
                    ...(entityDomains ? { domains: entityDomains } : {}),
                    ...(ensureDomains ? { ensure_domains: ensureDomains } : {}),
                    ...(entityDeviceClasses ? { device_classes: entityDeviceClasses } : {}),
                }),
            });
            entities = r.entities || [];
        }
        if (needsDevices) {
            const r = await fetchWithAuth(`${API_BASE}?action=get_devices`);
            devices = r.devices || [];
        }
        if (needsAreas) {
            const r = await fetchWithAuth(`${API_BASE}?action=get_areas`);
            areas = r.areas || [];
        }
        if (needsLabels) {
            const r = await fetchWithAuth(`${API_BASE}?action=get_labels`);
            labels = r.labels || [];
        }
        if (needsFloors) {
            const r = await fetchWithAuth(`${API_BASE}?action=get_floors`);
            floors = r.floors || [];
        }
        if (needsThemes) {
            const r = await fetchWithAuth(`${API_BASE}?action=get_themes`);
            themes = r.themes || [];
        }
        if (needsAddons) {
            const r = await fetchWithAuth(`${API_BASE}?action=get_addons`);
            addons = r.addons || [];
        }
    } catch (_) { /* non-fatal */ }

    _formData = {};
    // Use preserved value if the key still exists, else fall back to blueprint default
    allInputs.forEach(inp => {
        _formData[inp.key] = (inp.key in preservedValues) ? preservedValues[inp.key] : (inp.default ?? '');
    });

    const sectionsHtml = bpInfo.sections.map(s => _sectionHtml(s, devices, areas, entities, labels, floors, themes, addons)).join('');

    previewEl.innerHTML = `
        <div class="bf-panel">
            <div class="bf-header">
                <div class="bf-title-area">
                    <span class="material-icons" style="margin-right:8px;opacity:.7;font-size:1.1em;">architecture</span>
                    <span class="bf-title">Use Blueprint: "${_esc(bpInfo.name)}"</span>
                </div>
                <button class="bf-close" title="Close">✕</button>
            </div>
            <div class="bf-body">
                <div class="bf-field">
                    <label class="bf-label" for="bf-auto-name">Automation Name</label>
                    <input type="text" id="bf-auto-name" class="bf-input"
                           placeholder="My Automation" value="${_esc(bpInfo.name)}">
                </div>
                <div class="bf-field">
                    <label class="bf-label" for="bf-auto-desc">Description <span style="opacity:.5;font-size:.85em">(optional)</span></label>
                    <textarea id="bf-auto-desc" class="bf-input" rows="2"
                              placeholder="What does this automation do?">${_esc(bpInfo.description || '')}</textarea>
                </div>
                ${sectionsHtml}
            </div>
            <div class="bf-preview-divider">
                <span style="font-size:.8em;opacity:.6;font-weight:600;letter-spacing:.05em;text-transform:uppercase">Generated YAML</span>
                <span id="bf-yaml-status" style="font-size:.75em;opacity:.5;margin-left:8px;"></span>
            </div>
            <div class="bf-yaml-panel">
                <pre class="bf-yaml-pre" id="bf-yaml-pre">Fill in the fields above…</pre>
            </div>
            <div class="bf-footer">
                <button class="bf-btn bf-btn-secondary" id="bf-btn-validate">
                    <span class="material-icons">check_circle</span> Validate YAML
                </button>
                <button class="bf-btn bf-btn-primary" id="bf-btn-use">
                    <span class="material-icons">save</span> Save Automation
                </button>
            </div>
        </div>`;

    previewEl.querySelector('.bf-close').addEventListener('click', closeBlueprintForm);

    _wireControls(previewEl, _formData);

    // Validation state
    const requiredKeys = allInputs.filter(i => i.required).map(i => i.key);
    const saveBtn = previewEl.querySelector('#bf-btn-use');

    function _checkValidity() {
        const allFilled = requiredKeys.every(k => {
            const v = _formData[k];
            if (Array.isArray(v)) return v.length > 0;
            if (typeof v === 'boolean') return true;
            return v !== null && v !== undefined && String(v).trim() !== '';
        });
        if (saveBtn) {
            saveBtn.disabled = !allFilled;
            saveBtn.style.opacity = allFilled ? '' : '0.5';
            saveBtn.style.cursor = allFilled ? '' : 'not-allowed';
        }
    }

    // Run on every form change
    previewEl.addEventListener('input', _checkValidity);
    previewEl.addEventListener('change', _checkValidity);
    _checkValidity(); // initial check

    // Wire description info toggles
    previewEl.querySelectorAll('.bf-help-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const helpEl = previewEl.querySelector(`#bf-help-${btn.dataset.helpKey}`);
            if (helpEl) helpEl.classList.toggle('bf-helper-hidden');
        });
    });

    // Wire live preview on all changes
    previewEl.addEventListener('input', _scheduleLivePreview);
    previewEl.addEventListener('change', _scheduleLivePreview);

    previewEl.querySelector('#bf-btn-use').addEventListener('click', async () => {
        // Find first unfilled required field
        const firstInvalid = requiredKeys.find(k => {
            const v = _formData[k];
            if (Array.isArray(v)) return v.length === 0;
            if (typeof v === 'boolean') return false;
            return v === null || v === undefined || String(v).trim() === '';
        });
        if (firstInvalid) {
            const fieldEl = previewEl.querySelector(`[data-field="${firstInvalid}"]`);
            if (fieldEl) {
                fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                fieldEl.classList.add('bf-field-error');
                setTimeout(() => fieldEl.classList.remove('bf-field-error'), 2000);
            }
            showToast('Please fill in all required fields', 'warning');
            return;
        }
        const name = previewEl.querySelector('#bf-auto-name').value || bpInfo.name;
        const desc = previewEl.querySelector('#bf-auto-desc').value || '';
        const automation = await _generateAutomation(_blueprintContent, _formData, name, desc);
        if (automation) await _showSaveDialog(automation, name, previewEl);
    });

    // Wire Validate YAML button
    previewEl.querySelector('#bf-btn-validate')?.addEventListener('click', async () => {
        const name = previewEl.querySelector('#bf-auto-name')?.value || bpInfo.name;
        const desc = previewEl.querySelector('#bf-auto-desc')?.value || '';
        const yaml = await _generateAutomation(_blueprintContent, _formData, name, desc);
        if (!yaml) return;
        try {
            const res = await fetchWithAuth(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'check_yaml', content: yaml }),
            });
            if (res.valid) {
                showToast('YAML is valid', 'success');
            } else {
                showToast(`YAML error: ${res.error || 'Invalid YAML'}`, 'error', 6000);
            }
        } catch (e) {
            showToast(`Validation failed: ${e.message}`, 'error');
        }
    });

    // Trigger initial live preview
    _scheduleLivePreview();
}

// ─── Mobile overlay rendering ────────────────────────────────────────────────
// Renders the form into the full-screen mobile overlay.
// Delegates entirely to _renderForm by temporarily redirecting its DOM target.
async function _renderFormMobile(blueprintContent, bpInfo, preservedValues = {}) {
    if (!_mobileOverlayEl) return;
    // _renderForm writes to document.getElementById('secondary-asset-preview').
    // On mobile that element may not exist, so we temporarily inject a surrogate
    // and then move the rendered content into the real overlay.
    let surrogate = document.getElementById('secondary-asset-preview');
    let didCreateSurrogate = false;
    if (!surrogate) {
        surrogate = document.createElement('div');
        surrogate.id = 'secondary-asset-preview';
        surrogate.style.display = 'none';
        document.body.appendChild(surrogate);
        didCreateSurrogate = true;
    }
    const origCssText = surrogate.style.cssText;
    surrogate.classList.add('visible', 'bf-active');
    surrogate.style.cssText = 'padding:0;align-items:stretch;';

    await _renderForm(blueprintContent, bpInfo, preservedValues);

    // Move rendered panel into overlay
    const panel = surrogate.querySelector('.bf-panel');
    if (panel) {
        _mobileOverlayEl.innerHTML = '';
        _mobileOverlayEl.appendChild(panel);
        // Re-wire close button to remove overlay
        const closeBtn = panel.querySelector('.bf-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeBlueprintForm);
        }
        // Re-wire live preview & save (events were on surrogate)
        _mobileOverlayEl.addEventListener('input', _scheduleLivePreview);
        _mobileOverlayEl.addEventListener('change', _scheduleLivePreview);
        const saveBtn = panel.querySelector('#bf-btn-use');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const name = panel.querySelector('#bf-auto-name')?.value || bpInfo.name;
                const desc = panel.querySelector('#bf-auto-desc')?.value || '';
                const automation = await _generateAutomation(_blueprintContent, _formData, name, desc);
                if (automation) await _showSaveDialog(automation, name, _mobileOverlayEl);
            });
        }
        _wireControls(_mobileOverlayEl, _formData);
        _scheduleLivePreview();
    }

    // Restore surrogate
    surrogate.innerHTML = '';
    surrogate.classList.remove('visible', 'bf-active');
    surrogate.style.cssText = origCssText;
    if (didCreateSurrogate) surrogate.remove();
}

// ─── HTML builders ──────────────────────────────────────────────────────────

function _sectionHtml(section, devices, areas, entities, labels, floors, themes, addons) {
    const inputsHtml = section.inputs
        .map(inp => _fieldHtml(inp, devices, areas, entities, labels, floors, themes, addons))
        .join('');
    if (!section.name) return inputsHtml;  // top-level inputs, no accordion
    return `
        <details class="bf-section" open>
            <summary class="bf-section-title">
                <span class="material-icons bf-chevron">expand_more</span>
                ${_esc(section.name)}
                ${section.description ? `<span class="bf-section-desc">${_esc(section.description)}</span>` : ''}
            </summary>
            <div class="bf-section-body">${inputsHtml}</div>
        </details>`;
}

function _fieldHtml(inp, devices, areas, entities, labels, floors, themes, addons) {
    const selector = inp.selector || { text: {} };
    const sType = Object.keys(selector)[0] || 'text';
    const sCfg  = selector[sType] || {};
    const control = _controlHtml(inp, sType, sCfg, devices, areas, entities, labels, floors, themes, addons);
    return `
        <div class="bf-field" data-field="${_esc(inp.key)}">
            <label class="bf-label">
                ${_esc(inp.name)}${inp.required ? ' <span class="bf-required" title="Required">*</span>' : ''}
                ${inp.description ? `
                    <button type="button" class="bf-help-btn" data-help-key="${_esc(inp.key)}" title="Show help">
                        <span class="material-icons" style="font-size:14px">info_outline</span>
                    </button>` : ''}
            </label>
            ${inp.description ? `<div class="bf-helper bf-helper-hidden" id="bf-help-${_esc(inp.key)}">${_esc(inp.description)}</div>` : ''}
            <div class="bf-control">${control}</div>
        </div>`;
}

function _controlHtml(inp, sType, sCfg, devices, areas, entities, labels, floors, themes, addons) {
    const key = inp.key;
    const def = inp.default;
    const multiple = sCfg.multiple === true;

    switch (sType) {
        case 'entity': {
            // Support both direct config (domain:, device_class:) and filter: array
            const filters = sCfg.filter || [];
            const domain = sCfg.domain;
            let domains = domain
                ? (Array.isArray(domain) ? domain : [domain])
                : null;
            const deviceClass = sCfg.device_class;
            let deviceClasses = deviceClass
                ? (Array.isArray(deviceClass) ? deviceClass : [deviceClass])
                : null;
            let integrations = null;
            // Extract domains, device_classes, integrations from filter array
            if (filters.length) {
                filters.forEach(f => {
                    if (f.domain) {
                        const d = Array.isArray(f.domain) ? f.domain : [f.domain];
                        domains = domains ? [...new Set([...domains, ...d])] : d;
                    }
                    if (f.device_class) {
                        const dc = Array.isArray(f.device_class) ? f.device_class : [f.device_class];
                        deviceClasses = deviceClasses ? [...new Set([...deviceClasses, ...dc])] : dc;
                    }
                    if (f.integration) {
                        const ig = Array.isArray(f.integration) ? f.integration : [f.integration];
                        integrations = integrations ? [...new Set([...integrations, ...ig])] : ig;
                    }
                });
            }
            let filtered = entities;
            if (domains) {
                filtered = filtered.filter(e => domains.some(d => e.entity_id.startsWith(d + '.')));
            }
            if (deviceClasses) {
                filtered = filtered.filter(e => e.device_class && deviceClasses.includes(e.device_class));
            }
            if (integrations) {
                filtered = filtered.filter(e => e.integration && integrations.includes(e.integration));
            }
            const items = filtered.map(e => ({
                id: e.entity_id,
                name: e.friendly_name ? `${e.friendly_name} (${e.entity_id})` : e.entity_id,
            }));
            return _searchDropdownHtml(key, items, multiple, def, 'Search entities…');
        }
        case 'device': {
            let filteredDevices = devices;
            // Support both direct config and filter: array
            const devFilters = sCfg.filter || [];
            let devIntegration = sCfg.integration || null;
            let devManufacturer = sCfg.manufacturer || null;
            let devModel = sCfg.model || null;
            if (devFilters.length) {
                devFilters.forEach(f => {
                    if (f.integration) devIntegration = devIntegration || f.integration;
                    if (f.manufacturer) devManufacturer = devManufacturer || f.manufacturer;
                    if (f.model) devModel = devModel || f.model;
                });
            }
            if (devIntegration) {
                filteredDevices = filteredDevices.filter(d => d.integration === devIntegration);
            }
            if (devManufacturer) {
                filteredDevices = filteredDevices.filter(d => d.manufacturer === devManufacturer);
            }
            if (devModel) {
                filteredDevices = filteredDevices.filter(d => d.model === devModel);
            }
            return _searchDropdownHtml(key, filteredDevices.map(d => ({ id: d.id, name: d.name })),
                multiple, def, 'Search devices…');
        }
        case 'area':
            return _searchDropdownHtml(key, areas.map(a => ({ id: a.id, name: a.name })),
                multiple, def, 'Search areas…');
        case 'label':
            return _searchDropdownHtml(key, labels.map(l => ({ id: l.id, name: l.name })),
                multiple, def, 'Search labels…');
        case 'floor':
            return _searchDropdownHtml(key, (floors || []).map(f => ({ id: f.id, name: f.name })),
                multiple, def, 'Search floors…');
        case 'boolean':
            return _toggleHtml(key, def);
        case 'number':
            return _numberHtml(key, sCfg, def);
        case 'select':
            return _selectHtml(key, sCfg, multiple, def);
        case 'time':
            return `<input type="time" class="bf-input" data-key="${key}" value="${_esc(String(def ?? ''))}">`;
        case 'date':
            return `<input type="date" class="bf-input" data-key="${key}" value="${_esc(String(def ?? ''))}">`;
        case 'duration':
            return _durationHtml(key, def);
        case 'template':
        case 'action':
        case 'condition':
            return `<textarea class="bf-textarea" data-key="${key}" rows="4"
                        placeholder="${sType === 'template' ? 'Jinja2 template…' : 'YAML…'}"
                    >${_esc(String(def ?? ''))}</textarea>`;
        case 'target':
            return _targetHtml(key, entities, areas, devices, def);
        case 'text':
            if (sCfg.multiline) {
                return `<textarea class="bf-textarea" data-key="${key}" rows="3"
                            placeholder="${_esc(String(def ?? ''))}"
                        >${_esc(String(def ?? ''))}</textarea>`;
            }
            return `<input type="text" class="bf-input" data-key="${key}"
                        value="${_esc(String(def ?? ''))}">`;
        case 'icon':
            return `<input type="text" class="bf-input" data-key="${key}"
                        placeholder="mdi:home" value="${_esc(String(def ?? ''))}">`;
        case 'datetime': {
            const dtVal = String(def ?? '');
            const dtParts = dtVal.includes('T') ? dtVal.split('T') : ['', ''];
            return `<div class="bf-datetime-wrap">
                <input type="date" class="bf-input bf-dt-date" data-key-dt-date="${key}" value="${_esc(dtParts[0])}">
                <input type="time" class="bf-input bf-dt-time" data-key-dt-time="${key}" value="${_esc(dtParts[1] || '')}">
            </div>`;
        }
        case 'color_temp': {
            const ctMin = sCfg.min ?? 153;
            const ctMax = sCfg.max ?? 500;
            const ctVal = def ?? ctMin;
            return `<div class="bf-color-temp-wrap">
                <input type="range" class="bf-range bf-color-temp-track" data-key="${key}"
                       min="${ctMin}" max="${ctMax}" step="1" value="${ctVal}">
                <input type="number" class="bf-number-input" data-key-num="${key}"
                       min="${ctMin}" max="${ctMax}" step="1" value="${ctVal}">
                <span class="bf-unit">mireds</span>
            </div>`;
        }
        case 'color_rgb': {
            const rgb = Array.isArray(def) ? def : [255, 255, 255];
            const hex = '#' + rgb.map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
            return `<div class="bf-color-rgb-wrap">
                <input type="color" class="bf-color-picker" data-key-color="${key}" value="${hex}">
                <span class="bf-color-swatch" data-key-swatch="${key}" style="background:${hex}"></span>
                <span class="bf-unit" data-key-rgb-label="${key}">[${rgb.join(', ')}]</span>
            </div>`;
        }
        case 'object':
            return `<textarea class="bf-textarea" data-key="${key}" rows="4"
                        placeholder="YAML or JSON object…">${_esc(String(def ?? ''))}</textarea>`;
        case 'trigger':
            return `<textarea class="bf-textarea" data-key="${key}" rows="4"
                        placeholder="Trigger YAML…">${_esc(String(def ?? ''))}</textarea>`;
        case 'state':
            return `<input type="text" class="bf-input" data-key="${key}"
                        placeholder="Entity state value" value="${_esc(String(def ?? ''))}">`;
        case 'attribute':
            return `<input type="text" class="bf-input" data-key="${key}"
                        placeholder="Entity attribute name" value="${_esc(String(def ?? ''))}">`;
        case 'theme': {
            const opts = (themes || []).map(t =>
                `<option value="${_esc(t)}" ${def === t ? 'selected' : ''}>${_esc(t)}</option>`
            ).join('');
            return `<select class="bf-select" data-key="${key}">
                <option value="">— Select theme —</option>${opts}
            </select>`;
        }
        case 'addon': {
            if (!(addons || []).length) {
                return `<input type="text" class="bf-input" data-key="${key}"
                    placeholder="Add-on slug (e.g. core_ssh)" value="${_esc(String(def ?? ''))}">`;
            }
            const opts = (addons || []).map(a =>
                `<option value="${_esc(a.slug)}" ${def === a.slug ? 'selected' : ''}>${_esc(a.name)}</option>`
            ).join('');
            return `<select class="bf-select" data-key="${key}">
                <option value="">— Select add-on —</option>${opts}
            </select>`;
        }
        case 'location': {
            const lat = def?.latitude ?? '';
            const lon = def?.longitude ?? '';
            const rad = def?.radius ?? 100;
            return `<div class="bf-location-wrap" data-key="${key}">
                <div class="bf-location-row">
                    <label class="bf-location-label">Lat</label>
                    <input type="number" class="bf-input bf-loc-lat" step="0.000001"
                        placeholder="48.8566" value="${_esc(String(lat))}">
                </div>
                <div class="bf-location-row">
                    <label class="bf-location-label">Lon</label>
                    <input type="number" class="bf-input bf-loc-lon" step="0.000001"
                        placeholder="2.3522" value="${_esc(String(lon))}">
                </div>
                <div class="bf-location-row">
                    <label class="bf-location-label">Radius (m)</label>
                    <input type="number" class="bf-input bf-loc-rad" step="1" min="0"
                        placeholder="100" value="${_esc(String(rad))}">
                </div>
            </div>`;
        }
        case 'media':
            return `<div>
                <input type="text" class="bf-input" data-key="${key}"
                    placeholder="Media content ID or URL" value="${_esc(String(def ?? ''))}">
                <div class="bf-helper" style="margin-top:4px">Enter a media content ID (e.g. /media/local/song.mp3)</div>
            </div>`;
        default:
            return `<input type="text" class="bf-input" data-key="${key}"
                        placeholder="${_esc(String(def ?? ''))}" value="${_esc(String(def ?? ''))}">`;
    }
}

function _searchDropdownHtml(key, items, multiple, defaultVal, placeholder) {
    const defaults = multiple
        ? (Array.isArray(defaultVal) ? defaultVal : defaultVal ? [String(defaultVal)] : [])
        : [];

    const pillsHtml = defaults.map(d => {
        const item = items.find(i => i.id === d);
        return `<span class="bf-pill" data-value="${_esc(d)}">${_esc(item?.name || d)}
                    <button type="button" class="bf-pill-remove" tabindex="-1">×</button></span>`;
    }).join('');

    const hiddenVal = multiple ? '' : _esc(String(defaultVal ?? ''));
    const displayVal = multiple ? '' : (() => {
        if (!defaultVal) return '';
        const item = items.find(i => i.id === String(defaultVal));
        return _esc(item?.name || String(defaultVal));
    })();

    const listItems = items.slice(0, 500).map(i =>
        `<li data-id="${_esc(i.id)}" title="${_esc(i.id)}">${_esc(i.name)}</li>`
    ).join('');

    return `
        <div class="bf-search-dropdown" data-key="${_esc(key)}" data-multiple="${multiple}">
            ${multiple
                ? `<div class="bf-pills-wrap">${pillsHtml}<input type="text" class="bf-search-input" placeholder="${_esc(placeholder)}"></div>`
                : `<input type="text" class="bf-search-input" placeholder="${_esc(placeholder)}" value="${displayVal}">`
            }
            <ul class="bf-dropdown-list" style="display:none;">${listItems}</ul>
            ${!multiple ? `<input type="hidden" name="${_esc(key)}" value="${hiddenVal}">` : ''}
        </div>`;
}

function _toggleHtml(key, defaultVal) {
    const checked = (defaultVal === true || defaultVal === 'true') ? 'checked' : '';
    return `
        <label class="bf-toggle">
            <input type="checkbox" class="bf-toggle-input" data-key="${key}" ${checked}>
            <span class="bf-toggle-track"></span>
            <span class="bf-toggle-label">${checked ? 'On' : 'Off'}</span>
        </label>`;
}

function _numberHtml(key, cfg, defaultVal) {
    const min  = cfg.min  ?? 0;
    const max  = cfg.max  ?? 100;
    const step = cfg.step ?? 1;
    const val  = defaultVal ?? min;
    const unit = cfg.unit_of_measurement ? ` ${cfg.unit_of_measurement}` : '';
    return `
        <div class="bf-number-wrap">
            <input type="range" class="bf-range" data-key="${key}"
                   min="${min}" max="${max}" step="${step}" value="${val}">
            <input type="number" class="bf-number-input" data-key-num="${key}"
                   min="${min}" max="${max}" step="${step}" value="${val}">
            <span class="bf-unit">${_esc(unit)}</span>
        </div>`;
}

function _selectHtml(key, cfg, multiple, defaultVal) {
    const options = (cfg.options || []).map(o =>
        typeof o === 'object' ? { value: o.value, label: o.label || o.value } : { value: o, label: o }
    );
    const customValue = cfg.custom_value === true;
    if (!multiple) {
        const isCustom = customValue && defaultVal && !options.some(o => o.value === defaultVal);
        const opts = options.map(o =>
            `<option value="${_esc(o.value)}" ${defaultVal === o.value ? 'selected' : ''}>${_esc(o.label)}</option>`
        ).join('');
        const customOpt = customValue ? `<option value="__custom__" ${isCustom ? 'selected' : ''}>Custom value…</option>` : '';
        let html = `<select class="bf-select" data-key="${key}"${customValue ? ' data-custom-value="true"' : ''}><option value="">— Select —</option>${opts}${customOpt}</select>`;
        if (customValue) {
            const customVal = isCustom ? defaultVal : '';
            html += `<input type="text" class="bf-input bf-custom-input" data-key-custom="${key}"
                        placeholder="Enter custom value…" value="${_esc(String(customVal))}"
                        style="${isCustom ? '' : 'display:none;'}margin-top:6px;">`;
        }
        return html;
    }
    const defaults = Array.isArray(defaultVal) ? defaultVal : [];
    const checks = options.map(o =>
        `<label class="bf-check-item">
            <input type="checkbox" value="${_esc(o.value)}" ${defaults.includes(o.value) ? 'checked' : ''}>
            ${_esc(o.label)}
         </label>`
    ).join('');
    let html = `<div class="bf-multi-check" data-key="${key}">${checks}</div>`;
    if (customValue) {
        html += `<input type="text" class="bf-input bf-custom-multi-input" data-key-custom-multi="${key}"
                    placeholder="Add custom value and press Enter…" style="margin-top:6px;">`;
    }
    return html;
}

function _durationHtml(key, defaultVal) {
    const h = defaultVal?.hours   ?? 0;
    const m = defaultVal?.minutes ?? 0;
    const s = defaultVal?.seconds ?? 0;
    return `<div class="bf-duration" data-key="${key}">
        <label>H<input type="number" class="bf-dur-h" min="0" max="99"  value="${h}"></label>
        <label>M<input type="number" class="bf-dur-m" min="0" max="59"  value="${m}"></label>
        <label>S<input type="number" class="bf-dur-s" min="0" max="59"  value="${s}"></label>
    </div>`;
}

function _targetHtml(key, entities, areas, devices, defaultVal) {
    const defVal = defaultVal?.entity_id ?? defaultVal ?? '';
    const items = entities.slice(0, 500).map(e => ({
        id: e.entity_id,
        name: e.friendly_name ? `${e.friendly_name} (${e.entity_id})` : e.entity_id,
    }));
    return _searchDropdownHtml(key, items, false, defVal, 'Search entities…');
}

// ─── Control Wiring ──────────────────────────────────────────────────────────

function _wireControls(modal, formData) {
    // Text, select, time, date, icon, etc.
    modal.querySelectorAll('[data-key]').forEach(el => {
        const key = el.dataset.key;
        if (!key) return;
        const update = () => {
            if (el.type === 'checkbox') {
                formData[key] = el.checked;
                const lbl = el.closest('.bf-toggle')?.querySelector('.bf-toggle-label');
                if (lbl) lbl.textContent = el.checked ? 'On' : 'Off';
            } else if (el.tagName === 'SELECT') {
                // Handle custom_value selects
                if (el.dataset.customValue === 'true' && el.value === '__custom__') {
                    const customInput = modal.querySelector(`[data-key-custom="${key}"]`);
                    if (customInput) {
                        customInput.style.display = '';
                        customInput.focus();
                        formData[key] = customInput.value;
                    }
                } else {
                    formData[key] = el.value;
                    const customInput = modal.querySelector(`[data-key-custom="${key}"]`);
                    if (customInput) customInput.style.display = 'none';
                }
            } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                formData[key] = el.value;
            }
        };
        el.addEventListener('change', update);
        el.addEventListener('input', update);
        // Initialize from current value
        if (el.type === 'checkbox') formData[key] = el.checked;
        else if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            if (el.value !== '') formData[key] = el.value;
        }
    });

    // Custom value text inputs for selects with custom_value: true
    modal.querySelectorAll('[data-key-custom]').forEach(el => {
        const key = el.dataset.keyCustom;
        const update = () => { formData[key] = el.value; };
        el.addEventListener('input', update);
        el.addEventListener('change', update);
    });

    // Custom value text inputs for multi-select with custom_value: true
    modal.querySelectorAll('[data-key-custom-multi]').forEach(el => {
        const key = el.dataset.keyCustomMulti;
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || !el.value.trim()) return;
            e.preventDefault();
            const wrap = modal.querySelector(`.bf-multi-check[data-key="${key}"]`);
            if (!wrap) return;
            const val = el.value.trim();
            // Add a new checkbox item
            const label = document.createElement('label');
            label.className = 'bf-check-item';
            label.innerHTML = `<input type="checkbox" value="${val}" checked> ${val}`;
            label.querySelector('input').addEventListener('change', () => {
                formData[key] = [...wrap.querySelectorAll('input:checked')].map(c => c.value);
            });
            wrap.appendChild(label);
            formData[key] = [...wrap.querySelectorAll('input:checked')].map(c => c.value);
            el.value = '';
        });
    });

    // Range ↔ number sync
    modal.querySelectorAll('.bf-range').forEach(range => {
        const key = range.dataset.key;
        const numEl = modal.querySelector(`[data-key-num="${key}"]`);
        formData[key] = Number(range.value);
        range.addEventListener('input', () => {
            if (numEl) numEl.value = range.value;
            formData[key] = Number(range.value);
        });
        if (numEl) {
            numEl.addEventListener('input', () => {
                const minVal = parseFloat(numEl.min);
                const maxVal = parseFloat(numEl.max);
                let clamped = Number(numEl.value);
                if (!isNaN(minVal) && clamped < minVal) clamped = minVal;
                if (!isNaN(maxVal) && clamped > maxVal) clamped = maxVal;
                numEl.value = clamped;
                range.value = clamped;
                formData[key] = clamped;
            });
        }
    });

    // Multi-checkboxes
    modal.querySelectorAll('.bf-multi-check').forEach(wrap => {
        const key = wrap.dataset.key;
        const update = () => {
            formData[key] = [...wrap.querySelectorAll('input:checked')].map(c => c.value);
        };
        wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', update));
        update(); // initialize
    });

    // Duration spinners
    modal.querySelectorAll('.bf-duration').forEach(dur => {
        const key = dur.dataset.key;
        const update = () => {
            formData[key] = {
                hours:   Number(dur.querySelector('.bf-dur-h').value) || 0,
                minutes: Number(dur.querySelector('.bf-dur-m').value) || 0,
                seconds: Number(dur.querySelector('.bf-dur-s').value) || 0,
            };
        };
        dur.querySelectorAll('input').forEach(i => i.addEventListener('input', update));
        update(); // initialize
    });

    // Search dropdowns
    modal.querySelectorAll('.bf-search-dropdown').forEach(container => {
        _wireSearchDropdown(container, formData);
    });

    // Datetime composite controls
    modal.querySelectorAll('.bf-datetime-wrap').forEach(wrap => {
        const dateEl = wrap.querySelector('[data-key-dt-date]');
        const timeEl = wrap.querySelector('[data-key-dt-time]');
        if (!dateEl || !timeEl) return;
        const key = dateEl.dataset.keyDtDate;
        const update = () => {
            const d = dateEl.value || '';
            const t = timeEl.value || '00:00:00';
            formData[key] = d ? `${d}T${t}` : '';
        };
        dateEl.addEventListener('change', update);
        timeEl.addEventListener('change', update);
        update();
    });

    // Color RGB picker
    modal.querySelectorAll('.bf-color-picker').forEach(picker => {
        const key = picker.dataset.keyColor;
        const swatch = modal.querySelector(`[data-key-swatch="${key}"]`);
        const label = modal.querySelector(`[data-key-rgb-label="${key}"]`);
        const update = () => {
            const hex = picker.value;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            formData[key] = [r, g, b];
            if (swatch) swatch.style.background = hex;
            if (label) label.textContent = `[${r}, ${g}, ${b}]`;
        };
        picker.addEventListener('input', update);
        update();
    });

    // Location composite controls
    modal.querySelectorAll('.bf-location-wrap').forEach(wrap => {
        const key = wrap.dataset.key;
        const update = () => {
            formData[key] = {
                latitude: parseFloat(wrap.querySelector('.bf-loc-lat').value) || 0,
                longitude: parseFloat(wrap.querySelector('.bf-loc-lon').value) || 0,
                radius: parseFloat(wrap.querySelector('.bf-loc-rad').value) || 100,
            };
        };
        wrap.querySelectorAll('input').forEach(i => i.addEventListener('input', update));
        update();
    });
}

function _wireSearchDropdown(container, formData) {
    const key      = container.dataset.key;
    const multiple = container.dataset.multiple === 'true';
    const search   = container.querySelector('.bf-search-input');
    const list     = container.querySelector('.bf-dropdown-list');
    const hidden   = container.querySelector(`input[type="hidden"][name="${key}"]`);
    const allItems = [...(list?.querySelectorAll('li') || [])];

    if (!search || !list) return;

    // Initialize formData from hidden input (single-select)
    if (!multiple && hidden?.value) formData[key] = hidden.value;
    // Initialize formData from existing pills (multi-select)
    if (multiple) _updateMultiValue(container, key, formData);

    const showList = () => {
        list.style.display = '';
        _filterItems(search.value, allItems);
    };
    const hideList = () => setTimeout(() => { list.style.display = 'none'; }, 160);

    search.addEventListener('focus', showList);
    search.addEventListener('input', () => { list.style.display = ''; _filterItems(search.value, allItems); });
    search.addEventListener('blur', hideList);

    allItems.forEach(li => {
        li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const id   = li.dataset.id;
            const name = li.textContent;
            if (multiple) {
                // Prevent duplicates
                if (container.querySelector(`.bf-pill[data-value="${CSS.escape(id)}"]`)) return;
                const pill = document.createElement('span');
                pill.className = 'bf-pill';
                pill.dataset.value = id;
                pill.innerHTML = `${_esc(name)}<button type="button" class="bf-pill-remove" tabindex="-1">×</button>`;
                pill.querySelector('.bf-pill-remove').addEventListener('click', () => {
                    pill.remove();
                    _updateMultiValue(container, key, formData);
                });
                const pillsWrap = container.querySelector('.bf-pills-wrap');
                if (pillsWrap) pillsWrap.insertBefore(pill, search);
                search.value = '';
                _updateMultiValue(container, key, formData);
            } else {
                search.value = name;
                if (hidden) hidden.value = id;
                formData[key] = id;
                list.style.display = 'none';
            }
        });
    });

    // Wire existing pill remove buttons (rendered from defaults)
    container.querySelectorAll('.bf-pill-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.bf-pill').remove();
            _updateMultiValue(container, key, formData);
        });
    });
}

function _filterItems(query, items) {
    const q = query.toLowerCase().trim();
    let shown = 0;
    items.forEach(li => {
        const match = !q || li.textContent.toLowerCase().includes(q);
        // When no query, show all. When filtering, cap at 100 results.
        const visible = match && (!q || shown < 100);
        li.style.display = visible ? '' : 'none';
        if (visible) shown++;
    });
}

function _updateMultiValue(container, key, formData) {
    formData[key] = [...container.querySelectorAll('.bf-pill')].map(p => p.dataset.value);
}

// ─── Preview / Save ──────────────────────────────────────────────────────────

function _scheduleLivePreview() {
    clearTimeout(_livePreviewTimer);
    _livePreviewTimer = setTimeout(async () => {
        const pre = document.getElementById('bf-yaml-pre');
        const status = document.getElementById('bf-yaml-status');
        if (!pre) return;
        if (status) status.textContent = 'generating…';
        // On mobile the form is in the overlay; on desktop it's in the secondary pane
        const formContainer = _mobileOverlayEl || document.getElementById('secondary-asset-preview');
        const name = formContainer?.querySelector('#bf-auto-name')?.value || _bpInfo?.name || 'My Automation';
        const desc = formContainer?.querySelector('#bf-auto-desc')?.value || '';
        const yaml = await _generateAutomation(_blueprintContent, _formData, name, desc);
        if (pre && yaml) {
            pre.textContent = yaml;
            if (status) status.textContent = '';
        }
    }, 600);
}

async function _generateAutomation(blueprintContent, formData, name, description) {
    try {
        const res = await fetchWithAuth(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'instantiate_blueprint',
                content: blueprintContent,
                input_values: formData,
                name,
                description,
            }),
        });
        if (!res.success) throw new Error(res.message || 'Generation failed');
        return res.automation;
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
        return null;
    }
}

async function _showSaveDialog(automationYaml, name, panelEl) {
    const existing = panelEl.querySelector('.bf-save-dialog-overlay');
    if (existing) existing.remove();

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    const dialog = document.createElement('div');
    dialog.className = 'bf-save-dialog-overlay';
    dialog.innerHTML = `
        <div class="bf-save-dialog">
            <div class="bf-header">
                <span class="bf-title">Save Automation</span>
                <button class="bf-close bf-save-close">✕</button>
            </div>
            <div class="bf-save-body">
                <label class="bf-radio-item">
                    <input type="radio" name="bf-save-mode" value="append" checked>
                    <div>
                        <strong>Append to automations.yaml</strong>
                        <div class="bf-helper">Adds this automation to your existing automations file</div>
                    </div>
                </label>
                <label class="bf-radio-item">
                    <input type="radio" name="bf-save-mode" value="new">
                    <div>
                        <strong>Save as new file…</strong>
                        <div class="bf-helper">Create a separate YAML file for this automation</div>
                    </div>
                </label>
                <div class="bf-new-file-path" style="display:none;margin-top:12px;">
                    <label class="bf-label">File path</label>
                    <input type="text" class="bf-input" id="bf-new-file-path"
                           value="automations/${slug}.yaml">
                </div>
            </div>
            <div class="bf-footer">
                <button class="bf-btn bf-btn-secondary bf-cancel-btn">Cancel</button>
                <button class="bf-btn bf-btn-primary bf-confirm-btn">
                    <span class="material-icons">save</span> Save
                </button>
            </div>
        </div>`;

    panelEl.appendChild(dialog);

    const close = () => dialog.remove();
    dialog.querySelector('.bf-save-close').addEventListener('click', close);
    dialog.querySelector('.bf-cancel-btn').addEventListener('click', close);

    dialog.querySelectorAll('input[name="bf-save-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            dialog.querySelector('.bf-new-file-path').style.display =
                radio.value === 'new' ? '' : 'none';
        });
    });

    dialog.querySelector('.bf-confirm-btn').addEventListener('click', async () => {
        const mode = dialog.querySelector('input[name="bf-save-mode"]:checked')?.value;
        if (mode === 'append') {
            close();
            await _appendToAutomations(automationYaml);
            closeBlueprintForm();
        } else {
            const path = dialog.querySelector('#bf-new-file-path').value.trim();
            if (!path) { showToast('Please enter a file path', 'warning'); return; }
            close();
            await _saveNewFile(path, automationYaml);
            closeBlueprintForm();
        }
    });
}

async function _appendToAutomations(automationYaml) {
    let currentContent = '';
    try {
        const r = await fetchWithAuth(`${API_BASE}?action=read_file&path=automations.yaml`);
        currentContent = r.content || '';
    } catch (_) { /* file may not exist yet */ }

    const separator = currentContent.trim() ? '\n\n' : '';
    const newContent = currentContent.trimEnd() + separator + automationYaml;

    try {
        await fetchWithAuth(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'write_file', path: 'automations.yaml', content: newContent }),
        });
        // write_file auto-reloads automations when path has no slash
        // Also call reload_automations explicitly for robustness
        try {
            await fetchWithAuth(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reload_automations' }),
            });
        } catch (_) { /* non-fatal */ }
        showToast('Automation saved and reloaded!', 'success', 6000);
    } catch (e) {
        showToast(`Save failed: ${e.message}`, 'error');
    }
}

async function _saveNewFile(path, automationYaml) {
    try {
        await fetchWithAuth(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create_file', path, content: automationYaml, overwrite: false }),
        });
        // Reload automations after saving new file
        try {
            await fetchWithAuth(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reload_automations' }),
            });
        } catch (_) { /* non-fatal */ }
        showToast(`Automation saved to ${path} and reloaded!`, 'success', 6000);
    } catch (e) {
        showToast(`Save failed: ${e.message}`, 'error');
    }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function _esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
    );
}

let _stylesInjected = false;
function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const s = document.createElement('style');
    s.textContent = `
/* ── Blueprint Form Panel ── */
.bf-active { padding: 0 !important; align-items: stretch !important; }
.bf-panel {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    overflow: hidden;
    background: var(--bg-primary, #1e1e2e);
    font-size: 14px;
}
.bf-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color, #3a3a4a);
    flex-shrink: 0; min-width: 0;
}
.bf-title-area { display: flex; align-items: center; min-width: 0; overflow: hidden; }
.bf-title { font-weight: 600; font-size: 1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bf-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary, #888); font-size: 1.1em;
    padding: 4px 8px; border-radius: 4px; flex-shrink: 0; margin-left: 8px;
}
.bf-close:hover { background: var(--bg-tertiary, #2a2a3a); }
.bf-body { flex: 2; overflow-y: auto; padding: 16px 18px; min-height: 0; }
.bf-preview-divider {
    display: flex; align-items: center;
    padding: 7px 16px;
    background: var(--bg-secondary, #252535);
    border-top: 1px solid var(--border-color, #3a3a4a);
    border-bottom: 1px solid var(--border-color, #3a3a4a);
    flex-shrink: 0;
}
.bf-yaml-panel {
    flex: 1; min-height: 120px; max-height: 260px; overflow: auto; flex-shrink: 0;
    border-bottom: 1px solid var(--border-color, #3a3a4a);
}
.bf-yaml-pre {
    margin: 0; padding: 12px 16px;
    font-family: var(--font-mono, monospace); font-size: .82em;
    color: var(--text-secondary, #aaa);
    white-space: pre; tab-size: 2;
}
.bf-footer {
    display: flex; gap: 8px; justify-content: flex-end;
    padding: 10px 16px; border-top: 1px solid var(--border-color, #3a3a4a); flex-shrink: 0;
}

/* ── Buttons ── */
.bf-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 6px; border: none;
    cursor: pointer; font-size: .9em; font-weight: 500;
}
.bf-btn .material-icons { font-size: 1.1em; }
.bf-btn-primary { background: var(--accent-color, #5c8df6); color: #fff; }
.bf-btn-primary:hover { filter: brightness(1.1); }
.bf-btn-secondary {
    background: var(--bg-tertiary, #2a2a3a); color: var(--text-primary, #ccc);
    border: 1px solid var(--border-color, #3a3a4a);
}
.bf-btn-secondary:hover { filter: brightness(1.1); }

/* ── Fields ── */
.bf-field { margin-bottom: 18px; }
.bf-label { display:flex; align-items:center; gap:4px; font-weight:600; margin-bottom:5px; font-size:.9em; }
.bf-required { color: var(--error-color, #ff6b6b); margin-left: 2px; }
.bf-helper { font-size: .82em; color: var(--text-secondary, #888); margin-bottom: 6px; line-height: 1.4; }
.bf-helper-hidden { display: none; }
.bf-help-btn { background:none; border:none; cursor:pointer; color:var(--text-secondary); padding:0 4px; vertical-align:middle; display:inline-flex; align-items:center; }
.bf-help-btn:hover { color:var(--accent-color); }
.bf-control { position: relative; }

/* ── Inputs ── */
.bf-input, .bf-select, .bf-textarea {
    width: 100%; padding: 8px 10px; box-sizing: border-box;
    background: var(--bg-tertiary, #2a2a3a);
    border: 1px solid var(--border-color, #3a3a4a);
    border-radius: 6px; color: var(--text-primary, #ccc);
    font-size: .9em;
}
.bf-input:focus, .bf-select:focus, .bf-textarea:focus {
    outline: none; border-color: var(--accent-color, #5c8df6);
    box-shadow: 0 0 0 2px rgba(92,141,246,.15);
}
.bf-textarea { resize: vertical; font-family: inherit; }

/* ── Number slider ── */
.bf-number-wrap { display: flex; align-items: center; gap: 10px; }
.bf-range { flex: 1; accent-color: var(--accent-color, #5c8df6); cursor: pointer; }
.bf-number-input { width: 72px; padding: 6px 8px; box-sizing: border-box;
    background: var(--bg-tertiary); border: 1px solid var(--border-color);
    border-radius: 5px; color: var(--text-primary); font-size: .9em; text-align: right; }
.bf-unit { font-size: .82em; color: var(--text-secondary); flex-shrink: 0; }

/* ── Toggle ── */
.bf-toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.bf-toggle-input { display: none; }
.bf-toggle-track {
    width: 40px; height: 22px; border-radius: 11px;
    background: var(--bg-tertiary); border: 1px solid var(--border-color);
    position: relative; transition: background .2s;
}
.bf-toggle-input:checked + .bf-toggle-track { background: var(--accent-color, #5c8df6); border-color: var(--accent-color, #5c8df6); }
.bf-toggle-track::after {
    content: ''; position: absolute; top: 3px; left: 3px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #fff; transition: left .2s;
}
.bf-toggle-input:checked + .bf-toggle-track::after { left: 21px; }
.bf-toggle-label { font-size: .9em; color: var(--text-secondary); }

/* ── Dropdown ── */
.bf-search-dropdown { position: relative; }
.bf-search-input {
    width: 100%; padding: 8px 10px; box-sizing: border-box;
    background: var(--bg-tertiary); border: 1px solid var(--border-color);
    border-radius: 6px; color: var(--text-primary); font-size: .9em;
}
.bf-search-input:focus { outline: none; border-color: var(--accent-color); }
.bf-dropdown-list {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 200;
    background: var(--bg-secondary, #252535); border: 1px solid var(--border-color);
    border-radius: 6px; max-height: 200px; overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0,0,0,.4); list-style: none; margin: 3px 0; padding: 3px 0;
}
.bf-dropdown-list li { padding: 8px 12px; cursor: pointer; font-size: .9em; }
.bf-dropdown-list li:hover { background: var(--bg-tertiary); }
.bf-pills-wrap {
    display: flex; flex-wrap: wrap; gap: 5px;
    padding: 6px; background: var(--bg-tertiary); border: 1px solid var(--border-color);
    border-radius: 6px; min-height: 36px; align-items: center;
}
.bf-pill {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--accent-color, #5c8df6); color: #fff;
    border-radius: 4px; padding: 3px 8px; font-size: .82em;
}
.bf-pill-remove { background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 1em; line-height: 1; }

/* ── Select/Check ── */
.bf-multi-check { display: flex; flex-direction: column; gap: 6px; }
.bf-check-item { display: flex; align-items: center; gap: 8px; font-size: .9em; cursor: pointer; }

/* ── Duration ── */
.bf-duration { display: flex; gap: 10px; align-items: center; }
.bf-duration label { display: flex; align-items: center; gap: 5px; font-size: .9em; }
.bf-duration input { width: 60px; padding: 6px 8px; background: var(--bg-tertiary);
    border: 1px solid var(--border-color); border-radius: 5px; color: var(--text-primary); font-size: .9em; }

/* ── Section accordion ── */
.bf-section { border: 1px solid var(--border-color, #3a3a4a); border-radius: 7px; margin-bottom: 12px; }
.bf-section-title {
    display: flex; align-items: center; gap: 7px; cursor: pointer;
    padding: 10px 12px; font-weight: 600; font-size: .9em; list-style: none;
    user-select: none;
}
.bf-section-title::-webkit-details-marker { display: none; }
.bf-chevron { font-size: 1.1em; transition: transform .2s; }
details[open] .bf-chevron { transform: rotate(180deg); }
.bf-section-desc { font-size: .82em; color: var(--text-secondary); margin-left: 4px; }
.bf-section-body { padding: 12px 14px; border-top: 1px solid var(--border-color); }

/* ── Save dialog ── */
.bf-save-dialog-overlay {
    position: absolute; inset: 0; z-index: 500;
    background: rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center; padding: 16px;
}
.bf-save-dialog {
    background: var(--bg-primary); border: 1px solid var(--border-color);
    border-radius: 10px; width: min(400px, 95%);
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,.5);
}
.bf-save-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.bf-radio-item { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; padding: 10px; border-radius: 6px; }
.bf-radio-item:hover { background: var(--bg-secondary); }
.bf-radio-item input { margin-top: 2px; flex-shrink: 0; }
.bf-new-file-path { display: flex; flex-direction: column; gap: 6px; }

/* ── Datetime ── */
.bf-datetime-wrap { display: flex; gap: 8px; align-items: center; }
.bf-datetime-wrap .bf-input { flex: 1; }

/* ── Color Temp ── */
.bf-color-temp-wrap { display: flex; align-items: center; gap: 10px; }
.bf-color-temp-track {
    flex: 1; accent-color: var(--accent-color, #5c8df6); cursor: pointer;
    background: linear-gradient(to right, #ff9329, #fff5e6, #b4d7ff);
    border-radius: 4px; height: 8px; -webkit-appearance: none; appearance: none;
}
.bf-color-temp-track::-webkit-slider-thumb {
    -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%;
    background: #fff; border: 2px solid var(--border-color); cursor: pointer;
}

/* ── Color RGB ── */
.bf-color-rgb-wrap { display: flex; align-items: center; gap: 10px; }
.bf-color-picker { width: 48px; height: 36px; border: none; padding: 0; cursor: pointer;
    background: transparent; border-radius: 4px; }
.bf-color-swatch {
    width: 28px; height: 28px; border-radius: 6px;
    border: 1px solid var(--border-color); flex-shrink: 0;
}

/* ── Mobile overlay mode ── */
.bf-mobile-overlay {
    position: fixed; inset: 0; z-index: 9000;
    background: var(--bg-primary, #1e1e2e);
    display: flex; flex-direction: column;
    overflow: hidden;
}

/* ── Location ── */
.bf-location-wrap { display: flex; flex-direction: column; gap: 8px; }
.bf-location-row { display: flex; align-items: center; gap: 8px; }
.bf-location-label { font-size: .82em; color: var(--text-secondary); width: 80px; flex-shrink: 0; }

/* ── Validation ── */
.bf-field-error .bf-control input,
.bf-field-error .bf-control select,
.bf-field-error .bf-control textarea,
.bf-field-error .bf-control .bf-search-input,
.bf-field-error .bf-control .bf-pills-wrap {
    border-color: var(--error-color, #ff6b6b) !important;
    box-shadow: 0 0 0 2px rgba(255,107,107,.2) !important;
    animation: bf-shake 0.3s ease;
}
@keyframes bf-shake {
    0%,100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
}

@media (max-width: 768px) {
  .bf-body { padding: 12px; }
  .bf-close { min-width: 44px; min-height: 44px; padding: 8px; }
  .bf-pill-remove { min-width: 32px; min-height: 32px; padding: 4px 8px; }
  .bf-number-wrap { flex-wrap: wrap; }
  .bf-duration { flex-wrap: wrap; gap: 8px; }
  .bf-datetime-wrap { flex-direction: column; gap: 6px; }
  .bf-dropdown-list { max-height: 160px; }
  .bf-yaml-panel { max-height: 180px; }
  .bf-search-input { font-size: 16px !important; }
  input.bf-input, textarea.bf-textarea, select.bf-select { font-size: 16px !important; }
}
`;
    document.head.appendChild(s);
}
