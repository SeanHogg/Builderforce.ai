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
 * Source-only packages that live OUTSIDE `packages/`, listed one by one (repo-relative,
 * POSIX). Each is held to every guard rule exactly like a `packages/*` entry. Only
 * `webdit/torch` is here: the frontend's browser trainer takes its WGSL kernels from
 * `@webdit/torch/kernels` (PRD 31 §W9 phase 7 — one engine, no kernel copies). The
 * other `webdit/*` packages stay out — they reach consumers bundled inside studio's
 * `dist`, never by source alias.
 */
export const EXTRA_SOURCE_PACKAGE_DIRS = ['webdit/torch'];

/**
 * Every source-only export across `packages/` and `EXTRA_SOURCE_PACKAGE_DIRS`,
 * subpath exports included.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {SourcePackageEntry[]} Sorted by specifier, so callers are stable.
 */
export function readSourcePackages(repoRoot) {
  const packagesDir = path.join(repoRoot, 'packages');
  const packageDirs = [
    ...readdirSync(packagesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => `packages/${dirent.name}`),
    ...EXTRA_SOURCE_PACKAGE_DIRS,
  ];
  /** @type {SourcePackageEntry[]} */
  const found = [];

  for (const packageDir of packageDirs) {
    const manifestPath = path.join(repoRoot, ...packageDir.split('/'), 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // A built package (`exports` → `dist`, or a conditional object) resolves on
    // its own and must NOT be aliased: doing so would bypass its entry point.
    if (!manifest.name || typeof manifest.exports !== 'object' || manifest.exports === null) continue;

    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (typeof target !== 'string' || !target.startsWith(SOURCE_ENTRY)) continue;
      const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//, '')}`;
      const relative = `${packageDir}/${target.replace(/^\.\//, '')}`;
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
 * The set ALSO pins the npm packages those sources import (`PINNED_INSTALL_PACKAGES`,
 * subpaths included) to one install. Aliasing a package in means compiling it from
 * `packages/<name>/src`, whose bare imports Vite resolves from that directory — and
 * CI never installs `packages/*`, so `@seanhogg/builderforce-memory/stats` imported by
 * `packages/prefetch` failed to load every brain-embedded suite while passing locally
 * (where those installs happen to exist). The `tsconfig` side of the same rule is
 * guard rule 9 (`scripts/lib/npmSubpaths.mjs`).
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @param {{ installDir?: string }} [options] `installDir`: the consumer whose install
 *   serves those npm imports. Defaults to the working directory, which is the consumer
 *   for every `npm test`/`vitest run` here; a package that installs nothing and borrows
 *   its host's (`knowledge-graph-view` → `frontend`) names the host.
 * @returns {{ find: RegExp, replacement: string, customResolver?: any }[]} `customResolver` is a Vite `ResolverFunction`; typed loosely so this JS module needs no `vite` types.
 */
export function sourcePackageAliases(repoRoot, { installDir = process.cwd() } = {}) {
  const sources = readSourcePackages(repoRoot).map(({ specifier, entry }) => ({
    find: new RegExp(`^${escapeRegExp(specifier)}$`),
    replacement: entry,
  }));
  return [...sources, pinnedInstallAlias(installDir)];
}

/**
 * A `resolve.alias` entry that re-resolves every pinned specifier as if `installDir`
 * imported it, through Vite's own resolver (so `exports`, subpaths and conditions hold).
 * When that install does not have it, the entry steps aside (`null`) and Vite's normal
 * resolution runs, so a consumer without the package fails exactly as it would have.
 *
 * @param {string} installDir
 * @returns {{ find: RegExp, replacement: string, customResolver: any }}
 */
function pinnedInstallAlias(installDir) {
  const anchor = path.join(installDir, 'package.json');
  return {
    find: pinnedInstallFilter(),
    replacement: '$&',
    /** @this {{ resolve: (source: string, importer: string, options: object) => Promise<unknown> }} */
    async customResolver(source, _importer, options) {
      return (await this.resolve(source, anchor, { ...options, skipSelf: true })) ?? null;
    },
  };
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
 * The installed packages that must exist ONCE in a bundle, whoever imports them.
 *
 * A source-only package is bundled from `packages/<name>/src`, so its bare imports
 * resolve by node's walk from THAT directory — and every `packages/<name>/node_modules`
 * holds its own copy of the memory engine. `nodePaths` is only a fallback after that
 * walk, so it never got a say: VSIX 2026.10.174 shipped the consumer's memory 2026.10.81
 * for its own imports and agent-tools' 2026.10.80 (the old O(n·m) `.gitignore` matcher)
 * for the knowledge index, and typing in the editor stalled on it.
 */
export const PINNED_INSTALL_PACKAGES = ['@seanhogg/builderforce-memory', '@seanhogg/builderforce-memory-engine'];

/**
 * The specifiers a pin applies to: each package root and any subpath of it
 * (`@seanhogg/builderforce-memory/knowledge`), never a name that merely shares the prefix
 * (`@seanhogg/builderforce-memory-engine` is pinned only because it is listed itself).
 * Shared by the esbuild and Vite pins so the two bundlers cannot disagree on what is pinned.
 *
 * @param {string[]} [packages] Package names to pin; defaults to `PINNED_INSTALL_PACKAGES`.
 * @returns {RegExp}
 */
export function pinnedInstallFilter(packages = PINNED_INSTALL_PACKAGES) {
  return new RegExp(`^(?:${packages.map(escapeRegExp).join('|')})(?:/.*)?$`);
}

/**
 * The Vite/Rollup twin of `pinnedInstallResolve`. `resolve.dedupe` is not a pin: it resolves
 * from Vite's `root`, which is whatever directory the config names rather than the consumer
 * whose `package.json` declares the range, and it only covers the names someone remembered to
 * list. This plugin re-resolves every pinned specifier as if `installDir/package.json` imported
 * it — through Vite's own resolver, so the `exports` map, subpaths and conditions are honoured
 * exactly as for a direct import.
 *
 * Vite applies top-level `plugins` to worker bundles only in dev; a config that bundles workers
 * must also list this under `worker.plugins`.
 *
 * @param {string} installDir Absolute path of the consumer whose install is the one copy.
 * @param {string[]} [packages] Package names to pin; defaults to `PINNED_INSTALL_PACKAGES`.
 * @returns {import('vite').Plugin}
 */
export function pinnedInstallVitePlugin(installDir, packages = PINNED_INSTALL_PACKAGES) {
  const filter = pinnedInstallFilter(packages);
  // Must EXIST: Vite resolves a bare import from the importer's directory only when the
  // importer is on disk. The consumer's own manifest always is.
  const anchor = path.join(installDir, 'package.json');
  return {
    name: 'pinned-install-resolve',
    enforce: 'pre',
    async resolveId(source, _importer, options) {
      if (!filter.test(source)) return null;
      // `skipSelf` keeps the re-entry from reaching this hook again; the rest of the
      // caller's options (custom, isEntry, attributes) pass through unchanged.
      const resolved = await this.resolve(source, anchor, { ...options, skipSelf: true });
      if (!resolved) this.error(`[pinned-install-resolve] ${source} is not installed under ${installDir}`);
      return resolved;
    },
  };
}

/**
 * An esbuild plugin that resolves every `PINNED_INSTALL_PACKAGES` specifier — the root and
 * any subpath (`@seanhogg/builderforce-memory/knowledge`) — from `installDir`'s own
 * `node_modules`, whatever the importer. Resolution goes back through esbuild with
 * `resolveDir: installDir`, so the package's `exports` map and conditions are honoured
 * exactly as for a direct import; `pluginData` marks that re-entry so it is not pinned twice.
 *
 * @param {string} installDir Absolute path of the consumer whose install is the one copy.
 * @param {string[]} [packages] Package names to pin; defaults to `PINNED_INSTALL_PACKAGES`.
 * @returns {import('esbuild').Plugin}
 */
export function pinnedInstallResolve(installDir, packages = PINNED_INSTALL_PACKAGES) {
  const filter = pinnedInstallFilter(packages);
  const reentry = Symbol('pinned-install-resolve');
  return {
    name: 'pinned-install-resolve',
    setup(build) {
      build.onResolve({ filter }, async (args) => {
        if (args.pluginData === reentry) return undefined;
        const result = await build.resolve(args.path, { kind: args.kind, resolveDir: installDir, pluginData: reentry });
        if (result.errors.length > 0) return { errors: result.errors };
        return { path: result.path, external: result.external, sideEffects: result.sideEffects, namespace: result.namespace };
      });
    },
  };
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
