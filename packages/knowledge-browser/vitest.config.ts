/**
 * The package's own test run (`npm test` here) — the same arrangement as
 * `packages/knowledge-graph-view/vitest.config.ts`, for the same Windows reason (a test
 * file outside the runner's root fails to load from the frontend suite).
 *
 * The package is source-only and installs nothing: memory, react (through the view),
 * vitest itself live in the HOST's `frontend/node_modules`. One resolver rule re-resolves
 * every bare import made from inside a source-only package as if the frontend had made
 * it. The source-only packages this one imports (`@builderforce/agent-tools/knowledge`,
 * `@builderforce/knowledge-graph-view`) are aliased from the ONE registry
 * (`scripts/sourcePackages.mjs`), with their NodeNext `./x.js` imports mapped to `./x.ts`.
 *
 * No `vitest/config` import: that module, too, only exists in the frontend's install.
 *
 * The API suite also runs every source-only package's `*.test.ts` (api/vitest.config.ts),
 * where there is no React: so no test here imports the view's runtime (only its types),
 * and the labels mapper is tested where the catalogs live (frontend `labels.test.ts`,
 * Rovr's `KnowledgeView.test.tsx`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourcePackageAliases, sourcePackageRoots } from '../../scripts/sourcePackages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const FRONTEND = path.resolve(REPO, 'frontend');
/** Any path inside the frontend works as the importer: resolution starts from its directory. */
const FRONTEND_IMPORTER = path.join(FRONTEND, 'package.json');

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
const isBare = (id: string): boolean => !/^(\.|\/|\\|\0|[A-Za-z]:|virtual:|node:)/.test(id);
/** This package and every source-only package it reaches: none has an install of its own. */
const SOURCE_ROOTS = [HERE, ...sourcePackageRoots(REPO)].map(norm);
const fromSourcePackage = (importer: string): boolean => SOURCE_ROOTS.some((root) => norm(importer).startsWith(root));

interface ResolveContext {
  resolve(source: string, importer?: string, options?: Record<string, unknown>): Promise<unknown>;
}

const peersFromHost = {
  name: 'knowledge-browser:peers-from-host',
  enforce: 'pre' as const,
  async resolveId(this: ResolveContext, source: string, importer: string | undefined, options: Record<string, unknown>) {
    if (!importer || !fromSourcePackage(importer)) return null;
    if (source.endsWith('.js') && !isBare(source)) {
      // NodeNext source packages spell `./x.ts` as `./x.js`.
      const ts = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
      if (fs.existsSync(ts)) return ts;
    }
    if (!isBare(source)) return null;
    return this.resolve(source, FRONTEND_IMPORTER, { ...options, skipSelf: true });
  },
};

export default {
  root: HERE,
  plugins: [peersFromHost],
  resolve: { alias: sourcePackageAliases(REPO) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    testTimeout: 30_000,
  },
};
