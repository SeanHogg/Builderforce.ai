import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';
import { build as viteBuild, type Plugin } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pinnedInstallResolve, pinnedInstallVitePlugin } from '../../../../scripts/sourcePackages.mjs';
import webviewConfig from '../../webview/vite.config';

/**
 * REGRESSION: VSIX 2026.10.174 bundled the consumer's memory 2026.10.81 for its own imports and
 * agent-tools' own `node_modules` copy (2026.10.80, the old O(n·m) `.gitignore` matcher) for the
 * knowledge index — a source-only package's bare imports resolve by node's walk from ITS directory,
 * and `nodePaths`/`dedupe` never got a say. The pin must make the consumer's copy the ONLY copy,
 * for the package root AND its subpath exports, in both bundlers that ship the extension.
 *
 * Fixture: a consumer with memory "A" installed, and a source package `packages/x` with its own
 * memory "B" installed beside it, importing the root, a subpath and the engine.
 */
const MEMORY = '@seanhogg/builderforce-memory';
const ENGINE = '@seanhogg/builderforce-memory-engine';

let root: string;
let consumer: string;
let entry: string;

function write(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function installCopy(nodeModules: string, tag: string): void {
  const memory = join(nodeModules, ...MEMORY.split('/'));
  write(
    join(memory, 'package.json'),
    JSON.stringify({
      name: MEMORY,
      version: tag === 'A' ? '2026.10.82' : '2026.10.80',
      type: 'module',
      exports: {
        '.': { import: './dist/index.js', default: './dist/index.js' },
        './knowledge': { import: './dist/knowledge/index.js', default: './dist/knowledge/index.js' },
      },
    }),
  );
  write(join(memory, 'dist', 'index.js'), `export const memoryRoot = 'memory-root-${tag}';\n`);
  write(join(memory, 'dist', 'knowledge', 'index.js'), `export const memoryKnowledge = 'memory-knowledge-${tag}';\n`);

  const engine = join(nodeModules, ...ENGINE.split('/'));
  write(join(engine, 'package.json'), JSON.stringify({ name: ENGINE, version: '1.0.0', type: 'module', exports: { '.': './index.js' } }));
  write(join(engine, 'index.js'), `export const engineRoot = 'engine-root-${tag}';\n`);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pinned-install-'));
  consumer = join(root, 'consumer');
  write(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' }));
  installCopy(join(consumer, 'node_modules'), 'A');

  const pkg = join(root, 'packages', 'x');
  write(join(pkg, 'package.json'), JSON.stringify({ name: 'x', type: 'module' }));
  installCopy(join(pkg, 'node_modules'), 'B');
  write(
    join(pkg, 'src', 'index.js'),
    [
      `import { memoryRoot } from '${MEMORY}';`,
      `import { memoryKnowledge } from '${MEMORY}/knowledge';`,
      `import { engineRoot } from '${ENGINE}';`,
      'export const seen = [memoryRoot, memoryKnowledge, engineRoot];',
    ].join('\n'),
  );

  entry = join(consumer, 'entry.js');
  write(entry, `import { seen } from '../packages/x/src/index.js';\nconsole.log(seen);\n`);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

async function esbuildBundle(plugins: esbuild.Plugin[]): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins,
  });
  return result.outputFiles.map((file) => file.text).join('\n');
}

async function viteBundle(plugins: Plugin[], dedupe: string[] = []): Promise<string> {
  const output = await viteBuild({
    configFile: false,
    root: consumer,
    logLevel: 'silent',
    plugins,
    resolve: { dedupe },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'out' },
    },
  });
  const outputs = Array.isArray(output) ? output : [output];
  return outputs
    .flatMap((o) => ('output' in o ? o.output : []))
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
}

describe('pinnedInstallResolve (esbuild)', () => {
  it('reproduces the regression without the pin: the source package bundles its own copy', async () => {
    const text = await esbuildBundle([]);
    expect(text).toContain('memory-root-B');
    expect(text).toContain('memory-knowledge-B');
    expect(text).toContain('engine-root-B');
  });

  it("bundles the consumer's copy for the root, the subpath and the engine", async () => {
    const text = await esbuildBundle([pinnedInstallResolve(consumer)]);
    expect(text).toContain('memory-root-A');
    expect(text).toContain('memory-knowledge-A');
    expect(text).toContain('engine-root-A');
    expect(text).not.toMatch(/-B'|-B"/);
  });
});

describe('pinnedInstallVitePlugin (vite/rollup)', () => {
  it("reproduces the shipped webview's gap: deduping memory alone still bundles the source package's engine", async () => {
    // The webview config shipped `resolve.dedupe: [memory]`, which already picked the
    // consumer's memory (root and subpath) — the engine was never listed, so its copy leaked.
    const text = await viteBundle([], [MEMORY]);
    expect(text).toContain('memory-root-A');
    expect(text).toContain('memory-knowledge-A');
    expect(text).toContain('engine-root-B');
  }, 30_000);

  it("bundles the consumer's copy for the root, the subpath and the engine", async () => {
    const text = await viteBundle([pinnedInstallVitePlugin(consumer)]);
    expect(text).toContain('memory-root-A');
    expect(text).toContain('memory-knowledge-A');
    expect(text).toContain('engine-root-A');
    expect(text).not.toMatch(/-B'|-B"/);
  }, 30_000);

  it('is wired into the webview bundle, its workers included, and memory is no longer merely deduped', () => {
    const names = (plugins: unknown): string[] =>
      (plugins as unknown[]).flat(Infinity).map((p) => (p && typeof p === 'object' && 'name' in p ? String(p.name) : ''));
    expect(names(webviewConfig.plugins ?? [])).toContain('pinned-install-resolve');
    const workerPlugins = webviewConfig.worker?.plugins;
    expect(typeof workerPlugins).toBe('function');
    expect(names((workerPlugins as () => unknown[])())).toContain('pinned-install-resolve');
    expect(webviewConfig.resolve?.dedupe ?? []).not.toContain(MEMORY);
  });
});
