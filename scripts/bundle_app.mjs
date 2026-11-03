import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const www = path.join(root, 'custom_components', 'blueprint_studio', 'www');
const entryPoint = path.join(www, 'modules', 'main.js');
const targetRel = 'dist/app.bundle.js';
const targetPath = path.join(www, targetRel);

export async function buildAppBundle(options = {}) {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2022'],
    external: ['/blueprint_studio/*'],
    write: false,
    ...options,
  });

  return result.outputFiles[0].text;
}

export async function run() {
  const isCheck = process.argv.includes('--check');
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = await buildAppBundle();

  if (isCheck) {
    if (!fs.existsSync(targetPath)) {
      console.error(`MISSING bundle: ${targetRel}`);
      process.exit(1);
    }
    const existing = fs.readFileSync(targetPath, 'utf8');
    if (existing !== content) {
      console.error(`OUTDATED bundle: ${targetRel}`);
      console.error("\nApp bundle is outdated. Run 'npm run bundle:app' to regenerate.");
      process.exit(1);
    }
    console.log(`OK bundle: ${targetRel}`);
  } else {
    fs.writeFileSync(targetPath, content, 'utf8');
    console.log(`Generated bundle: ${targetRel} (${content.length} bytes)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
