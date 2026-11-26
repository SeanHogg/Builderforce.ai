/**
 * Which changed files feed an area's tests (`relatedInputs`), which areas a change reaches (`touchesArea`) and which package
 * owns a test (`groupByOwner`). The `nearby` selection itself is prePushNearby.mjs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathTouches } from '../../.github/scripts/affected-builds.mjs';
import { linkedTargets, readManifest } from '../linkedPackages.mjs';
import { toPosix } from './moduleImports.mjs';
import { SOURCE_RE } from './prePushUtil.mjs';
import { sourcePackageRoots } from '../sourcePackages.mjs';

/** Never selected by name: a vitest/vite config change selects every test (forceRerunTriggers). */
const CONFIG_RE = /(?:^|\/)(?:vitest|vite)\.config\.[cm]?[jt]s$/;

/** Repo-relative POSIX dirs of the source-linked packages. */
const sharedDirs = (root) => sourcePackageRoots(root).map((r) => toPosix(relative(root, dirname(r))));

/** Packages `dir` links (package.json `link:`) or aliases (tsconfig `@builderforce/<name>`), transitively. */
function upstreamDirs(root, dir) {
  const all = sharedDirs(root).map((d) => ({ dir: d, name: readManifest(join(root, d))?.name })).filter((p) => p.name);
  const found = new Set();
  const visit = (current) => {
    const manifest = readManifest(join(root, current));
    const tsconfig = existsSync(join(root, current, 'tsconfig.json')) ? readFileSync(join(root, current, 'tsconfig.json'), 'utf8') : '';
    const linked = manifest ? linkedTargets(join(root, current), manifest).map((t) => toPosix(relative(root, t))) : [];
    for (const p of all) {
      if (p.dir === dir || found.has(p.dir) || p.dir === current) continue;
      if (linked.includes(p.dir) || tsconfig.includes(`"${p.name}`)) { found.add(p.dir); visit(p.dir); }
    }
  };
  visit(dir);
  return [...found];
}

/** Expand path tokens (see prePushAreas.mjs) into repo-relative prefixes; '' matches every file. */
function expandTokens(root, area, tokens) {
  return tokens.flatMap((t) => (t === '@self' ? [area.dir] : t === '@shared' ? sharedDirs(root) : t === '@upstream' ? upstreamDirs(root, area.dir) : t === '*' ? [''] : [t]));
}
const under = (file, prefixes) => prefixes.includes('') || pathTouches([file], prefixes);

export function touchesArea(root, area, files) {
  if (!area.watch) return true;
  const prefixes = expandTokens(root, area, area.watch);
  return files.some((f) => under(f, prefixes));
}

/** Changed source files feeding the area's tests (absolute), plus those that cannot be tested (deleted, or configs). */
export function relatedInputs(root, area, files) {
  const prefixes = expandTokens(root, area, area.relatedFrom ?? ['@self']);
  const picked = files.filter((f) => under(f, prefixes) && SOURCE_RE.test(f));
  const uncovered = picked.filter((f) => CONFIG_RE.test(f) || !existsSync(join(root, f)));
  return { inputs: picked.filter((f) => !uncovered.includes(f)).map((f) => resolve(root, f)), uncovered };
}

/** Group absolute test paths by the package dir that owns them (the deepest of the area dir and the shared packages). */
export function groupByOwner(root, area, tests) {
  const owners = [area.dir, ...sharedDirs(root)].sort((a, b) => b.length - a.length);
  const groups = new Map();
  for (const test of tests) {
    const repoRel = toPosix(relative(root, test));
    const owner = owners.find((o) => pathTouches([repoRel], [o])) ?? area.dir;
    (groups.get(owner) ?? groups.set(owner, []).get(owner)).push(toPosix(relative(join(root, owner), test)));
  }
  return groups;
}
