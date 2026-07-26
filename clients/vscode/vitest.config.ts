import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
// The shared `@builderforce/agent-tools` contract is consumed as SOURCE (it ships no
// dist), exactly as `esbuild.mjs` does for the extension bundle — so the harness runs
// the same tool definitions the VSIX does, not a copy.
const agentToolsRoot = path.resolve(here, '../../packages/agent-tools/src');

/** Map that package's NodeNext `./x.js` relative imports onto the real `./x.ts` source.
 *  Scoped to it by importer path, so nothing else is affected. Mirrors the esbuild
 *  plugin in `esbuild.mjs` — same rule, same scope. */
const agentToolsTsResolve = {
  name: 'agent-tools-ts-resolve',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.endsWith('.js') || !importer.startsWith(agentToolsRoot)) return null;
    const tsPath = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
    return fs.existsSync(tsPath) ? tsPath : null;
  },
};

export default defineConfig({
  plugins: [agentToolsTsResolve],
  resolve: {
    alias: { '@builderforce/agent-tools': path.join(agentToolsRoot, 'index.ts') },
  },
  test: {
    // The harness drives the run loop headlessly — no DOM, no extension host.
    environment: 'node',
    include: ['harness/**/*.test.ts', 'src/**/*.test.ts', 'webview/src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
