#!/usr/bin/env node
/**
 * The vendored `bfi-web` build — `packages/bfi-web/`.
 *
 * Synapse's engine (`builderforce-inference`, crate `crates/bfi-web`) compiled by
 * wasm-pack for the browser: a ~50 KB JS glue, its `.d.ts` and a ~3.5 MB `.wasm`.
 * PRD 34 §4 VENDORS it rather than publishing it to npm, so the bytes live in this
 * repo and every host consumes them by `link:` (the way the built
 * `@seanhogg/builderforce-brain-ui` is consumed). A vendored binary nobody can trace
 * is a liability, so `packages/bfi-web/SOURCE.json` records the source commit and the
 * sha256 of every file this script copied.
 *
 *   node scripts/vendor-bfi-web.mjs               rebuild in the sibling repo, copy, record
 *   node scripts/vendor-bfi-web.mjs --no-build    copy the sibling's existing `pkg/` as is
 *   node scripts/vendor-bfi-web.mjs --check       the vendored files match SOURCE.json (CI)
 *   node scripts/vendor-bfi-web.mjs --check-build rebuild and compare to the vendored copy
 *
 * `--check` is the registered guard (api/scripts/checks.manifest.mjs): it needs no Rust,
 * so it runs everywhere, and it fails when a vendored file was edited, replaced or
 * dropped without re-vendoring. `--check-build` is the stronger, local-only proof — a
 * fresh wasm-pack build reproduces the vendored bytes — and needs the Rust toolchain.
 *
 * The sibling repo is `../builderforce-inference` beside this one; `BFI_REPO` overrides.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(repoRoot, 'packages', 'bfi-web');
const sourceRecordPath = join(vendorDir, 'SOURCE.json');
const sourceRepo = resolve(process.env.BFI_REPO ?? join(repoRoot, '..', 'builderforce-inference'));
const crate = 'crates/bfi-web';
const pkgDir = join(sourceRepo, ...crate.split('/'), 'pkg');

/** The wasm-pack output files that are vendored. Everything else in the package is hand-written. */
const VENDORED_FILES = ['bfi_web.js', 'bfi_web.d.ts', 'bfi_web_bg.wasm'];
const BUILD_ARGS = ['build', crate, '--target', 'web', '--release', '--out-dir', 'pkg'];

/**
 * sha256 of a file, with CRLF folded to LF for the text files — wasm-pack emits LF, and a
 * Windows checkout under `core.autocrlf` must not read as drift (the package's
 * `.gitattributes` already pins the bytes; this is the belt to that brace).
 */
function hashFile(file) {
  const bytes = readFileSync(file);
  const content = file.endsWith('.wasm') ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

function fail(message) {
  console.error(`❌  bfi-web vendor: ${message}`);
  process.exit(1);
}

function readRecord() {
  if (!existsSync(sourceRecordPath)) fail(`${sourceRecordPath} is missing — run \`node scripts/vendor-bfi-web.mjs\`.`);
  return JSON.parse(readFileSync(sourceRecordPath, 'utf8'));
}

/** Files whose hash in `dir` differs from `expected` (name → sha256). */
function diffAgainst(dir, expected) {
  const problems = [];
  for (const name of VENDORED_FILES) {
    const file = join(dir, name);
    if (!existsSync(file)) {
      problems.push(`${name}: missing`);
      continue;
    }
    if (!expected[name]) {
      problems.push(`${name}: not recorded in SOURCE.json`);
      continue;
    }
    const actual = hashFile(file);
    if (actual !== expected[name]) problems.push(`${name}: sha256 ${actual.slice(0, 12)}… ≠ recorded ${expected[name].slice(0, 12)}…`);
  }
  return problems;
}

function git(args) {
  const run = spawnSync('git', ['-C', sourceRepo, ...args], { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : '';
}

function wasmPackBuild() {
  if (!existsSync(join(sourceRepo, ...crate.split('/')))) fail(`no ${crate} under ${sourceRepo} — set BFI_REPO to the builderforce-inference checkout.`);
  console.log(`[bfi-web] wasm-pack ${BUILD_ARGS.join(' ')}  (in ${sourceRepo})`);
  const run = spawnSync('wasm-pack', BUILD_ARGS, { cwd: sourceRepo, stdio: 'inherit', shell: process.platform === 'win32' });
  if (run.status !== 0) fail('wasm-pack build failed (is the Rust toolchain + wasm-pack installed?).');
}

const args = new Set(process.argv.slice(2));

if (args.has('--check')) {
  const record = readRecord();
  const problems = diffAgainst(vendorDir, record.files ?? {});
  if (problems.length) {
    fail(
      `packages/bfi-web differs from SOURCE.json (${record.commit ?? 'unknown commit'}):\n  - ${problems.join('\n  - ')}\n` +
        '   Re-vendor with `node scripts/vendor-bfi-web.mjs` instead of editing the build by hand.',
    );
  }
  console.log(`✅  bfi-web vendor: ${VENDORED_FILES.length} file(s) match SOURCE.json (${record.repository}@${String(record.commit).slice(0, 7)}).`);
  process.exit(0);
}

if (args.has('--check-build')) {
  wasmPackBuild();
  const fresh = Object.fromEntries(VENDORED_FILES.filter((name) => existsSync(join(pkgDir, name))).map((name) => [name, hashFile(join(pkgDir, name))]));
  const problems = diffAgainst(vendorDir, fresh);
  if (problems.length) fail(`the vendored copy is not what ${crate} builds today:\n  - ${problems.join('\n  - ')}`);
  console.log('✅  bfi-web vendor: a fresh wasm-pack build reproduces the vendored files.');
  process.exit(0);
}

if (!args.has('--no-build')) wasmPackBuild();
for (const name of VENDORED_FILES) {
  if (!existsSync(join(pkgDir, name))) fail(`${join(pkgDir, name)} is missing — the build did not produce it.`);
  copyFileSync(join(pkgDir, name), join(vendorDir, name));
}

// The version follows the crate's; everything else in the manifest is ours.
const builtManifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const manifestPath = join(vendorDir, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = builtManifest.version ?? manifest.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const commit = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain', '--', crate]) !== '';
const record = {
  repository: 'SeanHogg/builderforce-inference',
  crate,
  commit: commit || 'unknown',
  ...(dirty ? { dirty: true } : {}),
  version: manifest.version,
  build: `wasm-pack ${BUILD_ARGS.join(' ')}`,
  files: Object.fromEntries(VENDORED_FILES.map((name) => [name, hashFile(join(vendorDir, name))])),
};
writeFileSync(sourceRecordPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`[bfi-web] vendored ${VENDORED_FILES.join(', ')} from ${record.commit.slice(0, 7)}${dirty ? ' (dirty)' : ''} → packages/bfi-web`);
