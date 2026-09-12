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
    // source packages (brain-ui, studio, transformers, onnxruntime-web, mermaid,
    // xlsx, creation-canvas-contract, canvas-widget-protocol, …), so more than a
    // couple of concurrent workers can overcommit the runner. Capping at 2 keeps
    // the worst case bounded WITHOUT masking the actual OOM: `harness/scenarios.test.ts`
    // grows heap unboundedly on its own (confirmed 2026-09-12 — it is the one file
    // that never finishes, at 1 worker or 2, at a 6 GiB or 10 GiB ceiling; see the
    // Consolidated Gap Register). Serializing to 1 worker was tried and only bought
    // that one file more rope before hitting the same wall, at roughly double the
    // wall-clock — real fix is in that file, not here. (`poolOptions.forks.maxForks`
    // was vitest 3; vitest 4 moved this to a top-level option.)
    maxWorkers: 2,
  },
});
