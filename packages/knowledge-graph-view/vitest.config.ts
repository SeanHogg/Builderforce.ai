/**
 * The view's own test run (`npm test` here), so its React tests no longer ride the
 * frontend suite — where, run from a root outside this package, Windows failed to load
 * them at all (`Cannot find module '/@fs/C:/…/src/….test.tsx'`).
 *
 * The package is source-only and installs nothing: react, react-dom, three, the r3f
 * peers, memory, testing-library, jsdom and vitest itself live in the HOST's
 * `frontend/node_modules`. Rather than alias each one (and every subpath export, e.g.
 * `@seanhogg/builderforce-memory/knowledge`, `react/jsx-dev-runtime`), one resolver rule
 * re-resolves every bare import made from inside this package as if the frontend had
 * made it — node resolution with `exports` conditions, from there. One copy of each peer,
 * exactly the copy the web host bundles.
 *
 * No `vitest/config` import: that module, too, only exists in the frontend's install.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '../../frontend');
/** Any path inside the frontend works as the importer: resolution starts from its directory. */
const FRONTEND_IMPORTER = path.join(FRONTEND, 'package.json');

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
const isBare = (id: string): boolean => !/^(\.|\/|\\|\0|[A-Za-z]:|virtual:|node:)/.test(id);

interface ResolveContext {
  resolve(source: string, importer?: string, options?: Record<string, unknown>): Promise<unknown>;
}

const peersFromHost = {
  name: 'knowledge-graph-view:peers-from-host',
  enforce: 'pre' as const,
  async resolveId(this: ResolveContext, source: string, importer: string | undefined, options: Record<string, unknown>) {
    if (!importer || !isBare(source) || !norm(importer).startsWith(norm(HERE))) return null;
    return this.resolve(source, FRONTEND_IMPORTER, { ...options, skipSelf: true });
  },
};

export default {
  root: HERE,
  // No `resolve.dedupe`: it resolves from `root`, which here has no node_modules. The peers'
  // own imports already land on the same (pnpm, realpath) copies the rule above picks.
  plugins: [peersFromHost],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist/**'],
    // testing-library unmounts between tests only when `afterEach` is global.
    globals: true,
    testTimeout: 30_000,
  },
};
