#!/usr/bin/env node
/**
 * Idempotent publish guard.
 *
 * Reads the version from sdk/package.json and queries the npm registry. If
 * the version is already published, exit 0 silently. If it's new, run
 * `npm publish` (which honours the package.json `publishConfig.access` and
 * any active `npm whoami` / `NPM_TOKEN`).
 *
 * Wired into CI on push to main so version bumps land on npm automatically
 * without duplicate-publish errors on retried runs.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const pkgPath = resolve(here, '../package.json');

/**
 * Wrap execSync with consistent options. Uses the system shell so npm's
 * platform-specific stub (`npm` on Linux, `npm.cmd` on Windows) resolves
 * correctly without per-platform branching at every call site.
 */
function runNpm(args, opts = {}) {
  return execSync(`npm ${args}`, {
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    cwd: opts.cwd ?? process.cwd(),
  });
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const { name, version } = pkg;

if (!name || !version) {
  console.error(`Could not read name/version from ${pkgPath}`);
  process.exit(1);
}

console.log(`Checking npm registry for ${name}@${version} ...`);

let alreadyPublished = false;
try {
  // `npm view <pkg>@<version> version` → prints version if exists, exits 0.
  // Exits non-zero if not found.
  const out = runNpm(`view ${name}@${version} version`).trim();
  alreadyPublished = out === version;
} catch (err) {
  // Two failure modes:
  //  1. Version not published yet → expected, proceed to publish.
  //  2. Network / auth error → also surfaces as a thrown exec — re-throw so
  //     CI fails loudly rather than silently skipping the publish.
  const stderr = (err?.stderr ?? '').toString();
  if (!stderr.includes('E404') && !stderr.includes('Not Found') && !stderr.includes('is not in this registry')) {
    console.error('Unexpected error querying npm registry:');
    console.error(stderr || err?.message || err);
    process.exit(1);
  }
}

if (alreadyPublished) {
  console.log(`${name}@${version} is already on npm — skipping publish.`);
  process.exit(0);
}

console.log(`${name}@${version} is new — publishing ...`);
runNpm('publish --provenance --access public', {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
});
console.log(`Published ${name}@${version}.`);
