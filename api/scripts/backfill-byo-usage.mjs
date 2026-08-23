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
 * ── HOW THE CORRECTION IS DERIVED ──────────────────────────────────────────
 * The row alone cannot say who paid, so two facts are joined to it:
 *
 *   1. WHICH PROVIDER the recorded model belongs to — `lib/byoProviderMap.mjs`,
 *      derived from `llmProviderCatalog.ts` + `vendors/registry.ts` rather than
 *      re-typed here, so a new provider or OAuth vendor alias cannot go missing.
 *      An OpenRouter `<org>/<slug>` id is never matched: `anthropic/claude-…` on
 *      OpenRouter is served by OUR key, and zeroing it would erase real spend.
 *
 *   2. WHETHER THE TENANT'S CREDENTIAL ALREADY EXISTED when the call was made —
 *      `tenant_llm_provider_keys.created_at`. This is the part that used to be
 *      guessed at with a hand-picked global `--cutoff`. It does not need to be:
 *      `setTenantProviderKey` upserts with `set: { id, key_enc, auth_type,
 *      updated_at }` and DOES NOT TOUCH `created_at`, so that column survives key
 *      rotation and means "when this tenant first connected this provider". A row
 *      older than its tenant's credential is therefore left alone by construction,
 *      per tenant and per provider, which is exactly the false positive — a key
 *      connected AFTER the call — that a single global date could only approximate.
 *
 *      (It is conservative in the other direction: a tenant who DISCONNECTED and
 *      reconnected has a later `created_at`, so their rows in between are skipped
 *      rather than wrongly zeroed. Under-correcting is recoverable; refunding spend
 *      we genuinely funded is not.)
 *
 * ── THE ONE OPEN PARAMETER ─────────────────────────────────────────────────
 * `--until=YYYY-MM-DD` is REQUIRED and has no default: the date the provenance fix
 * DEPLOYED. Before it, `byo = false` means "we never asked"; at and after it,
 * `byo = false` is the ledger's authoritative answer that the platform paid.
 * Running without an upper bound would re-attribute correctly-recorded
 * platform-funded rows as BYO and zero real revenue — so the bound is not optional,
 * and the code refuses to guess it. The dry run prints the earliest `byo = true`
 * row it can see as corroboration.
 *
 *   node scripts/backfill-byo-usage.mjs --until=2026-08-01            # dry run
 *   node scripts/backfill-byo-usage.mjs --until=2026-08-01 --apply    # write
 *   node scripts/backfill-byo-usage.mjs --until=2026-08-01 --tenant=42
 *   node scripts/backfill-byo-usage.mjs --until=2026-08-01 --since=2026-06-01
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without `--apply`, and the dry run
 * prints the rows and dollar amounts that would change per tenant+provider AND the
 * distinct model ids behind them — so the inference can be eyeballed before it is
 * made, not just its total.
 *
 * ── WHAT IT WRITES ─────────────────────────────────────────────────────────
 * For each matched row: `byo = true`, `byo_provider = <provider>`, and
 * `cost_usd_millicents` re-derived the way `computeRecordedCostMillicents` would
 * have: ZERO token cost, but the flat premium routing surcharge PRESERVED on a
 * `premium` row — that surcharge is what the tenant owes for using our metered
 * OpenRouter product and is independent of whose key paid the vendor. It never
 * touches a row that is already `byo = true`, and never touches token counts.
 *
 * `byo_credential_id` (0953) is left NULL unless `--stamp-credential` is passed.
 * The surrogate id is re-minted on every rotation, so the id readable TODAY is not
 * necessarily the instance that paid; NULL states honestly "BYO, instance unknown",
 * whereas stamping the current id would fabricate per-key-instance history. Pass
 * the flag only for a cohort you know has not rotated.
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadByoModelInference } from './lib/byoProviderMap.mjs';
import { numericConstant } from './lib/tsSource.mjs';

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

const until = flag('until');
const since = flag('since');
const apply = flag('apply') === true;
const stampCredential = flag('stamp-credential') === true;
const tenantFilter = flag('tenant') ? Number(flag('tenant')) : null;

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Checked FIRST so an operator reaching for the old flag reads why it is gone rather
// than a message about a flag they did not pass.
if (flag('cutoff') !== undefined) {
  console.error('❌  --cutoff no longer exists. Its job — guessing when a credential was');
  console.error('    connected — is now done per tenant+provider from');
  console.error('    tenant_llm_provider_keys.created_at. Pass --until (the provenance-fix');
  console.error('    deploy date), and --since only if you want an extra lower bound.');
  process.exit(1);
}
if (!isDate(until)) {
  console.error('❌  --until=YYYY-MM-DD is REQUIRED and has no default.\n');
  console.error('    It is the date the BYO provenance fix DEPLOYED, and rows created on or');
  console.error('    after it are left untouched. After that deploy `byo = false` is the');
  console.error('    ledger\'s authoritative answer that the PLATFORM paid; re-attributing');
  console.error('    those rows would zero revenue we really earned. Before it, `byo = false`');
  console.error('    only means the provenance was never carried.');
  process.exit(1);
}
if (since !== undefined && !isDate(since)) {
  console.error('❌  --since must be YYYY-MM-DD when given. It is an OPTIONAL extra lower');
  console.error('    bound; each row is already gated on its own credential\'s created_at.');
  process.exit(1);
}
if (since && since >= until) {
  console.error(`❌  --since=${since} is not before --until=${until}; that window selects nothing.`);
  process.exit(1);
}
if (flag('tenant') !== undefined && !Number.isSafeInteger(tenantFilter)) {
  console.error('❌  --tenant must be an integer tenant id.');
  process.exit(1);
}

/** The flat premium routing surcharge, read from the ledger that applies it. */
const PREMIUM_SURCHARGE_MILLICENTS = numericConstant(
  readFileSync(resolve(here, '..', 'src', 'application', 'llm', 'usageLedger.ts'), 'utf8'),
  'PREMIUM_REQUEST_SURCHARGE_MILLICENTS',
  'usageLedger.ts',
);

const { providerForModel } = loadByoModelInference();

const url = envVar('NEON_TRANSACTIONAL_DATABASE_URL') || envVar('NEON_DATABASE_URL');
if (!url) {
  console.error('❌  Neither NEON_TRANSACTIONAL_DATABASE_URL nor NEON_DATABASE_URL is set.');
  process.exit(1);
}
const sql = neon(url);
// `tenant_llm_provider_keys` lives ONLY on the primary database; the usage log may
// live on the operational one (`resolveUsageDatabase`). Read credentials from the
// primary either way — the two cannot be joined in SQL across Neon accounts, which is
// why the credential window is applied in JS below.
const primarySql = neon(envVar('NEON_DATABASE_URL') || url);

const usd = (millicents) => `$${(millicents / 100_000).toFixed(2)}`;
// The SAME expression works for a `timestamp` column (naive UTC, the operational
// ledger) and a `timestamptz` one (the primary), so both databases yield comparable
// absolute seconds and the credential window cannot be skewed by a server offset.
const EPOCH = `EXTRACT(EPOCH FROM created_at AT TIME ZONE 'UTC')`;

console.log(`\nBYO usage backfill — rows before ${until}${since ? `, from ${since}` : ''}, ${apply ? 'APPLYING' : 'DRY RUN'}${tenantFilter ? `, tenant ${tenantFilter}` : ''}\n`);

const credentials = await primarySql(
  `SELECT tenant_id, provider, id, ${EPOCH} AS connected_epoch
     FROM tenant_llm_provider_keys${tenantFilter ? ' WHERE tenant_id = $1' : ''}`,
  tenantFilter ? [tenantFilter] : [],
);
/** `tenant:provider` → { id, connectedEpoch } */
const credByTenantProvider = new Map(
  credentials.map((r) => [`${r.tenant_id}:${r.provider}`, { id: r.id, connectedEpoch: Number(r.connected_epoch) }]),
);
if (credByTenantProvider.size === 0) {
  console.log('No connected credentials found — nothing to attribute. Exiting.');
  process.exit(0);
}

const rowParams = [until];
let where = `byo = false AND tenant_id IS NOT NULL AND created_at < $1::date`;
if (since) { rowParams.push(since); where += ` AND created_at >= $${rowParams.length}::date`; }
if (tenantFilter) { rowParams.push(tenantFilter); where += ` AND tenant_id = $${rowParams.length}`; }

const rows = await sql(
  `SELECT id, tenant_id, model, cost_usd_millicents, premium, ${EPOCH} AS created_epoch
     FROM llm_usage_log
    WHERE ${where}
    ORDER BY id`,
  rowParams,
);

/** tenant:provider → { rows, refund, models: Map<model, count> } */
const plan = new Map();
/** Rows the model attributed but whose credential did not exist yet. */
let predatingCredential = 0;
const updates = [];
for (const row of rows) {
  const provider = providerForModel(row.model);
  if (!provider) continue;
  const credential = credByTenantProvider.get(`${row.tenant_id}:${provider}`);
  if (!credential) continue; // tenant has no credential for this provider — leave it
  if (Number(row.created_epoch) < credential.connectedEpoch) { predatingCredential++; continue; }

  // What `computeRecordedCostMillicents` would have recorded: no token cost, but the
  // flat routing surcharge stands on a premium row regardless of who paid the vendor.
  const correctedCost = row.premium ? PREMIUM_SURCHARGE_MILLICENTS : 0;
  const refund = Math.max(0, Number(row.cost_usd_millicents ?? 0) - correctedCost);

  const key = `${row.tenant_id}:${provider}`;
  const acc = plan.get(key) ?? { rows: 0, refund: 0, models: new Map() };
  acc.rows += 1;
  acc.refund += refund;
  acc.models.set(row.model, (acc.models.get(row.model) ?? 0) + 1);
  plan.set(key, acc);
  updates.push({ id: row.id, provider, credentialId: credential.id });
}

if (predatingCredential > 0) {
  console.log(`   ${predatingCredential} attributable rows PREDATE their tenant's credential and were skipped.\n`);
}

/**
 * Whether `--until` looks right, printed on EVERY dry run — including the one that
 * matches nothing. "Nothing to do" is ambiguous on its own: it reads identically
 * whether the ledger is clean or the window was simply pointed at the wrong dates,
 * and the operator has no way to tell those apart without this line.
 */
async function printCorroboration() {
  const [observed] = await sql(`SELECT MIN(created_at)::date AS first_byo, COUNT(*)::int AS n FROM llm_usage_log WHERE byo = true`, []);
  if (!observed?.n) {
    console.log('   Corroboration: no row anywhere carries byo = true — confirm the provenance fix\n   has actually deployed before trusting --until.\n');
    return;
  }
  const firstByo = new Date(observed.first_byo).toISOString().slice(0, 10);
  console.log(`   Corroboration: ${observed.n} rows already carry BYO provenance, the earliest dated ${firstByo}.`);
  console.log(firstByo >= until
    ? `   --until=${until} sits at or before that, which is the expected shape.\n`
    : `   ⚠  --until=${until} is AFTER it, so this window includes rows written once provenance\n      was already being recorded — for those, byo = false means the platform really paid.\n`);
}

if (updates.length === 0) {
  // Two different "nothing to do"s, and they mean opposite things: no candidate names
  // a provider the tenant holds a key for (the ledger is clean), versus every one was
  // ruled out by its credential's own start date (the window is simply too early).
  console.log(`Scanned ${rows.length} candidate rows; none is attributable.`);
  console.log(predatingCredential > 0
    ? `Every attributable row predates its tenant's credential, so none can be claimed as BYO.\n`
    : `Every one names a model no tenant holds a credential for, so all are platform-funded.\n`);
  if (!apply) await printCorroboration();
  process.exit(0);
}

console.log(`Scanned ${rows.length} rows before ${until}; ${updates.length} are attributable:\n`);
for (const [key, acc] of [...plan].sort((a, b) => b[1].refund - a[1].refund)) {
  const [tenantId, provider] = key.split(':');
  console.log(`   tenant ${tenantId.padStart(6)}  ${provider.padEnd(10)}  ${String(acc.rows).padStart(7)} rows   ${usd(acc.refund)} refunded`);
  // The model ids are the inference showing its work: a family match that looks wrong
  // is visible HERE, before anything is written, rather than in next month's invoice.
  for (const [model, count] of [...acc.models].sort((a, b) => b[1] - a[1])) {
    console.log(`              ${model.padEnd(44)} ${String(count).padStart(7)} rows`);
  }
}
const totalRefund = [...plan.values()].reduce((n, a) => n + a.refund, 0);
console.log(`\n   TOTAL: ${updates.length} rows, ${usd(totalRefund)} of catalog-priced cost reversed.`);
console.log(`   byo_credential_id: ${stampCredential ? 'stamped with each provider\'s CURRENT credential id' : 'left NULL (pass --stamp-credential to attach it)'}\n`);

if (!apply) {
  await printCorroboration();
  console.log('Dry run — nothing written. Re-run with --apply to make the correction.');
  process.exit(0);
}

// Batched so one statement never carries an unbounded id list. Grouped by the two
// values that vary per statement; the surcharge is decided per ROW by the CASE, so a
// premium row keeps what it genuinely owes without a second pass.
const BATCH = 500;
let written = 0;
for (const [, group] of groupByTarget(updates)) {
  for (let i = 0; i < group.ids.length; i += BATCH) {
    const slice = group.ids.slice(i, i + BATCH);
    const updated = await sql(
      `UPDATE llm_usage_log
          SET byo = true,
              byo_provider = $1,
              byo_credential_id = $2::uuid,
              cost_usd_millicents = CASE WHEN premium THEN $3 ELSE 0 END
        WHERE id = ANY($4::int[])
          AND byo = false
        RETURNING id`,
      [group.provider, stampCredential ? group.credentialId : null, PREMIUM_SURCHARGE_MILLICENTS, slice],
    );
    written += updated.length;
    process.stdout.write(`\r   written ${written}/${updates.length}`);
  }
}
console.log(`\n\n✅  Backfill complete: ${written} rows corrected.`);
if (written !== updates.length) {
  console.log(`   ${updates.length - written} rows were already byo = true by the time the UPDATE ran and were left as they were.`);
}

/** `provider|credentialId` → { provider, credentialId, ids[] } — one UPDATE per target. */
function groupByTarget(list) {
  const out = new Map();
  for (const u of list) {
    const key = `${u.provider}|${u.credentialId}`;
    const acc = out.get(key) ?? { provider: u.provider, credentialId: u.credentialId, ids: [] };
    acc.ids.push(u.id);
    out.set(key, acc);
  }
  return out;
}
