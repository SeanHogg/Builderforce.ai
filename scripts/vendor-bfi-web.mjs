#!/usr/bin/env node
/**
 * The vendored `bfi-web` build — `packages/bfi-web/`.
 *
 * Synapse's engine (`builderforce-inference`, crate `crates/bfi-web`) compiled by
 * wasm-pack for the browser: a ~50 KB JS glue, its `.d.ts` and a ~3.7 MB `.wasm` (WebGPU
 * + single-threaded CPU, stable toolchain) — and, optionally, under `threads/` the
 * THREADED CPU artifact (`crates/bfi-web/build-threads.mjs`: pinned nightly, atomics,
 * wasm-bindgen-rayon's worker pool), which a host serves as plain files and loads only on
 * a cross-origin-isolated page.
 *
 * PRD 34 §4 VENDORS it rather than publishing it to npm, so the bytes live in this repo
 * and every host consumes them by `link:` (the way the built
 * `@seanhogg/builderforce-brain-ui` is consumed). A vendored binary nobody can trace is a
 * liability, so `packages/bfi-web/SOURCE.json` records the source commit and the sha256
 * of every file this script copied.
 *
 *   node scripts/vendor-bfi-web.mjs               rebuild the default artifact (stable), copy, record
 *   node scripts/vendor-bfi-web.mjs --threads     … and the threaded one (pinned nightly)
 *   node scripts/vendor-bfi-web.mjs --no-build    copy the sibling's existing `pkg/` (with
 *                                                 --threads also `pkg-threads/`) as is — only
 *                                                 when the inference tree is clean and that
 *                                                 output's build stamp names HEAD
 *   node scripts/vendor-bfi-web.mjs --check       the vendored files match SOURCE.json and were
 *                                                 built from a clean tree (CI)
 *   node scripts/vendor-bfi-web.mjs --check-build rebuild and compare to the vendored copy
 *                                                 (threads/ too whenever SOURCE.json records
 *                                                 a threadsBuild)
 *
 * The threaded artifact is OPTIONAL to re-vendor: without `--threads` the default one
 * re-vendors on stable alone and an existing `threads/` is kept, recorded with the commit
 * it was built from (`threadsCommit`). `--check` holds EVERY file under `threads/` to
 * SOURCE.json, and requires `threadsBuild` whenever `threads/` exists.
 *
 * The CPU backend's planning constants (Rust `kv_plan`, printed by the `bfi-models`
 * example `cpu_limits`) are written to `packages/local-inference/src/bfiLimits.generated.ts`
 * on every vendor and recorded under `generated`, so the TypeScript fit cannot drift.
 *
 * A build from uncommitted sources is recorded `dirty` — every input of the wasm counts
 * (`SOURCE_INPUTS`), not only the bfi-web crate — and `--check` FAILS on such a record
 * (`dirty`, or a `threadsCommit` marked `(dirty)`): vendored bytes must trace to a commit.
 * Every build this script runs writes a stamp (`.bfi-build-stamp.json`: the commit and
 * whether the tree was dirty) into its output directory, so `--no-build` can prove the
 * `pkg/` it copies was built from the HEAD it is about to record.
 *
 * `--check` is the registered guard (api/scripts/checks.manifest.mjs): it needs no Rust,
 * so it runs everywhere. `--check-build` is the stronger, local-only proof — a fresh
 * build reproduces the vendored bytes — and needs the Rust toolchain.
 *
 * The sibling repo is `../builderforce-inference` beside this one; `BFI_REPO` overrides.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffAgainst, hashFile, requireStampedBuild as requireStamped, sourceRepository, writeBuildStamp } from './lib/vendoredBuild.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(repoRoot, 'packages', 'bfi-web');
const sourceRecordPath = join(vendorDir, 'SOURCE.json');
const sourceRepo = resolve(process.env.BFI_REPO ?? join(repoRoot, '..', 'builderforce-inference'));
const crate = 'crates/bfi-web';
const pkgDir = join(sourceRepo, ...crate.split('/'), 'pkg');
const threadsPkgDir = join(sourceRepo, ...crate.split('/'), 'pkg-threads');
/** Where the threaded artifact lands in the vendored package. */
const THREADS_DIR = 'threads';
/** Everything the wasm is compiled from: a change in any of these makes the bytes differ
 *  from the recorded commit. */
const SOURCE_INPUTS = [
  'crates/bfi-web',
  'crates/bfi-engine',
  'crates/bfi-core',
  'crates/bfi-models',
  'crates/bfi-runtime',
  'crates/bfi-gguf',
  'Cargo.toml',
  'Cargo.lock',
  '.cargo/config.toml',
];
/** The generated TypeScript twin of the CPU planning constants. */
const LIMITS_KEY = 'packages/local-inference/src/bfiLimits.generated.ts';
const LIMITS_FILE = join(repoRoot, ...LIMITS_KEY.split('/'));

/** The wasm-pack output files that are vendored. Everything else in the package is hand-written. */
const VENDORED_FILES = ['bfi_web.js', 'bfi_web.d.ts', 'bfi_web_bg.wasm'];
const BUILD_ARGS = ['build', crate, '--target', 'web', '--release', '--out-dir', 'pkg'];

/** Every file of the threaded artifact a host serves: the glue, its types, the wasm and
 *  wasm-bindgen-rayon's worker snippet(s), relative to `dir`. */
function threadFiles(dir) {
  const out = VENDORED_FILES.filter((name) => existsSync(join(dir, name)));
  const walk = (sub) => {
    const abs = join(dir, sub);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const rel = `${sub}/${name}`;
      if (statSync(join(dir, rel)).isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk('snippets');
  return out;
}

/** Every file under the vendored `threads/`, as `threads/…` keys. */
function vendoredThreadFiles() {
  const dir = join(vendorDir, THREADS_DIR);
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (sub) => {
    for (const name of readdirSync(join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name;
      if (statSync(join(dir, rel)).isDirectory()) walk(rel);
      else out.push(`${THREADS_DIR}/${rel}`);
    }
  };
  walk('');
  return out;
}

function fail(message) {
  console.error(`❌  bfi-web vendor: ${message}`);
  process.exit(1);
}

function readRecord() {
  if (!existsSync(sourceRecordPath)) fail(`${sourceRecordPath} is missing — run \`node scripts/vendor-bfi-web.mjs\`.`);
  return JSON.parse(readFileSync(sourceRecordPath, 'utf8'));
}

const source = sourceRepository(sourceRepo);
const git = source.git;
/** The inference tree now: HEAD, and whether any input of the wasm differs from it. */
const sourceState = () => source.state(SOURCE_INPUTS);
/** `--no-build`: refuse unless the tree is clean and `dir` was built from HEAD. */
const requireStampedBuild = (dir, state) => requireStamped(dir, state, { sourceRepo, fail });

function wasmPackBuild(withThreads) {
  if (!existsSync(join(sourceRepo, ...crate.split('/')))) fail(`no ${crate} under ${sourceRepo} — set BFI_REPO to the builderforce-inference checkout.`);
  const state = sourceState();
  console.log(`[bfi-web] wasm-pack ${BUILD_ARGS.join(' ')}  (in ${sourceRepo})`);
  const run = spawnSync('wasm-pack', BUILD_ARGS, { cwd: sourceRepo, stdio: 'inherit', shell: process.platform === 'win32' });
  if (run.status !== 0) fail('wasm-pack build failed (is the Rust toolchain + wasm-pack installed?).');
  writeBuildStamp(pkgDir, state);
  if (!withThreads) return;
  // The threaded artifact: its own script pins the nightly it needs.
  const threads = spawnSync('node', [join(...crate.split('/'), 'build-threads.mjs')], { cwd: sourceRepo, stdio: 'inherit' });
  if (threads.status !== 0) fail('the threaded bfi-web build failed (see crates/bfi-web/build-threads.mjs for the pinned nightly).');
  writeBuildStamp(threadsPkgDir, state);
}

/** The CPU planning constants from Rust, written as the generated TypeScript module. */
function generateLimits() {
  const run = spawnSync('cargo', ['run', '-q', '-p', 'bfi-models', '--example', 'cpu_limits'], {
    cwd: sourceRepo,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (run.status !== 0) fail(`cargo run --example cpu_limits failed:\n${run.stderr}`);
  const limits = JSON.parse(run.stdout.trim());
  const body = Object.entries(limits)
    .map(([key, value]) => `  ${key}: ${Number(value)},`)
    .join('\n');
  const text = [
    '// GENERATED by scripts/vendor-bfi-web.mjs from builderforce-inference',
    '// `crates/bfi-models/examples/cpu_limits.rs` (Rust `kv_plan`, the one source).',
    '// Do not edit — re-vendor. Held by `node scripts/vendor-bfi-web.mjs --check`.',
    '',
    "/** The bfi CPU backend's planning constants: the KV budget, the working set, wasm32's",
    ' *  cap, and the device-memory rule (`cpu_memory_ceiling`: min(wasm32 cap, device RAM /',
    ' *  divisor), an unreported RAM reading as `assumedDeviceMemoryBytes` on a phone and',
    ' *  `assumedDesktopMemoryBytes` on a desktop — the host decides which, `fit.ts`). */',
    'export const BFI_CPU_LIMITS = {',
    body,
    '} as const;',
    '',
  ].join('\n');
  writeFileSync(LIMITS_FILE, text);
}

const args = new Set(process.argv.slice(2));

if (args.has('--check')) {
  const record = readRecord();
  const files = record.files ?? {};
  const threaded = vendoredThreadFiles();
  const problems = diffAgainst(vendorDir, files, [...VENDORED_FILES, ...new Set([...threaded, ...Object.keys(files).filter((n) => n.startsWith(`${THREADS_DIR}/`))])]);
  if (threaded.length && !record.threadsBuild) problems.push('threads/ is vendored but SOURCE.json records no threadsBuild');
  // Bytes from uncommitted sources trace to no commit: re-vendor from a clean tree.
  if (record.dirty) problems.push(`SOURCE.json records a dirty build of ${record.commit ?? 'unknown'} — commit the inference changes and re-vendor`);
  if (String(record.threadsCommit ?? '').endsWith('(dirty)')) problems.push(`threads/ was built from a dirty tree (${record.threadsCommit}) — re-vendor with --threads from a clean tree`);
  const generated = record.generated?.[LIMITS_KEY];
  if (!existsSync(LIMITS_FILE)) problems.push(`${LIMITS_KEY}: missing`);
  else if (!generated) problems.push(`${LIMITS_KEY}: not recorded in SOURCE.json (generated)`);
  else if (hashFile(LIMITS_FILE) !== generated) problems.push(`${LIMITS_KEY}: edited by hand — re-vendor`);
  if (problems.length) {
    fail(
      `packages/bfi-web differs from SOURCE.json (${record.commit ?? 'unknown commit'}):\n  - ${problems.join('\n  - ')}\n` +
        '   Re-vendor with `node scripts/vendor-bfi-web.mjs` instead of editing the build by hand.',
    );
  }
  console.log(
    `✅  bfi-web vendor: ${Object.keys(files).length} file(s) + ${LIMITS_KEY} match SOURCE.json (${record.repository}@${String(record.commit).slice(0, 7)}).`,
  );
  process.exit(0);
}

if (args.has('--check-build')) {
  // threads/ is held whenever it is recorded, not only when asked for.
  const withThreads = args.has('--threads') || Boolean(readRecord().threadsBuild);
  wasmPackBuild(withThreads);
  const fresh = {
    ...Object.fromEntries(VENDORED_FILES.filter((name) => existsSync(join(pkgDir, name))).map((name) => [name, hashFile(join(pkgDir, name))])),
    ...(withThreads
      ? Object.fromEntries(threadFiles(threadsPkgDir).map((name) => [`${THREADS_DIR}/${name}`, hashFile(join(threadsPkgDir, ...name.split('/')))]))
      : {}),
  };
  const problems = diffAgainst(vendorDir, fresh, Object.keys(fresh));
  if (problems.length) fail(`the vendored copy is not what ${crate} builds today:\n  - ${problems.join('\n  - ')}`);
  console.log('✅  bfi-web vendor: a fresh wasm-pack build reproduces the vendored files.');
  process.exit(0);
}

const withThreads = args.has('--threads');
const previous = existsSync(sourceRecordPath) ? JSON.parse(readFileSync(sourceRecordPath, 'utf8')) : {};
if (args.has('--no-build')) {
  const state = sourceState();
  requireStampedBuild(pkgDir, state);
  if (withThreads) requireStampedBuild(threadsPkgDir, state);
} else wasmPackBuild(withThreads);
for (const name of VENDORED_FILES) {
  if (!existsSync(join(pkgDir, name))) fail(`${join(pkgDir, name)} is missing — the build did not produce it.`);
  copyFileSync(join(pkgDir, name), join(vendorDir, name));
}
if (withThreads) {
  const threaded = threadFiles(threadsPkgDir);
  if (!threaded.includes('bfi_web_bg.wasm')) fail(`${relative(sourceRepo, threadsPkgDir)} is missing — run crates/bfi-web/build-threads.mjs.`);
  rmSync(join(vendorDir, THREADS_DIR), { recursive: true, force: true });
  for (const name of threaded) {
    const to = join(vendorDir, THREADS_DIR, ...name.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(threadsPkgDir, ...name.split('/')), to);
  }
}
generateLimits();

// The version follows the crate's; everything else in the manifest is ours.
const builtManifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const manifestPath = join(vendorDir, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = builtManifest.version ?? manifest.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const commit = git(['rev-parse', 'HEAD']);
// Dirty = ANY input of the wasm differs from the commit — never a clean record for bytes
// that commit does not produce.
const dirty = git(['status', '--porcelain', '--', ...SOURCE_INPUTS]) !== '';
const threadedNow = vendoredThreadFiles();
const record = {
  repository: 'SeanHogg/builderforce-inference',
  crate,
  commit: commit || 'unknown',
  ...(dirty ? { dirty: true } : {}),
  version: manifest.version,
  build: `wasm-pack ${BUILD_ARGS.join(' ')}`,
  ...(threadedNow.length
    ? {
        threadsBuild: `node ${crate}/build-threads.mjs`,
        // Rebuilt now, or kept from the vendor that built it.
        threadsCommit: withThreads
          ? `${commit || 'unknown'}${dirty ? ' (dirty)' : ''}`
          : (previous.threadsCommit ?? `${previous.commit ?? 'unknown'}${previous.dirty ? ' (dirty)' : ''}`),
      }
    : {}),
  files: Object.fromEntries([
    ...VENDORED_FILES.map((name) => [name, hashFile(join(vendorDir, name))]),
    ...threadedNow.map((name) => [name, hashFile(join(vendorDir, ...name.split('/')))]),
  ]),
  generated: { [LIMITS_KEY]: hashFile(LIMITS_FILE) },
};
writeFileSync(sourceRecordPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  `[bfi-web] vendored ${VENDORED_FILES.join(', ')} + ${threadedNow.length} threads/ file(s)${withThreads ? '' : ' (kept)'} from ${record.commit.slice(0, 7)}${dirty ? ' (dirty)' : ''} → packages/bfi-web`,
);
