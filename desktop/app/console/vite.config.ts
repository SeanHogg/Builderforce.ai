import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvermindLabelBundles } from './labels';

/**
 * Builds Synapse's console bundle: ONE ES module, `../ui/vendor/evermind.js`, that the
 * window imports when the Evermind page first shows a workspace model. React, the shared
 * `<EvermindConsole>` and the web's brain-region derivation are compiled in; the window's
 * own UI stays plain modules with no build step.
 *
 * The console reaches the platform only through the `request` the window hands it
 * (Synapse's signed-in session, over IPC), so nothing here knows a URL or a token.
 */
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

/** `virtual:evermind-labels` — the five locales' console labels, derived at build time. */
function evermindLabels(): Plugin {
  const VIRTUAL = 'virtual:evermind-labels';
  const RESOLVED = '\0' + VIRTUAL;
  return {
    name: 'synapse-evermind-labels',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const { bundles, files } = buildEvermindLabelBundles(path.join(REPO_ROOT, 'clients/vscode'));
      for (const f of files) this.addWatchFile(f);
      return `export default ${JSON.stringify(bundles)};`;
    },
  };
}

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react(), evermindLabels()],
  resolve: {
    alias: [{ find: /^@\/lib\/evermindRegions$/, replacement: path.join(REPO_ROOT, 'frontend/src/lib/evermindRegions.ts') }],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(HERE, '../ui/vendor'),
    emptyOutDir: true,
    sourcemap: false,
    // The window loads one file on demand; nothing to split.
    lib: { entry: path.join(HERE, 'src/main.tsx'), formats: ['es'], fileName: () => 'evermind.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
