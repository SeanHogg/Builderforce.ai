#!/usr/bin/env node
/**
 * Migration sequence guard (T9 · Platform · DB · CI steward).
 *
 * "Migration numbering is the one true serialization point." Two migration files
 * that share a numeric prefix are a latent bug: scripts/migrate.mjs sorts by FULL
 * filename so both apply in a deterministic order today, but a runner that dedupes
 * on the bare prefix token could silently SKIP one (the `0109`/`0111` collisions
 * that bit us). This guard fails the build on ANY duplicate numeric prefix that is
 * not explicitly grandfathered.
 *
 * The numeric prefix is the token before the first `_` (so `0068a_…` is distinct
 * from `0068_…` — intentional point-release inserts do not collide).
 *
 * Grandfathered historical collisions live in
 * migrations/.migration-collisions-allowlist.txt — they were applied identically
 * to every live DB before this guard existed, so renumbering them is a deliberate
 * release-level op, not a CI cleanup (tracked in the README gap register). A stale
 * allowlist entry (a prefix that no longer collides) is reported so the list can be
 * trimmed as the historical debt is paid down.
 *
 * Run via `npm run check:migrations` and wired into `npm test` so CI catches any
 * new collision before it ships.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const migrationsDir = resolve(here, '../migrations');
const allowlistFile = resolve(migrationsDir, '.migration-collisions-allowlist.txt');

const allowlist = existsSync(allowlistFile)
  ? new Set(
      readFileSync(allowlistFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#')),
    )
  : new Set();

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// Group by numeric prefix = the token before the first underscore.
const byPrefix = new Map(); // prefix -> string[] filenames
for (const file of files) {
  const us = file.indexOf('_');
  const prefix = us === -1 ? file.replace(/\.sql$/, '') : file.slice(0, us);
  if (!/^[0-9]/.test(prefix)) continue; // ignore non-numbered files
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(file);
}

const newCollisions = []; // [{ prefix, files }]
const collidingPrefixes = new Set();
for (const [prefix, group] of byPrefix) {
  if (group.length > 1) {
    collidingPrefixes.add(prefix);
    if (!allowlist.has(prefix)) newCollisions.push({ prefix, files: group });
  }
}

// Allowlist hygiene: an entry that no longer collides is dead weight.
const staleAllowlist = [...allowlist].filter((p) => !collidingPrefixes.has(p));

let failed = false;

if (newCollisions.length > 0) {
  failed = true;
  console.error('❌  Duplicate migration numbers detected:\n');
  for (const { prefix, files: group } of newCollisions) {
    console.error(`   ${prefix}:`);
    for (const f of group) console.error(`      - ${f}`);
  }
  console.error(
    '\n   Renumber the newer file of each pair into a free slot from your\n' +
      '   track\'s migration band (README → 🧵 Isolation Tracks). Never reuse a\n' +
      '   number. If the collision is historical and already deployed everywhere,\n' +
      '   add its prefix to migrations/.migration-collisions-allowlist.txt with a\n' +
      '   note — but new collisions must be renumbered, not allowlisted.',
  );
}

if (staleAllowlist.length > 0) {
  // Not a hard failure on its own — but if it is the ONLY finding we still exit
  // non-zero so the list gets trimmed; pair it with the collision failure above
  // otherwise.
  console.error(
    `\n⚠️  Stale collision-allowlist entries (no longer collide, remove them): ${staleAllowlist.join(', ')}`,
  );
  failed = true;
}

if (failed) process.exit(1);

const allowed = [...collidingPrefixes].filter((p) => allowlist.has(p));
console.log(
  `✅  Migration sequence OK — ${files.length} files, no new duplicate prefixes` +
    (allowed.length ? ` (${allowed.length} grandfathered: ${allowed.sort().join(', ')})` : '') +
    '.',
);
