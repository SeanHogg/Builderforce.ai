import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSourcePackages } from '../../../scripts/sourcePackages.mjs';
import { sourcePackageGraph } from '../../../scripts/sourcePackageGraph.mjs';
import canvasConfig from '../webview/vite.canvas.config';

/**
 * The source-only shared packages (`packages/*` whose `exports` point at `src/`)
 * ship no `dist`, so nothing resolves them by plain node resolution. Every
 * toolchain has to be told where they live, and the tellings used to be six
 * hand-written lists: two `tsconfig.json` `paths` blocks, three vitest configs
 * and the extension's esbuild alias map.
 *
 * Both drifts that cost a build looked identical: a package was wired everywhere
 * the author checked and missing from the one list they did not.
 * `@builderforce/learned-routing` reached `api/tsconfig.json` and not
 * `api/vitest.config.ts`; `@builderforce/ide-file-contract` reached both frontend
 * lists and not the VS Code canvas bundle, which compiles that same frontend
 * source — and the release build failed at `Rollup failed to resolve import`.
 *
 * WHAT THIS FILE COVERS, AND WHAT MOVED. The `tsconfig` `paths` rules — every
 * project resolving what it imports, the transitive closure over inter-package
 * edges, and no stale keys — now live in `scripts/check-source-package-graph.mjs`,
 * which DISCOVERS its projects instead of listing them; the list this file used
 * to keep named three and there are nine. What stays here is the one thing a node
 * guard cannot read: the canvas bundle's own vite config, which is TypeScript and
 * has to be imported to be inspected.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const sourcePackages = readSourcePackages(repoRoot);
const specifiers = sourcePackages.map((pkg) => pkg.specifier);

describe('source-only shared packages', () => {
  it('finds the packages that ship no dist', () => {
    // A registry that silently reads empty would make every assertion below pass.
    expect(specifiers).toContain('@builderforce/creation-canvas-contract');
    expect(specifiers).toContain('@builderforce/ide-file-contract');
    // Subpath exports are entries of their own — an alias for the package root
    // does not reach them.
    expect(specifiers).toContain('@builderforce/agent-tools/node-path');
    // A BUILT package resolves through its own `exports`; aliasing it at source
    // would bypass its entry point.
    expect(specifiers).not.toContain('@seanhogg/builderforce-brain-ui');
  });

  it('points every entry at a file that exists', () => {
    const missing = sourcePackages.filter((pkg) => !existsSync(pkg.entry)).map((pkg) => pkg.relative);
    expect(missing).toEqual([]);
  });

  it('aliases in the canvas bundle every package the frontend imports', async () => {
    // The bundle compiles `frontend/src` outside the frontend's own resolution,
    // so a package the web resolves through tsconfig `paths` reaches rollup as a
    // bare specifier and fails the release build unless it is aliased here.
    const alias = canvasConfig.resolve?.alias;
    expect(Array.isArray(alias)).toBe(true);

    const aliased = (alias as { find: string | RegExp; replacement: string }[]).filter(
      (entry) => entry.find instanceof RegExp,
    );
    const unaliased = specifiers.filter((specifier) => !aliased.some((entry) => (entry.find as RegExp).test(specifier)));
    expect(unaliased).toEqual([]);
  });

  it('aliases the canvas bundle at package source, not at a copy', () => {
    const alias = canvasConfig.resolve?.alias as { find: string | RegExp; replacement: string }[];
    const replacements = alias
      .map((entry) => entry.replacement)
      .filter((replacement) => replacement.split(sep).includes('packages'));

    // Every package replacement must BE a registry entry: a hand-written alias
    // that drifts from the manifest is the failure mode this registry replaced.
    const entries = new Set(sourcePackages.map((pkg) => pkg.entry));
    const strays = replacements.filter((replacement) => !entries.has(replacement)).map((r) => relative(repoRoot, r));
    expect(strays).toEqual([]);
    expect(replacements.length).toBe(sourcePackages.length);
  });

  it('has no import cycle between source-only packages', async () => {
    // A cycle cannot be split later without breaking every consumer at once, and
    // it makes the closure the tsconfig guard computes unbounded in practice.
    const graph = await sourcePackageGraph(repoRoot);
    expect(graph.cycles()).toEqual([]);
  });
});
