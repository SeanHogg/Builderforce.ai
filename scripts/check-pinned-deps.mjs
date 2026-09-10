#!/usr/bin/env node
/**
 * Pinned-dependency guard.
 *
 * `scripts/pinnedDependencies.mjs` declares the version. This file is the only
 * thing that makes it true, and it exists because the alternative was tried: the
 * number was written into eight manifests by hand, three projects that resolved
 * the package had no entry at all, and nothing in the repo could tell the
 * difference. A pin nobody checks is a comment.
 *
 * THREE RULES:
 *
 *  1. RESOLVED. Every version a lockfile resolves for a pinned package is the
 *     pinned version. This is the rule that actually ships — it reads what will
 *     be installed rather than what a manifest asked for.
 *
 *  2. DECLARED. A project whose lockfile resolves a pinned package states the pin
 *     in its own manifest, in `overrides` or `pnpm.overrides`. Rule 1 can pass on
 *     a lockfile that happens to be right today; without an override the next
 *     resolution is free to drift, which is how `worker` ended up two patches
 *     behind under `miniflare` with nothing in its manifest mentioning the
 *     package at all.
 *
 *  3. STATED ONCE, CONSISTENTLY. Where a manifest names a pinned package more
 *     than once — a direct dependency AND an override — every statement is the
 *     pinned version. A manifest that pins one number and depends on another
 *     resolves whichever the installer reaches first.
 *
 * Projects are DISCOVERED, not listed: the guard walks the repo for manifests and
 * lockfiles. The inventory that prompted this guard named eight projects and
 * there were eleven.
 *
 * Run: `node scripts/check-pinned-deps.mjs` from anywhere in the repo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_DEPENDENCIES, declaredPins, lockedVersions, statesOverride } from './pinnedDependencies.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that never hold a project of ours. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.wrangler', 'coverage', '.turbo']);

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json'];

/**
 * Every directory holding a `package.json`, with whatever lockfiles sit beside it.
 * A project with no lockfile is still checked for rule 3 — it declares versions
 * that an install will act on even though nothing here records the result.
 */
function discoverProjects(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) {
    found.push({
      dir,
      manifestPath: join(dir, 'package.json'),
      lockPaths: LOCKFILES.map((name) => join(dir, name)).filter((path) => existsSync(path)),
    });
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    discoverProjects(join(dir, entry.name), found);
  }
  return found;
}

const failures = [];
const projects = discoverProjects(repoRoot);
let lockfilesRead = 0;
let projectsHolding = 0;

for (const { dir, manifestPath, lockPaths } of projects) {
  const where = relative(repoRoot, dir).split('\\').join('/') || '.';
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push({ where, rule: 'manifest', detail: `package.json could not be read: ${error.message}` });
    continue;
  }

  for (const pin of PINNED_DEPENDENCIES) {
    const resolved = new Map();
    for (const lockPath of lockPaths) {
      const versions = lockedVersions(readFileSync(lockPath, 'utf8'), lockPath, pin.name);
      lockfilesRead += 1;
      if (versions.size > 0) resolved.set(relative(repoRoot, lockPath).split('\\').join('/'), versions);
    }

    const declared = declaredPins(manifest, pin.name);
    const holds = resolved.size > 0 || declared.length > 0;
    if (holds) projectsHolding += 1;

    // Rule 1 — what a lockfile will install.
    for (const [lockPath, versions] of resolved) {
      const wrong = [...versions].filter((version) => version !== pin.version);
      if (wrong.length > 0) {
        failures.push({
          where,
          rule: 'resolved',
          pin,
          detail: `${lockPath} resolves ${pin.name} ${wrong.join(', ')}, not ${pin.version}`,
        });
      }
    }

    // Rule 2 — an override is what keeps the next resolution from drifting.
    if (resolved.size > 0 && !statesOverride(manifest, pin.name)) {
      failures.push({
        where,
        rule: 'declared',
        pin,
        detail: `resolves ${pin.name} transitively but its package.json states no override for it`,
      });
    }

    // Rule 3 — every statement in one manifest agrees.
    for (const { where: field, value } of declared) {
      if (value !== pin.version) {
        failures.push({
          where,
          rule: 'consistent',
          pin,
          detail: `package.json ${field}.${pin.name} is "${value}", not "${pin.version}"`,
        });
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Pinned-dependency check failed — ${failures.length} problem(s):\n`);
  for (const { where, rule, pin, detail } of failures) {
    console.error(`  ${where} · ${rule}`);
    console.error(`    ${detail}`);
  }
  const named = [...new Set(failures.map((failure) => failure.pin?.name).filter(Boolean))];
  for (const name of named) {
    const pin = PINNED_DEPENDENCIES.find((entry) => entry.name === name);
    console.error(`\n  Why ${name} is pinned at ${pin.version}:\n    ${pin.reason}`);
  }
  console.error(
    '\n  To fix: put the pin in the project\'s "pnpm.overrides" (or "overrides" for an npm'
    + '\n  project), then regenerate its lockfile — `pnpm install --lockfile-only` or'
    + '\n  `npm install --package-lock-only`. To move a pin, edit scripts/pinnedDependencies.mjs'
    + '\n  and regenerate every lockfile that carries it; the version lives in exactly one place.',
  );
  process.exit(1);
}

const names = PINNED_DEPENDENCIES.map((pin) => `${pin.name}@${pin.version}`).join(', ');
console.log(
  `Pinned-dependency check passed: ${PINNED_DEPENDENCIES.length} pin(s) (${names}) held across `
  + `${projectsHolding} project(s), ${lockfilesRead} lockfile(s) read of ${projects.length} discovered.`,
);
