import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Builds the React Brain webview into `../media/webview/{index.js,index.css}`
 * (single, hashless filenames so the extension host can reference them with a
 * stable `asWebviewUri`). Relative base because the assets are loaded through
 * the webview's `vscode-webview://` resource URIs, not from a server root.
 */
export default defineConfig({
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
