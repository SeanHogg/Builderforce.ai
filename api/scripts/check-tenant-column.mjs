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
 * tenant-independent. Those live in the baseline. What the baseline prevents is a
 * NEW customer-data table quietly joining them.
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

/**
 * Tables that are genuinely tenant-independent, with the reason recorded.
 *
 * Two kinds qualify: a GLOBAL CATALOGUE, which is the same rows for every
 * tenant, and a PRE-TENANT row, which is written before a tenant exists to scope
 * it to. Both are decisions; neither is an omission.
 *
 * The baseline is for tables that still need a decision; this is for tables the
 * decision was made about. Keeping them apart matters because `--update`
 * rewrites the baseline and would drop any comment explaining an entry, and a
 * global catalogue with no argument attached is indistinguishable from a
 * customer-data table somebody forgot to scope — which is the exact failure this
 * guard exists to catch.
 */
const TENANT_INDEPENDENT = new Map([
  ['cities', 'a geographic catalogue — the same city for every tenant, and the join key for territory and search-by-place.'],
  ['countries', 'ISO country list. Global by definition.'],
  ['stage_lookup', 'the platform-wide company-stage vocabulary a tenant selects FROM; a tenant-owned stage is a `pipeline_stages` row.'],
  ['email_otp_challenges', 'PRE-TENANT: a signup challenge is issued before the account exists. Scoped by (user_ref, purpose), which is narrower than tenant, not looser. Absorbed `email_verification_codes`, which was baselined here for the same reason.'],
  ['marketing_sessions', 'PRE-TENANT: an anonymous visitor IS the row, and it is written on their first prompt — before an account, and therefore before a tenant, exists. Scoped by the opaque `visitor_id`, which is narrower than tenant. Moved out of the baseline (0434) because it is a decision, not an omission.'],
  ['marketing_session_prompts', 'PRE-TENANT: the prompts behind a `marketing_sessions` row, written on the same pre-signup path and scoped by the same `visitor_id` (0434).'],
  ['web_search_robots', 'a cache of the public robots.txt policy for a DNS domain. The policy and its expiry are identical for every tenant; tenant-owned crawl sources and frontier rows remain tenant-scoped.'],
  // `developer_orgs` and `developer_org_members` were declared here on the
  // argument that a publisher is not a tenant. Migration 0472 rejected that: a
  // developer IS a tenant, both tables are gone, and `extension_packages` now
  // carries the publisher's `tenant_id` like everything else. That the exemption
  // could be argued for at all is what this map is supposed to surface — the
  // reason is written down precisely so it can be re-read and overruled.
  ['extension_versions', 'the immutable versions of an `extension_packages` row. Tenancy is INHERITED through `package_id` — the publisher owns the package, and a version cannot belong to a different workspace than the package it versions. Copying `tenant_id` down would be a second place for the same fact to be wrong.'],
  ['extension_categories', 'the public directory\'s category taxonomy (1094) — platform configuration, identical for every workspace, and the vocabulary a published listing files itself under. A tenant-scoped copy would mean one workspace\'s "finance" was a different category from another\'s, in a directory whose entire purpose is that a stranger can find a listing under the same name the publisher chose.'],
  ['extension_review_stages', 'one stage of the review pipeline for an `extension_versions` row (1094). Tenancy is INHERITED through `version_id` → `package_id`, exactly as `extension_versions` inherits it. The `sandbox_tenant_id` column names the workspace the DYNAMIC stage installed into, which is a piece of evidence about where the stage ran and is deliberately not a scoping column — scoping a review by the sandbox it borrowed would hand the sandbox ownership of every publisher\'s submissions.'],
]);

const tables = parseDrizzleTables(srcDir);
if (tables.size === 0) {
  console.error('❌  Parsed zero tables. The schema moved or the parser broke — failing rather than passing vacuously.');
  process.exit(1);
}

const findings = [];
for (const [name, cols] of [...tables].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (SCOPING_COLUMNS.some((c) => cols.has(c)) || TENANT_INDEPENDENT.has(name)) continue;
  findings.push({
    key: name,
    detail: 'no tenant_id / segment_id / account_id — if this holds customer data, every query against it is unscoped by construction.',
  });
}

reportRatchet({
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
