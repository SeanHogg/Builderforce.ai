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
  resolve: { alias: sourcePackageAliases(repoRoot) },
  test: {
    // Pure modules and fakes — no browser, no extension APIs.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
