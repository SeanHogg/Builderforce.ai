#!/usr/bin/env node
/**
 * telemetry-baseline.cjs — reproduce PRD 35 §8.1 from the live ops DB (read-only).
 *
 * WS6's acceptance gate: the per-entry-point baseline script must print the §8.1
 * attribution table from real data. It runs SELECTs only — it never writes,
 * migrates or mutates. The DB is the ops database (NEON_TRANSACTIONAL_DATABASE_URL);
 * the URL is read from the environment, never printed.
 *
 * Uses the driver api itself uses (@neondatabase/serverless), so it resolves from
 * api/scripts/ where api's node_modules can supply it. `pg` is not a dependency of
 * any package in this repo, so the original `require('pg')` form could not run.
 *
 * §8.1 attribution (what each entry point's rows look like):
 *   VS Code — llm_usage_log rows with surface = 'web' that carried an entry_point at
 *             WS6. The adapters stamp 'vscode' at WS3/4/5; until then this bucket is
 *             populated by cloud rows clamped to 'web'.
 *   cloud   — llm_usage_log rows with surface = 'cloud' and an execution_id.
 *   @-reply — llm_usage_log rows with use_case = 'brain_agent_reply'.
 *
 * Usage: node scripts/telemetry-baseline.cjs [--entry-point=vscode|cloud|reply|outcomes|all]
 */
'use strict';

const { readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
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

const url = process.env.NEON_TRANSACTIONAL_DATABASE_URL;
if (!url) {
  console.error('NEON_TRANSACTIONAL_DATABASE_URL is not set; nothing to read.');
  process.exit(1);
}

const arg = process.argv.find((a) => a.startsWith('--entry-point='));
const which = arg ? arg.split('=')[1] : 'all';

// llm_usage_log's token columns are prompt_tokens / completion_tokens, and its
// per-call spend is cost_usd_millicents.
const QUERIES = {
  vscode: {
    label: "VS Code (surface='web', entry_point='vscode')",
    sql: `SELECT count(*)::int AS calls,
                 coalesce(sum(prompt_tokens),0)::int      AS prompt_tokens,
                 coalesce(sum(completion_tokens),0)::int  AS completion_tokens,
                 coalesce(sum(cost_usd_millicents),0)::int AS cost_millicents
          FROM llm_usage_log
          WHERE surface = 'web' AND entry_point = 'vscode'`,
  },
  cloud: {
    label: "cloud (surface='cloud', execution_id present)",
    sql: `SELECT count(*)::int AS calls,
                 coalesce(sum(prompt_tokens),0)::int      AS prompt_tokens,
                 coalesce(sum(completion_tokens),0)::int  AS completion_tokens,
                 coalesce(sum(cost_usd_millicents),0)::int AS cost_millicents
          FROM llm_usage_log
          WHERE surface = 'cloud' AND execution_id IS NOT NULL`,
  },
  reply: {
    label: "@-reply (use_case = 'brain_agent_reply')",
    sql: `SELECT count(*)::int AS calls,
                 coalesce(sum(prompt_tokens),0)::int      AS prompt_tokens,
                 coalesce(sum(completion_tokens),0)::int  AS completion_tokens,
                 coalesce(sum(cost_usd_millicents),0)::int AS cost_millicents
          FROM llm_usage_log
          WHERE use_case = 'brain_agent_reply'`,
  },
  // The §8.2 outcome-row coverage: are the WS6 columns populated yet?
  outcomes: {
    label: 'run_model_outcomes §8.2 row coverage (rows with entry_point set)',
    sql: `SELECT count(*)::int AS total_rows,
                 count(entry_point)::int            AS labelled_rows,
                 count(first_spawn_turn)::int       AS with_first_spawn_turn,
                 count(progress_trips)::int         AS with_progress_trips
          FROM run_model_outcomes`,
  },
};

async function main() {
  const sql = neon(url);
  const keys = which === 'all' ? ['vscode', 'cloud', 'reply', 'outcomes'] : [which];
  console.log('PRD 35 §8.1 telemetry baseline (read-only)\n');
  for (const key of keys) {
    const q = QUERIES[key];
    if (!q) { console.error(`unknown entry point: ${key}`); continue; }
    const rows = await sql(q.sql);
    console.log(`── ${q.label}`);
    console.table(rows[0]);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
