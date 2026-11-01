import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const www = path.join(root, 'custom_components', 'blueprint_studio', 'www');

export const codemirrorJsFiles = [
  'vendor/codemirror/js/codemirror.min.js',
  'vendor/codemirror/js/yaml.min.js',
  'vendor/codemirror/js/javascript.min.js',
  'vendor/codemirror/js/python.min.js',
  'vendor/codemirror/js/clike.min.js',
  'vendor/codemirror/js/css.min.js',
  'vendor/codemirror/js/xml.min.js',
  'vendor/codemirror/js/htmlmixed.min.js',
  'vendor/codemirror/js/markdown.min.js',
  'vendor/codemirror/js/shell.min.js',
  'vendor/codemirror/js/lint.min.js',
  'vendor/codemirror/js/matchbrackets.min.js',
  'vendor/codemirror/js/closebrackets.min.js',
  'vendor/codemirror/js/search.min.js',
  'vendor/codemirror/js/searchcursor.min.js',
  'vendor/codemirror/js/jump-to-line.min.js',
  'vendor/codemirror/js/dialog.min.js',
  'vendor/codemirror/js/foldcode.min.js',
  'vendor/codemirror/js/foldgutter.min.js',
  'vendor/codemirror/js/indent-fold.min.js',
  'vendor/codemirror/js/brace-fold.min.js',
  'vendor/codemirror/js/comment.min.js',
  'vendor/codemirror/js/active-line.min.js',
  'vendor/codemirror/js/show-hint.min.js',
  'vendor/codemirror/js/anyword-hint.min.js',
  'vendor/codemirror/js/overlay.min.js',
  'vendor/codemirror/js/merge.min.js',
];

export const codemirrorCssFiles = [
  'vendor/codemirror/css/codemirror.min.css',
  'vendor/codemirror/css/lint.min.css',
  'vendor/codemirror/css/dialog.min.css',
  'vendor/codemirror/css/foldgutter.min.css',
  'vendor/codemirror/css/show-hint.min.css',
  'vendor/codemirror/css/merge.min.css',
  'vendor/codemirror/css/material-darker.min.css',
];

export const moduleCssFiles = [
  'styles/modules/base.css',
  'styles/modules/primitives.css',
  'styles/modules/layout.css',
  'styles/modules/file-tree.css',
  'styles/modules/editor.css',
  'styles/modules/codemirror.css',
  'styles/modules/ai.css',
  'styles/modules/git.css',
  'styles/modules/sftp.css',
  'styles/modules/ui-components.css',
  'styles/modules/previews.css',
  'styles/modules/welcome.css',
  'styles/modules/themes.css',
  'styles/modules/responsive.css',
  'styles/modules/user-guide.css',
  'styles/modules/accessibility.css',
];

export function buildBundle(files, commentStyle = '/*') {
  return files.map((relPath) => {
    const fullPath = path.join(www, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const header = commentStyle === '/*'
      ? `/* --- BUNDLE: ${relPath} --- */\n`
      : `// --- BUNDLE: ${relPath} ---\n`;
    return `${header}${content}\n`;
  }).join('\n');
}

export const bundles = [
  {
    target: 'vendor/codemirror/codemirror.bundle.js',
    files: codemirrorJsFiles,
    commentStyle: '/*',
  },
  {
    target: 'vendor/codemirror/codemirror.bundle.css',
    files: codemirrorCssFiles,
    commentStyle: '/*',
  },
  {
    target: 'styles/blueprint-studio.bundle.css',
    files: moduleCssFiles,
    commentStyle: '/*',
  },
];

function run() {
  const isCheck = process.argv.includes('--check');
  let hasDiff = false;

  for (const { target, files, commentStyle } of bundles) {
    const targetPath = path.join(www, target);
    const content = buildBundle(files, commentStyle);

    if (isCheck) {
      if (!fs.existsSync(targetPath)) {
        console.error(`MISSING bundle: ${target}`);
        hasDiff = true;
      } else {
        const existing = fs.readFileSync(targetPath, 'utf8');
        if (existing !== content) {
          console.error(`OUTDATED bundle: ${target}`);
          hasDiff = true;
        } else {
          console.log(`OK bundle: ${target}`);
        }
      }
    } else {
      fs.writeFileSync(targetPath, content, 'utf8');
      console.log(`Generated bundle: ${target} (${content.length} bytes)`);
    }
  }

  if (isCheck && hasDiff) {
    console.error("\nAsset bundles are outdated. Run 'node scripts/bundle_assets.mjs' to regenerate.");
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
