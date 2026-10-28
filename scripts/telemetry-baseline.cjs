#!/usr/bin/env node
/**
 * telemetry-baseline.cjs — reproduce PRD 35 §8.1 from the live ops DB (read-only).
 *
 * WS6's acceptance gate: the per-entry-point baseline script must print the §8.1
 * attribution table from real data. It runs SELECTs only — it never writes,
 * migrates or mutates. The DB is the ops database (NEON_TRANSACTIONAL_DATABASE_URL);
 * the URL is read from the environment, never printed.
 *
 * §8.1 attribution (what each entry point's rows look like):
 *   VS Code — llm_usage_log rows whose tenant_api_key_id's key kind is 'vscode'
 *             (the surface is clamped to 'web' for these).
 *   cloud   — llm_usage_log rows with surface = 'cloud' and an execution_id.
 *   @-reply — llm_usage_log rows with use_case = 'brain_agent_reply'.
 *
 * Usage: node scripts/telemetry-baseline.cjs [--entry-point=cloud|vscode|reply|all]
 */
'use strict';

const { Client } = require('pg');

const url = process.env.NEON_TRANSACTIONAL_DATABASE_URL;
if (!url) {
  console.error('NEON_TRANSACTIONAL_DATABASE_URL is not set; nothing to read.');
  process.exit(1);
}

const arg = process.argv.find((a) => a.startsWith('--entry-point='));
const which = arg ? arg.split('=')[1] : 'all';

const QUERIES = {
  vscode: {
    label: 'VS Code (tenant_api_key kind = vscode)',
    sql: `SELECT count(*) AS calls,
                 coalesce(sum(input_tokens),0)  AS input_tokens,
                 coalesce(sum(output_tokens),0) AS output_tokens,
                 coalesce(sum(cost_usd_millicents),0) AS cost_millicents
          FROM llm_usage_log u
          JOIN tenant_api_keys k ON k.id = u.tenant_api_key_id
          WHERE k.key_kind = 'vscode'`,
  },
  cloud: {
    label: 'cloud (surface = cloud, execution_id present)',
    sql: `SELECT count(*) AS calls,
                 coalesce(sum(input_tokens),0)  AS input_tokens,
                 coalesce(sum(output_tokens),0) AS output_tokens,
                 coalesce(sum(cost_usd_millicents),0) AS cost_millicents
          FROM llm_usage_log
          WHERE surface = 'cloud' AND execution_id IS NOT NULL`,
  },
  reply: {
    label: "@-reply (use_case = 'brain_agent_reply')",
    sql: `SELECT count(*) AS calls,
                 coalesce(sum(input_tokens),0)  AS input_tokens,
                 coalesce(sum(output_tokens),0) AS output_tokens,
                 coalesce(sum(cost_usd_millicents),0) AS cost_millicents
          FROM llm_usage_log
          WHERE use_case = 'brain_agent_reply'`,
  },
  // The §8.2 outcome-row coverage: are the WS6 columns populated yet?
  outcomes: {
    label: 'run_model_outcomes §8.2 row coverage (rows with entry_point set)',
    sql: `SELECT count(*) AS total_rows,
                 count(entry_point) AS labelled_rows,
                 count(first_spawn_turn) AS with_first_spawn_turn,
                 count(progress_trips) AS with_progress_trips
          FROM run_model_outcomes`,
  },
};

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const keys = which === 'all' ? ['vscode', 'cloud', 'reply', 'outcomes'] : [which];
    console.log('PRD 35 §8.1 telemetry baseline (read-only)\n');
    for (const key of keys) {
      const q = QUERIES[key];
      if (!q) { console.error(`unknown entry point: ${key}`); continue; }
      const { rows } = await client.query(q.sql);
      console.log(`── ${q.label}`);
      console.table(rows[0]);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
