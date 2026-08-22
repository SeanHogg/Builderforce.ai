/**
 * What a source tree IMPORTS — read from the TypeScript AST.
 *
 * A regex cannot answer this question in this repository, which is full of source
 * code INSIDE strings: `packages/ide-templates/src/scaffolds.ts` is a map of file
 * CONTENTS, and `packages/creation-canvas-contract/src/qa.ts` emits generated
 * Playwright specs line by line. A regex reports those as the package's own
 * imports, and a guard built on one either fails on packages that are not
 * dependencies or gets its pattern narrowed until it stops seeing real imports.
 *
 * Neither does `ts.preProcessFile`, which is what this module used first and what
 * `frontend/scripts/check-declared-deps.mjs` was written on. It is a LEXICAL
 * scanner, not a parser: `lines.push(\`import { test } from '@playwright/test';\`)`
 * inside a template literal is reported as an import of `@playwright/test`, and
 * the first run of the source-package guard duly demanded that the canvas
 * contract declare a dependency on Playwright it does not have. Parsing costs
 * nothing here — only files that survive the `mustContain` pre-filter are parsed
 * at all — and it is the difference between a guard people trust and one they
 * learn to add exceptions to.
 *
 * This module owns ONE thing: turning a set of directories into the list of bare
 * specifiers their source files import, with a file and line for each. What those
 * specifiers OUGHT to be is `declaredDependencies.mjs`'s question, and which
 * packages they resolve to is `../sourcePackageGraph.mjs`'s.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Directories that are never source: build output, dependencies, caches. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', '.next', '.git', '.vscode-test', 'coverage']);

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** Concurrent open file handles while scanning. Enough to hide per-open latency, not enough to exhaust the table. */
const READ_CONCURRENCY = 48;

/**
 * The packages that carry a `typescript` install. The repository is a set of
 * separately installed packages with no root `node_modules`, so a script at the
 * repo root cannot `import ts from 'typescript'` — it has to borrow the compiler
 * from a package that declares it. Ordered by how likely each is to be installed
 * in a checkout that is running guards at all.
 */
const TYPESCRIPT_HOSTS = ['frontend', 'api', 'clients/vscode', 'agent-runtime', 'worker'];

/**
 * Load the TypeScript compiler from whichever package in the repo has one.
 *
 * @param {string} repoRoot
 * @returns {import('typescript')}
 * @throws when no package in the repo has typescript installed — a guard that
 *   cannot read imports has not passed, so this is never a soft failure.
 */
export function loadTypeScript(repoRoot) {
  const tried = [];
  for (const host of TYPESCRIPT_HOSTS) {
    const manifest = join(repoRoot, ...host.split('/'), 'package.json');
    if (!existsSync(manifest)) continue;
    tried.push(host);
    try {
      return createRequire(pathToFileURL(manifest))('typescript');
    } catch {
      /* try the next host */
    }
  }
  throw new Error(
    `could not load the TypeScript compiler from any of ${tried.join(', ') || '(no candidate package found)'} — ` +
      'run `pnpm install` in one of them first.',
  );
}

/**
 * Every source file under `dir`, recursively.
 *
 * @param {string} dir Absolute.
 * @param {(name: string) => boolean} [skip] Extra directory names to skip.
 * @returns {string[]} Absolute paths. Empty when `dir` does not exist.
 */
export function collectSourceFiles(dir, skip) {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return SOURCE_FILE.test(dir) ? [dir] : [];

  /** @type {string[]} */
  const files = [];
  const pending = [dir];
  while (pending.length) {
    const current = /** @type {string} */ (pending.pop());
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !skip?.(entry.name)) pending.push(full);
        continue;
      }
      if (SOURCE_FILE.test(entry.name)) files.push(full);
    }
  }
  return files;
}

/**
 * @typedef {object} ImportSite
 * @property {string} specifier Bare specifier exactly as written.
 * @property {string} file      Absolute path of the importing file.
 * @property {string} relative  The same path, repo-relative and POSIX-separated.
 * @property {number} line      1-indexed line of the import.
 * @property {boolean} isTest   True for `*.test.*` / `*.spec.*` and config files.
 */

/** `@scope/name/sub` → `@scope/name`; `pkg/sub` → `pkg`. */
export function packageRoot(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Windows separators out, so guard output reads the same on every machine. */
export function toPosix(path) {
  return path.split(sep).join('/');
}

/** 1-indexed line of an offset, without slicing a copy of the file per import. */
function countLines(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** `.tsx` and `.jsx` need the JSX-aware grammar or every angle bracket misparses. */
function scriptKindFor(ts, file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Every module specifier the PARSER sees — static imports and re-exports,
 * `import(...)` (expression and type position) and `require(...)`.
 *
 * A specifier inside a string or a template literal is not a node of any of these
 * kinds, which is the whole reason this walks the tree instead of scanning tokens.
 *
 * @param {import('typescript')} ts
 * @param {string} file
 * @param {string} text
 * @returns {{ specifier: string, pos: number }[]}
 */
function parseModuleSpecifiers(ts, file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKindFor(ts, file));
  /** @type {{ specifier: string, pos: number }[]} */
  const found = [];

  const take = (node) => {
    if (node && ts.isStringLiteralLike(node)) found.push({ specifier: node.text, pos: node.pos });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) take(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      take(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) take(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isDynamicImport || isRequire) take(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return found;
}

/** A file whose imports are dev-time only: tests, and the configs that run them. */
function isTestFile(file) {
  const name = file.split(/[\\/]/).pop() ?? '';
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || /\.config\.[cm]?[jt]s$/.test(name);
}

/**
 * The bare (non-relative, non-builtin) specifiers imported anywhere under `dirs`.
 *
 * @param {object} options
 * @param {import('typescript')} options.ts
 * @param {string} options.repoRoot
 * @param {string[]} options.dirs Absolute directories (or files) to scan.
 * @param {string} [options.mustContain] Skip any file whose text does not contain
 *   this substring. A cheap pre-filter for the callers that only care about one
 *   family of specifiers over a very large tree; preprocessing every file in
 *   `frontend/` to find nine `@builderforce/` imports is the whole cost of the run.
 * @returns {ImportSite[]}
 */
export async function scanBareImports({ ts, repoRoot, dirs, mustContain }) {
  const files = [];
  const seen = new Set();
  for (const dir of dirs) {
    for (const file of collectSourceFiles(dir)) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }

  /** @type {ImportSite[][]} */
  const perFile = new Array(files.length);
  let next = 0;

  // Reads are the whole cost of this guard — ~9,000 source files, and a
  // synchronous pass over them takes three times as long as a concurrent one on
  // Windows, where every open goes through the filesystem filter driver. The
  // pool is bounded so a large tree cannot exhaust file handles.
  async function worker() {
    while (next < files.length) {
      const index = next;
      next += 1;
      const file = files[index];
      const text = await readFile(file, 'utf8');
      if (mustContain && !text.includes(mustContain)) {
        perFile[index] = [];
        continue;
      }
      const test = isTestFile(file);
      /** @type {ImportSite[]} */
      const sites = [];
      for (const { specifier, pos } of parseModuleSpecifiers(ts, file, text)) {
        if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
        if (BUILTINS.has(specifier) || BUILTINS.has(packageRoot(specifier))) continue;
        sites.push({
          specifier,
          file,
          relative: toPosix(relative(repoRoot, file)),
          line: countLines(text, pos),
          isTest: test,
        });
      }
      perFile[index] = sites;
    }
  }

  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  return perFile.flat();
}

/**
 * A scanner that reads each directory once.
 *
 * The projects in this repo overlap heavily — `frontend/tsconfig.json` compiles
 * `frontend/`, and the VS Code canvas project compiles `frontend/src` through its
 * own `@/*` alias — so a guard that walks per project reads the same tens of
 * thousands of files several times over. The cache is per scanner instance, and
 * a guard process is short-lived, so it never goes stale.
 *
 * @param {{ ts: import('typescript'), repoRoot: string }} options
 * @returns {{ scan: (dirs: string[], mustContain?: string) => Promise<ImportSite[]> }}
 */
export function createImportScanner({ ts, repoRoot }) {
  /** @type {Map<string, Promise<ImportSite[]>>} */
  const cache = new Map();
  return {
    async scan(dirs, mustContain) {
      const pending = dirs.map((dir) => {
        const key = [dir, mustContain ?? ''].join('|');
        let sites = cache.get(key);
        if (!sites) {
          sites = scanBareImports({ ts, repoRoot, dirs: [dir], mustContain });
          cache.set(key, sites);
        }
        return sites;
      });
      return (await Promise.all(pending)).flat();
    },
  };
}

/** Convenience for callers that only want the distinct specifier set. */
export function distinctSpecifiers(sites) {
  return [...new Set(sites.map((site) => site.specifier))].sort();
}

/** Absolute path helper shared by the callers that build `dirs`. */
export function fromRepo(repoRoot, ...segments) {
  return resolve(repoRoot, ...segments.flatMap((segment) => segment.split('/')));
}
