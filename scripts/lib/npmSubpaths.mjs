/**
 * Rule 9 of the source-package graph guard: NPM SUBPATHS RESOLVE.
 *
 * A source-only package is compiled from source by each consumer, so a bare npm
 * import in it (`@seanhogg/builderforce-memory/stats`) is resolved from the
 * package's REAL path under `packages/<name>/` — which CI never installs. Every
 * consumer therefore maps those subpaths through its own `tsconfig` `paths` onto
 * its own install. The failure this rule exists for: `/stats`, `/retrieval` and
 * the engine's `ml/tasks/check-scheduler` were added to one consumer's `paths`
 * and not the other seven, every local build passed (the packages' own
 * `node_modules` happened to exist on the author's machine) and the Release
 * workflow went red in six jobs at once.
 *
 * Only SUBPATHS are held to it, deliberately narrower than the hazard: a bare package
 * ROOT imported from `packages/<name>/src` fails the same way (neither `packages/*`
 * nor the repo root has an install in CI — frontend maps `three` for that reason),
 * but roots are imported by many packages and mapped per consumer with ad-hoc
 * targets (`@types/*`, peers), so widening it is its own pass. No source-only package
 * imports a memory or engine root outside tests today.
 *
 * This module owns the RELATION only; `check-source-package-graph.mjs` owns
 * which projects and packages it runs over and how failures are reported.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { declaredNames } from './declaredDependencies.mjs';
import { packageRoot, toPosix } from './moduleImports.mjs';
import { resolveThroughPaths } from './tsconfigPaths.mjs';

/** The spellings tsc tries for a `paths` target, declaration files included. */
const TARGET_SUFFIXES = ['', '.d.ts', '.ts', '.tsx', `${sep}index.d.ts`, `${sep}index.ts`];

/**
 * The install a `paths` target points into: the directory holding `node_modules`
 * and the package directory under it, or null when the target is not an install.
 *
 * @param {string} target Absolute.
 * @param {string} root   Package name, e.g. `@scope/name`.
 */
function installOf(target, root) {
  const marker = `${sep}node_modules${sep}${root.split('/').join(sep)}${sep}`;
  const at = target.indexOf(marker);
  if (at < 0) return null;
  return { ownerDir: target.slice(0, at), packageDir: target.slice(0, at + marker.length - 1) };
}

/**
 * @typedef {object} SubpathProblem
 * @property {import('./moduleImports.mjs').ImportSite} site
 * @property {'unmapped' | 'missing-file' | 'undeclared-install'} kind
 * @property {string} [target] The resolved `paths` target, when there is one.
 * @property {string} [ownerDir] Repo-relative directory whose manifest must declare the package.
 */

/**
 * Every npm subpath the given source-only packages import (outside tests) that
 * `project` does not resolve through its own `paths` onto an install it declares.
 *
 * A target is checked on disk only when that package is installed locally: an
 * absent install proves nothing about the mapping, and the declaration check
 * already holds the consumer to installing it in CI.
 *
 * @param {object} options
 * @param {{ dir: string, paths: Record<string, string[]> }} options.project
 * @param {Iterable<{ dir: string, externals: import('./moduleImports.mjs').ImportSite[] }>} options.nodes
 *   The source-only packages this project compiles.
 * @param {string[]} options.sourcePackageDirs Absolute dirs of every source-only package.
 * @param {string} options.repoRoot
 * @returns {SubpathProblem[]}
 */
export function unresolvedNpmSubpaths({ project, nodes, sourcePackageDirs, repoRoot }) {
  // A source-only package's OWN projects (`packages/run-policy/tsconfig.json`) are
  // checked only in `verify-kernel`, which installs that package and the
  // source-linked siblings it compiles; they are held to the rule only for an npm
  // package they already map through `paths` (knowledge-graph-view maps memory onto
  // the frontend install) — mapping some subpaths of a package obliges mapping all.
  const packageOwn = sourcePackageDirs.some((dir) => !relative(dir, project.dir).startsWith('..'));
  const mapsPackage = (root) => Object.keys(project.paths).some((key) => key === root || key.startsWith(`${root}/`));

  /** @type {SubpathProblem[]} */
  const problems = [];
  const seen = new Set();
  for (const node of nodes) {
    for (const site of node.externals) {
      const root = packageRoot(site.specifier);
      if (site.isTest || site.specifier === root || seen.has(site.specifier)) continue;
      if (packageOwn && !mapsPackage(root)) continue;
      seen.add(site.specifier);

      const target = resolveThroughPaths(project.paths, project.dir, site.specifier);
      if (!target) {
        problems.push({ site, kind: 'unmapped' });
        continue;
      }
      const install = installOf(target, root);
      if (!install) continue; // mapped onto source or a shim — the author's explicit choice
      const manifestPath = join(install.ownerDir, 'package.json');
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
      if (!declaredNames(manifest).has(root)) {
        problems.push({ site, kind: 'undeclared-install', target, ownerDir: toPosix(relative(repoRoot, install.ownerDir)) || '.' });
        continue;
      }
      if (!existsSync(join(install.packageDir, 'package.json'))) continue;
      if (!TARGET_SUFFIXES.some((suffix) => existsSync(`${target}${suffix}`))) {
        problems.push({ site, kind: 'missing-file', target });
      }
    }
  }
  return problems;
}

/**
 * The `paths` entry a project should write for `specifier`: the declaration file
 * the nearest install's `exports` map names (the project's own, or its package's for a
 * nested tsconfig such as `clients/vscode/harness`), relative to the project directory.
 *
 * @param {string} projectDir
 * @param {string} specifier
 * @param {string} repoRoot Where the upward search for an install stops.
 * @returns {string | null} Null when the package is not installed here or does not export it.
 */
export function suggestedSubpathTarget(projectDir, specifier, repoRoot) {
  const root = packageRoot(specifier);
  let packageDir = null;
  for (let dir = projectDir; !relative(repoRoot, dir).startsWith('..'); dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', ...root.split('/'));
    if (existsSync(join(candidate, 'package.json'))) {
      packageDir = candidate;
      break;
    }
    if (dir === repoRoot || dirname(dir) === dir) break;
  }
  if (!packageDir) return null;
  const manifestPath = join(packageDir, 'package.json');
  const exported = JSON.parse(readFileSync(manifestPath, 'utf8')).exports?.[`.${specifier.slice(root.length)}`];
  const types = typeof exported === 'string' ? exported : exported?.types ?? exported?.import?.types ?? null;
  if (typeof types !== 'string') return null;
  const target = toPosix(relative(projectDir, join(packageDir, types)));
  return target.startsWith('.') ? target : `./${target}`;
}
