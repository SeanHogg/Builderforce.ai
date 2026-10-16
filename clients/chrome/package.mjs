/**
 * Zips the built extension (`dist/extension/`) into `dist/builderforce-rovr-<version>.zip`
 * — the archive the Chrome Web Store dashboard takes. Run `node build.mjs --production`
 * first (the `package` script does both).
 *
 * Refuses to overwrite an existing archive: a rebuilt extension gets a new version
 * (repo rule — a version number is never reused).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'dist', 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const target = path.join(here, 'dist', `builderforce-rovr-${version}.zip`);

if (!fs.existsSync(path.join(root, 'manifest.json'))) {
  console.error('[rovr] dist/extension is missing — run `node build.mjs --production` first.');
  process.exit(1);
}
if (fs.existsSync(target)) {
  console.error(`[rovr] ${path.relative(here, target)} already exists — bump the version in package.json; a version is never reused.`);
  process.exit(1);
}

/** Every file under `dir`, keyed by its POSIX path relative to the extension root. */
function collect(dir, files = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, files);
    else if (!entry.name.endsWith('.map')) files[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full);
  }
  return files;
}

fs.writeFileSync(target, zipSync(collect(root), { level: 9 }));
console.log(`[rovr] packaged ${path.relative(here, target)}`);
