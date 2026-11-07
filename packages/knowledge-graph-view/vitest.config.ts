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
import { readFileSync } from 'node:fs';
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

/**
 * `import css from './x.css?raw'` for tests that read a stylesheet's text (`tokens.test.tsx`). Vitest stubs every `.css`
 * module to an empty string unless CSS processing is on, and that includes `?raw`, so the test would read '' and find no
 * rule. This plugin serves such an id straight from disk, before the CSS stub sees it.
 */
const RAW_CSS_PREFIX = '\0kg-raw-css:';
// The virtual id must NOT end in `.css`: vitest's CSS plugin matches ids by that suffix at the transform step and would stub it to ''.
const RAW_CSS_SUFFIX = '.raw.js';
const rawCss = {
  name: 'knowledge-graph-view:raw-css',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.css?raw')) return null;
    const file = source.slice(0, -'?raw'.length);
    return RAW_CSS_PREFIX + path.resolve(importer ? path.dirname(importer.split('?')[0]!) : HERE, file) + RAW_CSS_SUFFIX;
  },
  load(id: string) {
    if (!id.startsWith(RAW_CSS_PREFIX)) return null;
    return `export default ${JSON.stringify(readFileSync(id.slice(RAW_CSS_PREFIX.length, -RAW_CSS_SUFFIX.length), 'utf8'))};`;
  },
};

export default {
  root: HERE,
  // No `resolve.dedupe`: it resolves from `root`, which here has no node_modules. The peers'
  // own imports already land on the same (pnpm, realpath) copies the rule above picks.
  plugins: [rawCss, peersFromHost],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist/**'],
    // testing-library unmounts between tests only when `afterEach` is global.
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // The whole-view flows run role queries over 2000-node lists with the Act rail's Details (Insights charts) open; alone they take
    // 15-25s, and under the parallel suite that passed 30s.
    testTimeout: 60_000,
  },
};
