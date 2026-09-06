/**
 * Project-ownership ratchet — "this project belongs to this tenant" is written ONCE.
 *
 * The gate lives in `src/application/project/projectOwnership.ts`
 * (`projectInTenant` / `loadProjectInTenant`). Every hand-written copy —
 * a `select … from(projects) where(eq(projects.id, …), eq(projects.tenantId, …))`
 * anywhere else — is one edit away from a cross-tenant read: drop the tenant
 * predicate while "simplifying" and a guessed number reads another tenant's
 * project. The 2026-09-05 review found twenty-one such copies in eighteen
 * application modules and migrated them; this guard is what keeps the count
 * from climbing back.
 *
 * What counts: a statement that selects FROM `projects` and filters by BOTH
 * `projects.id` and `projects.tenantId`. Updates and deletes are not the gate
 * (they are the write that follows it); a select that also filters by
 * `projects.segmentId` is the segment-scoped variant, which has no shared
 * helper yet and is frozen here as baseline rather than exempted, so adding
 * one more copy of THAT is also a failure.
 *
 * Run via `npm run check:project-ownership`; wired into `npm test` through
 * `scripts/checks.manifest.mjs`. `--update` rewrites the baseline.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const baselineFile = resolve(here, '.project-ownership-baseline.txt');
const OWNER_FILE = 'application/project/projectOwnership.ts';

const UPDATE = process.argv.includes('--update');

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const key = (file) => relative(srcDir, file).split('\\').join('/');

/**
 * Statements are cut at `;`. A statement is an inline ownership gate when it
 * selects from `projects` and names both predicates. The `db.select(` prefix
 * check keeps `update(projects)` / `delete(projects)` (the writes) out.
 */
function inlineGates(text) {
  let count = 0;
  for (const stmt of text.split(';')) {
    if (!/\.select\(/.test(stmt)) continue;
    if (!/\.from\(projects\)/.test(stmt)) continue;
    if (!/eq\(projects\.id,/.test(stmt)) continue;
    if (!/eq\(projects\.tenantId,/.test(stmt)) continue;
    count += 1;
  }
  return count;
}

const current = new Map();
for (const file of collect(srcDir)) {
  const k = key(file);
  if (k === OWNER_FILE) continue;
  const n = inlineGates(readFileSync(file, 'utf8'));
  if (n > 0) current.set(k, n);
}

if (UPDATE) {
  const header =
    '# Files that still write the project-in-tenant gate inline (count per file).\n' +
    '# This list may only SHRINK — see scripts/check-project-ownership.mjs.\n' +
    '# Regenerate with: node scripts/check-project-ownership.mjs --update\n';
  const body = [...current.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, n]) => `${f} ${n}`).join('\n');
  writeFileSync(baselineFile, header + body + (current.size ? '\n' : ''), 'utf8');
  console.log(`Baseline rewritten: ${current.size} file(s).`);
  process.exit(0);
}

const baseline = new Map(
  existsSync(baselineFile)
    ? readFileSync(baselineFile, 'utf8')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
        .map((l) => { const [f, n] = l.split(/\s+/); return [f, Number(n) || 0]; })
    : [],
);

const grew = [...current.entries()].filter(([f, n]) => n > (baseline.get(f) ?? 0)).sort();
const improved = [...baseline.entries()].filter(([f, n]) => (current.get(f) ?? 0) < n).sort();

let failed = false;

if (grew.length > 0) {
  failed = true;
  console.error(`❌  New inline project-ownership gate(s) (${grew.length} file(s)):\n`);
  for (const [f, n] of grew) console.error(`      - ${f}  ${baseline.get(f) ?? 0} → ${n}`);
  console.error(
    '\n   "This project belongs to this tenant" is written once, in' +
      '\n   src/application/project/projectOwnership.ts. Use projectInTenant(db, tenantId, id)' +
      '\n   for the yes/no, or loadProjectInTenant(db, tenantId, id, { …columns }) when the' +
      '\n   caller needs columns of the project it was handed an id for — the ownership' +
      '\n   predicate and the column read are one query and one rule.\n',
  );
}

if (improved.length > 0) {
  failed = true;
  console.error(`✅→❌  ${improved.length} file(s) improved — lower their baseline so the ratchet holds:\n`);
  for (const [f, n] of improved) console.error(`      - ${f}  ${n} → ${current.get(f) ?? 0}`);
  console.error('\n   Run: node scripts/check-project-ownership.mjs --update\n');
}

if (failed) process.exit(1);

const total = [...current.values()].reduce((a, b) => a + b, 0);
console.log(`✅  Project-ownership ratchet OK — ${current.size} file(s) still inline (${total} statement(s)); 0 new.`);
