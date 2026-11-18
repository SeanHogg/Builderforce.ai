/**
 * Rule 10 of the source-package graph guard: A WRANGLER BUNDLE RESOLVES THROUGH ITS PROJECT.
 *
 * Rule 9 holds a project's `tsconfig` `paths` to every npm subpath the source-only
 * packages it compiles import (`@seanhogg/builderforce-memory/stats` from
 * `packages/run-delta`), because those packages' own dirs are never installed in CI.
 * That covered tsc. `wrangler deploy` bundles with esbuild, which takes no plugin from a
 * `wrangler.toml` (so `pinnedInstallResolve` cannot reach it) and, by default, applies the
 * NEAREST tsconfig to each importing file — `packages/run-delta/tsconfig.json`, not the
 * host's — so the host's mapping never applied and the import fell back to node's walk
 * from `packages/run-delta/src`, which finds nothing in CI. Deploy API went red with
 * "Could not resolve" ×81 while every type-check passed.
 *
 * The seam is the ONE hand-written table rule 9 already guards: the wrangler config names
 * its project's tsconfig (`tsconfig = "tsconfig.json"`), which makes esbuild apply that
 * file's `paths` to EVERY file in the bundle — so each npm subpath resolves onto the
 * host's own install (one copy, whoever imports it) and each source-only package onto its
 * `src` exactly as tsc sees it. Two obligations follow, and this module checks both:
 *
 *  a. the config's `tsconfig` is the project's tsconfig, and
 *  b. each of those subpaths lists a RUNTIME file (`dist/stats/index.js`) after its
 *     declaration: esbuild skips a `paths` candidate that is a `.d.ts` and tries the next,
 *     falling back to the walk that fails when none is left; tsc stops at the first that
 *     exists, and given only the `.js` reports it untyped (TS7016) — so both, in that order.
 *
 * This module owns the RELATION only; `check-source-package-graph.mjs` owns which projects
 * and packages it runs over and how failures are reported.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { packageRoot } from './moduleImports.mjs';
import { pathsCandidates } from './tsconfigPaths.mjs';

const WRANGLER_CONFIG = /^wrangler(?:\.[^.]+)?\.(?:toml|jsonc?)$/;
const TS_ENTRY = /\.[cm]?tsx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;

/** `dist/x/index.d.ts` → `dist/x/index.js`: the runtime file esbuild needs listed after it. */
export function runtimeTwin(declaration) {
  return declaration.replace(/\.d\.([cm]?)ts$/, '.$1js');
}

/**
 * A top-level string key of a wrangler config. TOML: only lines before the first table
 * header are top-level. JSON/JSONC: the first occurrence of the key.
 *
 * @param {string} text
 * @param {string} key
 * @param {boolean} toml
 * @returns {string | undefined}
 */
export function topLevelString(text, key, toml) {
  if (toml) {
    const head = text.split(/^\s*\[/m)[0] ?? '';
    return new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm').exec(head)?.[1];
  }
  return new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(text)?.[1];
}

/**
 * The wrangler configs in `dir` (not below it), with the absolute paths they name.
 *
 * @param {string} dir
 * @returns {{ file: string, main?: string, tsconfig?: string }[]}
 */
export function wranglerConfigsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && WRANGLER_CONFIG.test(entry.name))
    .map((entry) => {
      const file = join(dir, entry.name);
      const text = readFileSync(file, 'utf8');
      const toml = entry.name.endsWith('.toml');
      const main = topLevelString(text, 'main', toml);
      const tsconfig = topLevelString(text, 'tsconfig', toml);
      return { file, main: main && resolve(dir, main), tsconfig: tsconfig && resolve(dir, tsconfig) };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * @typedef {object} WranglerProblem
 * @property {string} config Absolute path of the wrangler config.
 * @property {'tsconfig-not-forced' | 'declaration-target'} kind
 * @property {string} [specifier] For `declaration-target`: the npm subpath.
 * @property {string} [target]    For `declaration-target`: where `paths` sends it.
 * @property {import('./moduleImports.mjs').ImportSite} [site] An import that needs it.
 */

/**
 * Every way a wrangler config beside `project` fails to bundle the npm subpaths that the
 * source-only packages `project` compiles import.
 *
 * @param {object} options
 * @param {{ file: string, dir: string, paths: Record<string, string[]>, sources: string[] }} options.project
 * @param {Iterable<{ externals: import('./moduleImports.mjs').ImportSite[] }>} options.nodes
 *   The source-only packages this project compiles.
 * @returns {WranglerProblem[]}
 */
export function wranglerBundleProblems({ project, nodes }) {
  // A TypeScript entry only: a `main` that is already a bundle (`frontend/wrangler.toml` →
  // the Next build's `_worker.js`) was resolved by the toolchain that emitted it.
  const configs = wranglerConfigsIn(project.dir).filter(
    (config) =>
      config.main &&
      TS_ENTRY.test(config.main) &&
      project.sources.some((dir) => !relative(dir, config.main).startsWith('..')),
  );
  if (configs.length === 0) return [];

  /** @type {Map<string, import('./moduleImports.mjs').ImportSite>} */
  const subpaths = new Map();
  for (const node of nodes) {
    for (const site of node.externals) {
      if (site.isTest || site.specifier === packageRoot(site.specifier) || subpaths.has(site.specifier)) continue;
      subpaths.set(site.specifier, site);
    }
  }
  if (subpaths.size === 0) return [];

  /** @type {WranglerProblem[]} */
  const problems = [];
  for (const config of configs) {
    if (config.tsconfig !== project.file) problems.push({ config: config.file, kind: 'tsconfig-not-forced' });
  }
  // Per project, not per config: every config here bundles through the same `paths`.
  for (const [specifier, site] of [...subpaths].sort(([a], [b]) => a.localeCompare(b))) {
    const candidates = pathsCandidates(project.paths, project.dir, specifier);
    // Unmapped is rule 9's to report; only a mapping esbuild would skip entirely is this rule's.
    if (candidates.length > 0 && candidates.every((target) => DECLARATION.test(target))) {
      problems.push({ config: configs[0].file, kind: 'declaration-target', specifier, target: candidates[0], site });
    }
  }
  return problems;
}
