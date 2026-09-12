import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases, sourcePackageRoots } from '../../scripts/sourcePackages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
/** Every source-consumed shared package whose NodeNext `./x.js` imports need rewriting.
 *  Derived from the manifests, exactly as `esbuild.mjs` derives them — one registry,
 *  both toolchains, so the harness runs the same sources the VSIX bundles. */
const tsSourcePackageRoots = sourcePackageRoots(repoRoot);

/** Map that package's NodeNext `./x.js` relative imports onto the real `./x.ts` source.
 *  Scoped to it by importer path, so nothing else is affected. Mirrors the esbuild
 *  plugin in `esbuild.mjs` — same rule, same scope. */
const agentToolsTsResolve = {
  name: 'agent-tools-ts-resolve',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.endsWith('.js') || !tsSourcePackageRoots.some((root) => importer.startsWith(root))) return null;
    const tsPath = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
    return fs.existsSync(tsPath) ? tsPath : null;
  },
};

export default defineConfig({
  plugins: [agentToolsTsResolve],
  resolve: {
    // The same set `esbuild.mjs` bundles with, from the same registry. Subpath
    // exports are included and anchored: `@builderforce/agent-tools/node-path` is
    // agent-tools' node-only export condition (the shared workspace-containment
    // resolver), and losing it takes out the whole harness suite the moment
    // `localCapabilities.ts` imports it.
    alias: sourcePackageAliases(repoRoot),
  },
  test: {
    // The harness drives the run loop headlessly — no DOM, no extension host.
    environment: 'node',
    include: ['harness/**/*.test.ts', 'src/**/*.test.ts', 'webview/src/**/*.test.ts'],
    passWithNoTests: true,
    // The default worker count is the runner's CPU count (4 on the release job's
    // `ubuntu-latest`). Each worker independently re-imports this suite's aliased
    // source packages, and with `NODE_OPTIONS=--max-old-space-size=6144` set on
    // that job, 4 concurrent workers can reserve up to 24 GiB against a 16 GiB
    // box — trading the V8 heap-limit crash this was raised to fix for a
    // harder-to-diagnose OS OOM-kill instead. Capping concurrency keeps the
    // worst case under the runner's budget. (`poolOptions.forks.maxForks` was
    // vitest 3; vitest 4 moved this to a top-level option.)
    maxWorkers: 2,
  },
});
