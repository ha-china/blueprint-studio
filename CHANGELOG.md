# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

## [2.5.1] - 2026-05-22

- **Blueprint- Studio has been transferred to ha-china organisation**

- **Mobile file tree indentation restored** — File and folder nesting in the mobile explorer now preserves depth-based indentation instead of flattening every row at the same left edge.

- **Local file visibility now matches SFTP** — The local file tree no longer hides files based on extension, so uploaded Home Assistant assets such as fonts are visible immediately. Single-file uploads are no longer limited by the browser picker filter, and known binary assets including fonts, WASM, AVIF/APNG images, and SQLite sidecar files are handled as binary.

## [2.5.0] - 2026-05-21

- **New HA Agent AI mode** — Route AI queries through Home Assistant conversation agents (e.g. Claw Assistant https://github.com/ha-china/ha_claw) with file edit and diff view support.

- **Complete Git diff viewer rewrite** — New side-by-side and unified diff display with syntax highlighting, context expansion, and inline commenting.

- **File navigation overhaul** — New `file-nav-helper.js` module for path-based reveal-and-open, breadcrumb navigation, and back-button support.

- **Theme system expansion** — Major `themes.css` additions for consistent dark/light mode across all components.

- **Blueprint conversion improvements** — Simplified entity extraction in `ai_generators.py` using regex over YAML traversal for robustness.

- **Frontend cache management** — New "Clear Frontend Cache" button in settings.

- **WebSocket file-change sync** — Real-time tab/tree updates on file create, delete, and rename operations.

- **Folder ZIP uploads no longer falsely report that the destination already exists** — Local "Upload Folder (ZIP)" now matches SFTP behaviour by extracting into `target-folder/zip-name` instead of checking the current target folder itself. Local uploads also now show the same merge/replace conflict flow when the zip-named folder really does already exist.

- **Terminal-created files appear in the file tree without a page reload** — External filesystem changes now trigger frontend refreshes when Home Assistant `folder_watcher` events are available. The integrated terminal also runs a lightweight file-tree snapshot check while open, so files created by commands such as `python -m tinytuya wizard` are picked up automatically.

- **Autocomplete filter no longer drops the start of the word** — Typing `ac` was filtering against just `c` because CodeMirror's tokenizer returned a sub-token start. The hint function now computes the word start by walking backward across identifier characters.

- **YAML autocomplete schema expanded** — `trigger:`, `triggers:`, `condition:`, `conditions:`, `action:`, `actions:`, `service:`, `variables:`, and `trace:` now appear at the root of flat-style automations. Flat automations are recognised by a sibling-key heuristic. Trigger and condition blocks now suggest their body keys (`entity_id:`, `id:`, `for:`, `to:`, `from:`, `above:`, `below:`, `attribute:`, etc.). `choose:` branch keys (`conditions:`, `default:`) and step modifiers (`continue_on_error:`, `enabled:`, `response_variable:`) added to action keys. Added `trigger: device`/`or`/`and`, `condition: weekday`, and the missing `climate.turn_on`/`turn_off`/`set_fan_mode`/`set_preset_mode`/`set_swing_mode` services.

- **Service-data field completion** — Inside a `data:` block under `action: domain.service`, autocomplete now suggests the service's actual fields (e.g. `brightness:`, `transition:` under `light.turn_on`) from the live HA service registry, with required-field flags and descriptions.

- **Value completion after `key: `** — Typing a value after a known key now suggests valid options: `mode:` → `single`/`restart`/`queued`/`parallel`, `state:` → `on`/`off`/`home`/..., `hvac_mode:` → `heat`/`cool`/`auto`/..., plus `fan_mode:`, `preset_mode:`, `weekday:`, `device_class:`, and others. Service fields with selector options feed dynamic enums.

- **Autocomplete filter accuracy** — Replaced the substring filter with prefix-first matching, so typing `i` no longer matches every key containing `i`. Added deduplication so merged arrays don't show the same key twice. Snippets now require the literal `snip:` prefix instead of triggering on a single `s`. The `!`-tag branch returns early instead of being overwritten by schema completion. Removed `:` from `closeCharacters` so the popup persists across `key:` → `key: value`.

## [2.4.8] - 2026-04-29

- **Visual Diff Viewer can now jump between changes** — File diffs now include previous/next navigation buttons and a current-change counter, making it easier to move through large files such as `automations.yaml` and `scripts.yaml`. The active diff block is highlighted as you navigate.

- **Cross-device settings no longer get overwritten by stale browser cache** — Settings loading no longer lets any browser’s `localStorage` override the server copy just because its `_savedAt` timestamp is newer. Local recovery is now limited to a short same-device window using a per-browser `_clientId`, and the resolved settings are written back to local storage after load so old caches stop reviving outdated state from another device.

- **Optional `.editorconfig` reads no longer spam 404 errors in the browser console** — The frontend now requests `.editorconfig` files with an `optional=true` flag, and the backend returns a normal JSON response when the file is missing instead of an HTTP 404. This keeps the console clean when opening files in directories that do not define an `.editorconfig`.

- **Collapsible tree folders no longer appear empty until a manual refresh** — In lazy-loaded tree mode, a folder could already be present in `loadedDirectories` cache without its children being hydrated into `state.fileTree`. Expanding that folder skipped the reload and rendered it as `(empty)` until a full refresh rebuilt the tree. Expanding a cached folder now hydrates the tree immediately, and directory updates replace stale child entries instead of only appending new ones.

- **iPad and touch-device folder navigation detection is more reliable** — Folder navigation mode previously relied on `matchMedia('(pointer: coarse)')`, which could miss some iPads and hybrid touch devices and leave them on the desktop double-click path. Touch detection now also checks `navigator.maxTouchPoints`, `ontouchstart`, and `any-pointer: coarse`, so folder taps consistently open in navigation mode on touch hardware.

## [2.4.7] - 2026-04-23

- **Folded or literal templated `entity_id` values no longer flagged as malformed** — The YAML validator previously scanned `entity_id: >` and `entity_id: |` as though the block scalar marker itself were the entity ID, producing a false "Malformed entity_id: '>'" or `'|'` error on valid multi-line Jinja templates. Block scalar indicators are now recognised and skipped so the templated value can pass cleanly.

- **Custom AI gateway support** — The AI Copilot can now route requests through any OpenAI-compatible endpoint, including local providers such as Ollama and LM Studio. Configure a custom base URL and model in Settings → AI, and use the new "Fetch Models" button to discover available models directly from the endpoint. All AI HTTP requests now enforce a 60-second timeout so a slow or unreachable endpoint fails cleanly instead of hanging indefinitely. (PR #61 by xyiqq)

- **Blocking I/O on the event loop during file search** — `global_search_stream` called `os.walk` synchronously on the HA event loop, causing "Detected blocking call to walk/scandir" log warnings. The directory traversal is now offloaded to `hass.async_add_executor_job`, and individual file reads use `asyncio.get_event_loop().run_in_executor` with `asyncio.as_completed`, keeping the event loop free throughout the entire search operation.

- **Navigation mode file tree not loading or listing files** — When navigating back to a previous folder, the directory data was never fetched, leaving the tree stuck on a permanent loading spinner. `navigateBack` now awaits `loadDirectory` when the target path is not cached, mirroring the existing behaviour of `navigateToFolder`. Additionally, if the app restores a deep `currentNavigationPath` from saved settings on startup and that path is not yet loaded, `renderFileTree` now fires `loadDirectory` automatically instead of showing a spinner that never resolves.

- **Manage Git Exclusions reopens with wrong checkbox states** — The `read_file` API response does not include a `success` field, so the check `if (response.success)` always evaluated to `undefined` (falsy), leaving `gitignoreContent` empty every time. The UI then fell back to four hardcoded defaults (`.cloud`, `.storage`, `deps`, `.ha_run.lock`) regardless of what `.gitignore` actually contained. The check now correctly reads `response.content`. Additionally, files covered by glob patterns (e.g. `*.db`, `*.db-shm`) were always shown as checked (included) because the `isPathIgnored` helper only performed exact string matches. It now evaluates wildcard patterns so files matched by a glob correctly appear unchecked (excluded) when the dialog is reopened.

- **Glob patterns in `.gitignore` stripped or made redundant on save** — When files matched by a glob (e.g. `home-assistant_v2.db` matched by `*.db`) appeared as checked due to the above bug, saving the dialog would add them as explicit paths to the ignore list alongside the glob. The save logic now always preserves wildcard lines unconditionally, and skips adding an explicit path entry if an existing glob pattern already covers it.

## [2.4.6] - 2026-04-11

- **YAML anchors and aliases no longer flagged as invalid entity IDs** — When `entity_id:` was assigned a YAML alias (`*alias_name`) or an anchor declaration was captured (`&anchor_name`), the validator incorrectly treated the token as a malformed entity ID. These are now recognised as YAML syntax and skipped.

- **Device registry UUIDs no longer flagged as invalid entity IDs** — In device triggers, the `entity_id` field holds a 32-character hex UUID rather than a `domain.entity` string. The validator now recognises this format and skips it instead of reporting it as malformed.

## [2.4.5] - 2026-04-09

- **Autocomplete toggle in Editor settings** — A new toggle in Settings → Editor → Behavior lets you disable the YAML autocomplete suggestions that appear as you type. Enabled by default.

- **Autocomplete service completion offset fix** — When completing an `action:` or `service:` line with leading whitespace after the colon, the replacement range was calculated incorrectly, leaving a fragment of the old text. The start offset now accounts for the full (untrimmed) text after the colon.

- **Blueprint detection scans more lines** — The YAML context analyser previously only scanned the first 5 lines to determine if a file was a blueprint. This has been increased to 15 lines to handle files with comments or blank lines before `blueprint:`.

- **Modern trigger syntax in autocomplete** — Trigger suggestions now offer the current `trigger: state` form (HA 2024.4+) as the primary option, with the legacy `platform: state` variants listed below. Also added the missing `trigger: persistent_notification` trigger and `condition: trigger` condition type.

- **`.editorconfig` support** — When a file is opened, Blueprint Studio now walks up the directory tree looking for `.editorconfig` files (stopping at `root = true`), exactly as VS Code does. `indent_style` and `indent_size` rules are applied to the editor for that file. Results are cached per directory for the session. Saving a `.editorconfig` file invalidates the cache for its directory so the new rules take effect immediately on the next file open.

- **Smart Backspace** — Pressing Backspace in leading whitespace now deletes back to the previous indent stop (like VS Code), rather than one character at a time. For example, with 2-space indentation, pressing Backspace at column 4 removes 2 spaces at once. Applies only in space-indent mode; tab-indent mode is unchanged.

- **Settings not surviving a page reload** — If the page was reloaded before the server POST completed (e.g. immediately after changing tab size), the new value was lost. Settings are now stamped with a `_savedAt` timestamp in both localStorage and the server. On load, if localStorage is newer than the server copy, localStorage wins and is immediately re-synced to the server.

- **Status bar and settings panel out of sync** — Changing indentation via the status bar picker did not update the Settings panel dropdown/checkbox, and vice versa. Both now stay in sync: the status bar picker updates the settings panel DOM elements, and the settings panel handlers call `updateStatusBar()` after saving.

- **`indentWithTabs` ignored when applying indentation** — When "Indent with Tabs" was enabled, `indentUnit` was incorrectly set to `tabSize` (e.g. 4) instead of `1`. CodeMirror's `indentUnit` must be `1` when using tabs so that `indentSelection` adds/removes one tab character per level. Fixed in `applyEditorSettings`, both settings panel handlers, the status bar picker, and `createEditor`.

- **Opening a file overwrote global indent preference** — Per-file indentation detection was writing the detected `tabSize` and `indentWithTabs` back to `state`, so switching files would permanently change the user's saved preference for the session. Detection now sets editor options directly without touching `state`.

- **`applyEditorSettings` stomping per-file indent on visibility change** — When switching back to the browser tab, `settings:loaded` fired and `applyEditorSettings` reset the editor to the global preference, overriding the per-file detected or `.editorconfig`-specified indentation. Indent options are now skipped in `applyEditorSettings` when a file is already open.

- **Indentation auto-detection producing "Spaces 1"** — The previous detection algorithm counted absolute indent depths, which caused GCD to collapse to 1 on files with YAML block scalars or multi-level jumps. Detection now uses frequency-filtered GCD of indent *changes* between consecutive lines, and excludes size `1` as a valid result. Single-occurrence deltas (e.g. block scalar continuations) are ignored.

- **Tab-indented files defaulting to size 4 regardless of user preference** — When a file was detected as tab-indented, `tabSize` was hardcoded to 4. It now uses `state.tabSize` (the user's saved preference).

- **`activateTab` not declared `async`** — Adding `await getEditorConfigIndent(...)` inside `activateTab` caused a `SyntaxError: Unexpected reserved word` crash on load. `activateTab` is now correctly declared `async`.

- **EditorConfig fetch logging 404 errors to console** — When no `.editorconfig` exists (the common case), three 404 requests were logged as errors on every file open. The editorconfig fetcher now uses a raw `fetch` call instead of `fetchWithAuth`, silently returning `null` on any non-ok response. Results are cached so subsequent file opens make no network requests for directories already confirmed as missing.

- **Collapsing a folder with an active file collapsed the entire file tree** — In navigation mode, clicking a folder to collapse it set `currentNavigationPath` to that folder, causing the tree to redraw showing only that folder's subtree (making everything else disappear). The navigation path is now only updated when *expanding* a folder, not when collapsing it.
  
## [2.4.4] - 2026-03-30

### Added

- **Hosts management in Settings → Integrations** — A new "Hosts" section lets you add, edit, and delete SSH/SFTP hosts from one central place. Hosts are shared across the SFTP panel and the terminal SSH dropdown, so you only need to configure a connection once. Each host shows its name, address, port, username, and auth method (password or key) at a glance.


### Fixed

- **No SSH host key verification (MITM)** — SFTP and Paramiko-based SSH terminal sessions previously used `AutoAddPolicy`, which accepted any server key unconditionally — including changed keys on subsequent connections. Host key verification is now enforced using a Trust-On-First-Use (TOFU) policy: the server key is trusted and saved to `<config_dir>/.ssh/known_hosts` on first contact, and any key change on a later connection raises an error to prevent silent man-in-the-middle attacks. Both SFTP and terminal sessions share the same `known_hosts` file.

- **Indentation size not persisting across sessions** — Tab size (e.g. 2 spaces) was saved correctly but not re-applied to the editor on startup. `applyEditorSettings` was missing `indentUnit`, `tabSize`, and `indentWithTabs` options, so the editor would revert to its default indentation until the setting was manually toggled. These options are now applied consistently on every settings load.

>>>>>>> a95fd1d9ec9ccc18c1661e0e01ee5f79f6b227f5

### Changed

- **PDF.js migrated to ES module loading** — PDF.js is no longer loaded as a classic `<script>` tag. It is now imported on demand via a dynamic `import()` when a PDF file is opened. This allows keeping PDF.js up to date (4.6.82 → 4.10.38) as newer versions require ES module context.

- **Vendor library updates** — Updated bundled frontend libraries: CodeMirror 5.65.19 → 5.65.20, highlight.js 11.10.0 → 11.11.1, PDF.js 4.6.82 → 4.10.38, Prettier 3.3.3 → 3.8.1, Acorn 8.12.1 → 8.16.0, xterm.js 5.5.0 → 6.0.0, xterm-addon-fit 0.10.0 → 0.11.0, xterm-addon-web-links 0.11.0 → 0.12.0, Primer Octicons 19.12.0 → 19.23.1, marked 12.0.0 → 17.0.5, marked-gfm-heading-id 3.2.0 → 4.1.3, marked-mangle 1.1.9 → 1.1.12, marked-highlight 2.1.4 → 2.2.3.

- **Split view moved to Editor settings** — The split view toggle is now in **Settings → Editor → Behavior** alongside word wrap, line numbers, minimap, and other editor options. The BETA label has been removed. It was previously in the Advanced tab. — Each depth level in the file tree (both local and SFTP) now indents by 24 px instead of 16 px, making it easier to tell which level a file belongs to when many folders are expanded.

- **File tree: empty folders now show an `(empty)` placeholder** — When an expanded folder contains no files or subfolders, an italic "(empty)" label is shown at the correct indent level, matching the existing behaviour in the SFTP tree.

- **SFTP panel: edit and delete buttons visible before connecting** — The edit and delete buttons for a saved host now appear as soon as a connection is selected in the SFTP dropdown, not only after a successful connection. This makes it possible to fix wrong credentials without having to connect first.

- **SFTP panel: connections now sourced from the unified Hosts store** — The SFTP connection list is no longer a separate setting. It reads from the same host list used by the terminal, and any host added through the SFTP "Add connection" dialog is immediately available in the terminal SSH dropdown as well. Existing `sftpConnections` saved in settings are automatically migrated into the unified list on first load.

- **Terminal: SSH dropdown simplified to host selection only** — The "Manage hosts" option has been removed from the terminal SSH dropdown. Host management is now done exclusively in Settings → Integrations → Hosts.

- **Blueprint converter: `addon:` data key is now parameterised** — The automation-to-blueprint converter now extracts `addon:` values under action `data:` blocks (e.g. `hassio.addon_restart`, `hassio.addon_start`) into an `addon_id` input with a `text` selector, defaulting to the slug found in the automation. Previously the add-on ID was left hardcoded in the generated blueprint body.

- **Blueprint converter: per-day time inputs named after trigger id** — When a time trigger has a sibling `id:` key (e.g. `id: mon_off`), the generated input is now named `mon_off_time` instead of the generic `trigger_time_N`. This makes weekly-schedule blueprints self-documenting and gives each day's off-time a meaningful label in the blueprint form.


## [2.4.3] - 2026-03-28

### Changed

- **Blueprint converter: `addon:` data key is now parameterised** — The automation-to-blueprint converter now extracts `addon:` values under action `data:` blocks (e.g. `hassio.addon_restart`, `hassio.addon_start`) into an `addon_id` input with a `text` selector, defaulting to the slug found in the automation. Previously the add-on ID was left hardcoded in the generated blueprint body.

- **Blueprint converter: per-day time inputs named after trigger id** — When a time trigger has a sibling `id:` key (e.g. `id: mon_off`), the generated input is now named `mon_off_time` instead of the generic `trigger_time_N`. This makes weekly-schedule blueprints self-documenting and gives each day's off-time a meaningful label in the blueprint form.

- **Updated autocomplete and snippets to use modern `action:` syntax** — All 48 autocomplete suggestions in the service/action list, the `snip:automation` and `snip:script` templates, and the validator error examples have been updated from the legacy `service:` key to the modern `action:` key introduced in Home Assistant 2024.8. The user guide hint text has also been updated accordingly.

- **Nested trigger groups: snippet added and validator false-positive fixed (HA 2024.10+)** — A new `snip:trigger_group` snippet inserts a ready-to-use `trigger: or` group with two sub-triggers. The YAML validator no longer raises a `legacy_trigger` warning for `- trigger: or`, `- trigger: and`, or `- trigger: not` lines — these are valid HA 2024.10+ nested trigger group syntax, not legacy `platform:` usage.

- **"Continue on error" snippet (HA 2026.3+)** — A new `snip:continue_on_error` snippet inserts an action step with `continue_on_error: true`, allowing automations to proceed past a failing step without halting.

- **Developer Tools improvements** — Three fixes across the panel:
  - **Actions tab**: YAML mode placeholder updated to show `action:` instead of `service:`, with a comment noting backward compatibility.
  - **Config tab**: Added missing **Input buttons** reload entry to the YAML reload grid.
  - **States tab**: Clicking an entity ID now copies it to the clipboard with a brief "Copied!" confirmation flash, without interfering with row expansion.

### Added

- **Minimap** — A VS Code-style minimap is now available in the editor. It renders a scaled-down, syntax-coloured overview of the entire file on the right side of the editor, with a semi-transparent viewport indicator showing your current scroll position. Click or drag anywhere on the minimap to jump to that part of the file. The minimap works in both the primary and secondary (split-view) editor panes. Toggle it on or off in **Settings → Editor → Minimap**.

- **Developer Tools panel** — A native floating Developer Tools panel (toolbar button + command palette) brings HA's developer tools experience inside Blueprint Studio without leaving the editor. Four tabs:
  - **Actions** — Search all registered HA actions by name or description. The dropdown is grouped by domain and filtered to the selected action's domain. Selecting an action builds a per-field form using the full metadata from each integration's `services.yaml` (loaded via `async_get_all_descriptions`): number fields with a defined range render as sliders synced to a number input, enum fields render as dropdowns (e.g. Flash: Long / Short), boolean fields render as true/false selects, and entity fields include a domain-filtered autocomplete datalist. A YAML mode toggle switches to a raw textarea for full manual control. Both modes call `call_service` on the backend.
  - **Template** — Jinja2 template renderer with live debounced output (600 ms). Results appear in a side-by-side pane; `Ctrl+Enter` forces an immediate render. Powered by `homeassistant.helpers.template.Template` on the backend.
  - **States** — Full entity state browser with domain filter and text search. Fetches real HA attributes (`with_attributes: true`); the Attributes column shows a short inline summary and clicking any row expands the full attribute table.
  - **Config** — HA configuration check (same validator as the removed toolbar button) plus one-click YAML reload buttons for 14 domains (automations, scripts, scenes, groups, all input helpers, timers, counters, schedules, template entities, and "Reload all YAML").
  - The panel is draggable by its header, dismissible via ✕ or Escape, and can be opened to a specific tab from the command palette ("Developer Tools: Actions / Template / States / Config").

- **Jump to Entity (Ctrl+click in editor)** — Ctrl+click (or Cmd+click on Mac) any entity ID in the YAML editor to instantly see a floating popup with the entity's current state, friendly name, domain, icon, and key attributes. A "Copy ID" button lets you copy the entity ID to the clipboard. The popup dismisses on outside click or Escape. No backend call needed — entity data is sourced from the already-loaded autocomplete registry.

## [2.4.2] - 2026-03-22

### Added

- **HA Service Autocomplete in Editor (3-A)** — The CodeMirror editor now offers live service name completions when typing on an `action:` or `service:` YAML key. All registered Home Assistant services are loaded at startup via a new `get_services` backend endpoint (backed by `hass.services.async_services()`). Results are cached for 30 seconds. When the cursor is on an `action:`/`service:` line, pressing `Ctrl+Space` or typing shows a dropdown of matching `domain.service` entries with their descriptions. Service lines are excluded from entity autocomplete to avoid mixed results.

- **Git Branch Management UI (3-B)** — A full branch manager is now available in both the Git and Gitea panels. Click the `account_tree` icon in either panel header (or the branch chip next to the panel title) to open it. From there you can: list all local branches with their remote tracking status, switch (checkout) any local branch, create a new branch from current HEAD, merge any branch into the current branch, and delete local branches (with unmerged-commit safety check and force-delete fallback). All branch operations are wired to new backend endpoints (`git_checkout_branch`, `git_create_branch`, `git_delete_local_branch`, `git_merge_branch`).

- **Conflict Resolution UI (3-C)** — When a merge or pull results in conflicts, both the Git and Gitea panels now show a "Merge Conflicts" section with per-file "Ours / Theirs" buttons instead of just a generic "Abort" button. Clicking "Ours" accepts the local version; "Theirs" accepts the incoming version. After resolving, stage and commit as normal. The "Abort & Reset Sync" button is still present to discard the merge entirely. Two new backend endpoints support this: `git_resolve_conflict` (wraps `git checkout --ours/--theirs` + `git add`) and `git_get_conflict_files` (wraps `git diff --name-only --diff-filter=U`). Conflict files are fetched from the backend during every status refresh and stored in `gitState.conflictFiles` / `giteaState.conflictFiles`, replacing a broken heuristic that intersected unstaged and modified file lists.

- **Admin-only gate for destructive actions** — Deleting files, force-pushing, hard-resetting, deleting remote branches, and restarting Home Assistant now require the requesting user to be a Home Assistant administrator. Non-admin users receive a 403 response instead of being able to perform these operations.

- **File-watch cache invalidation** — The file tree cache is now invalidated immediately when Home Assistant fires a `folder_watcher` event (requires the [folder_watcher integration](https://www.home-assistant.io/integrations/folder_watcher/)). Previously the cache could remain stale for up to 30 seconds after an external file change. The 30-second TTL fallback remains in place when the integration is not configured.

- **HA state response cache** — `get_entities`, `get_areas`, and `get_devices` now use a 5-second in-memory cache. Repeat calls within that window (e.g. opening multiple panels in quick succession) are served instantly without re-iterating the HA state machine. Filtered entity requests (AI autocomplete, entity pickers) always bypass the cache to return fresh results.

- **Deferred startup git check** — The git status check on integration load is now deferred via `hass.async_create_task`. All views are registered immediately and Blueprint Studio no longer adds to Home Assistant startup time.

- **Keyboard shortcuts: Terminal, Git panel, Format YAML (4-D)** — Three new keyboard shortcuts added: `Ctrl+`` toggles the terminal panel (maps to the existing `toggleTerminal` function), `Ctrl+Shift+G` collapses/expands the Git panel, and `Shift+Alt+F` formats/indents the current YAML file. All three are documented in the keyboard shortcuts overlay (F1). The `Ctrl+Shift+G` shortcut fires a new `git:toggle-panel` event handled by `GitCoordinator`.

- **Testing suite (4-E)** — Added `tests/test_ai_nlp.py` (80 tests) and `tests/test_ai_validators.py` (40 tests). The NLP tests cover all 7 extraction functions: `detect_domain`, `extract_area`, `extract_values` (12 domains), `detect_trigger_type` (13 trigger types), `extract_conditions` (11 condition types), `detect_additional_actions`, `extract_automation_name`, and `find_multi_domain_entities`. The validator tests cover `_detect_file_type`, `_detect_yaml_variant`, `_validate_entity_id`, `check_yaml`, `check_json`, `check_python`, and `check_blueprint`. All 120 tests pass on Python 3.14 without a Home Assistant install (HA and aiohttp are stubbed). Run with `python3 -m pytest tests/ -v`.

### Fixed

- **Git/Gitea panel collapse state not restored after refresh** — Collapsing the GitHub or Gitea changes panel and then refreshing the page caused the panel to reappear expanded. The root cause was a crash in `gitStatus`/`giteaStatus`: the new conflict detection code introduced in this version called `.toLowerCase()` on `gitState.status`/`giteaState.status` without guarding against non-string values returned by the API. The crash prevented `git:refresh` from being emitted, so `updateGitPanel`/`updateGiteaPanel` never ran and the saved `gitPanelCollapsed`/`giteaPanelCollapsed` state was never applied. Fixed by guarding both calls with `typeof ... === "string"` checks, consistent with the existing guards in `git-ui.js` and `gitea-ui.js`.

- **Collapsible file tree state not persisted across refresh** — In collapsible tree mode, collapsing a folder and refreshing the page caused it to reopen. `toggleFolder` updated `state.expandedFolders` but never called `saveSettings()`, so the change was lost on reload. Fixed by calling `saveSettings()` on both collapse and expand in `toggleFolder`.

- **File search and content search in explorer broken** — Filename search and content (text) search in the file explorer stopped working. Two separate bugs caused this: (1) `fetchWithAuth` spread array JSON responses into plain objects (`{ ...result, status }`) which destroyed the array structure needed by `list_files` and `global_search` — fixed by returning arrays directly without spreading; (2) The streaming content search sent the auth token via `window.pwaAuth?.getToken?.()`, which is only available in PWA standalone mode and always returns `""` in the Home Assistant iframe context — fixed by using `getAuthToken()` from `api.js`, which correctly handles both HA iframe and PWA authentication.

- **Global sidebar search showing only entities, no file results** — Searching in the sidebar global search panel returned entity matches but no file content matches. The root cause was the same `fetchWithAuth` array-spreading bug (#1 above) combined with a fallback path that silently returned an empty array when the POST-based search failed. Fixed by switching `performGlobalSearch` to use the same authenticated NDJSON stream endpoint (`search_stream`) as the explorer content search, which already worked correctly. A POST-based fallback is retained for environments where streaming is unavailable.

- **Global sidebar search: incremental streaming results** — File matches in the global search sidebar now appear incrementally as each file is scanned, matching the behaviour of the explorer content search. Results are patched into the DOM as they arrive (new file groups are appended, existing groups receive new matches) rather than waiting for the full scan to finish and re-rendering. Collapsed file groups stay collapsed during streaming and the list does not flicker.

- **Sidebar toggle broken after device rotation** — On iPad Pro 13 (and other tablets near the 1024px width boundary), rotating to portrait mode caused the sidebar toggle to stop working. The show/hide functions used `isMobile()` to decide which CSS class to apply (`visible` vs `hidden`), but `isMobile()` returns different values in portrait vs landscape. After rotating, the sidebar could end up with the wrong class for the active breakpoint, making the toggle appear to have no effect. The fix removes the `isMobile()` branch — both classes are now always applied consistently on every show/hide call, so orientation changes cannot leave the sidebar in a mixed state.

- **Large text file guard** — Opening a text file larger than 10 MB in the editor now returns a clear error message instead of attempting to load the full content. The frontend's existing warning dialog continues to handle the 2–10 MB range, allowing the user to open or download at their discretion. Binary files (images, video, PDF) are unaffected — they continue to be served via the binary path with no size restriction.

---



## [2.4.1] - 2026-03-21

### Fixed

- **Git panel: file selection not registering on checkbox click** — Clicking directly on a checkbox in the Git changes panel did not register the selection, causing a "No files selected" toast when attempting to stage. The click handler correctly skipped the checkbox element itself, but no `change` event listener existed to catch direct checkbox interactions. A `change` listener has been added to mirror the same pattern already working in the Gitea panel.

- **Git panel: push/pull sync buttons non-functional** — After committing, the green `arrow_upward` and orange `arrow_downward` indicator buttons in the panel actions bar did nothing when clicked. The buttons were created dynamically on each panel refresh without any event listener attached. Event delegation has been added to the git panel to handle clicks on `btn-git-push-sync` and `btn-git-pull-sync`. Additionally, the `git.js` code path was missing the `id` attributes on these buttons entirely, preventing the delegation from matching them.

- **Gitea panel: push/pull sync buttons non-functional** — The same issue affected the Gitea changes panel. The dynamically created `btn-gitea-push-sync` and `btn-gitea-pull-sync` buttons had no click handlers. Event delegation has been added to the Gitea panel to wire these buttons to `giteaPush` and `giteaPull` respectively.

- **Validator: automations with `use_blueprint:` incorrectly routed to blueprint checker** — Any automation file containing `use_blueprint:` triggered the blueprint validator instead of the standard YAML validator, because the file-type detector matched the substring `blueprint:` inside `use_blueprint:`. This caused a false "Blueprint must be a YAML mapping (dict)" error toast on valid automation files. The detection now uses a regex that only matches `blueprint:` as a standalone root-level key, not as part of `use_blueprint:`.

---

## [2.4.0] - 2026-03-20

### Blueprint Studio 2.4.0 — PWA Power, Blueprint Magic, SFTP & SSH Supercharged

### New Features

#### "Use Blueprint" Form — Instantiate Blueprints as Automations
- **Toolbar button**: `btn-use-blueprint` appears in the editor toolbar whenever the active file contains a `blueprint:` block
- **Command palette**: "Use Blueprint (Instantiate)" command added
- **Split-view panel**: The form opens in the secondary pane (side-by-side with the YAML editor) rather than a modal overlay — same pattern as Markdown Preview
- **Smart form controls** — selector type is mapped to an appropriate control:
  - `entity` / `target` → searchable dropdown with optional multi-select pill UI, filtered by domain
  - `device` / `area` → searchable dropdown populated from HA device/area registry
  - `boolean` → animated toggle switch
  - `number` → range slider synced with a numeric input box, respects `min`/`max`/`step`/`unit_of_measurement`
  - `select` (single) → `<select>` dropdown; `select` (multiple) → checkbox list
  - `time` / `date` → native time/date pickers
  - `duration` → H / M / S spinners
  - `template` / `action` / `condition` → resizable textarea with YAML/Jinja placeholder
  - `icon` → text input with `mdi:` placeholder
- **Section accordions**: Blueprint `input` groups render as collapsible `<details>` sections
- **Automation Name & Description fields** at the top of the form
- **Live YAML preview**: Generated automation YAML updates as the user fills in fields (600 ms debounce, API call to `instantiate_blueprint`)
- **Live editor→form sync**: While writing or editing a blueprint in the primary editor, the form re-parses and re-renders automatically after 1 second of idle time — filled values for unchanged inputs are preserved across re-renders
- **Save dialog**: choose to append to `automations.yaml` (auto-reloads HA automations) or write to a new file
- **Workspace persistence**: the form survives browser refresh — `blueprintFormActive` and `blueprintFormTabPath` are saved to settings and restored on load
- **Tab close behaviour**: clicking × on the secondary pane's tab closes the form and returns to single-pane view; the blueprint YAML file remains open and unmodified
- **Backend** (`api_misc.py`, `ai_generators.py`):
  - `parse_blueprint_inputs(content)` → structured JSON of sections, inputs, selectors, and defaults
  - `instantiate_blueprint(content, input_values, name, description)` → substitutes `!input` tags, returns ready-to-paste automation YAML with `alias` + `description` + UUID comment header
  - `get_devices` / `get_areas` — new GET actions using HA device/area registries (async-safe)

#### Blueprint Conversion — Smart Input Extraction ( Use ctrl+k/cmd+k and choose convert to blueprint) (`convert_automation_to_blueprint`)

- **Pass 1 (existing)**: Entity IDs → `entity` selector inputs with friendly `"The {domain} entity for this automation"` descriptions
- **Pass 2 — Numeric values**: Detects `above:`, `below:`, `temperature:`, `brightness:`, `brightness_pct:`, `position:`, `volume_level:`, `color_temp:`, `percentage:`, `humidity:` and extracts them as `number` selector inputs with appropriate `min`/`max`/`step`/`unit_of_measurement`. Values ≤ 1 without a decimal point (boolean-like) and template lines (`{{`) are skipped
- **Pass 3 — Delay/for durations**: Block-form (`delay:\n  seconds: 10`) and string-form (`delay: "00:05:00"`) delays and `for:` blocks are extracted as `number` (seconds) inputs with names `delay_seconds` / `duration_seconds`
- **Pass 4 — Time triggers**: `at: "19:00:00"` values are extracted as `time` selector inputs named `trigger_time` (incrementing suffix for multiples)
- **Pass 5 — Automation mode**: The `mode:` field (e.g. `single`, `queued`, `parallel`) is extracted as a `select` input named `automation_mode` with all four valid options
- **Pass 6 — Condition state values**: String values under `state:` keys in condition blocks are extracted as `text` inputs, skipping reserved values (`on`, `off`, `true`, `false`, `unknown`, `unavailable`)
- Collision-safe naming: duplicate keys get `_2`, `_3` suffixes
- `instantiate_blueprint()` now accepts and inserts a `description:` field into the generated automation
- Users can select a part of an automation file and then convert to blueprint

#### 🆕 SSH & PWA
*   **Full PWA Support**: Blueprint Studio is now a Progressive Web App (PWA). You can install it as a standalone, full-screen app on iOS and Android for a native, distraction-free experience.
*   **PWA Install Option**: Added PWA installation button in Settings > General tab to open Blueprint Studio in a new window where the PWA install prompt appears in the browser address bar - enables easy installation on all devices. (Requires HTTPS connection)
*   **SSH Key Authentication for Terminal Hosts**: Save SSH hosts with public key authentication (RSA, Ed25519, ECDSA, DSS key types) including optional passphrases for encrypted keys. Supports automatic one-click connection to saved hosts.
*   **SSH Password Authentication for Terminal Hosts**: Save SSH host passwords for direct one-click connection without manual password entry. Credentials securely stored in browser state.
*   **Edit SSH Host Manager**: Added "Edit" button to modify existing SSH host configurations including name, host, port, username, authentication method, and credentials.
*   **Delete SSH Host Manager**: Added "Delete" button to remove SSH hosts from the saved hosts list with automatic settings persistence.
*   **Persistent SSH Host Configuration**: SSH hosts and all authentication details are fully saved across browser refreshes and app restarts with secure local storage.
*   **Auto-Connect to SSH Hosts**: Terminal automatically attempts to connect to the last used SSH host on startup if credentials are available.
*   **SSH Key Format Validation**: Validates SSH keys are in proper PEM format (checks for "-----BEGIN" header) before saving.
*   **SSH Host Field Validation**: Validates that required fields (name, host) are provided when adding/editing hosts.
*   **Backward Compatible SSH Host Migration**: Automatically migrates old SSH hosts without SSH key fields to new schema with proper defaults.

#### 📝 Markdown & AI UI Enhancements
*   **Side-by-Side Markdown Preview**: Automatically enables vertical split view when toggling preview for `.md` files, showing the editor on the left and live-rendered HTML on the right.
*   **Throttled Live Updates**: Markdown preview now updates in real-time as you type, with a 300ms throttle for optimal performance.
*   **Syntax Highlighting in Preview**: Integrated `highlight.js` with `marked.js` to provide full syntax highlighting for code blocks within Markdown previews and AI responses.
*   **Unified AI Rendering**: The AI Copilot now uses the same modernized Markdown engine as the file preview, supporting bolding, tables, and task lists.
*   **Code Block Copy Buttons**: Added hover-to-show copy buttons to all code blocks in both Markdown previews and AI chat responses for a smoother "copy-paste" workflow.
*   **AI Chat Persistence**: Your AI chat history and sidebar visibility are now fully saved and restored across browser refreshes.

#### 📁 Advanced SFTP Improvements
*   **Full UI Parity**: The SFTP panel now matches the look and feel of the local file tree, including:
    *   **Modified Status Dots**: Instantly see which remote files have unsaved changes.
    *   **Selection Checkboxes**: Bulk delete and download support for remote files.
    *   **Active Highlights**: The currently open remote file is highlighted in the tree.
*   **Sidebar Integration**: Moved SFTP management to a dedicated full-height sidebar view for better organization and workflow consistency.
*   **Header Connection Manager**: Replaced the connection list with a compact dropdown integrated directly into the sidebar header, maximizing vertical space for the file tree.
*   **Contextual Header Actions**: Management buttons (Edit, Delete) now appear dynamically in the sidebar header only when a connection is active.
*   **New Context Actions**: Added "Copy Path", "Copy Virtual Path", "Pin to top" (Favorites), and "Run in Terminal" options to remote items.
*   **Remote ZIP Extraction**: Drag and drop a ZIP file onto an SFTP folder to extract it directly on the remote server.
*   **Recursive Deletion**: Implemented efficient bulk deletion for remote folders and files.
*   **Full Localization**: The SFTP panel, connection modals, and all tooltips now support all 10 project languages.

#### 🔍 Powerful Global Search
*   **Selective Search Modes**: New tabbed switcher to filter results between **All**, **Files Only**, or **Entities Only**.
*   **Interactive Replacement**: 
    *   **Single Match Replace**: Hover over a result to apply a replacement directly in the editor for review before saving.
    *   **File Level Replace**: Update all occurrences within a single file with one click.
*   **Result Dismissal**: Click "X" to hide specific matches or entire files from your search results to keep your workspace focused.
*   **UI Alignment**: Improved readability with fixed-width line numbers and better padding.

#### 🌍 Localization
*   **Enhanced Multi-Language Engine**: Re-engineered the translation system to work seamlessly with the new modular architecture. Supports dynamic runtime switching for 10 core languages.

#### 📁 Folder Upload & Extraction
*   **Automatic macOS Cleanup**: ZIP uploads now automatically ignore `__MACOSX` and `.DS_Store` metadata folders during extraction for a cleaner filesystem.
*   **Intelligent Refreshes**: Every file operation (save, delete, rename, unzip) now forces a full cache refresh, ensuring changes appear instantly even in Navigation (Lazy Loading) mode.
*   **File Existence Handling**: Fixed backend bugs related to directory creation and improved unzipping reliability for deep folder structures.

### Performance Improvements

#### Media Streaming & Large File Downloads
- **file_manager.py**: `serve_file()` now uses `web.FileResponse` for zero-copy serving with HTTP Range/206 support — required for `<video>` and `<audio>` seek
- **file_manager.py**: `download_folder()` / `download_multi()` stream ZIP archives via `web.StreamResponse` + `BytesIO` instead of buffering the entire archive in memory
- **api.py**: New `BlueprintStudioStreamView` at `/api/blueprint_studio/stream` — `requires_auth=False` with manual query-param token validation, dedicated to media streaming and folder downloads
- **sftp_manager.py**: `read_file_raw()` returns raw bytes; SFTP files are served via `StreamResponse` (no base64 overhead)
- **sftp.js**: `sftpStreamFile()` generates blob URLs for SFTP media playback
- **asset-preview.js**: Video/audio previews use streaming URLs (local files) or blob URLs (SFTP)

#### Multipart Upload — Bypass 16 MB Limit
- **api.py**: New `BlueprintStudioUploadView` at `/api/blueprint_studio/upload`
  - `requires_auth=True`; overrides HA's global 16 MB `client_max_size` via `request._client_max_size = 0`
  - Reads multipart form data in chunks — no base64, no memory spike
  - Handles both local (`_upload_local`) and SFTP (`_upload_sftp`) targets via a `connection` field
- **sftp_manager.py**: `create_file_raw()` writes raw bytes directly to SFTP (no base64 decode step)
- **downloads-uploads.js**: All binary uploads (local + SFTP) now route through `uploadFileMultipart()` / `uploadFileMultipartSftp()`; text files continue using the JSON POST path
### 🐛 Bug Fixes

#### Editor Indentation
*   **Format Code respects indentation setting**: Prettier's Format Code action now uses your configured tab size and indent-with-tabs preference instead of always formatting to 2 spaces.
*   **Settings panel stays in sync on file switch**: When opening a file with different indentation, the detected indent is now reflected in the Settings panel dropdown, not just the status bar.
*   **Status bar shows correct indent when no file is open**: The status bar placeholder now reflects your saved indentation setting (e.g. "Spaces: 4") instead of always showing "Spaces: 2".
*   **Added "Indent with Tabs" toggle to Settings panel**: The setting previously only accessible via the status bar picker is now also available in Settings → Editor, alongside the Tab Size dropdown.

#### SFTP Stale Expanded-Folder Paths Persisting Across Reloads
- **sftp.js**: `_refreshCurrentDir()` now emits `settings:save` after pruning stale expanded-folder entries, preventing them from being restored on next load
- **sftp_manager.py**: `list_directory()` catches `FileNotFoundError` and logs at DEBUG rather than ERROR

### Security Fixes

#### Fixed Command Injection in SSH Spawn
- **terminal_manager.py**: Escaped SSH command arguments using `shlex.quote()` to prevent shell metacharacter injection
  - Prevents attacks like `username=foo; rm -rf /` from executing arbitrary commands
  - Applied to host, username, and other user-controlled SSH parameters

#### Fixed `requires_auth = False` on Main API
- **api.py**: Changed `BlueprintStudioApiView` to `requires_auth = True`
  - Replaced custom authentication bypass with HA's native auth middleware
  - Leverages HA's built-in rate limiting and CSRF protection
  - Removes reliance on fragile custom Bearer token validation

#### Fixed Credentials Written to Disk in Plaintext
- **terminal_manager.py**:
  - Removed persistent plaintext SSH private key storage
  - Fixed Paramiko wrapper script that embedded credentials in source code
  - Implemented secure credential lifecycle (generated on-demand, cleaned up after use)
  - Private keys no longer left indefinitely on disk


#### SFTP Connection Pooling
- **sftp_manager.py**: Implemented connection pool with TTL-based cache
  - Keyed by `(host, port, username)` tuple
  - Connections reused for 60 seconds, then cleaned up
  - Eliminates redundant TCP+SSH handshakes per operation
  - Significant latency reduction for directory browsing and bulk operations

#### Remove Fake Filesystem Watcher
- **websocket.py**: Removed `async_watch_filesystem()` loop that fired redundant "poll" heartbeat every 10 seconds
  - The heartbeat was 100% redundant: real mutations already fire from `_fire_update()` in file_manager.py, and the frontend polls mtime independently every 10s
  - Removed `_async_start_watcher()`, `async_stop_watcher()`, and `async_start_watcher_callback()` functions
  - Removed unused imports: `asyncio`, `time`
- **\_\_init\_\_.py**:
  - Removed `async_stop_watcher` import and call in `async_unload_entry()`
- **settings-sync.js**:
  - Removed dead `startPollingForSettingsChanges()` function
  - Removed unused `POLLING_INTERVAL_MS` constant

#### WebSocket Reconnection for Long-Lived Sessions
- **api.js**: Enhanced `initWebSocketSubscription()` to handle HA WebSocket reconnections
  - Problem: Users idle 24+ hours would lose real-time updates when HA WebSocket dropped and reconnected
  - Solution: Extracted subscribe logic into `_subscribeToUpdates(conn, retries)` helper with module-level `_wsConn` guard
  - Registered `conn.addEventListener("ready", ...)` to auto-resubscribe on reconnect
  - Users can now continue editing seamlessly across network interruptions and extended idle periods

### Code Quality & Refactoring

#### Split Monolithic API View
- Extracted 822-line monolith into 5 domain-specific handler modules
  - **api_files.py**: File operations (list, read, write, upload, search, etc.)
  - **api_git.py**: Git/Gitea/GitHub handlers (45 functions)
  - **api_terminal.py**: Terminal WebSocket view + exec handlers
  - **api_sftp.py**: SFTP dispatcher with SFTP_ACTIONS frozenset
  - **api_misc.py**: Settings, AI, syntax checkers, utilities
  - **api.py**: Thin orchestrator (~190 lines) — class + dispatch tables only

#### Deduplicate Extensions, Allow Any Upload, Add Missing Editor Types
- **const.py**: Renamed `ALLOWED_EXTENSIONS` → `LISTED_EXTENSIONS` (controls visibility only, not access)
  - Added 25+ missing types: `.ts`, `.tsx`, `.jsx`, `.xml`, `.toml`, `.env`, `.sql`, `.go`, `.rs`, `.c`, `.java`, `.php`, `.lua`, and more
- **file_manager.py**: Removed allowlist gating from read/write/upload/search/replace operations
- **sftp_manager.py**: Deleted duplicate extension sets, imports from `const.py`
- **www/modules/**: Added editor modes, language names, icons for all new types

#### Split ai_manager.py into Domain Modules
- Split 2,320-line monolith into 5 focused modules
  - **ai_constants.py**: Lookup tables — domains, actions, error patterns
  - **ai_validators.py**: Syntax checkers — YAML, JSON, Python, JS, Jinja
  - **ai_nlp.py**: NLP extraction — domain detection, entity matching, triggers
  - **ai_generators.py**: YAML generation — automations, scripts, scenes
  - **ai_manager.py**: Thin orchestrator — AIManager class with query routing


## [2.3.0] - 2026-02-23

### ✨ Terminal Integration, Themes & Workspace Persistence

#### 🆕 New Features
*   **Interactive Terminal (xterm.js + PTY)**: A fully functional, stateful terminal environment for Home Assistant.
    *   **True Shell Access**: Runs a persistent `/bin/sh` or `bash` session with full environment support.
    *   **SSH Capable**: Supports interactive `ssh` sessions with password prompts and key management.
    *   **Secure & Restricted**: Backend commands are allow-listed (`ha`, `git`, `python3`, `ssh`, `pip`, etc.) to prevent accidental damage.
    *   **Admin-Only Access**: Terminal commands are strict-checked and limited to administrator users.
    *   **Audit Logging**: Every command execution is logged to the Home Assistant core logger for accountability.
    *   **Movable Panel**: Toggle as a VS Code-style bottom panel (`Ctrl+Shift+T`) or dock it as a main editor tab.
    *   **Resizable Interface**: Draggable top border to resize the terminal panel height.
    *   **Keyboard Shortcuts**: `Ctrl+Shift+T` to toggle, `Ctrl+L` or `Ctrl+K` to clear screen.
    *   **Quick Connect**: Save and manage SSH hosts for one-click connection directly from the terminal header.
*   **Contextual Shell Actions**: Right-click any file or folder to "Run in Terminal" (e.g., execute Python scripts, cat files).
*   **Mobile & Tablet Experience**:
    *   **Touch Gestures**: Swipe right from edge to open sidebar, swipe left to close.
    *   **Touch Optimization**: Larger touch targets for files and tabs.
*   **Theme System Overhaul**:
    *   **Auto (Match HA)**: New theme mode that instantly synchronizes with your Home Assistant theme (colors and light/dark mode) in real-time.
    *   **Glass Theme**: A premium "Glassmorphism" preset featuring translucent panels, 3D depth, and iOS-style blur effects.
    *   **Midnight Blue**: Added the deep, high-contrast Midnight Blue theme option.
*   **Persistent SFTP Workspace**: SFTP session state is now fully saved across browser refreshes.
    *   **Active Connection**: Automatically reconnects to the last used SFTP server.
    *   **Folder Navigation**: Remembers exactly which folder you were browsing.
    *   **Open Files**: Remote files in tabs are restored with content and scroll position.
    *   **SFTP Enhancements**: Added support for "Duplicate" and "Move" operations in the SFTP file tree, mirroring local file tree capabilities. Replaced standard browser prompts with professional UI modals for a consistent user experience. Added support for viewing hidden files and folders in SFTP, synced with the main "Show Hidden Files" toggle. Implemented full support for viewing remote binary files (images, PDFs, videos) via SFTP.
*   **Split View Enhancements**:
    *   **Terminal Docking**: Terminal tabs now work seamlessly within split-view panes.
    *   **Auto-Resize**: Terminal automatically reflows when split panes are resized.
    *   **Cross-Pane Dragging**: Drag terminal tabs between left/right panes without losing session state.

#### 🐛 Bug Fixes
*   **Critical Data Safety**: Fixed a race condition in Split View where clicking between tabs in different panes could overwrite file content.
*   **Ghosting Fix**: Fixed "modified file" ghosting when moving terminal tabs between split panes.
*   **SFTP Folder Deletion**: Implemented recursive deletion for SFTP, allowing folders with contents to be deleted correctly.


## [2.2.2] - 2026-02-20

### ✨ Feature & Fix Update

#### 🆕 New Features
*   **Collapse All Folders**: Added a "Collapse All" button (`unfold_less` icon) to the toolbar. Clears all expanded folder states and re-renders the file tree for a clean view.
*   **One Tab Mode**: Added an optional mode to keep only the last opened file active.
    *   Automatically saves and closes the previous tab when opening a new one.
    *   Toggle via the new toolbar button (`tab` icon) or **Settings → Editor → Behavior**.
    *   State is persisted across sessions.
*   **Toolbar Enhancements**: "Show Hidden Files" and "Select Files" buttons have been moved from the sidebar header to the main toolbar for better accessibility.
*   **Scrollbar Visibility**: Significantly increased the visibility of scrollbars in modals, shortcuts, and settings by darkening the default thumb color.
*   **CSV Support**: Added full support for creating, editing, and viewing `.csv` files with syntax highlighting and spreadsheet-inspired icons.

#### 🌍 Internationalisation
*   **Global Language Support**: Added translation files for 31 new languages, including Chinese (Simplified), Spanish, Hindi, Arabic, French, Portuguese, Russian, German, Japanese, and many European languages.

#### 🐛 Bug Fixes
*   **Favorites Panel**: Fixed an issue where the Favorites panel header was destroyed during rendering.
*   **Folder Pinning**: Validates both files and folders now, preventing favorited folders from disappearing from the list.

#### 🧹 UI Cleanup
*   **Explorer Header**: Removed the redundant "EXPLORER" sidebar header to maximize vertical space.
*   **Accent Color**: Removed the redundant dropdown selector in Appearance settings, keeping the cleaner color circle buttons.

## [2.2.1] - 2026-02-20

### ✨ Editor & UI Enhancement Suite

#### 🆕 New Features
*   **Collapsible File Tree**: A traditional tree view for navigating files with single-click expand/collapse. Can be toggled via Settings → File Tree. When active, breadcrumbs and back buttons are automatically hidden for a cleaner workspace.
*   **Improved Search (Ctrl+F)**: The cursor now correctly jumps to the search bar when opening search in the code editor. Three new search filters have been added:
    *   **Match Case (Aa)**: Case-sensitive lookups
    *   **Whole Word (ab|)**: Excludes partial matches
    *   **Regex (.*)**: Full regular expression support with real-time syntax validation
*   **Syntax Themes**: Five predefined themes available: Dracula, Nord, Monokai, Solarized, and One Dark.
*   **New UI Preset**: Midnight Blue added to appearance settings.
*   **New Font Options**: Additional font choices available in editor settings.

#### ⚡ Improvements
*   **Large File Protection**: A confirmation dialog is now shown before downloading potentially large files (.db, .sqlite, .zip) to prevent accidental transfers.

---
A big thank you to @cataseven for putting together this extensive UI enhancement PR — 13 files changed, all manually tested. The effort and attention to detail are greatly appreciated!

## [2.2.0] - 2026-02-12

### ✨ New Features

#### 📁 Folder Navigation (File Explorer Redesign)
*   **Browse-Style Navigation**: Completely redesigned file explorer from a tree expansion model to folder navigation (like Windows Explorer or mobile file browsers):
    *   **Double-Click to Enter**: Double-click any folder to navigate into it - shows only that folder's contents
    *   **Back Button**: Navigate up one level with the back button (disabled at root)
    *   **Breadcrumb Trail**: Full path shown as clickable breadcrumbs - jump to any level instantly
    *   **Flat View**: Clean, simple list of folders and files without nested indentation
    *   **No Chevrons**: Removed expand/collapse arrows - navigation is by entering folders, not expanding them
    *   **Removed Expand All Button**: No longer needed with folder navigation model
*   **Lazy Loading**: Directory contents loaded on-demand as you navigate - faster initial load, no massive tree rendering
*   **Performance**: Only loads the current folder - instant navigation, less memory usage
*   **Mobile-Friendly**: Large touch targets, familiar mobile UX, no tiny chevron icons

#### 🔍 Enhanced File Tree Search
*   **Recursive Search**: File search now finds files across ALL folders, not just the current folder:
    *   **Filename Search** (default): Searches all filenames recursively across the entire filesystem
    *   **Content Search** (toggle): Searches file contents across all files
    *   **Flat Results**: Matching files displayed as a flat list regardless of which folder they're in - click any result to open
    *   **Auto-Recursive**: Both search modes use backend API to search all files, not just visible ones

#### 🌐 SFTP Integration
*   **Remote File Access**: Connect to HAOS host or any SSH/SFTP server to edit files outside `/config`:
    *   **Dual Authentication**: Password and SSH key (RSA, Ed25519, ECDSA, DSS) support with optional passphrase
    *   **Named Connections**: Save multiple SFTP profiles (e.g., "HAOS Host", "NAS", "Remote Server")
    *   **Host Access**: Browse and edit `/addons`, `/ssl`, and any path on the HAOS host filesystem
    *   **Browse & Navigate**: Directory tree with breadcrumb navigation, back button, and folder drill-down
    *   **Full File I/O**: Open, edit, save, create, delete, and rename remote files
    *   **Virtual Paths**: Remote files open in regular tabs with `sftp://` prefix for seamless integration
    *   **Connection Test**: "Test & Save" validates connectivity before saving credentials
    *   **Context Menus**: Right-click files/folders for Rename and Delete operations
    *   **Sidebar Panel**: Dedicated SFTP section in Explorer below git panels
    *   **Session Persistence**: Connections saved in HA settings with secure credential storage
*   **Security Features**:
    *   Auto-accepts host keys on first connect (logs warning about AutoAddPolicy)
    *   Credentials stored in HA settings store (same security level as git tokens/AI keys)
    *   No credentials logged
    *   Text file filtering (binary files shown but disabled)
*   **Use Cases**: Access HAOS add-on configs, edit system files, manage backups, sync configurations

*   **Performance Control Panel**: New "Advanced" tab in Settings with fine-grained performance controls:
    *   **Polling Interval**: Adjustable git status polling (10-60 seconds) - default reduced from 5s to 10s for 50% fewer network requests
    *   **Remote Fetch Interval**: Configurable remote fetch timing (15-300 seconds) - default 30s
    *   **File Cache Size**: Adjustable in-memory file cache (5-20 files)
    *   **Virtual Scrolling**: Toggle for large file trees
*   **Real-time Sliders**: All performance settings update live with visual feedback
*   **Smart Defaults**: Balanced configuration optimized for most Home Assistant installations

#### 🔍 Global Search & Replace
*   **Project-Wide Search**: New sidebar-based global search across all files:
    *   **Keyboard Shortcut**: `Cmd/Ctrl + Shift + F` to open search sidebar
    *   **Search Options**: Case-sensitive matching, whole word matching, and regular expression support
    *   **File Filtering**: Include/exclude file patterns (e.g., `*.yaml`, `!secrets.yaml`)
    *   **Smart Results**: Results grouped by file with collapsible sections
    *   **Context Preview**: Shows line numbers and code context for each match
    *   **Quick Navigation**: Click any result to jump directly to that line in the file
    *   **Match Highlighting**: Temporarily highlights matched line when opening file
*   **Global Replace**: Batch replace across multiple files with safety features:
    *   **Preview**: See affected files and match counts before replacing
    *   **Confirmation Dialog**: Shows total occurrences and file count before proceeding
    *   **Regex Support**: Use regex capture groups ($1, $2) in replacements
    *   **Auto-Refresh**: Results update automatically after replace
*   **Home Assistant Integration**: Built-in entity search in results:
    *   Search matches Home Assistant entity IDs and friendly names
    *   Click to copy entity ID to clipboard
    *   Displays alongside file search results
*   **Visual Features**:
    *   Match count badges on each file
    *   Collapsible file groups with toggle arrows
    *   Loading spinner during search
    *   Empty state guidance

#### ✏️ Tab Size (Indentation) Control
*   **Customizable Indentation**: New tab size setting in Editor configuration:
    *   **Size Options**: Choose between 2, 4, or 8 spaces per indentation level
    *   **Indent With Tabs**: Toggle to use hard tabs instead of spaces
    *   **Smart Auto-Detection**: Automatically detects indentation from existing file content
    *   **User Preference Fallback**: Uses your configured tab size for new/empty files when auto-detection isn't possible
    *   **Live Updates**: Changes apply immediately to both editors (primary and secondary panes)
*   **Intelligent Behavior**: Balances smart auto-detection with user control - respects file conventions while maintaining your preferences
*   **Quick Status Bar Picker**: Click "Spaces: X" in status bar to instantly change tab size without opening Settings
    *   Visual dropdown menu with 2, 4, 8 space options
    *   Toggle "Indent with Tabs" on/off
    *   Checkmarks show current selection
    *   Changes apply immediately and save automatically
*   **Settings Location**: Editor → Tab Size & Indentation

#### 📱 Split View (Experimental) 🧪
*   **VS Code-Style Split Editor**: Edit multiple files side-by-side in a dual-pane layout:
    *   **Vertical Split**: Side-by-side layout for comparing and editing files simultaneously
    *   **Independent Editors**: Full CodeMirror features in both panes (syntax highlighting, search, replace, folding)
    *   **Pane Badges**: Each tab shows its pane location (L/R) for clear visual identification
    *   **Drag-and-Drop**: Move tabs between panes by dragging or via context menu
    *   **Smart Auto-Balance**: Automatically distribute tabs when moving to prevent empty panes
    *   **Same File Support**: Open the same file in both panes for comparing different sections
    *   **Resizable Panes**: Drag resize handle to adjust pane sizes (20-80% range)
    *   **Workspace Persistence**: Split view state, pane sizes, and tab distribution saved across sessions
*   **Experimental Feature Toggle**: Enable/disable split view from Settings → Advanced → Experimental Features
*   **Asset Preview Support**: Image, PDF, and markdown previews work in both panes
*   **Keyboard Shortcuts**:
    *   `Cmd/Ctrl + \` - Toggle split view on/off
    *   `Cmd/Ctrl + 1` - Focus primary pane (left)
    *   `Cmd/Ctrl + 2` - Focus secondary pane (right)
*   **Smart Button Management**: Split view buttons only appear when feature is enabled and 2+ tabs are open

#### 🧠 AI Architecture Overhaul
*   **Unified AI System**: Complete restructuring of AI integration with three distinct modes:
    *   **Rule-based**: Built-in pattern matching for automation generation (no API required)
    *   **Local AI**: Self-hosted LLM support via Ollama, LM Studio, or custom endpoints
    *   **Cloud AI**: Gemini, OpenAI, and Claude with persistent API keys per provider
*   **Persistent API Keys**: API keys now saved separately for each cloud provider - switch between Gemini, OpenAI, and Claude without re-entering credentials
*   **Smart Migration**: Automatic migration from old AI structure to new architecture
*   **Provider Isolation**: Each AI provider maintains independent configuration and state

### ⚡ Performance Improvements

#### 🚀 Parallel Initialization
*   **Concurrent Loading**: Multiple initialization tasks now run in parallel using Promise.all():
    *   Version fetch, WebSocket initialization, entity loading, and file listing run simultaneously
    *   ~30-40% faster initial load time
*   **Optimized Startup**: Reduced sequential bottlenecks during application bootstrap
*   **Smarter Polling**: Git status and tab restoration now execute concurrently

#### 📊 Reduced Server Load
*   **50% Fewer Requests**: Default polling interval increased from 5s to 10s
*   **Configurable Intervals**: Users can tune polling frequency for their environment
*   **Smart Fetch Timing**: Remote repository checks happen every 3rd poll (30s) by default
*   **Resource-Aware**: All settings persist across sessions

### 🏗️ Architecture & Code Quality

#### 📦 Modular Refactoring 
*   **84% Size Reduction**: app.js reduced from 12,461 lines to 2,032 lines
*   **46 Focused Modules**: Extracted functionality into maintainable, single-responsibility modules:
    *   `settings.js` (316 lines) - Settings management
    *   `settings-ui.js` (1,484 lines) - Settings modal UI
    *   `polling.js` (111 lines) - Optimized polling system
    *   `initialization.js` (671 lines) - Parallel initialization
    *   `split-view.js` (450+ lines) - Split view functionality
    *   `tabs.js` - Dual-pane tab rendering
    *   Plus 30 other specialized modules
*   **Callback Pattern**: Consistent cross-module communication preventing circular dependencies
*   **Better Testability**: Each module independently testable

#### 🔧 Settings System Enhancement
*   **Server-Side Sync**: Settings now stored on server with local fallback
*   **Automatic Migration**: Seamless transition from localStorage to server storage
*   **Type Safety**: Integer parsing for numeric settings preventing edge cases
*   **Performance Settings**: New category for polling, caching, and rendering options
*   **Settings UI Reorganization**: Complete 5-tab restructure for better user experience (General, Appearance, Editor, Integrations, Advanced)
*   **New Workspace Controls**: Added Remember Workspace and Show Hidden Files toggles

### 🛡️ Fixes & Stability
*   **Critical: File Size Protection**: Added 500MB hard limit to prevent out-of-memory crashes when opening large files
    *   Applies to ALL file types (text, binary, images, databases, etc.)
    *   Prevents server crashes when clicking on large database files like `home-assistant_v2.db`
    *   Shows user-friendly error message instead of attempting to load oversized files
    *   Configurable via `MAX_FILE_SIZE` constant (default: 500MB)
    *   Enhanced 2MB warning for text files using centralized `TEXT_FILE_WARNING_SIZE` constant
    *   8-second error toast with clear size limits and reasoning
*   **File Cache Corruption Fix (DEFINITIVE SOLUTION)**: Comprehensive 4-layer protection against HTTP 500 backend crashes:
    *   **🔒 LAYER 0 - Thread Safety (DEFINITIVE FIX)**: Added `threading.Lock` to prevent concurrent access corruption
        *   Root cause identified: Multiple concurrent requests via `async_add_executor_job` caused race conditions in Python 3.13
        *   All cache operations (read, write, clear) now protected by mutex lock
        *   Prevents cache from becoming `None` during concurrent access
        *   API methods (`git_pull`, `git_init`, `git_hard_reset`) now use thread-safe `clear_cache()` instead of direct `_file_cache = {}` assignment
        *   **This is the DEFINITIVE FIX** - eliminates the root cause rather than just handling symptoms
    *   **Layer 1 - Ultra-Defensive Initialization**: Detects and auto-recovers from cache becoming `None` due to race conditions or Python 3.13 GC issues
    *   **Layer 2 - os.walk() Validation**: Handles corrupted filesystem walker results (when `dirs` or `files` unexpectedly become `None`)
    *   **Layer 3 - Global Exception Handling**: Catches all filesystem errors (permissions, I/O errors, corruption) and returns cached/empty data instead of crashing
    *   **Production-Grade Diagnostics**: Detailed error logging showing exact failure type and location for troubleshooting
    *   **Graceful Degradation**: System continues operating with stale cache or empty results rather than requiring HA restart
    *   **Root Cause Analysis**: Fixed "argument of type 'NoneType' is not iterable" and "'NoneType' object does not support item assignment" errors identified from production logs
    *   **Python 3.13 Compatibility**: Addresses stricter event loop and GC behavior in Home Assistant Core 2026.2 (Python 3.13)
    *   **Impact**: Backend never crashes from file cache corruption - thread-safe operations prevent race conditions, automatic recovery handles edge cases
*   **Cache State Validation**: Implemented automatic cache reinitialization when corruption is detected, with logging to track occurrences
*   **Settings Persistence**: All new performance settings properly saved and loaded
*   **Migration Safety**: Automatic backup and restoration of AI settings during structure change
*   **Type Coercion**: Fixed parseInt issues for numeric settings preventing NaN errors
*   **Font Family Loading**: Added Google Fonts CDN import to ensure all editor font options (Fira Code, JetBrains Mono, Source Code Pro, Roboto Mono, Ubuntu Mono) are available on all systems without requiring manual font installation

### 🎨 UI/UX Improvements
*   **Settings Menu Reorganization**: Complete restructure of settings for better usability and logical grouping:
    *   **New Tab Structure**: "Features" renamed to "Integrations" for clarity
    *   **General Tab**: Now focused on workspace behavior (Remember Workspace, Recent Files, Show Hidden, UI Feedback)
    *   **Appearance Tab**: Streamlined to focus on visual customization (Theme, File Tree) - removed clutter
    *   **Editor Tab**: Added Syntax Highlighting section (moved from Appearance) for better organization
    *   **Integrations Tab**: Dedicated tab for external services (Version Control + AI Copilot) - all Git settings moved here
    *   **Advanced Tab**: Now includes Experimental Features and Danger Zone (moved from Features)
    *   **New Settings**: Added Remember Workspace toggle and Show Hidden Files toggle to General
    *   **Logical Grouping**: Each tab has a clear, focused purpose - easier to find settings
    *   **Same Visual Style**: Maintained consistent design language throughout
*   **Advanced Settings Tab**: Clean, organized interface for power users
*   **Range Sliders**: Visual feedback with real-time value updates
*   **Toast Notifications**: Immediate feedback for all settings changes
*   **Help Text**: Descriptive tooltips explaining each performance setting
*   **Welcome Screen Fix**: Now properly displays on startup when no tabs are open, and after closing all tabs

### 🔄 Migration Notes
*   **Automatic**: All migrations happen transparently on first load of v2.2.0
*   **AI Settings**: Old `aiProvider` automatically migrated to new `aiType` + `cloudProvider` structure
*   **API Keys**: Preserved and properly assigned to respective providers
*   **Performance**: New settings applied with safe defaults
*   **Zero Downtime**: No user action required



---


## [2.1.5] - 2026-02-09

### 🛡️ Fixes
*   **Home Assistant Compatibility**: Resolved `ImportError` for `StaticPathConfig` on Home Assistant versions older than 2024.7 (e.g., 2024.4.1).
*   **Dynamic Resource Registration**: Implemented a robust fallback system that detects and uses the appropriate static path registration method (`async_register_static_paths` or `register_static_path`) at runtime.
*   **Version Shim**: Added a `StaticPathConfig` compatibility shim to ensure stable performance across Home Assistant versions 2024.1 through 2026+.
*   **Asset Preview**: Removed the 2MB size restriction/warning for images and PDFs, allowing them to open instantly as binary assets.


## [2.1.4] - 2026-02-08

### ✨ New Features
*   **Smart Duplicate**: Added "Duplicate" action to file explorer context menu.
*   **Tab Management**: Added context menu for tabs with "Close Others" and "Close Saved".
*   **Folding Shortcuts**: Added `Ctrl+Alt+[` and `Ctrl+Alt+]` to Fold/Unfold All.
*   **VS Code-like Status Bar**: Real-time Ln/Col tracking, indentation info, and file encoding display.

### 🛡️ Fixes
*   **Large File Safety**: Added protection against opening files larger than 2MB to prevent browser crashes.

## [2.1.3] - 2026-02-06

### ✨ AI Models Update
*   **AI Model Refresh**: Updated Copilot to support latest 2026 models: **Gemini 3 Pro/Flash**, **GPT-5**, **GPT-5.2**, and more.

## [2.1.2] - 2026-02-06

### ✨ New Features
*   **Image Navigation**: Added Previous/Next buttons and keyboard shortcuts (Arrow Keys) to browse all images in a folder without closing the viewer.
*   **Integrated PDF Viewer**: View PDF files directly within the integration using a new high-performance PDF.js rendering engine.
*   **Markdown Preview**: Added a live preview toggle for `.md` files, rendering them as styled HTML.
*   **Bulk Operations**: Added support for multi-selecting files to **Delete**, **Download (as ZIP)**, and **Move** them in batches. Also supports **Batch Upload** via multi-select dialog or drag-and-drop.
*   **Quick Delete**: Streamlined the deletion process by replacing the filename typing requirement with a standard confirmation dialog.

### ⚡ Improvements
*   **Secure Binary Serving**: Added a dedicated `serve_file` API endpoint for efficient and secure binary file transfers.
*   **Auth Reliability**: Improved token handling for direct file downloads to prevent authentication timeouts.

### 🐛 Bug Fixes
*   **Git Notification Spam**: Eliminated repetitive "changes detected" toast notifications during background polling.
*   **Thread Safety**: Fixed `hass.async_create_task` being called from non-thread-safe contexts in `websocket.py`.
*   **Blocking I/O**: Moved synchronous file reads in `api.py` to executor jobs to prevent event loop blocking.
*   **Lifecycle Management**: Implemented proper background task cleanup during integration unloading.

## [2.1.1] - 2026-02-05

### ✨ New Features
*   **Context Menu Creation**: You can now **right-click** any folder or file in the explorer to quickly add a **New File** or **New Folder** in that directory.
*   **Productivity Shortcuts**: Added VS Code-style line operations:
    *   `Alt + Up/Down`: Move selected lines up/down.
    *   `Shift + Alt + Up/Down`: Duplicate selected lines.
    *   Includes Mac support using `Option` and `Cmd + Shift + Up/Down` overrides.
*   **Nested Folder Creation**: Create deep directory structures instantly (e.g., `folder/sub/deep`) without creating each level manually.
*   **Context Menu Actions**: Added **New File** and **New Folder** options to the file explorer right-click menu.
*   **Smart Path Pre-filling**: "New File/Folder" dialogs now pre-fill with the currently selected folder path, allowing for quick modifications.

## [2.1.0] - 2026-02-05

### ✨ New Features
*   **WebSocket Engine**: Real-time reactive updates for files and Git status. Blueprint Studio now pushes updates from the server, eliminating aggressive HTTP polling and drastically reducing network/CPU overhead.
*   **Instant Explorer (Backend Caching)**: Implemented server-side file tree caching. The file explorer now loads and filters instantly even in massive configurations, with intelligent cache invalidation and a manual "Hard Refresh" option.
*   **Modular Architecture**: Transitioned the massive monolithic JavaScript core into a modern ES Module system for better maintainability and performance.
*   **Gitea Integration**: Added full support for self-hosted Gitea instances with a dedicated workflow and dual-remote support.
*   **Real-time External Sync**: Automatically detects and reloads files modified outside of the editor while preserving cursor position.
*   **Claude AI Support**: Full integration for Anthropic Claude 4.5 suite (Sonnet, Haiku, and Opus).
*   **Help & Support Hub**: A professional, centralized modal for shortcuts, bug reports, and feature requests.
*   **One-Click Socials**: Star the repo and follow the author directly from the Support modal.
*   **1ocal Hosting**: Material Icons and fonts are now hosted locally, enabling true offline support and faster loading.
*   **Configurable Notifications**: Added a toggle to enable or disable toast notifications.
*   **Resource-Smart Polling**: Background checks now pause when the browser tab is not focused.

### 🐛 Bug Fixes
*   **Command Palette Restoration**: Fixed scope and shortcut issues ensuring palette works reliably across the entire UI.
*   **Setup Timeout Fix**: Resolved an issue where background tasks could block Home Assistant bootstrap.
*   **UI Ghosting**: Optimized loading sequence to prevent visual flickering.

### 🎨 Visual Refinements
*   **Editor Gutter Contrast**: Enhanced visual separation between the gutter and code area.
*   **Toast Repositioning**: Moved notifications to the bottom right to avoid obstructing the view.

## [2.0.6] - 2026-02-05

### 🐛 Bug Fixes
*   Folders in custom_components couldn't be deleted.

## [2.0.5] - 2026-02-02

### ✨ New Features
*   **Persistent Workspace**: The editor now remembers your exact workspace layout across restarts, including the specific order of your open tabs, which tab was actively being edited, and the exact cursor/scroll positions for every file. This can be toggled in **Settings > General**.

### 🐛 Bug Fixes
*   **Keyboard Shortcuts**: Removed the `?` global shortcut for the help overlay, as it was interfering with typing question marks in some contexts.

## [2.0.4] - 2026-02-01

### 🐛 Bug Fixes
*   **Multi-Cursor Selection**: Fixed a bug where **Cmd+D** (select next occurrence) failed to work when text was selected from right to left (backward selection).
*   **Git Panel Persistence**: The Git changes panel now remembers its collapsed/expanded state across restarts and page reloads.
*   **Git Panel Collapse**: Fixed an issue where clicking the collapse button would hide the entire Git changes panel, preventing users from re-expanding it. The panel now correctly collapses to show only its header, with a toggleable icon.

## [2.0.3] - 2026-01-31

### ✨ Improvements
*   **Robust OAuth Polling**: Re-engineered the GitHub Device Flow authentication to dynamically adjust polling speed in response to server rate limits ("slow_down" signals), preventing API timeouts and ensuring a reliable login experience.
*   **Smart "Check Now"**: The manual auth check button now coordinates with the background polling loop to prevent race conditions and accidental rate limiting.
*   **Multi-Cursor Editing**: Added **Ctrl+D** (Cmd+D) support to select the next occurrence of the current selection, enabling simultaneous editing of multiple lines for faster refactoring.

## [2.0.2] - 2026-01-31

### ✨ Improvements
*   **Refined Block Indicator**: The vertical indentation guide has been significantly improved. It is now **thinner (1px)** and matches your editor's line number color for a subtle, professional look. Additionally, the line now starts **below the block header**, ensuring it doesn't overlap with the first character or dash.
*   **Modal Keyboard Shortcuts**: Added support for **Enter** to confirm and **Escape** to cancel in all standard input modals for a smoother, keyboard-driven experience.
*   **Smart File Extensions**: New files created without an extension are now automatically saved as `.yaml` files, streamlining the creation of Home Assistant configuration files.

### 🐛 Bug Fixes
*   **Selective Commits**: Resolved a critical issue where unselected files were being included in commits. The "Commit" action now strictly respects your staged files.
*   **Push Behavior**: "Push" continues to function as a convenient "Commit All & Push" for quick syncing, while "Push Only" is now more flexible, allowing you to push existing commits even with a dirty working directory.
*   **Favorites Alignment**: Fixed visual misalignment of labels in the Favorites panel and ensured the empty state is correctly hidden.
*   **Compact Tree Indentation**: Corrected CSS priority issue that caused nested folders to lose their indentation hierarchy when using Compact Mode.

## [2.0.1] - 2026-01-31

### ✨ New Features
*   **Block Scope Highlighting**: Added a visual vertical line indicator that appears when clicking on Home Assistant keywords (e.g., `automation:`, `trigger:`, `action:`) to clearly show the boundaries of code blocks.


### 🐛 Bug Fixes
*   **Intelligent Scope Detection**: Enhanced the block detection logic to correctly handle complex YAML list structures and shared indentation levels common in `automations.yaml`.
*   **Toolbar Save Button**: Fixed a critical issue where the Save button in the toolbar was unresponsive when auto-save was disabled due to an event parameter conflict.
*   **Code Folding Restoration**: Fixed a regression where configuration blocks could no longer be collapsed in YAML files.

## [2.0.0] - 2026-01-30

### ✨ New Features

#### 🧠 AI Studio Copilot
Bring AI intelligence directly into your Home Assistant workflow with flexible provider support and a powerful local logic engine.
*   **Dual-Mode Intelligence**:
    *   **Cloud Mode**: Native integration for **Gemini** (defaulting to `gemini-2.0-flash-exp`) and **OpenAI** GPT models. System prompts strictly enforce 2024+ Home Assistant best practices (e.g., plural `triggers:`, mandatory `id:` fields, `metadata: {}` blocks).
    *   **Local Logic Engine**: A robust, privacy-first fallback that parses natural language locally to generate valid YAML without any external API calls.
*   **Context-Aware Analysis**: The AI reads your currently active file to provide suggestions that match your specific configuration structure.
*   **Smart Trigger Detection**: Local parser automatically extracts complex triggers from natural language:
    *   **Time**: Handles AM/PM, "at 5pm", and multiple time slots.
    *   **State**: Detects motion, door/window events, and generic on/off changes.
    *   **Numeric**: Parses "above 25 degrees", "humidity under 50%", etc.
*   **Real-time Structural Analysis**: The "Fix my error" feature uses a custom YAML loader to report exact line numbers for:
    *   Legacy syntax (`service:` vs `action:`, `platform:` triggers).
    *   Singular keys (`trigger:` vs `triggers:`).
    *   Malformed entity IDs and missing automation IDs.

#### 🎭 Intelligent Scene & Script Generation
*   **7 Smart Scene Presets**:
    *   **Morning**: 100% brightness, 4000K (Cool White), `mdi:weather-sunny`.
    *   **Evening**: 40% brightness, 2700K (Warm White), `mdi:weather-night`.
    *   **Movie**: 10% brightness, Deep Blue RGB, `mdi:movie`.
    *   **Reading**: 80% brightness, 4000K, `mdi:book-open`.
    *   **Romantic**: 20% brightness, Soft Pink/Red, `mdi:heart`.
    *   **Party**: 100% brightness, Vibrant Magenta, `mdi:party-popper`.
    *   **Relax**: 50% brightness, 2700K, `mdi:sofa`.
*   **Multi-Step Script Logic**: Automatically detects sequences ("then", "after", "wait") to generate `sequence:` blocks with precise `delay:` actions (hours/minutes/seconds).
*   **Parallel Execution Detection**: Phrases like "turn on all lights" trigger parallel execution mode for optimized performance.
*   **Advanced Domain Support**:
    *   **100+ Synonyms**: Maps terms like "chandelier" -> `light`, "roomba" -> `vacuum`, "deadbolt" -> `lock`.
    *   **Area Awareness**: Entity scoring algorithm boosts matches found in the mentioned room (e.g., "kitchen lights" prioritizes `light.kitchen_main`).

#### 📝 Jinja Template Support
*   **Advanced Editor**: Full syntax highlighting for `.jinja`, `.jinja2`, and `.j2` files.
*   **Distinct Syntax Coloring**: Brackets (`{{`, `{%`), keywords (`if`, `for`), variables, and operators are now colored distinctly from the surrounding YAML or text.
*   **Intelligent Validation**: dedicated validator checks for:
    *   Missing quotes in `states()` (e.g., `states(sensor.temp)` -> `states('sensor.temp')`).
    *   Wrong bracket usage (`{{{` -> `{{`).
    *   Missing filter pipes.
*   **Smart Suggestions**: Context-aware autocomplete for loops (`{% for %}`), time functions (`now()`), and state attributes.

#### 🎨 Professional UI Customization
*   **6 Theme Presets**: Dark (VS Code style), Light, High Contrast, Solarized (Dark/Light), Ocean, and Dracula.
*   **Custom Accent Colors**: 8 vibrant options (Blue, Purple, Pink, Cyan, etc.) with automatic hover color generation.
*   **Editor Personalization**: Adjustable font size (10-24px), 7 programming font families (Fira Code, JetBrains Mono, etc.), word wrap toggle, and whitespace visibility.
*   **File Tree Customization**: Compact mode for dense listings and toggleable file type icons.

#### 💾 Advanced File Management
*   **Configurable Auto-Save**: Automatically save files after typing stops (500ms - 5000ms delay).
*   **Smart Settings Interface**: New tabbed modal for General, Appearance, Editor, and Feature settings.
*   **Recent Files Limit**: Configurable history depth (5-30 files).
*   **Entity Explorer Mode**: New "Search Entities" toggle in Global Search (`Ctrl+Shift+F`) to browse the Home Assistant entity registry, view states, and one-click copy IDs into your configuration.
*   **UUID Generator**: Insert random UUIDs instantly with `Ctrl+Shift+U` or via the Command Palette.
*   **Filter by Content**: New toggle in the File Explorer sidebar allows filtering the file tree by content (e.g., entity IDs) instead of just filenames.
*   **Full Theme Selector**: The bottom toolbar theme menu now includes all presets (High Contrast, Solarized, Ocean, Dracula) for quick switching.
*   **Custom Editor Colors**: Added ability to customize font colors for **Line Numbers** and **Fold Arrows** (collapsible indicators) in the editor.

### 🚀 Improvements
*   **Editor UX**: Fold icons are now 40% larger and scale proportionally with your chosen font size for better visibility and easier clicking.
*   **Theme Synchronization**: The bottom toolbar theme selector is now fully synchronized with the main Settings presets, including correct icons and labels for all specific theme modes.
*   **Slider Visibility**: Improved the visual contrast of settings sliders by updating track colors to ensure they are visible across all light and dark themes.
*   **Global Search Performance**: Engineered a faster search engine that automatically excludes binary files (`.db`, `.sqlite`, `.zip`) and all hidden folders (starting with `.`), including `.storage` and `.git`.
*   **Dynamic CSS Architecture**: All themes and accent colors applied via CSS variables for instant preview without reloading.
*   **Robust Backend API**: New `check_yaml` and `check_jinja` endpoints provide instant feedback to the frontend.
*   **Self-Healing Git**: Sync recovery tools and automated branch mismatch migration.
*   **Entity Scoring Algorithm**: improved fuzzy matching logic considers friendly names, entity IDs, and area context for more accurate device selection.

### 🐛 Bug Fixes
*   **Robust Auto-Save**: Hardened the auto-save feature with background timer cleanup and execution guards to ensure it strictly respects the toggle state and prevents accidental saves after being disabled.
*   **Real-time Color Updates**: Fixed an issue where changing custom line number or fold gutter colors required a page refresh to apply.
*   **Double Save**: Resolved a conflict between editor and global keyboard shortcuts that caused files to be saved twice (and two toast notifications) when pressing Ctrl+S.
*   **Git Toggle Robustness**: Ensured the Git Changes panel and all associated toolbar buttons are completely hidden when the GitHub integration is toggled off.
*   **Drag-and-Drop Reliability**: Fixed an issue where moving files via drag-and-drop triggered duplicate API calls due to event bubbling, resulting in "Invalid path or exists" error toasts despite successful moves.
*   **Zero External Dependencies**: Local mode now strictly keeps configuration 100% private.
*   **Recent Files Logic**: Fixed limit enforcement and persistent storage issues.
*   **Toast Layering**: Corrected an issue where toast notifications were hidden behind modals by moving them to the highest visual layer (z-index).
*   **Editor Font Stability**: Corrected font loading race conditions on editor initialization.
*   **YAML Analysis**: Fixed line/column reporting for complex nested structures.

## [1.5.0] - 2026-01-25

### ✨ New Features
*   **Command Palette**: Access all Blueprint Studio features instantly with `Ctrl+K`.
*   **Commit History**: New panel to browse recent commits with color-coded diffs.
*   **YAML Snippets**: Intelligent templates for common Home Assistant patterns (`snip:`).
*   **Advanced Global Search**: Support for Regular Expressions and Case Sensitivity.

## [1.4.0] - 2026-01-25

### ✨ New Features
*   **Smart Entity Autocomplete**: Intelligent suggestions for Home Assistant entities with icons.
*   **Global Search**: Cross-file text search with context and filtering.

## [1.2.0] - 2026-01-18

### 🌟 Added - GitHub Integration & Advanced Features
*   **GitHub Integration**: Full push/pull/commit/stage workflow with OAuth.
*   **Pin Favorites**: Quick access to frequently used files in the sidebar.
*   **Smart .gitignore**: Automatically excludes large models and lock files.

## [1.0.0] - 2024-12-05

### Added
- Initial release with VS Code-like interface and multi-tab editing.
- Syntax highlighting and real-time YAML validation.

---


## Version History
- **2.5.1** - Mobile File Tree Indentation, Allow all file types & Organisation Transfer
- **2.5.0** - HA Agent AI Mode, Diff Viewer Rewrite & File Navigation Overhaul
- **2.4.8** - Improved Diff Navigation, Stable Settings Sync & UI Fixes
- **2.4.7** - Custom AI & Stability Improvements
- **2.4.6** - Bug Fix for yaml anchors and UUIDs no longer flagged as invalid entity IDs
- **2.4.5** - Smart Indentation, .editorconfig Support, Modern YAML Syntax & Bug Fixes
- **2.4.4** - Hosts Management & Editor Improvements
- **2.4.3** - Modern Actions, Developer Tools Panel & Minimap
- **2.4.2** - Better Merges, Faster Lookups, Stronger Access Control
- **2.4.1** - Bug Fixes
- **2.4.0** - PWA Power, Blueprint Magic, SFTP & SSH Supercharged
- **2.3.0** - Terminal Integration & Workspace Persistence
- **2.2.2** - Feature & Fix Update (31 Languages)
- **2.2.1** - Editor & UI Enhancement Suite
- **2.2.0** - Performance, Architecture & SFTP Integration Update
- **2.1.5** - Compatibility & Reliability Update
- **2.1.4** - Quality of Life Update
- **2.1.3** - AI Models Update
- **2.1.2** - Visuals & Efficiency Update
- **2.1.1** - Professional File Management and Productivity Boost 
- **2.1.0** - The Performance & Architecture Update
- **2.0.5** - Allow Deletion of Folders and Files In custom_components Folder
- **2.0.5** - Persistant Workspace and Keyboard Shortcut Conflict Fix
- **2.0.4** - Git Panel Bug Fix
- **2.0.3** - Robust GitHub Authentication
- **2.0.2** - Git & UI Improvements
- **2.0.1** - Bug Fixes & Stability
- **2.0.0** - AI Copilot, Intelligent Scenes, Advanced Scripts & UI Customization
- **1.5.0** - Command Palette, Commit History & Regex Search
- **1.4.0** - Smart Autocomplete, Global Search & Bug Fixes
- **1.2.0** - GitHub Integration, Pin Favorites & Auto-Refresh
- **1.0.0** - First stable release

[Unreleased]: https://github.com/ha-china/blueprint-studio/compare/v2.5.1...HEAD
[2.5.1]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.5.1
[2.5.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.5.0
[2.4.8]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.8
[2.4.7]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.7
[2.4.6]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.6
[2.4.5]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.5
[2.4.4]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.4
[2.4.3]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.3
[2.4.2]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.2
[2.4.1]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.1
[2.4.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.4.0
[2.3.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.3.0
[2.2.2]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.2.2
[2.2.1]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.2.1
[2.2.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.2.0
[2.1.5]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.1.5
[2.1.4]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.1.4
[2.1.3]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.1.3
[2.1.2]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.1.2
[2.1.1]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.1.1
[2.1.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.1.0
[2.0.6]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.0.6
[2.0.5]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.0.5
[2.0.4]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.0.4
[2.0.3]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.0.3
[2.0.2]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.0.2
[2.0.1]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.0.1
[2.0.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v2.0.0
[1.5.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v1.5.0
[1.4.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v1.4.0
[1.2.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v1.2.0
[1.0.0]: https://github.com/ha-china/blueprint-studio/releases/tag/v1.0.0
