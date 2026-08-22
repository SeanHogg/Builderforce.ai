#!/usr/bin/env node
/**
 * Tenancy guard, schema half (PRD 20 §4) — every table carries `tenant_id`.
 *
 * `check-tenant-scope.mjs` already guards the QUERY half: a statement against a
 * tenant-owned table must filter by tenant. That guard is only as good as the set
 * of tables it considers owned — a table with no `tenant_id` column is invisible
 * to it, and every query against that table is unscoped by construction rather
 * than by omission. This is the other half: which tables have the column at all.
 *
 * It matters most for the merge. BurnRateOS's 404 models are scoped by
 * `company_id` and carry no tenant column, while every gate in this platform runs
 * on tenant. Converting them faithfully and adding tenancy afterwards means
 * touching all 404 twice, so the codemod has to stamp `tenant_id NOT NULL` in the
 * same pass (PRD 20 §5 step 4) — and this guard is what makes "in the same pass"
 * checkable rather than aspirational.
 *
 * NOT every table should have one. Global catalogues (countries, currencies,
 * model registries), platform-owned config and pure lookup tables are genuinely
 * tenant-independent — those are argued once in
 * `scripts/adjudications/tenant-column.mjs` and stop being counted. The baseline
 * is the rest: tables that still need that decision made. What the pair prevents
 * is a NEW customer-data table quietly joining either list.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrizzleReferences, parseDrizzleTables } from './lib/drizzleSchema.mjs';
import { reportRatchet } from './lib/ratchet.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const srcDir = resolve(here, '..', 'src');

/** Any of these means the row is already scoped to a tenant, directly or through
 *  a parent this platform treats as tenant-owned. */
const SCOPING_COLUMNS = ['tenant_id', 'segment_id', 'account_id'];


const tables = parseDrizzleTables(srcDir);
if (tables.size === 0) {
  console.error('❌  Parsed zero tables. The schema moved or the parser broke — failing rather than passing vacuously.');
  process.exit(1);
}

/**
 * INHERITED TENANCY, DERIVED RATHER THAN ADJUDICATED.
 *
 * A child row that hangs off a tenant-scoped parent by a NOT NULL foreign key with
 * ON DELETE CASCADE cannot outlive its parent and cannot belong to a different
 * tenant than the parent it cascades with. `creation_session_objects.session_id`,
 * `qa_run_steps.run_id`, `ide_training_logs.job_id` are all this shape: copying
 * `tenant_id` down would create a second place for one fact to be wrong, and the
 * database has no way to keep the two agreeing.
 *
 * This was previously hand-written, one paragraph per table, ~35 times over — the
 * same argument retyped for every child table in the schema. It is a STRUCTURAL
 * fact about the foreign key, so it is computed here instead. A new child table
 * that hangs off a scoped parent correctly is now silent, and only a table that
 * genuinely has nowhere to inherit from is a finding.
 *
 * The three conditions are all load-bearing and none is relaxed:
 *   • NOT NULL   — a nullable parent id means the row can exist orphaned, with no
 *                  tenant to inherit at all.
 *   • CASCADE    — anything else lets the child survive its parent's deletion, at
 *                  which point it belongs to a tenant that no longer owns it.
 *   • the parent is itself scoped, transitively — so a chain of cascading children
 *     (`ide_training_logs` → `ide_training_jobs` → `projects`) resolves, but a chain
 *     that bottoms out in an unscoped table does not.
 *
 * `users` is deliberately NOT a scoping parent. A user belongs to many tenants, so
 * inheriting from one tells you nothing about which tenant a row is in.
 */
function scopedByInheritance(tables, refs) {
  const direct = new Set(
    [...tables].filter(([, cols]) => SCOPING_COLUMNS.some((c) => cols.has(c))).map(([n]) => n),
  );
  const scoped = new Set(direct);
  // Fixed point: each pass can only add tables, so it terminates in at most one
  // pass per level of nesting.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, cols] of tables) {
      if (scoped.has(name)) continue;
      const inherits = (refs.get(name) ?? []).some(
        (r) => r.notNull && r.onDelete === 'cascade' && r.target && r.target !== name && scoped.has(r.target),
      );
      if (inherits) { scoped.add(name); changed = true; }
    }
  }
  for (const n of direct) scoped.delete(n);
  return scoped;
}

const inherited = scopedByInheritance(tables, parseDrizzleReferences(srcDir));

const findings = [];
for (const [name, cols] of [...tables].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (SCOPING_COLUMNS.some((c) => cols.has(c)) || inherited.has(name)) continue;
  findings.push({
    key: name,
    detail: 'no tenant_id / segment_id / account_id — if this holds customer data, every query against it is unscoped by construction.',
  });
}

await reportRatchet({
  name: 'check-tenant-column',
  baselinePath: resolve(here, '.tenant-column-baseline.txt'),
  findings,
  unit: 'table(s) with no tenant-scoping column',
  header: 'Tables carrying none of tenant_id / segment_id / account_id (PRD 20 §4). Global catalogues and platform config belong here; customer data does not.',
  fixHint:
    'A new table holds no tenant-scoping column, so `check-tenant-scope.mjs` cannot see it\n' +
    '    and no query against it can be checked. Add `tenant_id`, or record why it is global.',
  update: process.argv.includes('--update'),
});
