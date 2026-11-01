import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const live = process.argv.includes('--live');
const checks = [
  ['asset bundles', 'node', ['scripts/bundle_assets.mjs', '--check']],
  ['ownership', 'node', ['scripts/audit_frontend_ownership.mjs']],
  ['scoped wiring', 'node', ['scripts/audit_frontend_scoped_wiring.mjs']],
];
const requiredArtifacts = [
  'custom_components/blueprint_studio/www/panels/panel_custom.html',
  'custom_components/blueprint_studio/www/vendor/codemirror/codemirror.bundle.js',
  'custom_components/blueprint_studio/www/vendor/codemirror/codemirror.bundle.css',
  'custom_components/blueprint_studio/www/styles/blueprint-studio.bundle.css',
  'custom_components/blueprint_studio/www/modules/app.js',
  'custom_components/blueprint_studio/www/modules/translations.js',
  'custom_components/blueprint_studio/www/locales/en.json',
  'scripts/audit_frontend_ownership.mjs',
  'scripts/audit_frontend_scoped_wiring.mjs',
  'scripts/audit_frontend_pseudo_locale.mjs',
  'scripts/audit_frontend_degraded_states.mjs',
];

const run = (label, command, args = []) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${label} failed`);
};

for (const [label, command, args] of checks) run(label, command, args);
run('pseudo locale', 'node', ['scripts/audit_frontend_pseudo_locale.mjs']);
run('degraded states', 'node', ['scripts/audit_frontend_degraded_states.mjs']);
for (const artifact of requiredArtifacts) await readFile(new URL(`../${artifact}`, import.meta.url));
console.log(`PASS release artifact inventory (${requiredArtifacts.length} files)`);

if (live) {
  const liveChecks = [
    ['performance budgets', 'scripts/audit_frontend_performance_budgets.mjs'],
    ['lazy dependencies', 'scripts/audit_frontend_lazy_dependencies.mjs'],
    ['large workspace', 'scripts/audit_frontend_large_workspace.mjs'],
    ['reinitialization', 'scripts/audit_frontend_reinitialization.mjs'],
    ['viewport screenshots', 'scripts/audit_frontend_screenshots.mjs'],
    ['shortcut guide', 'scripts/audit_frontend_shortcuts.mjs'],
    ['Playwright layouts', 'scripts/audit_frontend_playwright.mjs'],
  ];
  for (const [label, script] of liveChecks) run(label, 'node', [script]);
}

console.log(live ? 'Frontend release gate passed (static + live)' : 'Frontend release gate passed (CI static)');
