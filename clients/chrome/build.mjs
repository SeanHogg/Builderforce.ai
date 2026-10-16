/**
 * Builds Rovr — the Chrome (MV3) extension — into `dist/extension/`, the folder Chrome
 * loads unpacked and `package.mjs` zips for the Web Store.
 *
 * Three bundles, one esbuild run each, no code splitting (an MV3 content script cannot
 * import a chunk, and the service worker must be one module):
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
 * The transcript's copy is the web app's own `brain.timeline` catalog, trimmed to that
 * namespace for all five locales and served as `virtual:rovr-timeline-catalogs` — the
 * same strings the web Brain panel renders, never a second translation of them.
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

/** `virtual:rovr-timeline-catalogs` — `{ en: {...}, de: {...}, … }` of `brain.timeline`. */
const timelineCatalogs = {
  name: 'rovr-timeline-catalogs',
  setup(build) {
    build.onResolve({ filter: /^virtual:rovr-timeline-catalogs$/ }, () => ({
      path: 'rovr-timeline-catalogs',
      namespace: 'rovr-virtual',
    }));
    build.onLoad({ filter: /.*/, namespace: 'rovr-virtual' }, () => {
      const catalogs = {};
      for (const locale of CATALOG_LOCALES) {
        const file = path.join(repoRoot, 'frontend', 'src', 'i18n', 'messages', `${locale}.json`);
        const messages = JSON.parse(fs.readFileSync(file, 'utf8'));
        catalogs[locale] = messages?.brain?.timeline ?? {};
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
  alias: {
    ...sourcePackageAliasMap(repoRoot),
    // One React for the whole panel — see the header.
    react: nodeModule('react'),
    'react-dom': nodeModule('react-dom'),
  },
  plugins: [sharedPackageTsResolve, timelineCatalogs],
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await Promise.all([
  esbuild.build({ ...shared, entryPoints: { background: 'src/background/serviceWorker.ts' }, format: 'esm', outdir: outDir }),
  esbuild.build({ ...shared, entryPoints: { content: 'src/content/pageAgent.ts' }, format: 'iife', outdir: outDir }),
  esbuild.build({
    ...shared,
    entryPoints: { sidepanel: 'src/sidepanel/main.tsx' },
    format: 'esm',
    outdir: outDir,
    jsx: 'automatic',
    loader: { '.css': 'css' },
  }),
]);

// ── Static files ─────────────────────────────────────────────────────────────
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true });
copyDir(path.join(here, '_locales'), path.join(outDir, '_locales'));
fs.copyFileSync(path.join(here, 'static', 'sidepanel.html'), path.join(outDir, 'sidepanel.html'));

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
