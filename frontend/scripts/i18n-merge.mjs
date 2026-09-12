// Deep-merges a per-locale patch object into each messages/<locale>.json,
// adding only missing leaf keys (idempotent; never overwrites an existing value).
// Usage: node scripts/i18n-merge.mjs <patchModule.mjs>
// The module exports the per-locale object as `PATCHES` or as its default export.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES = resolve(__dirname, '../src/i18n/messages');
const LOCALES = ['en', 'zh', 'es', 'fr', 'de'];

function mergeMissing(target, patch) {
  let added = 0;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (target[k] == null || typeof target[k] !== 'object') target[k] = {};
      added += mergeMissing(target[k], v);
    } else if (target[k] === undefined) {
      target[k] = v;
      added += 1;
    }
  }
  return added;
}

const patchPath = pathToFileURL(resolve(process.cwd(), process.argv[2])).href;
const patchModule = await import(patchPath);
const PATCHES = patchModule.PATCHES ?? patchModule.default;
if (!PATCHES || typeof PATCHES !== 'object') {
  throw new Error(`${process.argv[2]} exports neither PATCHES nor a default per-locale object`);
}

for (const loc of LOCALES) {
  const file = resolve(MESSAGES, `${loc}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const added = mergeMissing(json, PATCHES[loc] ?? {});
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`${loc}: +${added} keys`);
}
