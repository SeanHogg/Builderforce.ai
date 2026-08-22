/**
 * The EDGES between the source-only packages — derived, because a hand-written
 * copy of them is the thing that keeps breaking.
 *
 * `sourcePackages.mjs` answers "which packages ship no `dist`, and where is each
 * one's source". That is enough to alias them, and it is not enough to know what
 * aliasing one COSTS. A source-only package that imports another declares
 * nothing: it has no `dist`, is never installed, and its `package.json` carries
 * no dependency entry — so the obligation "resolving A obliges you to resolve B"
 * exists only inside A's import statements. A consumer that aliases A and not B
 * finds out at build time, which is precisely the shape of both drifts that cost
 * a release.
 *
 * Adding the edge to `package.json` would state it, and would state it TWICE —
 * the import is already the statement, and a second copy is a second thing to
 * drift. It would also change install behaviour for packages that are currently
 * never installed (`scripts/ensure-linked-deps.mjs` runs `pnpm install` inside
 * any linked package whose declared deps are not on disk). So the edge stays
 * where it is written, and this module reads it: one derived graph, closed over
 * by every guard that has to decide what a toolchain must resolve.
 *
 * This module owns the RELATION only. Who must satisfy it is
 * `check-source-package-graph.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourcePackages } from './sourcePackages.mjs';
import { loadTypeScript, packageRoot, scanBareImports } from './lib/moduleImports.mjs';

/**
 * @typedef {object} SourcePackageNode
 * @property {string} name        Package name from its manifest.
 * @property {string} dir         Absolute package directory.
 * @property {string} srcDir      Absolute `src` directory.
 * @property {string} relative    Repo-relative directory, POSIX-separated.
 * @property {Record<string, unknown>} manifest
 * @property {string[]} specifiers Every specifier that resolves into this package.
 * @property {import('./lib/moduleImports.mjs').ImportSite[]} imports Bare imports in its `src`.
 * @property {Set<string>} edges  Source-only specifiers this package imports.
 * @property {import('./lib/moduleImports.mjs').ImportSite[]} externals Imports of packages
 *   that are NOT source-only — the ones that must appear in this manifest.
 */

/**
 * @typedef {object} SourcePackageGraph
 * @property {SourcePackageNode[]} nodes
 * @property {Map<string, SourcePackageNode>} bySpecifier Every specifier → its package.
 * @property {Map<string, string>} entryBySpecifier Every specifier → the source file it resolves to.
 * @property {(specifiers: Iterable<string>) => Set<string>} closure
 * @property {() => string[][]} cycles
 */

/**
 * Build the graph.
 *
 * @param {string} repoRoot
 * @param {import('typescript')} [ts] Injected by callers that already loaded it.
 * @returns {SourcePackageGraph}
 */
export function sourcePackageGraph(repoRoot, ts = loadTypeScript(repoRoot)) {
  const entries = readSourcePackages(repoRoot);

  /** @type {Map<string, SourcePackageNode>} */
  const byDir = new Map();
  /** @type {Map<string, SourcePackageNode>} */
  const bySpecifier = new Map();
  /** @type {Map<string, string>} specifier → the absolute source file it resolves to. */
  const entryBySpecifier = new Map(entries.map((entry) => [entry.specifier, entry.entry]));

  for (const entry of entries) {
    // `packages/<name>/src/…` — the package dir is whatever sits above `src`.
    const relativeSrcRoot = entry.relative.slice(0, entry.relative.indexOf('/src/') + '/src'.length);
    const packageRelative = relativeSrcRoot.slice(0, -'/src'.length);
    const dir = join(repoRoot, ...packageRelative.split('/'));
    let node = byDir.get(dir);
    if (!node) {
      const manifestPath = join(dir, 'package.json');
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
      node = {
        name: manifest.name ?? packageRelative,
        dir,
        srcDir: join(repoRoot, ...relativeSrcRoot.split('/')),
        relative: packageRelative,
        manifest,
        specifiers: [],
        imports: [],
        edges: new Set(),
        externals: [],
      };
      byDir.set(dir, node);
    }
    node.specifiers.push(entry.specifier);
    bySpecifier.set(entry.specifier, node);
  }

  for (const node of byDir.values()) {
    node.imports = scanBareImports({ ts, repoRoot, dirs: [node.srcDir] });
    for (const site of node.imports) {
      if (bySpecifier.has(site.specifier)) {
        // A package importing its OWN subpath export is not an edge.
        if (bySpecifier.get(site.specifier) !== node) node.edges.add(site.specifier);
        continue;
      }
      // A bare specifier under a source-only package's NAME that is not an
      // exported subpath resolves nowhere — report it as an external so the
      // manifest check names it rather than silently passing.
      node.externals.push(site);
    }
  }

  const nodes = [...byDir.values()].sort((a, b) => a.name.localeCompare(b.name));

  /** Transitive expansion of a specifier set under the edge relation. */
  function closure(specifiers) {
    const out = new Set();
    const pending = [...specifiers];
    while (pending.length) {
      const specifier = /** @type {string} */ (pending.pop());
      if (out.has(specifier)) continue;
      out.add(specifier);
      const node = bySpecifier.get(specifier);
      if (!node) continue;
      for (const edge of node.edges) if (!out.has(edge)) pending.push(edge);
    }
    return out;
  }

  /** Import cycles between packages, as name paths. Empty when the graph is a DAG. */
  function cycles() {
    /** @type {string[][]} */
    const found = [];
    const state = new Map(); // name → 'open' | 'done'
    /** @type {string[]} */
    const stack = [];

    function visit(node) {
      if (state.get(node.name) === 'done') return;
      if (state.get(node.name) === 'open') {
        found.push([...stack.slice(stack.indexOf(node.name)), node.name]);
        return;
      }
      state.set(node.name, 'open');
      stack.push(node.name);
      for (const edge of node.edges) {
        const next = bySpecifier.get(edge);
        if (next) visit(next);
      }
      stack.pop();
      state.set(node.name, 'done');
    }

    for (const node of nodes) visit(node);
    return found;
  }

  return { nodes, bySpecifier, entryBySpecifier, closure, cycles };
}

export { packageRoot };
