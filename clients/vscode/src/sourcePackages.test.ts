import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSourcePackages } from '../../../scripts/sourcePackages.mjs';
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
 * The JS-side lists are now derived (`scripts/sourcePackages.mjs`). This guard
 * covers what a module cannot reach: the `tsconfig` `paths` that stay JSON, and
 * the canvas bundle actually being wired to the registry rather than to a fresh
 * hand-written copy of it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const sourcePackages = readSourcePackages(repoRoot);
const specifiers = sourcePackages.map((pkg) => pkg.specifier);

/** Projects that resolve these packages through tsconfig `paths` (tsc, Next, wrangler). */
const PATHS_PROJECTS = [
  { tsconfig: 'api/tsconfig.json', sources: ['api/src'] },
  { tsconfig: 'frontend/tsconfig.json', sources: ['frontend/src'] },
  { tsconfig: 'clients/vscode/tsconfig.json', sources: ['clients/vscode/src'] },
];

function readTsconfigPaths(tsconfigPath: string): Record<string, string[]> {
  const parsed = JSON.parse(readFileSync(join(repoRoot, tsconfigPath), 'utf8'));
  return parsed.compilerOptions?.paths ?? {};
}

/**
 * Resolve a bare specifier the way tsc does — exact key first, then the longest
 * matching `prefix/*` key with its capture substituted into the target.
 */
function resolveThroughPaths(paths: Record<string, string[]>, tsconfigPath: string, specifier: string): string | null {
  const from = dirname(join(repoRoot, tsconfigPath));
  const exact = paths[specifier]?.[0];
  if (exact) return resolve(from, exact);

  const wildcards = Object.keys(paths)
    .filter((key) => key.endsWith('/*') && specifier.startsWith(key.slice(0, -1)))
    .sort((a, b) => b.length - a.length);
  for (const key of wildcards) {
    const target = paths[key]?.[0];
    if (!target) continue;
    return resolve(from, target.replace('*', specifier.slice(key.length - 1)));
  }
  return null;
}

/**
 * A `paths` target is written the way tsc reads it, which is not always the file
 * name: a wildcard target (`…/src/*`) stops at the extensionless path and tsc
 * appends the extension itself. Both spellings point at the same source.
 */
function resolvesTo(candidate: string | null, entry: string | undefined): boolean {
  if (!candidate || !entry) return false;
  return [candidate, `${candidate}.ts`, `${candidate}.tsx`, join(candidate, 'index.ts')].includes(entry);
}

/** Every source-only specifier imported anywhere under `dir`. */
function importedSpecifiers(dir: string): Set<string> {
  const found = new Set<string>();
  const pending = [join(repoRoot, dir)];
  while (pending.length) {
    const current = pending.pop() as string;
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name !== 'node_modules') pending.push(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(dirent.name)) continue;
      const source = readFileSync(full, 'utf8');
      if (!source.includes('@builderforce/')) continue;
      for (const [, specifier] of source.matchAll(/(?:from|import|require)\s*\(?\s*['"](@builderforce\/[^'"]+)['"]/g)) {
        if (specifiers.includes(specifier)) found.add(specifier);
      }
    }
  }
  return found;
}

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

  it.each(PATHS_PROJECTS)('$tsconfig declares every source-only package it imports', ({ tsconfig, sources }) => {
    const paths = readTsconfigPaths(tsconfig);
    const byEntry = new Map(sourcePackages.map((pkg) => [pkg.specifier, pkg.entry]));

    const unresolved = [...new Set(sources.flatMap((dir) => [...importedSpecifiers(dir)]))]
      .filter((specifier) => !resolvesTo(resolveThroughPaths(paths, tsconfig, specifier), byEntry.get(specifier)));
    expect(unresolved).toEqual([]);
  });

  it.each(PATHS_PROJECTS)('$tsconfig has no stale @builderforce path', ({ tsconfig }) => {
    const paths = readTsconfigPaths(tsconfig);
    const byEntry = new Map(sourcePackages.map((pkg) => [pkg.specifier, pkg.entry]));

    const wrong = Object.keys(paths)
      .filter((key) => key.startsWith('@builderforce/') && !key.endsWith('/*'))
      .filter((key) => !byEntry.has(key) || !resolvesTo(resolveThroughPaths(paths, tsconfig, key), byEntry.get(key)));
    expect(wrong).toEqual([]);
  });

  it('aliases in the canvas bundle every package the frontend imports', () => {
    // The bundle compiles `frontend/src` outside the frontend's own resolution,
    // so a package the web resolves through tsconfig `paths` reaches rollup as a
    // bare specifier and fails the release build unless it is aliased here.
    const alias = canvasConfig.resolve?.alias;
    expect(Array.isArray(alias)).toBe(true);

    const aliased = (alias as { find: string | RegExp; replacement: string }[]).filter(
      (entry) => entry.find instanceof RegExp,
    );
    const unaliased = [...importedSpecifiers('frontend/src')].filter(
      (specifier) => !aliased.some((entry) => (entry.find as RegExp).test(specifier)),
    );
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
});
