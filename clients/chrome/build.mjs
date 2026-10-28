/**
 * Builds Rovr — the Chrome (MV3) extension — into `dist/extension/`, the folder Chrome
 * loads unpacked and `package.mjs` zips for the Web Store.
 *
 * Three bundles, one esbuild run each. The service worker and the content script are
 * single files (an MV3 content script cannot import a chunk, and the worker stays one
 * module); the SIDE PANEL is code-split — an extension page loads ES modules
 * (`static/sidepanel.html` uses `<script type="module">`), so the page engines' heavy
 * dependencies (`@mlc-ai/web-llm`, ~6 MB) stay lazy chunks under `chunks/`, parsed only
 * when a WebLLM model is downloaded or run, never on every panel open:
 *
 *   background.js   the service worker — side-panel behaviour, the sync outbox that
 *                   owns every network write, alarms that wake it to replay a backlog
 *   content.js      the page agent — injected on demand into an ALLOWED site only
 *   sidepanel.js    the run host + the React side panel (BrainTimeline transcript)
 *
 * Resolution mirrors `clients/vscode/esbuild.mjs`: the source-only shared packages are
 * aliased from the ONE registry (`scripts/sourcePackages.mjs`) and their NodeNext
 * `./x.js` imports are mapped to `./x.ts`. React is pinned to THIS package's copy so the
 * linked `brain-ui` / `brain-embedded` dists (each with its own dev install) never pull
 * in a second React.
 *
 * The transcript's copy is the web app's own `brain.timeline` catalog, and the Knowledge
 * view's its `knowledgeGraph` catalog — each trimmed to its namespace for all five locales
 * and served as a virtual module (`webCatalogs` below): the same strings the web renders,
 * never a second translation of them.
 *
 * The Knowledge view (PRD 38 WS6) is a lazy chunk of the side panel, and its 3D scene
 * (three.js, @react-three/*) a lazy chunk of that — the panel's entry never grows by
 * either. Its review worker is an entry of its own (`knowledgeReview.js`).
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourcePackageAliasMap, sourcePackageRoots } from '../../scripts/sourcePackages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const production = process.argv.includes('--production');
const outDir = path.join(here, 'dist', 'extension');

const manifestPkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

/** The five locales the platform ships, as the web catalogs name them. */
const CATALOG_LOCALES = ['en', 'de', 'es', 'fr', 'zh'];

const tsSourcePackageRoots = sourcePackageRoots(repoRoot);

/** Map a source-only package's NodeNext `./x.js` import onto its real `./x.ts`. */
const sharedPackageTsResolve = {
  name: 'shared-package-ts-resolve',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!tsSourcePackageRoots.some((root) => args.importer.startsWith(root))) return undefined;
      const tsPath = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, '.ts'));
      return fs.existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

/**
 * The web catalogs' namespaces Rovr renders verbatim, each served as a virtual module of
 * `{ en: {...}, de: {...}, … }` trimmed to that namespace — the same strings the web
 * renders, never a second translation of them:
 *
 *   virtual:rovr-timeline-catalogs    `brain.timeline` — the transcript (main bundle)
 *   virtual:rovr-knowledge-catalogs   `knowledgeGraph` — the Knowledge view (its lazy chunk,
 *                                     fed to `@builderforce/knowledge-browser`'s labels mapper)
 */
const WEB_CATALOG_NAMESPACES = {
  'virtual:rovr-timeline-catalogs': (messages) => messages?.brain?.timeline ?? {},
  'virtual:rovr-knowledge-catalogs': (messages) => messages?.knowledgeGraph ?? {},
};

const webCatalogs = {
  name: 'rovr-web-catalogs',
  setup(build) {
    build.onResolve({ filter: /^virtual:rovr-[a-z]+-catalogs$/ }, (args) =>
      (args.path in WEB_CATALOG_NAMESPACES ? { path: args.path, namespace: 'rovr-virtual' } : undefined));
    build.onLoad({ filter: /.*/, namespace: 'rovr-virtual' }, (args) => {
      const pick = WEB_CATALOG_NAMESPACES[args.path];
      const catalogs = {};
      for (const locale of CATALOG_LOCALES) {
        const file = path.join(repoRoot, 'frontend', 'src', 'i18n', 'messages', `${locale}.json`);
        catalogs[locale] = pick(JSON.parse(fs.readFileSync(file, 'utf8')));
      }
      return { contents: JSON.stringify(catalogs), loader: 'json' };
    });
  },
};

const nodeModule = (name) => path.join(here, 'node_modules', name);

const shared = {
  bundle: true,
  splitting: false,
  target: 'chrome120',
  platform: 'browser',
  sourcemap: production ? false : 'linked',
  minify: production,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
  // Source-only packages with PEERS and no install of their own
  // (`@builderforce/knowledge-graph-view`: three, @react-three/*, memory) resolve those
  // bare imports from THIS package's install — a fallback only, after node's own walk.
  nodePaths: [path.join(here, 'node_modules')],
  alias: {
    ...sourcePackageAliasMap(repoRoot),
    // One React for the whole panel — see the header.
    react: nodeModule('react'),
    'react-dom': nodeModule('react-dom'),
  },
  plugins: [sharedPackageTsResolve, webCatalogs],
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await Promise.all([
  esbuild.build({ ...shared, entryPoints: { background: 'src/background/serviceWorker.ts' }, format: 'esm', outdir: outDir }),
  esbuild.build({ ...shared, entryPoints: { content: 'src/content/pageAgent.ts' }, format: 'iife', outdir: outDir }),
  // The `bfi` engine's Web Worker (`BFI_WORKER_FILE`): the panel starts it on first use.
  esbuild.build({ ...shared, entryPoints: { bfiWorker: 'src/host/bfiWorker.ts' }, format: 'esm', outdir: outDir }),
  // The knowledge review's Web Worker (`KNOWLEDGE_WORKER_FILE`): the shared browser host's
  // worker entry, reached through the ONE registry like every other source-only import.
  esbuild.build({ ...shared, entryPoints: { knowledgeReview: shared.alias['@builderforce/knowledge-browser/worker'] }, format: 'esm', outdir: outDir }),
  esbuild.build({
    ...shared,
    entryPoints: { sidepanel: 'src/sidepanel/main.tsx' },
    format: 'esm',
    // Code-split (see the header): dynamic imports become lazy chunks beside the entry.
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    outdir: outDir,
    jsx: 'automatic',
    loader: { '.css': 'css' },
  }),
]);

// ── Static files ─────────────────────────────────────────────────────────────
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true });
copyDir(path.join(here, '_locales'), path.join(outDir, '_locales'));
fs.copyFileSync(path.join(here, 'static', 'sidepanel.html'), path.join(outDir, 'sidepanel.html'));

// The WebGPU `bfi` engine's binary (the vendored `@seanhogg/bfi-web`, PRD 34). esbuild has
// no asset pipeline for `new URL(…, import.meta.url)`, so the file is copied beside the
// bundles (`BFI_WASM_FILE` in src/config.ts names it) and the panel passes its
// `chrome.runtime.getURL` to the loader. The glue itself is bundled — reached through
// brain-embedded's `/bfi` entry — as a lazy chunk.
const bfiWasm = path.join(repoRoot, 'packages', 'bfi-web', 'bfi_web_bg.wasm');
if (!fs.existsSync(bfiWasm)) throw new Error(`[rovr] ${path.relative(repoRoot, bfiWasm)} is missing — run \`node scripts/vendor-bfi-web.mjs\``);
fs.copyFileSync(bfiWasm, path.join(outDir, 'bfi_web_bg.wasm'));

// The brand mark the web app already ships (no second icon pipeline): Chrome downscales
// it for the toolbar, the side panel header and the extensions page.
fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });
fs.copyFileSync(path.join(repoRoot, 'frontend', 'public', 'icon.png'), path.join(outDir, 'icons', 'icon-64.png'));
fs.copyFileSync(path.join(repoRoot, 'frontend', 'public', 'icon-192.png'), path.join(outDir, 'icons', 'icon-192.png'));

// The manifest carries the package version, so the two can never disagree.
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
manifest.version = manifestPkg.version;
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`[rovr] built ${manifestPkg.version} → ${path.relative(here, outDir)}`);
