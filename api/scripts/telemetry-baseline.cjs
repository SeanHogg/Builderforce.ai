#!/usr/bin/env node
/**
 * telemetry-baseline.cjs — reproduce PRD 35 §8.1 from the live ops DB, per entry point.
 *
 * READ-ONLY: SELECTs only — it never writes, migrates or mutates. Telemetry lives on the
 * ops database (NEON_TRANSACTIONAL_DATABASE_URL, required). Connection URLs are read from
 * the environment and NEVER printed (an error message is scrubbed of any URL first).
 *
 * §8.1, per entry point, over a window (default: the 30 days to now):
 *   failure rate      run_model_outcomes: terminal_status <> 'completed' ÷ runs
 *   steps per run     run_model_outcomes: AVG(steps), and AVG(steps) of the failed runs
 *   prompt-cache hit  llm_usage_log: SUM(cache_read_tokens) ÷ SUM(prompt_tokens)
 * plus the §8.2 outcome-row columns WS6 added (how far each entry point fills them).
 *
 * How a row is attributed (§8.1) — the WS6 `entry_point` label first, else:
 *   run_model_outcomes  source 'ide' → vscode · 'cloud' → cloud · 'onprem' → on-prem
 *   llm_usage_log       tenant_api_key_id of a key minted for the VS Code client
 *                       (core `tenant_api_keys.client = 'vscode'`; its `surface` is
 *                       clamped to 'web') → vscode · surface 'cloud' with an execution
 *                       id → cloud · use_case 'brain_agent_reply' → @-reply
 * The VS Code key ids are read from core (NEON_DATABASE_URL, optional, one SELECT). Without
 * it only labelled rows count as VS Code usage, and the script says so.
 *
 * Usage: node scripts/telemetry-baseline.cjs [--days=30] [--until=2026-10-25] [--entry-point=vscode|cloud|…|all]
 */
'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { neon } = require('@neondatabase/serverless');

// Load api/.env without a dotenv dep (same pattern as api/scripts/*.mjs).
function loadDotEnv(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(resolve(__dirname, '..', '.env'));

const opsUrl = process.env.NEON_TRANSACTIONAL_DATABASE_URL;
if (!opsUrl) {
  console.error('NEON_TRANSACTIONAL_DATABASE_URL is not set; nothing to read.');
  process.exit(1);
}
const coreUrl = process.env.NEON_DATABASE_URL;

function argOf(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const days = Number(argOf('days', '30'));
if (!Number.isInteger(days) || days < 1 || days > 365) {
  console.error('--days must be an integer from 1 to 365.');
  process.exit(1);
}
const untilArg = argOf('until', '');
const until = untilArg ? new Date(`${untilArg}T00:00:00Z`) : new Date();
if (Number.isNaN(until.getTime())) {
  console.error('--until must be a date (YYYY-MM-DD).');
  process.exit(1);
}
const since = new Date(until.getTime() - days * 86_400_000);
const only = argOf('entry-point', 'all');

/** Never let a connection string reach the terminal, even inside a driver error. */
function scrub(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, '<connection url>');
}

const OUTCOME_BUCKET = `COALESCE(entry_point,
  CASE source WHEN 'ide' THEN 'vscode' WHEN 'cloud' THEN 'cloud' WHEN 'onprem' THEN 'on-prem' ELSE source END)`;

const OUTCOMES_SQL = `
  SELECT ${OUTCOME_BUCKET} AS entry_point,
         count(*)::int                                                         AS runs,
         count(*) FILTER (WHERE terminal_status <> 'completed')::int           AS failed,
         round(100.0 * count(*) FILTER (WHERE terminal_status <> 'completed') / count(*), 1) AS failure_pct,
         round(avg(steps), 1)                                                  AS steps_per_run,
         round(avg(steps) FILTER (WHERE terminal_status <> 'completed'), 1)    AS steps_failed,
         count(entry_point)::int                                               AS s82_rows,
         round(avg(compactions) FILTER (WHERE entry_point IS NOT NULL), 2)     AS compactions,
         round(avg(stall_recoveries) FILTER (WHERE entry_point IS NOT NULL), 2) AS stall_recoveries,
         round(avg(escalations) FILTER (WHERE entry_point IS NOT NULL), 2)     AS escalations,
         count(*) FILTER (WHERE verify = 'failed')::int                        AS verify_failed,
         round(avg(first_spawn_turn), 1)                                       AS first_spawn_turn,
         round(avg(covered_read_stubs), 1)                                     AS covered_read_stubs,
         round(avg(shell_file_reads), 1)                                       AS shell_file_reads,
         round(avg(repo_errors), 2)                                            AS repo_errors,
         round(avg(unkept_ready_claims), 2)                                    AS unkept_ready_claims
    FROM run_model_outcomes
   WHERE created_at >= $1 AND created_at < $2
   GROUP BY 1
   ORDER BY runs DESC`;

const USAGE_BUCKET = `COALESCE(entry_point, CASE
  WHEN tenant_api_key_id::text = ANY($3::text[]) THEN 'vscode'
  WHEN surface = 'cloud' AND execution_id IS NOT NULL THEN 'cloud'
  WHEN use_case = 'brain_agent_reply' THEN '@-reply'
  ELSE 'other' END)`;

// `calls` (not COUNT(*)): a day the grain rollup folded is one row standing for many calls.
const USAGE_SQL = `
  SELECT ${USAGE_BUCKET} AS entry_point,
         coalesce(sum(calls), 0)::int                                          AS calls,
         coalesce(sum(prompt_tokens), 0)::bigint                               AS prompt_tokens,
         coalesce(sum(cache_read_tokens), 0)::bigint                           AS cache_read_tokens,
         round(100.0 * sum(cache_read_tokens) / nullif(sum(prompt_tokens), 0), 1) AS cache_hit_pct,
         coalesce(sum(cost_usd_millicents), 0)::bigint                         AS cost_millicents,
         count(turn_index)::int                                                AS with_turn_index,
         count(tool_schema_tokens)::int                                        AS with_tool_schema_tokens
    FROM llm_usage_log
   WHERE created_at >= $1 AND created_at < $2
   GROUP BY 1
   ORDER BY calls DESC`;

async function vscodeKeyIds() {
  if (!coreUrl) {
    console.log('NEON_DATABASE_URL is not set: only rows labelled entry_point=vscode count as VS Code usage.\n');
    return [];
  }
  const rows = await neon(coreUrl)(`SELECT id::text AS id FROM tenant_api_keys WHERE client = 'vscode'`);
  return rows.map((r) => r.id);
}

function pick(rows) {
  return only === 'all' ? rows : rows.filter((r) => r.entry_point === only);
}

async function main() {
  const ops = neon(opsUrl);
  const window = [since.toISOString(), until.toISOString()];
  console.log(`PRD 35 §8.1 telemetry baseline (read-only) — ${days} days to ${until.toISOString().slice(0, 10)}\n`);

  console.log('── Runs (run_model_outcomes): failure rate, steps per run, §8.2 row fill');
  console.table(pick(await ops(OUTCOMES_SQL, window)));

  const keyIds = await vscodeKeyIds();
  console.log('── Calls (llm_usage_log): prompt-cache hit, per-turn telemetry fill');
  console.table(pick(await ops(USAGE_SQL, [...window, keyIds])));
}

main().catch((err) => { console.error(scrub(err && err.message ? err.message : err)); process.exit(1); });
