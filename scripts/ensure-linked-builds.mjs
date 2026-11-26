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
 * Linked packages are built before the packages that link them: stale packages are grouped
 * into dependency levels, each level builds concurrently (at most availableParallelism() - 1
 * at a time, output buffered and printed per package), and a level starts only when the one
 * below it has finished (none starts after a level had a failure).
 *
 * A failed build FAILS this script: shipping a stale dist is the bug this exists to stop.
 *
 * Usage: `node scripts/ensure-linked-builds.mjs [--include-roots] [consumerDir ...]` (default: cwd). Pass
 * every consumer of one build in a single run so shared links are walked once.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File, walkFiles } from './lib/hashTree.mjs';
import { linkedTargets, readManifest } from './linkedPackages.mjs';
import { readSourcePackages } from './sourcePackages.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.vitest-cache', '.vite']);
const PACKAGE_INPUTS = ['tsup.config.ts', 'tsup.config.mjs', 'tsup.config.js', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', '.npmrc'];
const REPO_INPUTS = ['scripts/ensure-linked-builds.mjs', 'scripts/linkedPackages.mjs', 'scripts/tsup.base.mjs',
  'scripts/install-brain-workspace.mjs', 'scripts/sourcePackages.mjs', 'scripts/lib/tsconfigPaths.mjs', 'scripts/check-browser-dist.mjs'];
const STAMP = '.build-inputs';

function* packageInputs(dir, manifest, seen = new Set()) {
  const key = realpathSync(dir);
  if (seen.has(key)) return;
  seen.add(key);
  yield* walkFiles(join(dir, 'src'), { skipDirs: SKIP_DIRS });
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
    if (!fileDigests.has(file)) fileDigests.set(file, sha256File(file));
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
const levelOf = new Map();
const rebuilt = [];
const failed = [];
/** Packages whose dist is stale, grouped by dependency level: `pending[0]` has no stale link beneath it. */
const pending = [];

/**
 * Post-order: a package's links are decided before the package itself is checked. Returns the
 * deepest pending level in this package's subtree (-1 when nothing under it needs a build); a
 * package that needs a build lands one level above its deepest pending link, so every build
 * runs after the builds it depends on.
 */
function plan(dir) {
  let key;
  try {
    key = realpathSync(dir);
  } catch {
    return -1;
  }
  if (visited.has(key)) return levelOf.get(key) ?? -1;
  visited.add(key);
  const manifest = readManifest(dir);
  if (!manifest) return -1;
  let below = -1;
  for (const target of linkedTargets(dir, manifest)) below = Math.max(below, plan(target));

  const main = manifest.main?.replace(/^\.\//, '');
  if (!manifest.scripts?.build || !main?.startsWith('dist/')) {
    levelOf.set(key, below);
    return below;
  }
  const stamp = join(dir, 'dist', STAMP);
  const outputs = shippedFiles(dir, manifest);
  const complete = () => outputs.every(existsSync);
  const digest = inputDigest(dir, manifest);
  if (complete() && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === digest) {
    levelOf.set(key, below);
    return below;
  }
  const level = below + 1;
  (pending[level] ??= []).push({ dir, name: manifest.name ?? dir, stamp, digest, complete });
  levelOf.set(key, level);
  return level;
}

/** One `npm run build`, its output buffered so concurrent builds never interleave a line. */
function build(job) {
  console.log(`[ensure-linked-builds] ${job.name}: building from current inputs`);
  return new Promise((done) => {
    const chunks = [];
    const child = spawn('npm', ['run', 'build'], { cwd: job.dir, shell: process.platform === 'win32' });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    let finished = false;
    const finish = (status) => {
      if (finished) return; // `error` and `close` can both fire for one child
      finished = true;
      const text = Buffer.concat(chunks).toString('utf8').replace(/\s+$/, '');
      if (text) console.log(text.split('\n').map((line) => `[${job.name}] ${line}`).join('\n'));
      done(status === 0);
    };
    child.on('error', () => finish(1));
    child.on('close', finish);
  });
}

/** The builds of one level, at most `limit` at a time; a failure never stops its siblings. */
async function runLevel(jobs, limit) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const ok = (await build(job)) && job.complete();
      if (ok) writeFileSync(job.stamp, `${job.digest}\n`);
      (ok ? rebuilt : failed).push(job.name);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

async function buildPending() {
  const limit = Math.max(1, availableParallelism() - 1);
  for (const jobs of pending) {
    if (!jobs?.length) continue;
    // A level that failed leaves its dependants without a good dist to build against: stop here.
    if (failed.length) break;
    await runLevel(jobs, limit);
  }
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
    plan(root);
    continue;
  }
  // A consumer is never built itself — but only from its own turn on, so a consumer that
  // an EARLIER consumer links is still checked as that one's link, as a separate run would.
  visited.add(realpathSync(root));
  for (const target of linkedTargets(root, manifest)) plan(target);
}
await buildPending();

if (rebuilt.length) console.log(`[ensure-linked-builds] rebuilt: ${rebuilt.join(', ')}`);
if (failed.length) {
  console.error(`[ensure-linked-builds] FAILED to rebuild: ${failed.join(', ')} — refusing to bundle a stale dist.`);
  process.exit(1);
}
if (!rebuilt.length) console.log('[ensure-linked-builds] every linked dist is current.');
