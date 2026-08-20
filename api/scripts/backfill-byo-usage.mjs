#!/usr/bin/env node
/**
 * Backfill BYO attribution + pricing on historical `llm_usage_log` rows.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 * Every row written via `completeForTenant` → `recordProxyUsage` before the BYO
 * provenance fix landed has `byo = false` and a CATALOG-PRICED
 * `cost_usd_millicents`. Two consequences, and the second is the serious one:
 *   • those calls render as platform-funded in `/insights/ai`, so a tenant paying
 *     with their own key sees our spend attributed to them;
 *   • they were CHARGED for tokens their own provider account already paid for.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A MIGRATION ───────────────────────────────
 * The correction cannot be derived from the row alone. All we can do is infer:
 * "this row's model belongs to vendor V, and the tenant has a credential for V,
 * therefore the tenant probably paid." That inference is LOSSY IN ONE DIRECTION —
 * a credential connected AFTER the call would false-positive and zero out spend
 * that we really did fund. There is no timestamp on the credential row that
 * survives rotation (an upsert overwrites `created_at`'s meaning), so the code
 * cannot decide the boundary for you.
 *
 * ── THE ONE OPEN PARAMETER ─────────────────────────────────────────────────
 * `--cutoff=YYYY-MM-DD` is that boundary, and it is REQUIRED: rows older than it
 * are left alone. Choose it as the earliest date you are confident the tenant's
 * credential was already connected — typically the date BYO was launched to that
 * cohort, or (safest) the date of the oldest credential you are prepared to vouch
 * for. There is no default, deliberately: a wrong default here silently rewrites
 * revenue, and the script refuses to guess.
 *
 *   node scripts/backfill-byo-usage.mjs --cutoff=2026-06-01            # dry run
 *   node scripts/backfill-byo-usage.mjs --cutoff=2026-06-01 --apply    # write
 *   node scripts/backfill-byo-usage.mjs --cutoff=2026-06-01 --tenant=42
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without `--apply`, and the dry run
 * prints exactly the rows and dollar amounts that would change, per tenant and
 * per provider, so the correction can be reviewed before it is made.
 *
 * ── WHAT IT WRITES ─────────────────────────────────────────────────────────
 * For each matched row: `byo = true`, `byo_provider = <provider>`,
 * `byo_credential_id = <that provider's current credential id>` (0953), and
 * `cost_usd_millicents = 0` — the same four facts `recordUsageRow` would have
 * written had the provenance been carried at the time. It never touches a row
 * that is already `byo = true`, and never touches token counts.
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');

function readEnvFile(name) {
  const path = resolve(here, '..', name);
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const fileEnv = readEnvFile('.env');
const envVar = (n) => process.env[n] || fileEnv[n] || '';

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

const cutoff = flag('cutoff');
const apply = flag('apply') === true;
const tenantFilter = flag('tenant') ? Number(flag('tenant')) : null;

if (typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
  console.error('❌  --cutoff=YYYY-MM-DD is REQUIRED and has no default.\n');
  console.error('    Rows created BEFORE this date are left untouched. Inference from a');
  console.error('    connected credential cannot tell whether the credential existed at the');
  console.error('    time of the call, so a credential connected later would false-positive');
  console.error('    and zero out spend we really did fund. Pick the earliest date you are');
  console.error('    confident the tenant credentials were already connected.');
  process.exit(1);
}

/**
 * Gateway vendor id → BYO provider. Mirrors `providerForVendor` in
 * `application/llm/llmProviderCatalog.ts`; kept as data here because this script
 * runs under plain node without the TS build.
 */
const PROVIDER_BY_VENDOR = {
  anthropic: 'anthropic',
  openai: 'openai',
  'openai-codex': 'openai',
  googleai: 'google',
  meta: 'meta',
  'kimi-code': 'kimi',
  moonshot: 'moonshot',
  qwen: 'qwen',
  minimax: 'minimax',
  xai: 'xai',
  'xai-oauth': 'xai',
};

/**
 * Which provider does this model id belong to? Deliberately CONSERVATIVE: only ids
 * whose vendor is unambiguous from their prefix or their bare `claude-*` form are
 * matched. An OpenRouter `<org>/<slug>` id is NOT matched even when the org looks
 * like a provider name — `anthropic/claude-…` on OpenRouter is served by OUR key,
 * not the tenant's, and treating it as BYO would zero out spend we really funded.
 */
function providerForModel(model) {
  const id = String(model ?? '').trim();
  if (!id) return null;
  if (id.startsWith('claude-')) return 'anthropic';
  for (const prefix of ['direct/', 'googleai/', 'openai-codex/', 'xai-oauth/']) {
    if (id.startsWith(prefix)) {
      const rest = prefix === 'direct/' ? id.slice(prefix.length) : prefix.slice(0, -1);
      const vendor = prefix === 'direct/' ? rest.slice(0, rest.indexOf('/')) : rest;
      return PROVIDER_BY_VENDOR[vendor] ?? null;
    }
  }
  return null;
}

const url = envVar('NEON_TRANSACTIONAL_DATABASE_URL') || envVar('NEON_DATABASE_URL');
if (!url) {
  console.error('❌  Neither NEON_TRANSACTIONAL_DATABASE_URL nor NEON_DATABASE_URL is set.');
  process.exit(1);
}
const sql = neon(url);
// `tenant_llm_provider_keys` lives ONLY on the primary database; the usage log may
// live on the operational one. Read credentials from the primary either way.
const primarySql = neon(envVar('NEON_DATABASE_URL') || url);

console.log(`\nBYO usage backfill — cutoff ${cutoff}, ${apply ? 'APPLYING' : 'DRY RUN'}${tenantFilter ? `, tenant ${tenantFilter}` : ''}\n`);

const credentials = await primarySql`
  SELECT tenant_id, provider, id
  FROM tenant_llm_provider_keys
  ${tenantFilter ? primarySql`WHERE tenant_id = ${tenantFilter}` : primarySql``}
`;
const credByTenantProvider = new Map(
  credentials.map((r) => [`${r.tenant_id}:${r.provider}`, r.id]),
);
if (credByTenantProvider.size === 0) {
  console.log('No connected credentials found — nothing to attribute. Exiting.');
  process.exit(0);
}

const rows = await sql`
  SELECT id, tenant_id, model, cost_usd_millicents
  FROM llm_usage_log
  WHERE byo = false
    AND tenant_id IS NOT NULL
    AND created_at >= ${cutoff}::date
    ${tenantFilter ? sql`AND tenant_id = ${tenantFilter}` : sql``}
  ORDER BY id
`;

/** tenant:provider → { rows, millicents } */
const plan = new Map();
const updates = [];
for (const row of rows) {
  const provider = providerForModel(row.model);
  if (!provider) continue;
  const credentialId = credByTenantProvider.get(`${row.tenant_id}:${provider}`);
  if (!credentialId) continue; // tenant has no credential for this provider — leave it
  const key = `${row.tenant_id}:${provider}`;
  const acc = plan.get(key) ?? { rows: 0, millicents: 0 };
  acc.rows += 1;
  acc.millicents += Number(row.cost_usd_millicents ?? 0);
  plan.set(key, acc);
  updates.push({ id: row.id, provider, credentialId });
}

if (updates.length === 0) {
  console.log(`Scanned ${rows.length} candidate rows; none is attributable. Nothing to do.`);
  process.exit(0);
}

console.log(`Scanned ${rows.length} rows since ${cutoff}; ${updates.length} are attributable:\n`);
for (const [key, acc] of [...plan].sort((a, b) => b[1].millicents - a[1].millicents)) {
  const [tenantId, provider] = key.split(':');
  console.log(`   tenant ${tenantId.padStart(6)}  ${provider.padEnd(10)}  ${String(acc.rows).padStart(7)} rows   $${(acc.millicents / 100_000).toFixed(2)} refunded`);
}
const totalMillicents = [...plan.values()].reduce((n, a) => n + a.millicents, 0);
console.log(`\n   TOTAL: ${updates.length} rows, $${(totalMillicents / 100_000).toFixed(2)} of catalog-priced cost zeroed.\n`);

if (!apply) {
  console.log('Dry run — nothing written. Re-run with --apply to make the correction.');
  process.exit(0);
}

// Batched so one statement never carries an unbounded id list.
const BATCH = 500;
let written = 0;
for (const [key, credentialId] of groupByCredential(updates)) {
  const provider = key.split('|')[1];
  const ids = credentialId.ids;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    await sql`
      UPDATE llm_usage_log
      SET byo = true,
          byo_provider = ${provider},
          byo_credential_id = ${credentialId.id}::uuid,
          cost_usd_millicents = 0
      WHERE id = ANY(${slice}::int[])
        AND byo = false
    `;
    written += slice.length;
    process.stdout.write(`\r   written ${written}/${updates.length}`);
  }
}
console.log(`\n\n✅  Backfill complete: ${written} rows corrected.`);

/** `${credentialId}|${provider}` → { id, ids[] } so each UPDATE carries one credential. */
function groupByCredential(list) {
  const out = new Map();
  for (const u of list) {
    const key = `${u.credentialId}|${u.provider}`;
    const acc = out.get(key) ?? { id: u.credentialId, ids: [] };
    acc.ids.push(u.id);
    out.set(key, acc);
  }
  return out;
}
