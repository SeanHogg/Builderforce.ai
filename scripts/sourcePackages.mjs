import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The SOURCE-ONLY shared packages under `packages/` — the ones whose `exports`
 * point straight at TypeScript in `src/` because they are never built. They have
 * no `dist`, so a bundler that follows plain node resolution finds nothing;
 * every consumer has to spell the specifier out as an alias.
 *
 * That spelling-out is the whole reason this module exists. The set was written
 * by hand in five places — `api/tsconfig.json`, `api/vitest.config.ts`,
 * `frontend/tsconfig.json`, `frontend/vitest.config.ts` and the VS Code canvas
 * bundle — and the copies drifted twice. First `@builderforce/learned-routing`
 * reached `api/tsconfig.json` and not `api/vitest.config.ts`, so a directory run
 * of the LLM tests failed while the full suite passed. Then
 * `@builderforce/ide-file-contract` reached both frontend copies and not the
 * canvas bundle, which compiles that same frontend source — the extension's
 * release build failed on `Rollup failed to resolve import` with the package
 * already correctly wired everywhere the author had looked.
 *
 * So the JS-side copies are gone: every bundler and test runner derives its
 * aliases from `sourcePackageAliases()`, and the set itself is derived from the
 * manifests rather than listed here. A new source-only package is wired
 * everywhere the moment its `package.json` exists. The `tsconfig.json` `paths`
 * cannot import a module and so stay hand-written; `clients/vscode/src/
 * sourcePackages.test.ts` holds them to this registry.
 */

/** A subpath export is source-only when it resolves inside the package's `src/`. */
const SOURCE_ENTRY = './src/';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @typedef {object} SourcePackageEntry
 * @property {string} specifier   Bare import specifier, e.g. `@builderforce/agent-tools/node-path`.
 * @property {string} entry       Absolute path to the TypeScript source it resolves to.
 * @property {string} relative    The same path, repo-relative and POSIX-separated.
 */

/**
 * Every source-only export across `packages/`, subpath exports included.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {SourcePackageEntry[]} Sorted by specifier, so callers are stable.
 */
export function readSourcePackages(repoRoot) {
  const packagesDir = path.join(repoRoot, 'packages');
  /** @type {SourcePackageEntry[]} */
  const found = [];

  for (const dirent of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(packagesDir, dirent.name, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // A built package (`exports` → `dist`, or a conditional object) resolves on
    // its own and must NOT be aliased: doing so would bypass its entry point.
    if (!manifest.name || typeof manifest.exports !== 'object' || manifest.exports === null) continue;

    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target !== 'string' || !target.startsWith(SOURCE_ENTRY)) continue;
      const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//, '')}`;
      const relative = `packages/${dirent.name}/${target.replace(/^\.\//, '')}`;
      found.push({ specifier, entry: path.join(repoRoot, ...relative.split('/')), relative });
    }
  }

  return found.sort((a, b) => a.specifier.localeCompare(b.specifier));
}

/**
 * Vite/Vitest `resolve.alias` entries for every source-only package.
 *
 * Array form with anchored patterns, not the object form: an object alias
 * matches by PREFIX, so `@builderforce/agent-tools` would swallow
 * `@builderforce/agent-tools/node-path` and rewrite it to `…/src/index.ts/node-path`.
 * Anchoring each specifier keeps subpath exports resolvable and makes the
 * entries order-independent.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {{ find: RegExp, replacement: string }[]}
 */
export function sourcePackageAliases(repoRoot) {
  return readSourcePackages(repoRoot).map(({ specifier, entry }) => ({
    find: new RegExp(`^${escapeRegExp(specifier)}$`),
    replacement: entry,
  }));
}

/**
 * The same set as esbuild's `alias` option wants it — a plain specifier → path map.
 *
 * esbuild matches the LONGEST alias key, so a subpath export (`…/node-path`) is
 * still reached even though the package root is aliased too.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {Record<string, string>}
 */
export function sourcePackageAliasMap(repoRoot) {
  return Object.fromEntries(readSourcePackages(repoRoot).map(({ specifier, entry }) => [specifier, entry]));
}

/**
 * The `src` roots of the source-only packages.
 *
 * A package written for NodeNext spells its own relative imports `./x.js`, and no
 * bundler maps that back to `./x.ts` on its own — the importer has to be
 * recognised as one of these roots first. Deriving the roots rather than listing
 * them is what stops the next package from bundling everywhere except the one
 * toolchain whose list was not updated.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {string[]} Absolute, de-duplicated.
 */
export function sourcePackageRoots(repoRoot) {
  const roots = readSourcePackages(repoRoot)
    // The package's whole `src`, not the entry's own folder: a deeper entry point
    // (`./src/foo/index.ts`) must not narrow the root its siblings import from.
    .map(({ relative }) => relative.slice(0, relative.indexOf('/src/') + '/src'.length))
    .map((relative) => path.join(repoRoot, ...relative.split('/')));
  return [...new Set(roots)];
}
