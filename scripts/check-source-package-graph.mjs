#!/usr/bin/env node
/**
 * Source-package graph guard.
 *
 * The packages under `packages/` whose `exports` point straight at `src/` ship no
 * `dist` and are never installed. Nothing resolves them by plain node resolution,
 * so every consumer spells them out — vite/vitest/esbuild derive that list from
 * `sourcePackages.mjs`, and the `tsconfig` `paths` cannot import a module, so they
 * stay hand-written JSON. Both build failures this arrangement has produced were
 * the same shape: a package wired everywhere the author checked and missing from
 * the one list they did not.
 *
 * Deriving the JS lists closed three of those holes. This guard closes the rest,
 * and it is the ONLY implementation of the rules — `clients/vscode/src/
 * sourcePackages.test.ts` asserts through the same modules, and the
 * `.claude/hooks/source-package-graph-guard.mjs` PostToolUse hook runs this file,
 * so the editor, `npm test` and CI can never disagree about what the rule is.
 *
 * FIVE RULES:
 *
 *  1. DECLARED EXTERNALS. Every non-builtin import in a source-only package's
 *     `src/` that is not another source-only package must appear in that
 *     package's own manifest — and, outside test files, in `dependencies` or
 *     `peerDependencies` rather than `devDependencies`, because a consumer
 *     installs neither the package nor its dev tree. An undeclared external is
 *     resolved by whatever the consumer happens to have hoisted.
 *
 *  2. STATED EDGES ARE CLOSED. If a source-only package imports another, every
 *     toolchain that resolves the first must resolve the second. This is the
 *     obligation nothing else records: the edge lives only in an import
 *     statement, so a consumer aliasing one and not the other builds fine until
 *     it does not.
 *
 *  3. DIRECT IMPORTS RESOLVE. Every source-only specifier a project's own
 *     sources import must resolve through that project's `paths`.
 *
 *  4. NO STALE PATH. A `@builderforce/*` `paths` key that no longer matches the
 *     registry points at a file that has moved or gone.
 *
 *  5. NO CYCLES. Two source-only packages that import each other cannot be split
 *     later without breaking every consumer at once.
 *
 * Projects are DISCOVERED, not listed: the guard walks the repo for tsconfigs and
 * checks every one that resolves or imports these packages. The list it replaced
 * named three projects and there are seven.
 *
 * Run: `node scripts/check-source-package-graph.mjs` from anywhere in the repo.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImportScanner, loadTypeScript } from './lib/moduleImports.mjs';
import {
  declaredNames,
  linkedPackageNames,
  runtimeDeclaredNames,
  undeclaredImports,
} from './lib/declaredDependencies.mjs';
import { findTsconfigProjects, resolveThroughPaths, resolvesTo } from './lib/tsconfigPaths.mjs';
import { sourcePackageGraph } from './sourcePackageGraph.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ rule: string, detail: string, remedy: string }[]} */
const failures = [];

const ts = loadTypeScript(repoRoot);
const scanner = createImportScanner({ ts, repoRoot });
const graph = await sourcePackageGraph(repoRoot, ts);
const specifiers = [...graph.bySpecifier.keys()];

if (graph.nodes.length === 0) {
  console.error('❌  No source-only packages found under packages/ — the registry read empty, which would make every rule below pass vacuously.');
  process.exit(1);
}

// ── Rule 1: declared externals ───────────────────────────────────────────────
for (const node of graph.nodes) {
  const declared = declaredNames(node.manifest);
  const runtimeOnly = runtimeDeclaredNames(node.manifest);
  const offenders = undeclaredImports({
    imports: node.externals,
    declared,
    runtimeOnly,
    resolvedElsewhere: (specifier) => graph.bySpecifier.has(specifier),
  });
  for (const site of offenders) {
    const known = declared.has(site.specifier.split('/')[0]) || declared.has(site.specifier);
    failures.push({
      rule: 'declared externals',
      detail: `${site.relative}:${site.line} imports '${site.specifier}', which ${node.name} does not declare${known ? ' as a runtime dependency' : ''}.`,
      remedy: known
        ? `Move it from devDependencies to dependencies in ${node.relative}/package.json — a consumer installs neither this package nor its dev tree.`
        : `Add it to ${node.relative}/package.json under "dependencies" (or "devDependencies" if the import is test-only).`,
    });
  }
}

// ── Rule 5: no cycles ────────────────────────────────────────────────────────
for (const cycle of graph.cycles()) {
  failures.push({
    rule: 'no cycles',
    detail: `Import cycle between source-only packages: ${cycle.join(' → ')}.`,
    remedy: 'Move the shared shape into a third package that both import, so either can be aliased without the other.',
  });
}

// ── Rules 2–4: every project that touches these packages ─────────────────────
const projects = [];
for (const project of findTsconfigProjects(repoRoot)) {
  const declaredHere = Object.keys(project.paths).filter((key) => specifiers.includes(key));
  const linked = linkedPackageNames(nearestManifest(project.dir, repoRoot));
  // One scanner across every project: `frontend/tsconfig.json` and the VS Code
  // canvas project compile overlapping trees, and reading them once each is the
  // difference between a guard that runs in seconds and one that runs in minutes.
  const sites = await scanner.scan(project.sources, '@builderforce/');
  const imported = sites.map((site) => site.specifier).filter((specifier) => graph.bySpecifier.has(specifier));
  projects.push({ ...project, declaredHere, linked, imported: [...new Set(imported)].sort() });
}

const relevant = projects.filter(
  (project) =>
    project.imported.length > 0 || Object.keys(project.paths).some((key) => key.startsWith('@builderforce/')),
);

/**
 * Does this project resolve `specifier` at all?
 *
 * Two mechanisms, and a guard that knows only one cries wolf: a tsconfig `paths`
 * entry, or a `link:`/`file:` dependency whose `node_modules` symlink lets node
 * resolution follow the package's own `exports` into its `src`.
 */
function resolvesSpecifier(project, specifier) {
  if (resolvesTo(resolveThroughPaths(project.paths, project.dir, specifier), graph.entryBySpecifier.get(specifier))) {
    return true;
  }
  return project.linked.has(graph.bySpecifier.get(specifier)?.name ?? specifier);
}

if (relevant.length === 0) {
  console.error('❌  No tsconfig project resolves or imports a source-only package — discovery read empty, so rules 2–4 checked nothing.');
  process.exit(1);
}

for (const project of relevant) {
  // Rule 3 + 2: everything the project imports, PLUS everything those packages
  // import, must resolve. The closure is the whole point — a project that
  // aliases `A` and compiles a file importing `A` still fails on `A`'s own
  // import of `B` unless `B` is spelled out here too.
  const required = graph.closure([...project.imported, ...project.declaredHere, ...project.linked]);
  for (const specifier of [...required].sort()) {
    if (!graph.bySpecifier.has(specifier)) continue; // a linked package that is not source-only
    if (resolvesSpecifier(project, specifier)) continue;

    const viaEdge = !project.imported.includes(specifier);
    failures.push({
      rule: viaEdge ? 'stated edges are closed' : 'direct imports resolve',
      detail: viaEdge
        ? `${project.relative} resolves a package that imports '${specifier}', but has no paths entry for it.`
        : `${project.relative} compiles sources that import '${specifier}', but has no paths entry for it.`,
      remedy: `Add "${specifier}": ["${pathsTargetFor(project, specifier)}"] to compilerOptions.paths in ${project.relative}.`,
    });
  }

  // Rule 4: a `@builderforce/` key that no longer names a real entry.
  for (const key of Object.keys(project.paths)) {
    if (!key.startsWith('@builderforce/') || key.endsWith('/*')) continue;
    const entry = graph.entryBySpecifier.get(key);
    if (entry && resolvesTo(resolveThroughPaths(project.paths, project.dir, key), entry)) continue;
    failures.push({
      rule: 'no stale path',
      detail: `${project.relative} maps '${key}' to ${project.paths[key]?.[0] ?? '(nothing)'}, which is not where that package's source lives.`,
      remedy: entry
        ? `Point it at "${pathsTargetFor(project, key)}".`
        : `Remove it — no package under packages/ exports '${key}'.`,
    });
  }
}

// ── Rule 6: a published type surface never names a source-only package ───────
//
// `brain-embedded` links `@builderforce/agent-stall` as a devDependency and
// re-exports six of its members. tsup INLINED them into the JS bundles — zero
// references in `dist/index.mjs` — and left the declarations pointing at the bare
// specifier, so the published `@seanhogg/builderforce-brain-embedded` shipped a
// `dist/index.d.ts` importing a package that has no `dist`, is not a runtime
// dependency, and that no consumer installs. Under `skipLibCheck` those six
// exports silently lose their types instead of failing.
//
// Checked against the EMITTED declarations because that is the artefact that
// ships. When a package has not been built, the guard says so rather than
// counting it as a pass.
const unbuilt = [];
for (const consumer of publishedConsumers(repoRoot, graph)) {
  const declarations = collectDeclarationFiles(consumer.distDir);
  if (declarations.length === 0) {
    unbuilt.push(consumer.relative);
    continue;
  }
  for (const file of declarations) {
    const text = readFileSync(file, 'utf8');
    for (const specifier of specifiers) {
      if (!new RegExp(`from ['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(text)) continue;
      failures.push({
        rule: 'published surface is self-contained',
        detail: `${toPosix(relative(repoRoot, file))} re-exports from '${specifier}', a source-only package that ships no dist and that ${consumer.name}'s consumers never install.`,
        remedy:
          `Inline it into the declarations — for tsup, \`dts: { resolve: [/^@builderforce\\//] }\` in ` +
          `${consumer.relative}/tsup.config.ts — then rebuild. Moving it to \`dependencies\` does not help: a ` +
          '`link:` specifier cannot be published.',
      });
      break;
    }
  }
}

/** Packages that publish a build AND link a source-only package. */
function publishedConsumers(root, sourceGraph) {
  const names = new Set(sourceGraph.nodes.map((node) => node.name));
  const found = [];
  for (const project of projects) {
    const manifestPath = join(project.dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const types = manifest.types ?? manifest.typings ?? manifest.exports?.['.']?.types;
    if (typeof types !== 'string' || !types.includes('dist')) continue;
    if (![...linkedPackageNames(manifest)].some((name) => names.has(name))) continue;
    if (found.some((entry) => entry.dir === project.dir)) continue;
    found.push({
      name: manifest.name ?? project.relative,
      dir: project.dir,
      relative: toPosix(relative(root, project.dir)),
      distDir: join(project.dir, 'dist'),
    });
  }
  return found;
}

/** Every emitted declaration file under a package's `dist`. */
function collectDeclarationFiles(distDir) {
  if (!existsSync(distDir)) return [];
  return readdirSync(distDir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.d\.[cm]?ts$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? distDir, entry.name));
}

/** The nearest `package.json` at or above `dir`, stopping at the repo root. */
function nearestManifest(dir, root) {
  let current = dir;
  for (;;) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    if (current === root) return {};
    const parent = dirname(current);
    if (parent === current) return {};
    current = parent;
  }
}

/** The `paths` target a project should write, relative to its own directory. */
function pathsTargetFor(project, specifier) {
  const entry = graph.entryBySpecifier.get(specifier);
  if (!entry) return '(unknown)';
  const rel = toPosix(relative(project.dir, entry));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Windows separators out, so guard output reads the same on every machine. */
function toPosix(path) {
  return path.split(sep).join('/');
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`❌  Source-package graph: ${failures.length} problem(s).\n`);
  const byRule = new Map();
  for (const failure of failures) {
    if (!byRule.has(failure.rule)) byRule.set(failure.rule, []);
    byRule.get(failure.rule).push(failure);
  }
  for (const [rule, entries] of byRule) {
    console.error(`  ${rule}:`);
    for (const entry of entries) {
      console.error(`    - ${entry.detail}`);
      console.error(`      → ${entry.remedy}`);
    }
    console.error('');
  }
  console.error(
    '   These packages ship no dist and are never installed, so nothing resolves them\n' +
      '   by plain node resolution and nothing states what resolving one costs. The JS\n' +
      '   toolchains derive their aliases from scripts/sourcePackages.mjs; the tsconfig\n' +
      '   paths are hand-written and are what this guard holds to the same set.\n',
  );
  process.exit(1);
}

const edgeCount = graph.nodes.reduce((total, node) => total + node.edges.size, 0);
if (unbuilt.length > 0) {
  console.log(
    `ℹ️   Not built, so their declarations could not be checked: ${unbuilt.join(', ')}. ` +
      'Run their build before a release — `prepublishOnly` does, but only at publish time.',
  );
}
console.log(
  `✅  Source-package graph: ${graph.nodes.length} source-only package(s), ${edgeCount} inter-package edge(s), ` +
    `${relevant.length} tsconfig project(s) checked — every external declared, every alias set closed.`,
);
