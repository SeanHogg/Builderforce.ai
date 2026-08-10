import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasPaths, collectCanvasNamespaces } from './src/canvas/messageNamespaces';

/**
 * Builds the CREATION CANVAS webview into `../media/canvas/`.
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
 *
 * Separate from the Brain bundle (`vite.config.ts`) on purpose: the canvas pulls
 * in xyflow, xlsx and mermaid, and the chat panel should not pay for them.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FRONTEND_SRC = path.resolve(HERE, '../../../frontend/src');

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
  plugins: [react(), canvasMessages(), dropWasmAssets()],
  root: HERE,
  base: './',
  resolve: {
    alias: [
      { find: /^next-intl$/, replacement: path.join(HERE, 'src/shims/next-intl.ts') },
      { find: /^next\/navigation$/, replacement: path.join(HERE, 'src/shims/next-navigation.ts') },
      { find: /^next\/link$/, replacement: path.join(HERE, 'src/shims/next-link.tsx') },
      // Source-only shared package (no package.json — the web resolves it through
      // tsconfig paths), so the bundler needs it spelled out.
      {
        find: /^@builderforce\/creation-canvas-contract$/,
        replacement: path.resolve(HERE, '../../../packages/creation-canvas-contract/src/index.ts'),
      },
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
  define: {
    // The frontend reads build-time config from `process.env`. Vite has no
    // `process`, so the values the canvas closure touches are inlined here. The
    // API base is overridden at runtime by the host's `baseUrl` where it matters;
    // this is the fallback the module-level constants capture at import time.
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.NEXT_PUBLIC_AUTH_API_URL': JSON.stringify(process.env.BF_API_URL || 'https://api.builderforce.ai'),
    'process.env.NEXT_PUBLIC_WORKER_URL': JSON.stringify(''),
    'process.env.NEXT_PUBLIC_APP_URL': JSON.stringify('https://builderforce.ai'),
  },
  build: {
    outDir: path.resolve(HERE, '../media/canvas'),
    emptyOutDir: true,
    sourcemap: false,
    // 1.6 MB of canvas is expected; the warning is noise that hides real ones.
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: path.join(HERE, 'canvas.html'),
      output: {
        // Hashless names so the host can build stable `asWebviewUri`s. Dynamic
        // imports stay SPLIT (unlike the Brain bundle): the Evermind engines, the
        // voice studio and mermaid are lazily loaded by features most sessions
        // never open, and inlining them would triple the panel's start-up cost.
        entryFileNames: 'index.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'index.[ext]',
      },
    },
  },
});
