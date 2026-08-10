#!/usr/bin/env node
/**
 * Layering ratchet — the presentation layer must not reach into infrastructure.
 *
 * The api declares a DDD layering (presentation → application → domain, with
 * infrastructure behind the domain's repository interfaces). In practice 104 of
 * 147 route modules import `infrastructure/database/schema` and run SQL inline,
 * so an HTTP handler reaches past application AND domain straight into the
 * database. That is why tenant scoping, caching and validation all have to be
 * re-remembered per route instead of living in one place.
 *
 * Rewriting 104 route files is not a single pass, so this guard is a RATCHET, not
 * a wall:
 *
 *   - Every file that violates the rule TODAY is listed in the baseline file
 *     `scripts/.layering-baseline.txt`.
 *   - A NEW violation (a file not in the baseline) fails the build.
 *   - A file that has been CLEANED but is still listed also fails, with an
 *     instruction to delete its baseline line. The list can only shrink.
 *
 * So the debt is frozen at its current size and pays down monotonically: each
 * route that gets touched can drop off the list, and nothing can be added.
 *
 * The rule: nothing under `src/presentation/` may take a runtime dependency on
 * `src/infrastructure/`. Type-only imports are erased by TypeScript and therefore do
 * not cross the runtime boundary. Route modules should call an application service
 * (or a domain repository) instead. Middleware is held to the same rule.
 *
 * Run via `npm run check:layering` and wired into `npm test`.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const presentationDir = resolve(srcDir, 'presentation');
const baselineFile = resolve(here, '.layering-baseline.txt');

/** `--update` rewrites the baseline from the current tree (use when paying debt down in bulk). */
const UPDATE = process.argv.includes('--update');

/**
 * An import specifier that resolves into `src/infrastructure/`, written either
 * relatively (`../../infrastructure/…`) or via a path alias.
 */
const INFRA_IMPORT = /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+['"](?:(?:\.\.\/)+|@\/)infrastructure\//m;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Repo-relative, forward-slashed path used as the baseline key. */
function key(file) {
  return relative(srcDir, file).split('\\').join('/');
}

const current = new Set();
for (const file of collect(presentationDir)) {
  // Tests may reach for infrastructure to build fixtures — they are not the
  // shipped call graph and are exempt.
  if (file.endsWith('.test.ts')) continue;
  const text = readFileSync(file, 'utf8');
  if (INFRA_IMPORT.test(text)) current.add(key(file));
}

if (UPDATE) {
  const header =
    '# Presentation-layer files that still import from src/infrastructure/.\n' +
    '# This list may only SHRINK — see scripts/check-layering.mjs.\n' +
    '# Regenerate with: node scripts/check-layering.mjs --update\n';
  writeFileSync(baselineFile, header + [...current].sort().join('\n') + '\n', 'utf8');
  console.log(`Baseline rewritten: ${current.size} file(s).`);
  process.exit(0);
}

const baseline = new Set(
  existsSync(baselineFile)
    ? readFileSync(baselineFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
    : [],
);

const added = [...current].filter((f) => !baseline.has(f)).sort();
const cleaned = [...baseline].filter((f) => !current.has(f)).sort();

let failed = false;

if (added.length > 0) {
  failed = true;
  console.error(`❌  New presentation → infrastructure import(s) (${added.length}):\n`);
  for (const f of added) console.error(`      - ${f}`);
  console.error(
    '\n   A route/middleware must not query the database directly. Move the query into' +
      '\n   an application service (src/application/<context>/) and call that from the' +
      '\n   handler, or use a domain repository (src/domain/*/I*Repository.ts).' +
      '\n   The baseline in scripts/.layering-baseline.txt is frozen debt — it may only' +
      '\n   shrink, never grow.\n',
  );
}

if (cleaned.length > 0) {
  failed = true;
  console.error(`✅→❌  ${cleaned.length} baseline entr(ies) no longer violate — remove them so the ratchet holds:\n`);
  for (const f of cleaned) console.error(`      - ${f}`);
  console.error('\n   Delete those lines from scripts/.layering-baseline.txt (or run: node scripts/check-layering.mjs --update).\n');
}

if (failed) process.exit(1);

console.log(
  `✅  Layering ratchet OK — ${current.size} presentation file(s) still import infrastructure, ` +
    'all known; 0 new.',
);
