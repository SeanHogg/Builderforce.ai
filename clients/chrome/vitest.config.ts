import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases, sourcePackageRoots } from '../../scripts/sourcePackages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
/** The source-only packages' NodeNext `./x.js` imports, mapped onto `./x.ts` — the same
 *  rule `build.mjs` bundles with (and `clients/vscode/vitest.config.ts` tests with). */
const tsSourcePackageRoots = sourcePackageRoots(repoRoot);

const sharedPackageTsResolve = {
  name: 'shared-package-ts-resolve',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.endsWith('.js') || !tsSourcePackageRoots.some((root) => importer.startsWith(root))) return null;
    const tsPath = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
    return fs.existsSync(tsPath) ? tsPath : null;
  },
};

export default defineConfig({
  plugins: [sharedPackageTsResolve],
  resolve: {
    alias: [
      ...sourcePackageAliases(repoRoot),
      // The transcript catalogs `build.mjs` serves from the web's `brain.timeline` — a
      // component test reads the empty stand-in (every label falls back to its default).
      { find: 'virtual:rovr-timeline-catalogs', replacement: path.resolve(here, 'src/test/timelineCatalogsStub.ts') },
      // The Knowledge view's `knowledgeGraph` catalogs: the REAL web catalogs, trimmed the
      // way `build.mjs` trims them — the destination test holds Rovr's labels to the web's.
      { find: 'virtual:rovr-knowledge-catalogs', replacement: path.resolve(here, 'src/test/knowledgeCatalogs.ts') },
    ],
    // The `link:`ed brain packages resolve React from here too, so a component test has
    // ONE React (two copies break every hook).
    // The source-only `@builderforce/knowledge-graph-view` has PEERS and no install of its
    // own (three, @react-three/*, memory): they resolve from here too, as one copy.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'three', '@react-three/fiber', '@react-three/drei', '@seanhogg/builderforce-memory'],
  },
  test: {
    // Pure modules and fakes — no browser, no extension APIs. A component test
    // (`*.test.tsx`) opts into a DOM with its own `// @vitest-environment jsdom` line.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

