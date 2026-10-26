#!/usr/bin/env node
/**
 * Rebuild every linked package whose shipped `dist/` is older than the source it is
 * built from — before a consumer bundles it.
 *
 * WHY: a `link:`ed package like `@seanhogg/builderforce-brain-embedded` is consumed
 * through its `main`/`exports`, which point at `dist/`. Its `prepare` builds that dist
 * on INSTALL, and nothing rebuilds it after. So every change to its source — and to the
 * source of the packages it bundles in (`run-policy`, `agent-tools`, …) — is invisible
 * to the VS Code extension until someone remembers to run its build. Its tests import
 * the source and pass; the VSIX ships the old dist. That is how VSIX 2026.10.97 and
 * 2026.10.98 shipped a run loop from before the analysis budget, the coding role and the
 * hand-off brief existed (VS Code chat #5739: 105 turns on MiniMax Flash, no role on any
 * turn), while every test of those changes was green.
 *
 * A package is BUILT (and so checked) when it has a `build` script and its `main` lives
 * in `dist/`; source-only packages (`exports: ./src/index.ts`) are bundled straight from
 * source and need nothing. A built package is stale when any input is newer than its
 * dist entry: its own `src/`, its manifest, its `tsup.config.*`, or — recursively — the
 * inputs of every package it links, since tsup bundles linked source into its output.
 * Linked packages are built before the packages that link them.
 *
 * A failed build FAILS this script: shipping a stale dist is the bug this exists to stop.
 *
 * Usage: `node scripts/ensure-linked-builds.mjs [consumerDir]` (default: cwd).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { linkedTargets, readManifest } from './linkedPackages.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.vitest-cache', '.vite']);
const BUILD_CONFIGS = ['tsup.config.ts', 'tsup.config.mjs', 'tsup.config.js', 'tsconfig.json', 'package.json'];

const mtime = (file) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** The newest file under `dir`, skipping build output and installs. */
function newestIn(dir) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) newest = Math.max(newest, newestIn(join(dir, entry.name)));
    } else {
      newest = Math.max(newest, mtime(join(dir, entry.name)));
    }
  }
  return newest;
}

/** The dist entry a built package ships, or null for a source-only package. */
function distEntry(dir, manifest) {
  const main = typeof manifest.main === 'string' ? manifest.main.replace(/^\.\//, '') : '';
  return manifest.scripts?.build && main.startsWith('dist/') ? join(dir, main) : null;
}

const inputsMemo = new Map();
/** The newest input to a package's build: its own source and every linked package's. */
function newestInput(dir, manifest, path = new Set()) {
  const key = realpathSync(dir);
  if (inputsMemo.has(key)) return inputsMemo.get(key);
  if (path.has(key)) return 0; // a link cycle — its other members are counted on the way in
  path.add(key);
  let newest = Math.max(newestIn(join(dir, 'src')), ...BUILD_CONFIGS.map((f) => mtime(join(dir, f))));
  for (const target of linkedTargets(dir, manifest)) {
    const child = readManifest(target);
    if (child) newest = Math.max(newest, newestInput(target, child, path));
  }
  path.delete(key);
  inputsMemo.set(key, newest);
  return newest;
}

const visited = new Set();
const rebuilt = [];
const failed = [];

/** Post-order: a package's links are fresh before the package itself is checked. */
function ensure(dir) {
  let key;
  try {
    key = realpathSync(dir);
  } catch {
    return;
  }
  if (visited.has(key)) return;
  visited.add(key);
  const manifest = readManifest(dir);
  if (!manifest) return;
  for (const target of linkedTargets(dir, manifest)) ensure(target);

  const entry = distEntry(dir, manifest);
  if (!entry) return;
  const built = existsSync(entry) ? mtime(entry) : 0;
  const input = newestInput(dir, manifest);
  if (built >= input) return;
  const name = manifest.name ?? dir;
  console.log(`[ensure-linked-builds] ${name}: dist is ${built ? 'older than its source' : 'missing'} — rebuilding`);
  const ok = spawnSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit', shell: true }).status === 0;
  (ok ? rebuilt : failed).push(name);
}

const root = resolve(process.argv[2] ?? process.cwd());
const rootManifest = readManifest(root);
if (!rootManifest) {
  console.error(`[ensure-linked-builds] no package.json at ${root}`);
  process.exit(1);
}
visited.add(realpathSync(root));
for (const target of linkedTargets(root, rootManifest)) ensure(target);

if (rebuilt.length) console.log(`[ensure-linked-builds] rebuilt: ${rebuilt.join(', ')}`);
if (failed.length) {
  console.error(`[ensure-linked-builds] FAILED to rebuild: ${failed.join(', ')} — refusing to bundle a stale dist.`);
  process.exit(1);
}
if (!rebuilt.length) console.log('[ensure-linked-builds] every linked dist is current.');
