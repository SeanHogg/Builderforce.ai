/**
 * llmUsageRollup — GRAIN-level retention for `llm_usage_log`, the billing ledger.
 *
 * THE PROBLEM. This relation takes one row per LLM call, on every surface, forever. It
 * had no `SWEPT_TABLES` entry at all — no purge and, just as costly, no vacuum — and
 * it is the operational endpoint's steadiest unbounded grower once `llm_traces` stops
 * being the loudest. It also cannot simply be purged: it is what the platform bills
 * from, what the consumption meter reads, and what thirty-odd cost, allocation and
 * portfolio surfaces aggregate.
 *
 * FOLDED IN PLACE, NOT INTO A SIBLING TABLE. `tool_audit_events` folds into
 * `tool_audit_daily` because it had exactly two consumers, both of which could be
 * taught to read the tally. This relation has thirty, several of which sum a window
 * longer than any fold boundary, and every one of them would silently UNDER-REPORT the
 * moment history moved to a table they do not know about. Under-reporting a billing
 * figure is the single worst outcome available here, so the fold does not move the
 * rows: it REPLACES a day's rows, in the same table, with one row per dimension set.
 * Every reader keeps its existing query and keeps getting the right answer, because
 * the dimensions it groups by and the quantities it sums both survive by construction.
 *
 * WHAT SURVIVES. Every column anything groups or filters by: tenant, user, model,
 * product, surface, role, project, task, execution, chat (and mode), agent host, cloud
 * agent ref, API key, and the BYO / premium / paid-overflow flags. Every quantity
 * anything sums: prompt, completion and total tokens, both cache tiers, retries,
 * `cost_usd_millicents` and the memory-savings figures (the `saved_*` / `recall_*`
 * quantities, with `savings_source` / `savings_estimated` kept as dimensions), and the
 * per-turn telemetry (1253): `reasoning_tokens` and `tool_schema_tokens` are SUMMED —
 * `SUM` over all-NULL stays NULL, so "the vendor reported no reasoning split" survives
 * the fold instead of becoming a reported zero — and `turn_index` keeps its MAX, which
 * for a folded run row (grouped by `execution_id`) is the run's turn count, the one thing
 * a position-in-the-loop still says once the loop's rows are one row. The run's
 * pipeline route (1277) is a dimension, and its `route_score` is AVERAGED — a folded
 * row's score is its runs' mean, which is what the route report reads. `created_at`
 * becomes the day's EARLIEST, so a folded row stays inside the calendar day every range
 * filter buckets it into.
 *
 * WHAT IT COSTS. Three columns that are already dead at the boundary, and the row count.
 *   • `trace_id`         — the pivot to `llm_traces`, which is itself purged at 30 days,
 *                          so past this boundary it can only ever dangle.
 *   • `idempotency_key`  — the replay guard reads a TEN MINUTE window.
 *   • `metadata`         — the caller's free-form trace-back bag; one reader, a per-key
 *                          row listing that is windowed in days.
 *   • the ROW COUNT      — which is why `calls` exists and why "requests" is
 *                          `usageRequestCount()` everywhere rather than `COUNT(*)`.
 *
 * WHOLE DAYS ONLY, same safety property as the tool-audit fold: the boundary is floored
 * to midnight so a day is either entirely folded or entirely raw, and a partially folded
 * day — the one shape that could double-count — is excluded by construction rather than
 * by care.
 *
 * IDEMPOTENT. Re-folding an already-folded day groups each surviving row with itself and
 * writes back the same sums, so a repeated tick is a no-op rather than a distortion.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { foldDaysBefore, type DayFoldResult } from './dayFold';

/**
 * Days a usage row keeps its per-call identity.
 *
 * 90 and not less, because that is where the last consumer that can tell the difference
 * stops looking. The per-key usage listing, the per-run model breakdown and the chat-mode
 * report all render individual rows over a caller-supplied window, and a quarter is the
 * longest any of them is asked for in practice; past it every surviving reader is an
 * aggregate, and an aggregate cannot tell a folded row from a raw one. It is also
 * comfortably beyond the consumption meter's month-to-date window, so no billing period
 * is ever folded while it is still being metered.
 */
export const LLM_USAGE_ROLLUP_AFTER_DAYS = 90;

const foldDay = (db: Db, day: string) => db.execute(sql`
  WITH folded AS (
    SELECT tenant_id, user_id, llm_product, model, chat_id, chat_mode, use_case,
           tenant_api_key_id, agent_host_id, cloud_agent_ref, execution_id, task_id,
           project_id, paid_overflow, premium, byo, byo_provider, byo_credential_id,
           surface, role, streamed, savings_source, savings_estimated, pipeline_route,
           SUM(calls)::int                 AS calls,
           SUM(prompt_tokens)::int         AS prompt_tokens,
           SUM(completion_tokens)::int     AS completion_tokens,
           SUM(total_tokens)::int          AS total_tokens,
           SUM(cache_read_tokens)::int     AS cache_read_tokens,
           SUM(cache_creation_tokens)::int AS cache_creation_tokens,
           SUM(retries)::int               AS retries,
           SUM(cost_usd_millicents)::int   AS cost_usd_millicents,
           SUM(saved_prompt_tokens)::int       AS saved_prompt_tokens,
           SUM(saved_completion_tokens)::int   AS saved_completion_tokens,
           SUM(recall_prompt_tokens)::int      AS recall_prompt_tokens,
           SUM(saved_cost_usd_millicents)::int AS saved_cost_usd_millicents,
           AVG(route_score)::real          AS route_score,
           SUM(reasoning_tokens)::int      AS reasoning_tokens,
           SUM(tool_schema_tokens)::int    AS tool_schema_tokens,
           MAX(turn_index)                 AS turn_index,
           MIN(created_at)                 AS created_at
      FROM llm_usage_log
     WHERE created_at >= ${day}::date AND created_at < ${day}::date + interval '1 day'
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24
  ),
  removed AS (
    DELETE FROM llm_usage_log
     WHERE created_at >= ${day}::date AND created_at < ${day}::date + interval '1 day'
    RETURNING 1
  ),
  tallied AS (
    INSERT INTO llm_usage_log
      (tenant_id, user_id, llm_product, model, chat_id, chat_mode, use_case,
       tenant_api_key_id, agent_host_id, cloud_agent_ref, execution_id, task_id,
       project_id, paid_overflow, premium, byo, byo_provider, byo_credential_id,
       surface, role, streamed, savings_source, savings_estimated, pipeline_route, calls, prompt_tokens,
       completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, retries,
       cost_usd_millicents, saved_prompt_tokens, saved_completion_tokens, recall_prompt_tokens,
       saved_cost_usd_millicents, route_score, reasoning_tokens, tool_schema_tokens, turn_index, created_at)
    SELECT tenant_id, user_id, llm_product, model, chat_id, chat_mode, use_case,
           tenant_api_key_id, agent_host_id, cloud_agent_ref, execution_id, task_id,
           project_id, paid_overflow, premium, byo, byo_provider, byo_credential_id,
           surface, role, streamed, savings_source, savings_estimated, pipeline_route, calls, prompt_tokens,
           completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, retries,
           cost_usd_millicents, saved_prompt_tokens, saved_completion_tokens, recall_prompt_tokens,
           saved_cost_usd_millicents, route_score, reasoning_tokens, tool_schema_tokens, turn_index, created_at
      FROM folded
    RETURNING 1
  )
  -- usage-count-ok: these count the CTE result sets — how many rows the fold wrote and
  -- how many it removed — not how many LLM calls those rows stand for. Calls are summed
  -- into the surviving row's own calls column, which is the column this statement maintains.
  SELECT (SELECT count(*) FROM tallied)::int AS tallies,
         (SELECT count(*) FROM removed)::int AS folded
`);

export async function rollUpLlmUsage(
  db: Db,
  cutoff: Date,
  opts: { maxDays?: number } = {},
): Promise<DayFoldResult> {
  return foldDaysBefore(db, cutoff, {
    relation: 'llm_usage_log',
    tsColumn: 'created_at',
    foldDay,
    source: 'application/maintenance/llmUsageRollup.ts',
    operation: 'rollUpLlmUsage',
    // SEVEN days a tick, not the shared fourteen: this is the billing ledger, and a day
    // of it is a far heavier statement than a day of tool audit. The backlog drains a
    // week per night either way.
  }, { maxDays: opts.maxDays ?? 7 });
}
