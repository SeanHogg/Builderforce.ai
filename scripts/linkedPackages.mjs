/**
 * The repo's `link:`ed local packages — how a consumer's manifest names them.
 *
 * The repo is a set of SEPARATELY installed packages that reference each other with
 * `link:../..` specifiers (deliberately not a pnpm workspace). Two scripts walk that
 * graph for different reasons — `ensure-linked-deps.mjs` installs each linked package's
 * own dependencies, `ensure-linked-builds.mjs` rebuilds a linked package whose shipped
 * `dist/` is older than its source — and both read it through these helpers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const LINK_PREFIXES = ['link:', 'file:'];

export function readManifest(dir) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Local packages this manifest links, as absolute directories. */
export function linkedTargets(dir, manifest) {
  const specs = { ...manifest.dependencies, ...manifest.devDependencies };
  return Object.values(specs)
    .filter((spec) => typeof spec === 'string' && LINK_PREFIXES.some((p) => spec.startsWith(p)))
    .map((spec) => spec.slice(spec.indexOf(':') + 1))
    .map((target) => (isAbsolute(target) ? target : resolve(dir, target)))
    .filter((target) => existsSync(join(target, 'package.json')));
}
