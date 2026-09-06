/**
 * toolAuditRollup — GRAIN-level retention for `tool_audit_events`.
 *
 * THE THIRD STAGE. The log-table policy already had two knobs and neither could
 * touch this relation's real cost. `retentionDays` deletes a row, and here it may
 * not: the SOC 2 evidence export reads 90 days back, so the ROW has to exist.
 * `redact.afterDays` blanks the fat `args`/`result` payloads, which took the table
 * from 298 MB to 176 MB and then stopped — what remains is 665,010 narrow rows whose
 * cost is the row COUNT, not the row width. 97% of them are one fortnight of
 * `auto_run_skipped` sweeps.
 *
 * WHAT A FOLD KEEPS. Every number the two consumers compute — the compliance summary
 * and the evidence pack — is a sum over (tenant, day, tool_name, category, agent):
 * total volume, sensitive-action count, per-tool / per-category / per-agent
 * breakdown, duration. Folding to exactly that grain measured 188:1 in production —
 * 651,664 raw rows became 3,464 tallies, and the relation went from 176 MB to 11 MB —
 * and changes none of those figures. The tally is
 * a defensible audit artifact in its own right: it states that this agent called this
 * tool this many times on this day, first at this time and last at that one.
 *
 * WHAT A FOLD COSTS. The ability to cite ONE call, from the fold boundary back. Where
 * that boundary belongs, and what the two windows either side of it are for, is
 * {@link TOOL_AUDIT_ROLLUP_AFTER_DAYS}.
 *
 * WHOLE DAYS ONLY. The fold is keyed on a calendar day and the cutoff is floored to
 * midnight, so a day is either entirely folded or entirely raw. A partially folded
 * day is the one way this could double-count, and it is excluded by construction
 * rather than by care.
 *
 * NOT EVERY ROW IS FOLDABLE. `execution_claim_evidence` cites individual audit rows
 * by id under an `ON DELETE RESTRICT` foreign key — a provenance claim whose support
 * is a specific call. Those rows are skipped by both halves of the statement, so the
 * claim keeps pointing at a real event.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Days a raw tool-audit row keeps its individual identity.
 *
 * THE LADDER. Three windows, each of which has to earn its place or it is a knob that
 * does nothing: `redact.afterDays` (14) → this (30) → `retentionDays` (90).
 *
 *   0–14d   full fidelity — `args`/`result` readable, which is the window in which
 *           anyone is actually debugging a run or reading a skip reason off the
 *           lifecycle ledger.
 *   14–30d  row-level identity, payload blanked. Still cites an individual call.
 *   30d+    a daily tally. Every compliance figure intact, no individual call.
 *
 * WHY 30 AND NOT LATER. The first choice here was 45, on the reasoning that pushing
 * the fold past the redaction boundary bought row-level history for free because
 * "the space is in the backlog, not the margin". Running it disproved that: folding
 * at 45 days cleared 229,944 rows and LEFT 421,719 — the July re-dispatch loop sits
 * almost entirely in the 30-to-45-day band, so the margin was where nearly all of
 * the space was. 30 is also the point at which the row has already lost its payload,
 * which is what makes the fold cheap in what it discards.
 *
 * The redaction window moved 30 → 14 in the same pass rather than the fold moving to
 * 31 to clear it. Two stages one day apart is theatre: the fold subsumes redaction
 * (it drops the whole row, not two columns of it), so a redaction window that only
 * ever applies for a day is a dead knob dressed as a policy. At 14 days it is a real
 * stage again, and the cost is bounded — the compliance summary and evidence pack
 * never read either column, so this narrows only the ledger's ability to quote a skip
 * REASON on a ticket idle 14–30 days, a degradation that path already handles.
 */
export const TOOL_AUDIT_ROLLUP_AFTER_DAYS = 30;

/** Days of tallies to fold per invocation. Bounds the work of one sweep tick; the
 *  backlog drains over consecutive ticks rather than in one long transaction. */
const DEFAULT_MAX_DAYS = 14;

export interface ToolAuditRollupResult {
  /** Calendar days folded this run. */
  days: number;
  /** Raw events removed. */
  folded: number;
  /** Tally rows written or added to. */
  tallies: number;
}

/**
 * Fold one calendar day of raw events into `tool_audit_daily` and delete them.
 *
 * ONE STATEMENT, ONE SNAPSHOT. The aggregate, the insert and the delete are CTEs of
 * a single statement, so the delete removes exactly the rows the aggregate counted —
 * an event written while this runs belongs to a later day and is invisible to both.
 * A re-fold of an already-folded day therefore finds no rows and is a no-op; if one
 * arrives late anyway (a backfill with an old `ts`), `ON CONFLICT DO UPDATE` ADDS it
 * to the existing tally rather than duplicating the grain.
 */
const foldDay = (db: Db, day: string) => db.execute(sql`
  WITH folded AS (
    SELECT tenant_id, ts::date AS day, tool_name, category, agent_host_id, cloud_agent_ref,
           count(*)::int AS events,
           count(DISTINCT execution_id)::int AS distinct_executions,
           sum(duration_ms)::bigint AS duration_ms_total,
           min(ts) AS first_ts,
           max(ts) AS last_ts
      FROM tool_audit_events
     WHERE ts >= ${day}::date AND ts < ${day}::date + interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM execution_claim_evidence e WHERE e.tool_audit_event_id = tool_audit_events.id)
     GROUP BY 1, 2, 3, 4, 5, 6
  ),
  tallied AS (
    INSERT INTO tool_audit_daily
      (tenant_id, day, tool_name, category, agent_host_id, cloud_agent_ref,
       events, distinct_executions, duration_ms_total, first_ts, last_ts)
    SELECT tenant_id, day, tool_name, category, agent_host_id, cloud_agent_ref,
           events, distinct_executions, duration_ms_total, first_ts, last_ts
      FROM folded
    ON CONFLICT (tenant_id, day, tool_name, category, agent_host_id, cloud_agent_ref) DO UPDATE SET
      events              = tool_audit_daily.events + EXCLUDED.events,
      distinct_executions = tool_audit_daily.distinct_executions + EXCLUDED.distinct_executions,
      duration_ms_total   = COALESCE(tool_audit_daily.duration_ms_total, 0) + COALESCE(EXCLUDED.duration_ms_total, 0),
      first_ts            = LEAST(tool_audit_daily.first_ts, EXCLUDED.first_ts),
      last_ts             = GREATEST(tool_audit_daily.last_ts, EXCLUDED.last_ts)
    RETURNING 1
  ),
  removed AS (
    DELETE FROM tool_audit_events
     WHERE ts >= ${day}::date AND ts < ${day}::date + interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM execution_claim_evidence e WHERE e.tool_audit_event_id = tool_audit_events.id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM tallied)::int AS tallies,
         (SELECT count(*) FROM removed)::int AS folded
`);

/** Rows of `{ tallies, folded }` come back untyped from `db.execute`. */
function readCounts(result: unknown): { tallies: number; folded: number } {
  const row = (Array.isArray(result) ? result[0] : (result as { rows?: unknown[] })?.rows?.[0]) as
    | { tallies?: unknown; folded?: unknown }
    | undefined;
  return { tallies: Number(row?.tallies ?? 0), folded: Number(row?.folded ?? 0) };
}

/**
 * Fold every whole day of `tool_audit_events` strictly before `cutoff`, oldest first.
 *
 * `cutoff` is floored to its calendar day, so the day the cutoff falls in is never
 * touched — see WHOLE DAYS ONLY above.
 */
export async function rollUpToolAudit(
  db: Db,
  cutoff: Date,
  opts: { maxDays?: number } = {},
): Promise<ToolAuditRollupResult> {
  const boundary = cutoff.toISOString().slice(0, 10);
  const maxDays = opts.maxDays ?? DEFAULT_MAX_DAYS;

  const dayRows = await db.execute(sql`
    SELECT DISTINCT ts::date::text AS day
      FROM tool_audit_events
     WHERE ts < ${boundary}::date
     ORDER BY 1
     LIMIT ${maxDays}
  `);
  const days = (Array.isArray(dayRows) ? dayRows : (dayRows as { rows?: unknown[] }).rows ?? [])
    .map((r) => String((r as { day: string }).day));

  const total: ToolAuditRollupResult = { days: 0, folded: 0, tallies: 0 };
  for (const day of days) {
    const { tallies, folded } = readCounts(await foldDay(db, day));
    total.days += 1;
    total.folded += folded;
    total.tallies += tallies;
  }
  return total;
}
