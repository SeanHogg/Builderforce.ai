#!/usr/bin/env node
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

/** `x.y.z` (prerelease/build stripped) → `[x, y, z]`, or null when it is not one. */
function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Whether `version` satisfies `range`. Covers the range forms these manifests use — exact `x.y.z`,
 * `^x.y.z`, `~x.y.z`, `>=x.y.z` — and returns null for any other form, which the caller reports as
 * unsupported rather than guessing.
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
  const op = match[1] ?? '=';
  if (op === '=') return compare(installed, floor) === 0;
  if (compare(installed, floor) < 0) return false;
  if (op === '>=') return true;
  if (op === '~') return installed[0] === floor[0] && installed[1] === floor[1];
  // `^`: the left-most non-zero component is fixed.
  if (floor[0] > 0) return installed[0] === floor[0];
  if (floor[1] > 0) return installed[0] === 0 && installed[1] === floor[1];
  return compare(installed, floor) === 0;
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
