/**
 * What the webview's vite build READS and WRITES, hashed — the one place that decides whether
 * `media/webview/` is still the output of the current tree.
 *
 * A skipped build must never ship stale output (the bug behind VSIX 2026.10.97/98, see
 * `scripts/ensure-linked-builds.mjs`), so the stamp keys on a content hash of every input that
 * can change the output, and ANY doubt means "build":
 *
 *   modules  every file Rollup loaded, every source file of an emitted asset, and every watch file
 *            (CSS `@import`s, files plugins read) — the plugin in `buildInputsStamp.ts` lists them
 *   configs  the nearest package.json / tsconfig.json of each module and the tsconfig `extends`
 *            chains, and dirs: each module directory's listing (a new file can shadow an import)
 *            (`moduleNeighbours.mjs`)
 *   fixed    what no module list shows: the vite/postcss/tailwind configs, the manifests, lockfiles
 *            and installed-state files, the version files the config inlines, the i18n catalogs the
 *            virtual module reads, and every file Tailwind SCANS for class names
 *   meta     the vite and node versions, platform, the extension's build id (the `define`d
 *            `__BF_WEBVIEW_BUILD_ID__`), and the env the config reads (`BF_API_URL`, `VITE_*`)
 *   output   a hash of every file in `media/webview/`, so output changed behind the stamp's back
 *            (a `watch:webview` run, a git checkout) is detected, not trusted
 *
 * The stamp lives in `node_modules/.cache` — never in `media/webview/` (tracked, and shipped).
 * Plain ESM because `scripts/webview-build-if-changed.mjs` runs before any TypeScript compiles.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File, walkFiles } from '../../../scripts/lib/hashTree.mjs';
import { EXTRA_SOURCE_PACKAGE_DIRS } from '../../../scripts/sourcePackages.mjs';
import { computeBuildId } from '../buildId.mjs';
import { directoryListings, nearestConfigFiles } from './moduleNeighbours.mjs';

const WEBVIEW_DIR = fileURLToPath(new URL('.', import.meta.url));
const VSCODE_DIR = path.resolve(WEBVIEW_DIR, '..');
const REPO_ROOT = path.resolve(VSCODE_DIR, '../..');
const OUT_DIR = path.join(VSCODE_DIR, 'media', 'webview');
const STAMP_FILE = path.join(VSCODE_DIR, 'node_modules', '.cache', 'bf-webview-build', 'inputs.json');

const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const SKIP_DIRS = new Set(['node_modules', '.git']);
const MISSING = 'missing';
const STAMP_SCHEMA = 2;
/** The extensions `webview/tailwind.config.js` scans under the frontend (`{js,ts,jsx,tsx,mdx}`). */
const FRONTEND_SCANNED = /\.(js|ts|jsx|tsx|mdx)$/;
const WEBVIEW_SCANNED = /\.(ts|tsx)$/;
const MANIFEST_NAMES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json', '.npmrc'];
const INSTALL_STATE = ['node_modules/.pnpm/lock.yaml', 'node_modules/.modules.yaml'];

/**
 * The files `vite.config.ts` reads the versions it inlines from (`process.env.NEXT_PUBLIC_*_VERSION`),
 * in the order each is tried — the config reads them from here and the stamp hashes them from here.
 */
export function inlinedVersionFiles() {
  return {
    ui: [path.join(FRONTEND_DIR, 'package.json')],
    brain: [
      path.join(FRONTEND_DIR, 'node_modules/@seanhogg/builderforce-brain-embedded/package.json'),
      path.join(REPO_ROOT, 'brain-embedded/package.json'),
    ],
    runtime: [
      path.join(FRONTEND_DIR, 'node_modules/@seanhogg/builderforce-webcontainers/package.json'),
      path.resolve(REPO_ROOT, '../builderforce-webcontainers/packages/browser/package.json'),
    ],
  };
}

/** Posix path relative to the repo root (absolute when on another drive): the stamp's file key. */
function keyOf(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function hashFile(file) {
  try {
    return sha256File(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return MISSING;
    throw error;
  }
}

function byKey(entries) {
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** `{ key: sha256 }` sorted by key; null when a file changed after `notAfterMs` (it may not be what was built). */
function digestFiles(files, notAfterMs) {
  const entries = [];
  for (const file of new Set(files)) {
    if (notAfterMs !== undefined) {
      try {
        if (fs.statSync(file).mtimeMs > notAfterMs) return null;
      } catch {
        // a missing optional file is hashed as MISSING below
      }
    }
    entries.push([keyOf(file), hashFile(file)]);
  }
  return byKey(entries);
}

function listingDigest(files) {
  return byKey([...directoryListings(files)].map(([dir, hash]) => [keyOf(dir), hash]));
}

function readDirNames(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function tree(dir, accept) {
  return walkFiles(dir, { skipDirs: SKIP_DIRS, accept: (name) => accept.test(name) });
}

/** Inputs no module id reveals — see the file header. Missing optional files hash as `missing`. */
function fixedInputFiles() {
  const files = [
    ...['vite.config.ts', 'postcss.config.js', 'tailwind.config.js', 'tsconfig.json', 'tsconfig.canvas.json', 'index.html',
      'buildInputs.mjs', 'buildInputs.d.mts', 'buildInputsStamp.ts', 'moduleNeighbours.mjs', '.env', '.env.local', '.env.production', '.env.production.local'].map((name) => path.join(WEBVIEW_DIR, name)),
    path.join(VSCODE_DIR, 'buildId.mjs'),
    ...['hashTree.mjs', 'tsconfigPaths.mjs'].map((name) => path.join(REPO_ROOT, 'scripts/lib', name)),
    ...['sourcePackages.mjs', 'linkedPackages.mjs'].map((name) => path.join(REPO_ROOT, 'scripts', name)),
    ...['tsconfig.json', 'tailwind.config.js', 'postcss.config.js'].map((name) => path.join(FRONTEND_DIR, name)),
    ...Object.values(inlinedVersionFiles()).flat(),
  ];
  for (const dir of [REPO_ROOT, VSCODE_DIR, WEBVIEW_DIR, FRONTEND_DIR]) for (const name of MANIFEST_NAMES) files.push(path.join(dir, name));
  // The installed state, not only the lockfiles: what `pnpm install` actually put in node_modules.
  for (const dir of [VSCODE_DIR, FRONTEND_DIR]) for (const name of INSTALL_STATE) files.push(path.join(dir, name));
  // Source-only packages are aliased from their manifests (`sourcePackageAliases`).
  const packageDirs = [...readDirNames(path.join(REPO_ROOT, 'packages')).map((name) => `packages/${name}`), ...EXTRA_SOURCE_PACKAGE_DIRS];
  for (const dir of packageDirs) files.push(path.join(REPO_ROOT, ...dir.split('/'), 'package.json'));
  // The i18n catalogs the `virtual:bf-canvas-messages` module reads straight from disk.
  files.push(...tree(path.join(FRONTEND_DIR, 'src/i18n/messages'), /\.json$/));
  // Everything Tailwind scans for class names (`tailwind.config.js` `content`).
  files.push(...tree(path.join(WEBVIEW_DIR, 'src'), WEBVIEW_SCANNED));
  for (const sub of ['components', 'lib']) files.push(...tree(path.join(FRONTEND_DIR, 'src', sub), FRONTEND_SCANNED));
  return files;
}

/** The build's other inputs: tool versions, platform, the extension's build id and the env the config reads. */
function stampMeta(buildId = computeBuildId(VSCODE_DIR)) {
  const vite = createRequire(path.join(VSCODE_DIR, 'package.json'))('vite/package.json').version;
  const viteEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('VITE_')).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    schema: STAMP_SCHEMA, vite, node: process.versions.node, platform: process.platform, arch: process.arch,
    buildId, apiUrl: process.env.BF_API_URL || null, viteEnv,
  };
}

/** The real files among Rollup's module ids: no `\0` virtual ids, queries stripped, never the output dir. */
export function realModuleFiles(ids) {
  const files = new Set();
  for (const id of ids) {
    if (id.startsWith('\0')) continue;
    const file = id.split('?')[0];
    if (!path.isAbsolute(file)) continue;
    const abs = path.resolve(file);
    if (abs.startsWith(OUT_DIR + path.sep)) continue;
    try {
      if (fs.statSync(abs).isFile()) files.add(abs);
    } catch {
      // not on disk: nothing to hash
    }
  }
  return files;
}

export function removeStamp() {
  fs.rmSync(STAMP_FILE, { force: true });
}

/**
 * Records the inputs of the build that just wrote `media/webview/`. Returns false (and leaves NO
 * stamp) when any input changed after `startedAt`, since the output may then not match what was hashed.
 */
export function writeStamp({ moduleFiles, buildId, startedAt }) {
  removeStamp();
  const files = [...moduleFiles];
  const modules = digestFiles(files, startedAt);
  const configs = digestFiles([...nearestConfigFiles(files)], startedAt);
  const fixed = digestFiles(fixedInputFiles(), startedAt);
  if (!modules || !configs || !fixed) return false;
  const output = digestFiles([...walkFiles(OUT_DIR)]);
  fs.mkdirSync(path.dirname(STAMP_FILE), { recursive: true });
  fs.writeFileSync(STAMP_FILE, `${JSON.stringify({ meta: stampMeta(buildId), modules, configs, dirs: listingDigest(files), fixed, output })}\n`);
  return true;
}

/**
 * Why the webview must be rebuilt, or null when the stamp proves `media/webview/` is the output of
 * the current inputs. Throws on anything unreadable — the caller builds on a throw too.
 */
export function rebuildReason() {
  if (!fs.existsSync(OUT_DIR) || !fs.existsSync(STAMP_FILE)) return 'no output or no stamp';
  const stamp = JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'));
  if (JSON.stringify(stamp.meta) !== JSON.stringify(stampMeta())) return 'vite/node version, platform, build id or env changed';
  const files = Object.keys(stamp.modules).map((key) => path.resolve(REPO_ROOT, key));
  for (const [key, hash] of Object.entries(stamp.modules)) {
    if (hashFile(path.resolve(REPO_ROOT, key)) !== hash) return `${key} changed`;
  }
  if (JSON.stringify(stamp.fixed) !== JSON.stringify(digestFiles(fixedInputFiles()))) return 'a config, manifest, lockfile or scanned file changed';
  if (JSON.stringify(stamp.configs) !== JSON.stringify(digestFiles([...nearestConfigFiles(files)]))) return 'a package.json or tsconfig near a module changed';
  if (JSON.stringify(stamp.dirs) !== JSON.stringify(listingDigest(files))) return 'a module directory gained or lost a file';
  if (JSON.stringify(stamp.output) !== JSON.stringify(digestFiles([...walkFiles(OUT_DIR)]))) return 'media/webview does not match the stamped build';
  return null;
}
