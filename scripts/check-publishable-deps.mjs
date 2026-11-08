#!/usr/bin/env node
/**
 * Publish guard: a published package must not need anything a registry install
 * cannot resolve.
 *
 *   node scripts/check-publishable-deps.mjs <package-dir>...
 *
 * 1. `dependencies`, `peerDependencies` and `optionalDependencies` are what a
 *    consumer's install resolves, so none may be `file:`, `link:`, `workspace:` or
 *    `portal:`. `devDependencies` may keep local links (private, bundled packages
 *    such as @webdit/* live there).
 * 2. When `dist` exists, every bare specifier its JS and declaration files import
 *    must be a declared dependency/peer, a Node builtin, or in ALLOWED_IMPORTS —
 *    so a private package that should have been bundled cannot leak through.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { undeclaredImports } from './lib/distImports.mjs';

const FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const LOCAL = /^(file|link|workspace|portal):/;
const BUILT_FILE = /\.(mjs|cjs|js|d\.ts|d\.mts|d\.cts)$/;

/** Packages a built file may import without declaring. Keep this empty unless a reason is written next to the entry. */
const ALLOWED_IMPORTS = [];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (BUILT_FILE.test(entry.name)) yield path;
  }
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: check-publishable-deps.mjs <package-dir>...');
  process.exit(2);
}

const problems = [];
for (const dir of dirs) {
  const root = resolve(dir);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (LOCAL.test(String(spec))) {
        problems.push(`${pkg.name}: ${field}["${name}"] = "${spec}" cannot be installed from the registry. Bundle it (tsup noExternal) and move it to devDependencies.`);
      }
    }
  }
  const dist = join(root, 'dist');
  if (!existsSync(dist)) continue;
  for (const file of walk(dist)) {
    const missing = undeclaredImports(readFileSync(file, 'utf8'), pkg, ALLOWED_IMPORTS);
    if (missing.length) {
      problems.push(`${pkg.name}: ${file.slice(root.length + 1)} imports undeclared package(s): ${missing.join(', ')}. Declare as a dependency/peer or bundle it.`);
    }
  }
}

if (problems.length) {
  console.error(`check-publishable-deps: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-publishable-deps: ${dirs.length} package(s) OK`);
