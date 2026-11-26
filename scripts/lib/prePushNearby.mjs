/**
 * `nearby` test selection: the tests that import a changed file within two hops, found by reading import statements.
 *
 * WHY. `vitest related` (vitest 4, `getTestDependencies` in cli-api) transforms the FULL import graph of EVERY test file in
 * the project, in the main process, before it picks the few that import the changed file. api's suite is ~520 files over
 * barrels and the pglite suites; one changed file cost 985-1118 s. `nearby` takes milliseconds. Each hop is capped at
 * MAX_TESTS and a cap that fires is reported, never silent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { git } from './git.mjs';
import { resolveRelativeFile, toPosix } from './moduleImports.mjs';
import { SOURCE_RE, TEST_RE } from './prePushUtil.mjs';
import { sourcePackageAliasMap } from '../sourcePackages.mjs';

// A regex, not `parseModuleSpecifiers`: that needs the TypeScript compiler loaded, which costs seconds this check exists to save.
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bvi\.(?:mock|importActual)\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const MAX_TESTS = 40;

/**
 * @param {string[]} inputs absolute paths of the changed source files
 * @returns {{ tests: string[], notes: string[] }} absolute POSIX paths; notes name every truncation.
 */
export function nearbyTests(root, area, inputs) {
  const rel = (abs) => toPosix(relative(root, abs));
  const scope = [...new Set([area.dir, ...inputs.map((f) => rel(f).split('/').slice(0, 2).join('/'))])];
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...scope], { cwd: root })
    .split('\0').filter((f) => SOURCE_RE.test(f) && existsSync(join(root, f))).map((f) => toPosix(resolve(root, f)));
  const aliases = new Map(Object.entries(sourcePackageAliasMap(root)).map(([spec, entry]) => [spec, toPosix(entry)]));
  const resolved = new Map();
  const resolveSpec = (spec, from) => {
    if (!spec.startsWith('.')) return aliases.get(spec);
    const key = `${dirname(from)}|${spec}`;
    if (!resolved.has(key)) { const hit = resolveRelativeFile(from, spec); resolved.set(key, hit && toPosix(hit)); }
    return resolved.get(key);
  };
  const importers = new Map();
  for (const file of listed) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const [, spec] of text.matchAll(IMPORT_RE)) {
      const target = resolveSpec(spec, file);
      if (target) (importers.get(target) ?? importers.set(target, new Set()).get(target)).add(file);
    }
  }
  const isTest = (abs) => TEST_RE.test(rel(abs));
  const notes = [];
  const starts = inputs.map(toPosix);
  const tests = new Set(starts.filter(isTest));
  for (const input of starts) {
    const stem = basename(input).replace(/\.[^.]+$/, '');
    listed.filter((f) => isTest(f) && dirname(f) === dirname(input) && basename(f).startsWith(`${stem}.`)).forEach((f) => tests.add(f));
  }
  const seen = new Set(starts);
  const inputDirs = new Set(starts.map(dirname));
  let frontier = new Set(seen);
  for (let hop = 1; hop <= 2; hop += 1) {
    const next = new Set([...frontier].flatMap((f) => [...(importers.get(f) ?? [])]).filter((f) => !seen.has(f)));
    next.forEach((f) => seen.add(f));
    let level = [...next].filter(isTest);
    if (hop === 1 && level.length > MAX_TESTS) {
      level = level.sort((a, b) => Number(inputDirs.has(dirname(b))) - Number(inputDirs.has(dirname(a))) || a.localeCompare(b)).slice(0, MAX_TESTS);
      notes.push(`${area.id}: coverage TRUNCATED: ${next.size} files import the change directly; only the ${MAX_TESTS} nearest tests ran`);
    }
    if (hop === 2 && tests.size + level.length > MAX_TESTS) {
      notes.push(`${area.id}: coverage TRUNCATED: two-hop importers (${level.length} more tests) skipped; direct importers only`);
      break;
    }
    level.forEach((f) => tests.add(f));
    frontier = next;
  }
  return { tests: [...tests], notes };
}
