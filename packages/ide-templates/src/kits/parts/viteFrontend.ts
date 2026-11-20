/**
 * What the Vite frontends (React, Vue) share: the dev server on the kit's web port with
 * `/api` proxied to the kit's backend, and the npm-run fragment. The user's app source,
 * so deliberately not localized.
 */
import { BACKEND_INGRESS_PATH } from '@builderforce/app-detect/manifest';
import type { ManifestFragment } from '../types';
import { frontendFragment, KIT_API_PORT, KIT_WEB_PORT } from './fragments';

/** `vite.config.js` for a Vite frontend whose framework plugin is imported as `pluginImport` and called as `plugin`. */
export function viteProxyConfig(pluginImport: string, plugin: string): string {
  return `import { defineConfig } from 'vite';
${pluginImport}

// The API runs as its own service (builderforce.json → services.api); the dev server
// forwards /api to it, so the app calls a same-origin path everywhere.
export default defineConfig({
  plugins: [${plugin}],
  server: {
    port: ${KIT_WEB_PORT},
    proxy: { '${BACKEND_INGRESS_PATH}': 'http://localhost:${KIT_API_PORT}' },
  },
});`;
}

/** A Vite frontend's manifest fragment: `npm install`, then `npm run dev`. */
export const VITE_FRONTEND_FRAGMENT: ManifestFragment = frontendFragment({ runtime: 'node', command: 'npm run dev', install: 'npm install' });
