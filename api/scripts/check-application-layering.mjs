/**
 * Inward-dependency ratchet — application, domain and infrastructure must not
 * import from the presentation layer.
 *
 * `check-layering.mjs` holds the OUTER edge (presentation must not reach into
 * infrastructure). This guard holds the other direction: a use case, a domain
 * rule or a repository that imports a route module or a middleware has inverted
 * the dependency arrow — the HTTP adapter is now load-bearing for business
 * logic, a route file cannot be split without breaking application code, and
 * every one of those imports is a latent cycle (`llmRoutes` importing the
 * application services that imported `llmRoutes` was exactly that, and one
 * module escaped it with a dynamic import).
 *
 * The review that landed this guard found 23 such imports and moved the worst
 * one (`resolveTenantPlan`, imported by six application modules) into
 * `application/tenant/tenantPlanSnapshot`. The rest are frozen here as a
 * baseline that may only SHRINK: removing a violation and forgetting the list is
 * itself a failure, so the list is the review.
 *
 * Run via `npm run check:application-layering`; wired into `npm test` through
 * `scripts/checks.manifest.mjs`. `--update` rewrites the baseline.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const innerDirs = ['application', 'domain', 'infrastructure'].map((d) => resolve(srcDir, d));
const baselineFile = resolve(here, '.application-layering-baseline.txt');

const UPDATE = process.argv.includes('--update');

/**
 * A runtime import (static or dynamic) that resolves into `src/presentation/`,
 * written relatively or via the `@/` alias. `import type` is exempt: a type-only
 * edge is erased at build time and cannot create a cycle.
 */
const PRESENTATION_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+['"](?:(?:\.\.\/)+|@\/)presentation\/|\bimport\(\s*['"](?:(?:\.\.\/)+|@\/)presentation\//m;

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const key = (file) => relative(srcDir, file).split('\\').join('/');

const current = new Set();
for (const dir of innerDirs) {
  for (const file of collect(dir)) {
    if (file.endsWith('.test.ts')) continue;
    if (PRESENTATION_IMPORT.test(readFileSync(file, 'utf8'))) current.add(key(file));
  }
}

if (UPDATE) {
  const header =
    '# Application/domain/infrastructure files that still import from src/presentation/.\n' +
    '# This list may only SHRINK — see scripts/check-application-layering.mjs.\n' +
    '# Regenerate with: node scripts/check-application-layering.mjs --update\n';
  writeFileSync(baselineFile, header + [...current].sort().join('\n') + (current.size ? '\n' : ''), 'utf8');
  console.log(`Baseline rewritten: ${current.size} file(s).`);
  process.exit(0);
}

const baseline = new Set(
  existsSync(baselineFile)
    ? readFileSync(baselineFile, 'utf8')
        .replace(/\r\n/g, '\n')
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
  console.error(`❌  New inner-layer → presentation import(s) (${added.length}):\n`);
  for (const f of added) console.error(`      - ${f}`);
  console.error(
    '\n   Application, domain and infrastructure code must not depend on a route or a' +
      '\n   middleware. Move the shared piece into src/application/<context>/ (or src/domain/)' +
      '\n   and import it from there in BOTH places — the route keeps working, and the' +
      '\n   dependency arrow points inward again. The baseline in' +
      '\n   scripts/.application-layering-baseline.txt is frozen debt — it may only shrink.\n',
  );
}

if (cleaned.length > 0) {
  failed = true;
  console.error(`✅→❌  ${cleaned.length} baseline entr(ies) no longer violate — remove them so the ratchet holds:\n`);
  for (const f of cleaned) console.error(`      - ${f}`);
  console.error('\n   Delete those lines from scripts/.application-layering-baseline.txt (or run: node scripts/check-application-layering.mjs --update).\n');
}

if (failed) process.exit(1);

console.log(
  `✅  Inner-layer ratchet OK — ${current.size} application/domain/infrastructure file(s) still import presentation, ` +
    'all known; 0 new.',
);
