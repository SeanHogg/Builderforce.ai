/**
 * Fail packaging when an installed dependency does not satisfy the range its consumer declares.
 *
 * WHY: bumping a range in `package.json` and refreshing the lockfile changes nothing on disk until
 * someone runs `pnpm install` — and the bundler packages whatever `node_modules` holds. VSIX builds
 * shipped `@seanhogg/builderforce-memory` 2026.10.35 under a declared `^2026.10.37`, and later the
 * memory engine's old O(n·m) `.gitignore` matcher after the range had already moved past it. The
 * packaging path therefore checks the packages whose copy the bundle pins (`PINNED_INSTALL_PACKAGES`,
 * `scripts/sourcePackages.mjs`) against the consumer's declared range, and refuses to package on a
 * mismatch.
 *
 * Usage: `node scripts/check-installed-ranges.mjs [consumerDir] [packageName ...]`
 * (default: cwd, and `PINNED_INSTALL_PACKAGES`). A name the consumer does not declare is skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_INSTALL_PACKAGES } from './sourcePackages.mjs';

/**
 * `x.y.z[-pre][+build]` → `{ core: [x, y, z], pre: [...identifiers] }`, or null when it is not one.
 * Build metadata is dropped (semver gives it no precedence); the prerelease is KEPT — stripping it
 * let `2026.10.82-beta.1` pass `^2026.10.82`.
 */
function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    String(version).trim(),
  );
  return match ? { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] } : null;
}

function compareCore(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Semver §11 prerelease precedence: none > any; numeric < alphanumeric; a longer set wins a tie. */
function comparePre(a, b) {
  if (!a.length || !b.length) return (a.length ? -1 : 0) + (b.length ? 1 : 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const aNum = /^\d+$/.test(a[i]);
    const bNum = /^\d+$/.test(b[i]);
    if (aNum && bNum) {
      if (Number(a[i]) !== Number(b[i])) return Number(a[i]) - Number(b[i]);
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

function compare(a, b) {
  return compareCore(a.core, b.core) || comparePre(a.pre, b.pre);
}

/**
 * Whether `version` satisfies `range`, by node-semver's rules. Covers the range forms these
 * manifests use — exact `x.y.z`, `^x.y.z`, `~x.y.z`, `>=x.y.z`, each optionally with a prerelease —
 * and returns null for any other form, which the caller reports as unsupported rather than guessing.
 *
 * A PRERELEASE install satisfies a range only when the range's comparator itself carries a
 * prerelease on the same `major.minor.patch` (`2026.10.82-beta.2` satisfies `^2026.10.82-beta.1`,
 * never `^2026.10.82` nor `^2026.10.81`): opting into one beta is not opting into every later one.
 *
 * @param {string} version Installed version.
 * @param {string} range   Declared range.
 * @returns {boolean | null}
 */
export function satisfiesRange(version, range) {
  const installed = parseVersion(version);
  const match = /^(\^|~|>=|=)?\s*(.+)$/.exec(String(range).trim());
  const floor = match ? parseVersion(match[2]) : null;
  if (!installed || !floor) return null;
  if (installed.pre.length && !(floor.pre.length && compareCore(installed.core, floor.core) === 0)) return false;
  const op = match[1] ?? '=';
  if (op === '=') return compare(installed, floor) === 0;
  if (compare(installed, floor) < 0) return false;
  if (op === '>=') return true;
  const [major, minor] = installed.core;
  if (op === '~') return major === floor.core[0] && minor === floor.core[1];
  // `^`: the left-most non-zero component is fixed.
  if (floor.core[0] > 0) return major === floor.core[0];
  if (floor.core[1] > 0) return major === 0 && minor === floor.core[1];
  return compareCore(installed.core, floor.core) === 0;
}

/**
 * Every declared package among `names` whose install under `consumerDir/node_modules` is missing
 * or outside the declared range.
 *
 * @param {string} consumerDir Absolute path of the consumer package.
 * @param {string[]} [names]   Packages to check; defaults to `PINNED_INSTALL_PACKAGES`.
 * @returns {{ name: string, declared: string, installed: string | null, reason: string }[]}
 */
export function installedRangeMismatches(consumerDir, names = PINNED_INSTALL_PACKAGES) {
  const manifest = JSON.parse(readFileSync(join(consumerDir, 'package.json'), 'utf8'));
  const declaredAll = { ...manifest.devDependencies, ...manifest.dependencies };
  const mismatches = [];
  for (const name of names) {
    const declared = declaredAll[name];
    if (typeof declared !== 'string') continue;
    const installedManifest = join(consumerDir, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(installedManifest)) {
      mismatches.push({ name, declared, installed: null, reason: 'not installed' });
      continue;
    }
    const installed = JSON.parse(readFileSync(installedManifest, 'utf8')).version ?? null;
    const ok = satisfiesRange(installed, declared);
    if (ok === null) mismatches.push({ name, declared, installed, reason: `unsupported range or version` });
    else if (!ok) mismatches.push({ name, declared, installed, reason: 'outside the declared range' });
  }
  return mismatches;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dirArg, ...nameArgs] = process.argv.slice(2);
  const consumerDir = resolve(dirArg ?? process.cwd());
  const mismatches = installedRangeMismatches(consumerDir, nameArgs.length ? nameArgs : undefined);
  if (mismatches.length) {
    for (const m of mismatches) {
      console.error(`[check-installed-ranges] ${m.name}: declared ${m.declared}, installed ${m.installed ?? '(none)'} — ${m.reason}.`);
    }
    console.error(`[check-installed-ranges] run \`pnpm install\` in ${consumerDir} before packaging.`);
    process.exit(1);
  }
  console.log('[check-installed-ranges] every pinned dependency satisfies its declared range.');
}
