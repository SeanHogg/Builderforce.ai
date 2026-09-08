import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasPaths, collectCanvasNamespaces } from './src/canvas/messageNamespaces';
import { sourcePackageAliases } from '../../../scripts/sourcePackages.mjs';
// The SAME hash the extension host stamps (see esbuild.mjs), so the two ids are
// comparable rather than merely both present.
import { computeBuildId } from '../buildId.mjs';

/**
 * Builds THE webview into `../media/webview/`.
 *
 * ── WHY THERE IS ONLY ONE OF THESE NOW ───────────────────────────────────────
 * There used to be two configs, because there were two webviews: a hand-rolled
 * chat panel and a Creation Canvas panel. That split was the editor asserting
 * something the product does not believe — that a chat and a canvas are different
 * kinds of place. They are not: chat is the canvas's zero-object SURFACE
 * (`frontend/src/lib/canvasSurfaces.ts`), and the editor now renders one panel
 * whose centre is whichever surface the user is on.
 *
 * The old split had one real argument behind it: the canvas pulls in xyflow, xlsx
 * and mermaid, and a chat panel should not pay to parse them. The merge ANSWERS that
 * argument by dissolving it — there is no chat panel any more, only a board opened at
 * its chat surface, so the board is the app in both cases and the entry chunk is the
 * board's. Opening at chat now costs what opening the canvas always cost.
 *
 * What the merge removes is the duplication: a second React runtime, a second
 * Tailwind pipeline, a second HTML shell, a second copy of every shared component.
 * What code-splitting still buys is the OPTIONAL heavy features — the Evermind
 * engines, the voice studio, mermaid, the 3D world — which most sessions never open
 * and which stay out of the entry (see `output` below).
 *
 * The canvas rendered in VS Code is not a port of the web canvas — it IS the web
 * canvas. This config compiles `frontend/src/components/creation-canvas/**` and
 * its ~118-module import closure directly, so there is exactly one implementation
 * of the board, the 66 object kinds, the inspector, the Brain dock, the 3D view,
 * the workflow editor and the Evermind adapter studio. A feature added on the web
 * appears here on the next build; there is no second copy to keep in sync.
 *
 * Three things stand between that source and a plain Vite bundle, and all three
 * are handled by alias:
 *
 *   next-intl       → `use-intl`, which is what next-intl's client hooks re-export
 *   next/navigation → a router that hands navigations to the extension host
 *   next/link       → an anchor that does the same
 *
 * Everything else in the closure is ordinary client React and `fetch`, including
 * the API client — it authenticates through `setEmbedAuth()`, the token override
 * `auth.ts` already exposes for embedded surfaces.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src');

/**
 * Supplies `virtual:bf-canvas-messages` — the web message catalogs trimmed to the
 * namespaces the canvas actually reads, for all five locales.
 *
 * Both halves are derived from source at build time: the catalogs are read from
 * `frontend/src/i18n/messages` (never a committed copy, so editor strings cannot
 * drift from web strings) and the namespace set is computed by walking the
 * canvas import closure (so a namespace added on the web needs no change here).
 */
function canvasMessages(): Plugin {
  const VIRTUAL = 'virtual:bf-canvas-messages';
  const RESOLVED = '\0' + VIRTUAL;
  const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;
  return {
    name: 'bf-canvas-messages',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const { frontendSrc, entry } = canvasPaths(HERE);
      const namespaces = collectCanvasNamespaces(entry, frontendSrc);
      const bundle: Record<string, Record<string, unknown>> = {};
      for (const locale of LOCALES) {
        const file = path.join(FRONTEND_SRC, `i18n/messages/${locale}.json`);
        // Rebuild when a catalog changes (matters for `--watch`).
        this.addWatchFile(file);
        const catalog = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        const trimmed: Record<string, unknown> = {};
        for (const namespace of namespaces) {
          if (catalog[namespace] !== undefined) trimmed[namespace] = catalog[namespace];
        }
        bundle[locale] = trimmed;
      }
      this.info(`trimmed catalogs to ${namespaces.length} namespaces`);
      return `export default ${JSON.stringify(bundle)};`;
    },
  };
}

/**
 * Keeps the ONNX runtime's `.wasm` OUT of the package.
 *
 * `onnxruntime-web` locates its runtime with `new URL('….wasm', import.meta.url)`,
 * which Vite turns into an emitted asset — ~21 MB, for on-device voice cloning,
 * in every VSIX download and every update. The canvas instead points the runtime
 * at the BuilderForce origin (`CanvasHost.wasmBaseUrl` → `configureOnnxRuntime`
 * in `voiceEngine.ts`), which is set before the runtime initialises, so the
 * emitted copy is never requested. Dropping it at `generateBundle` is what makes
 * that saving real.
 */
function dropWasmAssets(): Plugin {
  return {
    name: 'bf-drop-wasm',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'asset' && fileName.endsWith('.wasm')) delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  // BUILD IDENTITY for the WEBVIEW HALF, stamped independently of the extension
  // host's. Both halves ship inside one `.vsix`, so in a released install they are
  // the same age — but nothing PROVED that, and a developer running `watch:webview`
  // refreshes `media/webview` while `out/extension.js` keeps the stamp from its last
  // build. Stamping both turns "are these the same build?" into a comparison instead
  // of an assumption: equal ids mean one artifact, different ids name the stale half.
  define: {
    __BF_WEBVIEW_BUILD_ID__: JSON.stringify(computeBuildId(fileURLToPath(new URL('..', import.meta.url)))),
    __BF_WEBVIEW_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    // The frontend reads build-time config from `process.env`. Vite has no
    // `process`, so the values this closure touches are inlined here. The API base
    // is overridden at runtime by the host's `baseUrl` where it matters; this is the
    // fallback the module-level constants capture at import time.
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.NEXT_PUBLIC_AUTH_API_URL': JSON.stringify(process.env.BF_API_URL || 'https://api.builderforce.ai'),
    'process.env.NEXT_PUBLIC_WORKER_URL': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_APP_URL': JSON.stringify('https://builderforce.ai'),
  },
  plugins: [react(), canvasMessages(), dropWasmAssets()],
  root: HERE,
  base: './',
  resolve: {
    alias: [
      { find: /^next-intl$/, replacement: path.join(HERE, 'src/shims/next-intl.ts') },
      { find: /^next\/navigation$/, replacement: path.join(HERE, 'src/shims/next-navigation.ts') },
      { find: /^next\/link$/, replacement: path.join(HERE, 'src/shims/next-link.tsx') },
      // The source-only shared packages — the canvas contract, the IDE scaffolds
      // and the workspace file contract among them. They ship no `dist`, so the
      // web resolves them through tsconfig `paths` and a bundler has to be told.
      // Derived from the manifests (`scripts/sourcePackages.mjs`) rather than
      // listed: this config compiles the frontend's whole import closure, so a
      // package listed for the web and forgotten here fails the release build.
      ...sourcePackageAliases(REPO_ROOT),
      // The frontend's own path alias, so its modules resolve unchanged.
      { find: /^@\//, replacement: FRONTEND_SRC + '/' },
    ],
    // The canvas closure and this package both pull React in; two copies would
    // break hooks. Resolve to this package's single instance.
    dedupe: ['react', 'react-dom', '@xyflow/react'],
  },
  css: {
    postcss: path.join(HERE, 'postcss.canvas.config.js'),
  },
  build: {
    outDir: path.resolve(HERE, '../media/webview'),
    /**
     * ONE stylesheet.
     *
     * The HTML shell loads exactly one `<link>` (`renderWebviewHtml` → `index.css`),
     * which is all a webview needs — it reads from local disk, so there is nothing to
     * save by splitting. With splitting ON, every async chunk that carries CSS emits
     * its own file and Vite de-duplicates the names by counting: `index.css`,
     * `index2.css` … `index6.css`. The shell still loaded only the first, so whichever
     * styles landed in the others were simply never applied — which is how the chat
     * surface came out with an unstyled textarea and a vertically stacked composer.
     *
     * A single sheet also makes the cascade ORDER deterministic, which matters here:
     * the frontend's `globals.css`, the shared brain-ui stylesheet and this package's
     * own `index.css` all define overlapping ground, and "which file won" must not
     * depend on which chunk happened to load first.
     */
    cssCodeSplit: false,
    emptyOutDir: true,
    sourcemap: false,
    // 1.6 MB of canvas is expected; the warning is noise that hides real ones.
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: path.join(HERE, 'index.html'),
      output: {
        // Hashless names so the host can build stable `asWebviewUri`s. Dynamic
        // imports stay SPLIT: the Evermind engines, the voice studio, mermaid and
        // the 3D world are lazily loaded by features most sessions never open, and
        // inlining them would multiply the panel's start-up cost.
        entryFileNames: 'index.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'index.[ext]',
      },
    },
  },
});
