#!/usr/bin/env node
/**
 * Copy the agent-run telemetry from CORE to the OPERATIONAL endpoint
 * (transactional-migrations/0013), ids preserved.
 *
 * WHY A COPY AND NOT A FRESH START. The other operational tables started empty on purpose
 * (logs nobody reads twice). These do not: `run_model_outcomes` is what the learned router
 * ranks models from, `tool_audit_daily` is the 400-day compliance record, and
 * `execution_claim_evidence` cites trail rows BY ID — which is why ids must survive.
 *
 * CUTOVER (operator). A push to main runs `db:migrate` and deploys the Worker in one job,
 * so new rows reach the operational endpoint before this runs. That is safe: 0013 starts
 * every operational sequence at 500M, above any core id, so copied rows keep their ids
 * and never collide. Until the copy runs, the moved surfaces show only post-deploy data.
 *   1. node scripts/copy-run-telemetry.mjs     — copies everything (re-run to catch any
 *                                                rows an old isolate wrote to core late)
 *   2. node scripts/copy-run-telemetry.mjs --purge-source
 *                                              — verifies every core row is present on the
 *                                                operational endpoint, then empties the core copies
 *
 * Idempotent: every insert is ON CONFLICT DO NOTHING, so a re-run copies only what is
 * missing. `--dry-run` reports counts and writes nothing.
 *
 * Reads NEON_DATABASE_URL (core) and NEON_TRANSACTIONAL_DATABASE_URL from api/.env or the
 * environment. Refuses to run when they are the same database.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { loadDotEnv } from './lib/loadDotEnv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(here, '../.env'));

const DRY = process.argv.includes('--dry-run');
const PURGE = process.argv.includes('--purge-source');
const BATCH = 500;
/** Head-room between core's highest id and the first id the operational endpoint hands
 *  out, so rows written to core during the cutover can still be copied with their own ids. */
const SEQUENCE_MARGIN = 1_000_000;

const coreUrl = process.env.NEON_DATABASE_URL?.trim();
const opsUrl = process.env.NEON_TRANSACTIONAL_DATABASE_URL?.trim();
if (!coreUrl || !opsUrl) {
  console.error('NEON_DATABASE_URL and NEON_TRANSACTIONAL_DATABASE_URL must both be set.');
  process.exit(1);
}
if (coreUrl === opsUrl) {
  console.error('Core and operational URLs are the same database — nothing to copy.');
  process.exit(1);
}
const core = neon(coreUrl);
const ops = neon(opsUrl);

/**
 * The relations, parents before children (claims before their evidence). `key` is the
 * keyset the copy pages on; `serial` names the sequence to advance afterwards.
 */
const TABLES = [
  { name: 'tool_audit_events', key: ['id'], serial: true },
  { name: 'tool_audit_daily', key: ['id'], serial: true },
  { name: 'execution_claims', key: ['id'], serial: false },
  { name: 'execution_claim_evidence', key: ['claim_id', 'tool_audit_event_id'], serial: false },
  { name: 'usage_snapshots', key: ['id'], serial: true },
  { name: 'brain_chat_trace', key: ['id'], serial: true },
  { name: 'run_context_state', key: ['id'], serial: true },
  { name: 'run_model_outcomes', key: ['id'], serial: true },
];

async function columnsOf(db, table) {
  const rows = await db(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

const ident = (name) => `"${name.replace(/"/g, '""')}"`;

async function copyTable({ name, key }) {
  const [coreCols, opsCols] = await Promise.all([columnsOf(core, name), columnsOf(ops, name)]);
  if (opsCols.length === 0) throw new Error(`${name} does not exist on the operational endpoint — run npm run db:migrate first.`);
  const cols = coreCols.filter((c) => opsCols.includes(c));
  const colList = cols.map(ident).join(', ');
  const keyList = key.map(ident).join(', ');

  let cursor = null;
  let read = 0;
  let written = 0;
  for (;;) {
    // Keyset paging on the table's own key, so a long copy never re-reads or skips rows.
    const after = cursor == null ? '' : `WHERE (${keyList}) > (${key.map((_, i) => `$${i + 1}`).join(', ')})`;
    const [{ batch }] = await core(
      `SELECT coalesce(json_agg(t), '[]'::json) AS batch FROM (SELECT ${colList} FROM ${ident(name)} ${after} ORDER BY ${keyList} LIMIT ${BATCH}) t`,
      cursor ?? [],
    );
    if (batch.length === 0) break;
    read += batch.length;
    if (!DRY) {
      const [{ n }] = await ops(
        `WITH ins AS (
           INSERT INTO ${ident(name)} (${colList})
           SELECT ${colList} FROM json_populate_recordset(NULL::${ident(name)}, $1::json)
           ON CONFLICT DO NOTHING RETURNING 1)
         SELECT count(*)::int AS n FROM ins`,
        [JSON.stringify(batch)],
      );
      written += n;
    }
    const last = batch[batch.length - 1];
    cursor = key.map((k) => last[k]);
  }
  return { read, written };
}

/** Move the operational sequence past core's highest id + the margin (never backwards). */
async function advanceSequence(name) {
  const [{ max: coreMax }] = await core(`SELECT coalesce(max(id), 0)::bigint AS max FROM ${ident(name)}`);
  const target = Number(coreMax) + SEQUENCE_MARGIN;
  if (DRY) return target;
  const [{ v }] = await ops(
    `SELECT setval(pg_get_serial_sequence($1, 'id'),
                   GREATEST($2::bigint, (SELECT coalesce(max(id), 0) FROM ${ident(name)}),
                            (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = $1 || '_id_seq')),
                   true) AS v`,
    [name, target],
  );
  return Number(v);
}

/** Every core row must already be on the operational endpoint before core is emptied. */
async function missingOnOps({ name, key }) {
  let cursor = null;
  let missing = 0;
  const keyList = key.map(ident).join(', ');
  for (;;) {
    const after = cursor == null ? '' : `WHERE (${keyList}) > (${key.map((_, i) => `$${i + 1}`).join(', ')})`;
    const [{ batch }] = await core(
      `SELECT coalesce(json_agg(t), '[]'::json) AS batch FROM (SELECT ${keyList} FROM ${ident(name)} ${after} ORDER BY ${keyList} LIMIT 5000) t`,
      cursor ?? [],
    );
    if (batch.length === 0) break;
    const [{ n }] = await ops(
      `SELECT count(*)::int AS n FROM json_populate_recordset(NULL::${ident(name)}, $1::json) k
        WHERE NOT EXISTS (SELECT 1 FROM ${ident(name)} o WHERE ${key.map((c) => `o.${ident(c)} = k.${ident(c)}`).join(' AND ')})`,
      [JSON.stringify(batch)],
    );
    missing += n;
    const last = batch[batch.length - 1];
    cursor = key.map((k) => last[k]);
  }
  return missing;
}

async function main() {
  // Rows written by the pre-move Worker carry no tenant on the trace; stamp them from the
  // chat while core still has both, so the copy carries a tenant the reader scopes on.
  if (!DRY) {
    await core(`UPDATE brain_chat_trace t SET tenant_id = c.tenant_id FROM brain_chats c WHERE c.id = t.chat_id AND t.tenant_id IS NULL`);
  }

  // The attach trigger would re-derive evidence for every copied claim (and refuse a claim
  // whose cited rows were never copied); the evidence is copied verbatim below instead.
  if (!DRY) await ops(`ALTER TABLE execution_claims DISABLE TRIGGER trg_execution_claim_attach_evidence`);
  try {
    for (const table of TABLES) {
      const { read, written } = await copyTable(table);
      const seq = table.serial ? ` · sequence → ${await advanceSequence(table.name)}` : '';
      console.log(`${DRY ? '[dry-run] ' : ''}${table.name}: ${read} core rows, ${written} newly copied${seq}`);
    }
  } finally {
    if (!DRY) await ops(`ALTER TABLE execution_claims ENABLE TRIGGER trg_execution_claim_attach_evidence`);
  }

  if (!PURGE) return;
  for (const table of TABLES) {
    const missing = await missingOnOps(table);
    if (missing > 0) {
      console.error(`Refusing to purge: ${table.name} has ${missing} core rows not on the operational endpoint. Re-run without --purge-source first.`);
      process.exit(1);
    }
  }
  if (DRY) {
    console.log('[dry-run] every core row is present on the operational endpoint; core copies would be emptied.');
    return;
  }
  // TRUNCATE, not DELETE: the claim tables are immutable by row trigger, and the eight are
  // a closed set (nothing else on core references them), so one statement empties them all.
  await core(`TRUNCATE ${TABLES.map((t) => ident(t.name)).join(', ')}`);
  console.log(`Core copies emptied: ${TABLES.map((t) => t.name).join(', ')}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
