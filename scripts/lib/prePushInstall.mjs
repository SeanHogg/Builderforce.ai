/**
 * Is an area's pnpm install usable and current? Neither answer ever blocks a push: both are WARNINGS with the fix, and the
 * area's checks that depend on the install are demoted to warnings too (a stale tree fails on exports CI's fresh install has).
 *
 *   missing: `node_modules/.bin` does not exist (never installed).
 *   stale:   the `importers` section (the specifiers and versions this project asked for) of `pnpm-lock.yaml` differs from
 *            `node_modules/.pnpm/lock.yaml`, the lockfile pnpm last installed from. Only the importers are compared: pnpm's
 *            copy legitimately omits other fields, so a whole-file diff, or an mtime test alone, flags a plain checkout,
 *            stash or editor save. The (cheap) mtime test is only a prefilter that skips the parse when nothing is newer.
 *            Needs the `yaml` package from any installed project; without it nothing can be said and nothing is reported.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const SKEW_MS = 2000;
const YAML_FROM = ['frontend', 'api', 'clients/vscode'];

function loadYaml(root, dir) {
  for (const base of [dir, ...YAML_FROM]) {
    try { return createRequire(join(root, base, 'package.json'))('yaml'); } catch { /* try the next project's install */ }
  }
  return undefined;
}

const stable = (value) => JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

function importersOf(yaml, file) {
  const doc = yaml.parse(readFileSync(file, 'utf8'));
  return doc?.importers?.['.'] ?? (doc?.dependencies || doc?.devDependencies ? { dependencies: doc.dependencies, devDependencies: doc.devDependencies } : undefined);
}

/** @returns {{ missing?: string, stale?: string }} one-line reasons, each naming the fix. */
export function installIssues(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(join(abs, 'node_modules', '.bin'))) return { missing: `${dir}: no node_modules/.bin; run pnpm install in ${dir}` };
  const lock = join(abs, 'pnpm-lock.yaml');
  const modules = join(abs, 'node_modules', '.modules.yaml');
  const installed = join(abs, 'node_modules', '.pnpm', 'lock.yaml');
  if (![lock, modules, installed].every(existsSync) || statSync(lock).mtimeMs <= statSync(modules).mtimeMs + SKEW_MS) return {};
  try {
    const yaml = loadYaml(root, dir);
    if (!yaml) return {};
    const wanted = importersOf(yaml, lock);
    const had = importersOf(yaml, installed);
    if (wanted && had && stable(wanted) !== stable(had)) return { stale: `${dir}: stale install (pnpm-lock.yaml importers differ from the install); run pnpm install in ${dir}` };
  } catch { /* an unparseable lockfile says nothing about staleness */ }
  return {};
}
