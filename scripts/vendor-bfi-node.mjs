#!/usr/bin/env node
/**
 * The vendored `bfi-node` build — `packages/bfi-node/`.
 *
 * Synapse's engine as a native Node addon (`builderforce-inference`, crate
 * `crates/bfi-node`, napi-rs over `bfi-engine`): the JS face (`index.js` + `index.d.ts`)
 * and one prebuilt `bfi_node.<platform>-<arch>.node` per platform. The editor's
 * extension host runs it (`clients/vscode/src/hostBfi/nativeEngine.ts`) — native wgpu on
 * Vulkan (Metal on macOS), or every CPU core — and falls back to the vendored wasm where no
 * addon ships.
 *
 * Vendored like `bfi-web` (PRD 34 §4): the bytes live in this repo and trace to a commit.
 * `SOURCE.json` records the JS face's commit and sha256s, and for EACH platform's addon
 * the commit it was built from — a re-vendor on one machine rebuilds that machine's
 * platform and keeps the others (built on their own machines, or by the inference
 * repo's `bfi-node` workflow, which builds every platform and stamps each build).
 *
 *   node scripts/vendor-bfi-node.mjs                    build THIS platform's addon, copy, record
 *   node scripts/vendor-bfi-node.mjs --from <dir>       vendor prebuilt addons from <dir> or its
 *                                                       subfolders — the `bfi-node` workflow's
 *                                                       artifacts (`gh run download <run> -R
 *                                                       SeanHogg/builderforce-inference -p 'bfi-node-*'
 *                                                       -D <dir>`): bfi_node.<platform>-<arch>.node
 *                                                       + the .bfi-build-stamp.<platform>-<arch>.json
 *                                                       build.mjs wrote beside it
 *   node scripts/vendor-bfi-node.mjs --check            the vendored files match SOURCE.json and every
 *                                                       one was built from a clean tree (CI)
 *
 * The sibling repo is `../builderforce-inference` beside this one; `BFI_REPO` overrides.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffAgainst, hashFile, sourceRepository } from './lib/vendoredBuild.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(repoRoot, 'packages', 'bfi-node');
const sourceRecordPath = join(vendorDir, 'SOURCE.json');
const sourceRepo = resolve(process.env.BFI_REPO ?? join(repoRoot, '..', 'builderforce-inference'));
const crate = 'crates/bfi-node';
const crateDir = join(sourceRepo, ...crate.split('/'));
/** Everything the addon is compiled from. */
const SOURCE_INPUTS = [
  'crates/bfi-node',
  'crates/bfi-engine',
  'crates/bfi-core',
  'crates/bfi-models',
  'crates/bfi-runtime',
  'crates/bfi-gguf',
  'Cargo.toml',
  'Cargo.lock',
];
/** The JS face, copied as is. */
const FACE_FILES = ['index.js', 'index.d.ts'];
const ADDON = /^bfi_node\.([a-z0-9]+-[a-z0-9]+)\.node$/;
const source = sourceRepository(sourceRepo);

function fail(message) {
  console.error(`❌  bfi-node vendor: ${message}`);
  process.exit(1);
}

const readRecord = () => (existsSync(sourceRecordPath) ? JSON.parse(readFileSync(sourceRecordPath, 'utf8')) : {});
const addonsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => ADDON.test(name)) : []);
const platformOf = (name) => ADDON.exec(name)[1];

const args = process.argv.slice(2);

if (args.includes('--check')) {
  if (!existsSync(sourceRecordPath)) fail(`${sourceRecordPath} is missing — run \`node scripts/vendor-bfi-node.mjs\`.`);
  const record = readRecord();
  const addons = addonsIn(vendorDir);
  const expected = {
    ...(record.files ?? {}),
    ...Object.fromEntries(Object.entries(record.platforms ?? {}).map(([platform, p]) => [`bfi_node.${platform}.node`, p.sha256])),
  };
  const problems = diffAgainst(vendorDir, expected, [...FACE_FILES, ...new Set([...addons, ...Object.keys(record.platforms ?? {}).map((p) => `bfi_node.${p}.node`)])]);
  if (record.dirty) problems.push(`the JS face was vendored from a dirty tree (${record.commit}) — commit the inference changes and re-vendor`);
  for (const [platform, p] of Object.entries(record.platforms ?? {})) {
    if (p.dirty) problems.push(`bfi_node.${platform}.node was built from a dirty tree (${p.commit}) — re-vendor it from a clean one`);
  }
  if (problems.length) fail(`packages/bfi-node differs from SOURCE.json:\n  - ${problems.join('\n  - ')}`);
  console.log(`✅  bfi-node vendor: the JS face + ${addons.length} platform addon(s) match SOURCE.json (${record.repository}@${String(record.commit).slice(0, 7)}).`);
  process.exit(0);
}

if (!existsSync(crateDir)) fail(`no ${crate} under ${sourceRepo} — set BFI_REPO to the builderforce-inference checkout.`);
const state = source.state(SOURCE_INPUTS);
const previous = readRecord();
const platforms = { ...(previous.platforms ?? {}) };

const fromAt = args.indexOf('--from');
if (fromAt >= 0) {
  // Prebuilt addons (CI): each carries the stamp its build wrote. `gh run download`
  // puts every artifact in its own subfolder.
  const root = resolve(args[fromAt + 1] ?? fail('--from needs a directory'));
  const dirs = [root, ...readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, e.name))];
  const found = dirs.flatMap((dir) => addonsIn(dir).map((name) => ({ dir, name })));
  if (!found.length) fail(`no bfi_node.<platform>-<arch>.node in ${root} or its subfolders`);
  for (const { dir, name } of found) {
    const platform = platformOf(name);
    const stampFile = join(dir, `.bfi-build-stamp.${platform}.json`);
    if (!existsSync(stampFile)) fail(`${name} has no .bfi-build-stamp.${platform}.json beside it — it was not built by crates/bfi-node/build.mjs.`);
    const stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
    // The JS face is copied from the local checkout below: an addon built from another
    // commit would pair this face with a different native surface.
    if (stamp.commit !== state.commit) {
      fail(`${name} was built from ${String(stamp.commit).slice(0, 7)}, but ${sourceRepo} is at ${String(state.commit).slice(0, 7)} — check out the commit the workflow built.`);
    }
    copyFileSync(join(dir, name), join(vendorDir, name));
    platforms[platform] = { commit: stamp.commit, ...(stamp.dirty ? { dirty: true } : {}), sha256: hashFile(join(vendorDir, name)) };
  }
} else {
  // This machine's platform, built now.
  console.log(`[bfi-node] node ${crate}/build.mjs  (in ${sourceRepo})`);
  const run = spawnSync('node', [join(...crate.split('/'), 'build.mjs')], { cwd: sourceRepo, stdio: 'inherit' });
  if (run.status !== 0) fail('the addon build failed (is the Rust toolchain installed?).');
  const name = `bfi_node.${process.platform}-${process.arch}.node`;
  if (!existsSync(join(crateDir, name))) fail(`${join(crateDir, name)} is missing — the build did not produce it.`);
  copyFileSync(join(crateDir, name), join(vendorDir, name));
  platforms[`${process.platform}-${process.arch}`] = {
    commit: state.commit || 'unknown',
    ...(state.dirty ? { dirty: true } : {}),
    sha256: hashFile(join(vendorDir, name)),
  };
}

for (const name of FACE_FILES) copyFileSync(join(crateDir, name), join(vendorDir, name));
const built = JSON.parse(readFileSync(join(crateDir, 'package.json'), 'utf8'));
const manifestPath = join(vendorDir, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = built.version ?? manifest.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const record = {
  repository: 'SeanHogg/builderforce-inference',
  crate,
  commit: state.commit || 'unknown',
  ...(state.dirty ? { dirty: true } : {}),
  version: manifest.version,
  build: `node ${crate}/build.mjs [--target <rust triple>]`,
  files: Object.fromEntries(FACE_FILES.map((name) => [name, hashFile(join(vendorDir, name))])),
  platforms: Object.fromEntries(Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(sourceRecordPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  `[bfi-node] vendored the JS face + ${Object.keys(platforms).join(', ')} from ${record.commit.slice(0, 7)}${state.dirty ? ' (dirty)' : ''} → packages/bfi-node`,
);
