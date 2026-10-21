/**
 * Publishes the vendored THREADED `bfi-web` artifact (`packages/bfi-web/threads/`) under
 * `public/bfi-threads/`.
 *
 * WHY plain files: the threaded build's worker pool (wasm-bindgen-rayon, `no-bundler`)
 * spawns its helpers from its own script URL and imports the glue by URL, so the files
 * must be served as they were built — never bundled or renamed. The page's `bfi` Web
 * Worker loads them only on a cross-origin-isolated page with no WebGPU adapter
 * (brain-embedded `loadBfiWeb`); everywhere else they are never fetched.
 *
 * Run from `prebuild` and `dev`, so a deploy always serves the vendored bytes (SOURCE.json
 * pins them) rather than a stale committed copy. `public/bfi-threads/` is gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROM = path.join(ROOT, '..', 'packages', 'bfi-web', 'threads');
const OUT = path.join(ROOT, 'public', 'bfi-threads');

// Always start clean: a previous copy must never outlive the vendored source (dev would
// otherwise keep serving an untraced build).
fs.rmSync(OUT, { recursive: true, force: true });
if (!fs.existsSync(path.join(FROM, 'bfi_web.js'))) {
  console.warn('[bfi-threads] packages/bfi-web/threads is not vendored — nothing published; bfi runs single-threaded.');
} else {
  fs.cpSync(FROM, OUT, { recursive: true, filter: (src) => !src.endsWith('.d.ts') });
  console.log(`[bfi-threads] published ${path.relative(ROOT, OUT)}`);
}
