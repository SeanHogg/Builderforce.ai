import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// The SAME hash the extension host stamps (see esbuild.mjs), so the two ids are
// comparable rather than merely both present.
import { computeBuildId } from '../buildId.mjs';

/**
 * Builds the React Brain webview into `../media/webview/{index.js,index.css}`
 * (single, hashless filenames so the extension host can reference them with a
 * stable `asWebviewUri`). Relative base because the assets are loaded through
 * the webview's `vscode-webview://` resource URIs, not from a server root.
 */
export default defineConfig({
  // BUILD IDENTITY for the WEBVIEW HALF, stamped independently of the extension host's.
  //
  // Both halves ship inside one `.vsix`, so in a released install they are the same age
  // — but nothing PROVED that, and a report could not rule out the opposite. A developer
  // running `watch:webview` refreshes `media/webview` while `out/extension.js` keeps the
  // stamp from its last build, and a support report saying "version 2026.9.5" then
  // describes whichever half the reader assumed. Stamping both turns "are these the same
  // build?" into a comparison instead of an assumption: equal ids mean one artifact,
  // different ids name exactly which half is stale.
  define: {
    __BF_WEBVIEW_BUILD_ID__: JSON.stringify(computeBuildId(fileURLToPath(new URL('..', import.meta.url)))),
    __BF_WEBVIEW_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../media/webview', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
      },
    },
  },
});
