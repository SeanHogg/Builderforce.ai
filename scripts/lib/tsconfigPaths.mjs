/**
 * The `tsconfig.json` half of source-package resolution.
 *
 * Every JS toolchain in this repo derives its aliases from `sourcePackages.mjs`,
 * so a new source-only package is wired into vitest, vite and esbuild the moment
 * its manifest exists. The `tsconfig` `paths` cannot import a module and so stay
 * hand-written JSON — which makes them the one place the set can still drift, and
 * the place both build failures came from.
 *
 * This module owns reading them: JSONC (these files carry comments and the guard
 * must not care), `extends` chains, tsc's own longest-wildcard resolution order,
 * and finding every project in the repository that has such a block rather than
 * relying on a hand-kept list of three — a list that is itself the drift it was
 * written to prevent, and which had already fallen four projects behind.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** Directories never worth walking for a tsconfig. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', '.next', '.git', '.vscode-test', 'coverage']);

/**
 * Strip JSONC to JSON: line and block comments outside strings, then trailing
 * commas. Written rather than pulled in because the repo root has no
 * `node_modules` to install a parser into.
 */
function stripJsonc(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i += 1; continue; }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Parse a tsconfig, following `extends` so an inherited `paths` block counts.
 *
 * @param {string} file Absolute path to a tsconfig.
 * @param {Set<string>} [seen] Cycle guard, supplied by the recursion.
 * @returns {{ compilerOptions: Record<string, any>, include: string[], exclude: string[] }}
 */
export function readTsconfig(file, seen = new Set()) {
  if (seen.has(file)) return { compilerOptions: {}, include: [], exclude: [] };
  seen.add(file);

  const parsed = JSON.parse(stripJsonc(readFileSync(file, 'utf8')));
  const own = {
    compilerOptions: parsed.compilerOptions ?? {},
    include: parsed.include ?? [],
    exclude: parsed.exclude ?? [],
  };
  if (!parsed.extends) return own;

  const parentSpec = String(parsed.extends);
  const parentPath = parentSpec.startsWith('.')
    ? resolve(dirname(file), parentSpec.endsWith('.json') ? parentSpec : `${parentSpec}.json`)
    : null;
  if (!parentPath || !existsSync(parentPath)) return own;

  const parent = readTsconfig(parentPath, seen);
  return {
    // `paths` in the child REPLACES the parent's — tsc merges compilerOptions
    // key by key, not deeply — and `baseUrl`/`paths` are then relative to the
    // file that declared them, which is why resolution below takes the owning dir.
    compilerOptions: { ...parent.compilerOptions, ...own.compilerOptions },
    include: own.include.length ? own.include : parent.include,
    exclude: own.exclude.length ? own.exclude : parent.exclude,
  };
}

/**
 * Resolve a bare specifier the way tsc does: exact key first, then the longest
 * matching `prefix/*` key with its capture substituted into the target.
 *
 * @param {Record<string, string[]>} paths
 * @param {string} fromDir Directory the `paths` are relative to.
 * @param {string} specifier
 * @returns {string | null} Absolute, extensionless for a wildcard target.
 */
export function resolveThroughPaths(paths, fromDir, specifier) {
  const exact = paths[specifier]?.[0];
  if (exact) return resolve(fromDir, exact);

  const wildcards = Object.keys(paths)
    .filter((key) => key.endsWith('/*') && specifier.startsWith(key.slice(0, -1)))
    .sort((a, b) => b.length - a.length);
  for (const key of wildcards) {
    const target = paths[key]?.[0];
    if (!target) continue;
    return resolve(fromDir, target.replace('*', specifier.slice(key.length - 1)));
  }
  return null;
}

/**
 * A `paths` target is written the way tsc reads it, which is not always the file
 * name: a wildcard target (`…/src/*`) stops at the extensionless path and tsc
 * appends the extension itself. Both spellings point at the same source.
 *
 * @param {string | null} candidate
 * @param {string | undefined} entry Absolute path of the file the specifier must reach.
 */
export function resolvesTo(candidate, entry) {
  if (!candidate || !entry) return false;
  return [candidate, `${candidate}.ts`, `${candidate}.tsx`, join(candidate, 'index.ts')].includes(entry);
}

/**
 * The directories a project's `include` globs actually compile.
 *
 * Only the literal prefix of each glob is used — the guard scans directories, so
 * `src/**\/*.ts` and `**\/*.tsx` become `src` and the project root. That is
 * broader than tsc's own file set and deliberately so: a project that compiles a
 * file must resolve what that file imports, and over-scanning can only make the
 * guard notice more.
 *
 * @param {string} tsconfigFile Absolute.
 * @param {{ include: string[] }} config
 * @returns {string[]} Absolute directories that exist.
 */
export function includedDirs(tsconfigFile, config) {
  const base = dirname(tsconfigFile);
  const globs = config.include.length ? config.include : ['.'];
  const dirs = globs.map((glob) => {
    const literal = glob.split('/').reduce((acc, part) => {
      if (acc.stopped || part.includes('*') || part.includes('?')) return { parts: acc.parts, stopped: true };
      return { parts: [...acc.parts, part], stopped: false };
    }, { parts: [], stopped: false }).parts;
    return resolve(base, ...(literal.length ? literal : ['.']));
  });
  return [...new Set(dirs)].filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
}

/**
 * Directories a project reaches through its OWN non-package aliases.
 *
 * `clients/vscode/webview/tsconfig.canvas.json` maps `@/*` at `frontend/src` and
 * compiles those files — which is exactly how the canvas bundle came to compile
 * frontend source that imported a package the canvas project had never heard of.
 * A project that aliases another app's source owns that source's imports too.
 *
 * @param {string} tsconfigFile Absolute.
 * @param {{ compilerOptions: Record<string, any> }} config
 * @param {string} repoRoot
 * @returns {string[]} Absolute directories inside the repo, excluding the project's own tree.
 */
export function aliasedSourceDirs(tsconfigFile, config, repoRoot) {
  const base = dirname(tsconfigFile);
  const paths = config.compilerOptions?.paths ?? {};
  const dirs = new Set();
  for (const [key, targets] of Object.entries(paths)) {
    if (key.startsWith('@builderforce/')) continue;
    for (const target of targets ?? []) {
      const literal = String(target).split('/').filter((part) => !part.includes('*'));
      const dir = resolve(base, ...literal);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      if (relative(repoRoot, dir).startsWith('..')) continue;
      if (!relative(base, dir).startsWith('..')) continue; // inside the project — already included
      dirs.add(dir);
    }
  }
  return [...dirs];
}

/**
 * @typedef {object} TsconfigProject
 * @property {string} file      Absolute path to the tsconfig.
 * @property {string} relative  Repo-relative, POSIX-separated — the name in guard output.
 * @property {string} dir       Directory the `paths` resolve against.
 * @property {Record<string, string[]>} paths
 * @property {string[]} sources Absolute directories whose imports this project must resolve.
 */

/**
 * Every tsconfig in the repository, with its effective `paths` and source dirs.
 *
 * @param {string} repoRoot
 * @returns {TsconfigProject[]} Sorted by path, so guard output is stable.
 */
export function findTsconfigProjects(repoRoot) {
  /** @type {TsconfigProject[]} */
  const projects = [];
  const pending = [repoRoot];
  while (pending.length) {
    const current = /** @type {string} */ (pending.pop());
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(full);
        continue;
      }
      if (!/^tsconfig(\..+)?\.json$/.test(entry.name)) continue;

      let config;
      try {
        config = readTsconfig(full);
      } catch {
        continue; // Unparseable configs are not this guard's business to report.
      }
      projects.push({
        file: full,
        relative: relative(repoRoot, full).split('\\').join('/'),
        dir: dirname(full),
        paths: config.compilerOptions?.paths ?? {},
        sources: [...includedDirs(full, config), ...aliasedSourceDirs(full, config, repoRoot)],
      });
    }
  }
  return projects.sort((a, b) => a.relative.localeCompare(b.relative));
}
