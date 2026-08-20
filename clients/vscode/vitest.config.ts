import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
// The shared `@builderforce/agent-tools` contract is consumed as SOURCE (it ships no
// dist), exactly as `esbuild.mjs` does for the extension bundle — so the harness runs
// the same tool definitions the VSIX does, not a copy.
const agentToolsRoot = path.resolve(here, '../../packages/agent-tools/src');
const runContextRoot = path.resolve(here, '../../packages/run-context/src');
/** Every source-consumed shared package whose NodeNext `./x.js` imports need rewriting.
 *  Mirrors `esbuild.mjs`'s `tsSourcePackageRoots` — one list, both toolchains. */
const tsSourcePackageRoots = [agentToolsRoot, runContextRoot];

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
    alias: {
      // Keep BOTH entries in step with `esbuild.mjs`'s `sharedPackageAliases`: the
      // `/node-path` subpath is agent-tools' node-only export condition (the shared
      // workspace-containment resolver). Without it a test that touches the local
      // capability provider fails to import at all, which took out the whole harness
      // suite the moment `localCapabilities.ts` started using it.
      '@builderforce/agent-tools/node-path': path.join(agentToolsRoot, 'node-path.ts'),
      '@builderforce/agent-tools': path.join(agentToolsRoot, 'index.ts'),
      '@builderforce/creation-canvas-contract': path.resolve(here, '../../packages/creation-canvas-contract/src/index.ts'),
      '@builderforce/run-context': path.join(runContextRoot, 'index.ts'),
    },
  },
  test: {
    // The harness drives the run loop headlessly — no DOM, no extension host.
    environment: 'node',
    include: ['harness/**/*.test.ts', 'src/**/*.test.ts', 'webview/src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
