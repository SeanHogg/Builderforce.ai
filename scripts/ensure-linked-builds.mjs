#!/usr/bin/env node
/**
 * Rebuild every linked package whose shipped `dist/` does not match the source it is
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
 * source and need nothing. The build digest covers source, manifests, lockfiles,
 * and config, including the linked packages that tsup bundles into the output.
 * Linked packages are built before the packages that link them.
 *
 * A failed build FAILS this script: shipping a stale dist is the bug this exists to stop.
 *
 * Usage: `node scripts/ensure-linked-builds.mjs [--include-roots] [consumerDir ...]` (default: cwd). Pass
 * every consumer of one build in a single run so shared links are walked once.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkedTargets, readManifest } from './linkedPackages.mjs';
import { readSourcePackages } from './sourcePackages.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.vitest-cache', '.vite']);
const PACKAGE_INPUTS = ['tsup.config.ts', 'tsup.config.mjs', 'tsup.config.js', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', '.npmrc'];
const REPO_INPUTS = ['scripts/ensure-linked-builds.mjs', 'scripts/linkedPackages.mjs', 'scripts/tsup.base.mjs',
  'scripts/install-brain-workspace.mjs', 'scripts/sourcePackages.mjs', 'scripts/lib/tsconfigPaths.mjs', 'scripts/check-browser-dist.mjs'];
const STAMP = '.build-inputs';

function* sourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(file);
    else if (entry.isFile()) yield file;
  }
}

function* packageInputs(dir, manifest, seen = new Set()) {
  const key = realpathSync(dir);
  if (seen.has(key)) return;
  seen.add(key);
  yield* sourceFiles(join(dir, 'src'));
  yield* PACKAGE_INPUTS.map((file) => join(dir, file)).filter(existsSync);
  for (const target of linkedTargets(dir, manifest)) {
    const child = readManifest(target);
    if (child) yield* packageInputs(target, child, seen);
  }
}

const fileDigests = new Map();
function inputDigest(dir, manifest) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([process.platform, process.arch, process.versions.node]));
  const seen = new Set();
  const inputs = new Set([...packageInputs(dir, manifest, seen), ...REPO_INPUTS.map((file) => join(repo, file))]);
  // Brain's tsup aliases can bundle registry entries even when they have no local link.
  if (seen.has(realpathSync(join(repo, 'brain-embedded')))) {
    const sourceDirs = new Set(readSourcePackages(repo).map(({ relative }) => relative.split('/src/')[0]));
    for (const sourceDir of sourceDirs) {
      const target = join(repo, sourceDir);
      for (const file of packageInputs(target, readManifest(target), seen)) inputs.add(file);
    }
  }
  for (const file of [...inputs].sort()) {
    if (!fileDigests.has(file)) fileDigests.set(file, createHash('sha256').update(readFileSync(file)).digest('hex'));
    hash.update(JSON.stringify([relative(repo, file).split(sep).join('/'), fileDigests.get(file)]));
  }
  return hash.digest('hex');
}

function distTargets(value) {
  if (typeof value === 'string') return value.replace(/^\.\//, '').startsWith('dist/') && !value.includes('*') ? [value] : [];
  return value && typeof value === 'object' ? Object.values(value).flatMap(distTargets) : [];
}

function shippedFiles(dir, manifest) {
  return [manifest.main, manifest.module, manifest.types, manifest.exports].flatMap(distTargets).map((file) => join(dir, file));
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

  const main = manifest.main?.replace(/^\.\//, '');
  if (!manifest.scripts?.build || !main?.startsWith('dist/')) return;
  const stamp = join(dir, 'dist', STAMP);
  const outputs = shippedFiles(dir, manifest);
  const complete = () => outputs.every(existsSync);
  const digest = inputDigest(dir, manifest);
  if (complete() && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === digest) return;
  const name = manifest.name ?? dir;
  console.log(`[ensure-linked-builds] ${name}: building from current inputs`);
  const ok = spawnSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0 && complete();
  if (ok) writeFileSync(stamp, `${digest}\n`);
  (ok ? rebuilt : failed).push(name);
}

// Several consumers in one run share visited packages and input hashes, so a package linked by
// more than one of them (the extension and `frontend/` share most of theirs) has its
// source tree walked, and its build checked, once.
const includeRoots = process.argv.includes('--include-roots');
const cacheKey = process.argv.includes('--cache-key');
const dirs = process.argv.slice(2).filter((arg) => arg !== '--include-roots' && arg !== '--cache-key');
const roots = (dirs.length ? dirs : [process.cwd()]).map((dir) => resolve(dir));
const consumers = roots.map((root) => {
  const manifest = readManifest(root);
  if (!manifest) {
    console.error(`[ensure-linked-builds] no package.json at ${root}`);
    process.exit(1);
  }
  return { root, manifest };
});
if (cacheKey) {
  console.log(createHash('sha256').update(consumers.map(({ root, manifest }) => inputDigest(root, manifest)).join('\n')).digest('hex'));
  process.exit(0);
}
for (const { root, manifest } of consumers) {
  if (includeRoots) {
    ensure(root);
    continue;
  }
  // A consumer is never built itself — but only from its own turn on, so a consumer that
  // an EARLIER consumer links is still checked as that one's link, as a separate run would.
  visited.add(realpathSync(root));
  for (const target of linkedTargets(root, manifest)) ensure(target);
}

if (rebuilt.length) console.log(`[ensure-linked-builds] rebuilt: ${rebuilt.join(', ')}`);
if (failed.length) {
  console.error(`[ensure-linked-builds] FAILED to rebuild: ${failed.join(', ')} — refusing to bundle a stale dist.`);
  process.exit(1);
}
if (!rebuilt.length) console.log('[ensure-linked-builds] every linked dist is current.');
