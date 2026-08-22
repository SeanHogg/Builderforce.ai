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
import { parseDrizzleTables } from './lib/drizzleSchema.mjs';
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

const findings = [];
for (const [name, cols] of [...tables].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (SCOPING_COLUMNS.some((c) => cols.has(c))) continue;
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
