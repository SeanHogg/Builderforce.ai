/**
 * Chat MODE usage — "how much of what people do here is a conversation, and how much
 * is actually work getting done?"
 *
 * This exists because until migration 0409 the question was unanswerable: every Brain
 * conversation ran under the same always-execute directive, so there was no column, and
 * no metric, that separated asking from delegating. The mode column supplies the
 * dimension; this supplies the read.
 *
 * ── NO NEW COLLECTION ────────────────────────────────────────────────────────────
 * Deliberately a JOIN over tables that already record everything needed, the same
 * discipline the ticket lifecycle ledger uses. Adding a `chat_mode_events` table would
 * be a second, lossier copy of facts `brain_chats`, `chat_ticket_links`, `tasks` and
 * `ticket_runs` already hold — and it would only start being true from the day it
 * shipped, where this reports retroactively over history already on disk.
 *
 * What it answers, per mode, over a trailing window:
 *   • how many conversations were started, and how many actually got a turn;
 *   • how much work they PRODUCED — tickets linked, and how many of those reached a
 *     dispatched run vs. sat there;
 *   • what they COST — tokens and spend, from the usage rows the turns wrote.
 *
 * The cost half is what makes it a decision tool rather than a vanity chart: "work
 * conversations are 12% of the total and 61% of the spend" is an operating fact.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

/** One mode's slice of the window. */
export interface ChatModeUsageRow {
  mode: string;
  /** Conversations created in the window. */
  conversations: number;
  /** …of those, how many have at least one message (i.e. were actually used). */
  engaged: number;
  /** Work items linked to those conversations. */
  ticketsLinked: number;
  /** …of those, how many ever had a run dispatched. This is the execution rate: a
   *  work conversation that opens tickets nothing ever runs is the failure mode the
   *  whole mode split exists to make visible. */
  ticketsDispatched: number;
  /** Tokens spent by turns in those conversations. */
  totalTokens: number;
  /** Spend in USD millicents (the unit `llm_usage_log` stamps at write time). */
  costUsdMillicents: number;
}

export interface ChatModeUsage {
  generatedAt: string;
  windowDays: number;
  rows: ChatModeUsageRow[];
  /** Canvas sessions bucketed by mode — the other conversation surface. */
  canvasSessions: Array<{ mode: string; sessions: number }>;
}

/**
 * Compute the rollup for one tenant over a trailing window.
 *
 * ONE statement for the chat side rather than a query per mode: the mode set is small
 * but the cost/ticket sub-aggregates are not, and fanning out per mode would be an N+1
 * over the hottest tables in the schema. `llm_usage_log` is joined on its real
 * `chat_id` column (0934, backfilled from the metadata JSON it used to be scanned
 * out of), so the join is indexed and a row can no longer be dropped for having an
 * unexpected metadata shape. Cost is grouped by the chat's CURRENT mode, so a turn
 * written before 0409 contributes to whatever mode its chat now reports — the
 * honest reading of a retroactive column.
 */
export async function computeChatModeUsage(db: Db, tenantId: number, days: number): Promise<ChatModeUsage> {
  const since = sql`now() - (${days}::text || ' days')::interval`;

  // Aggregate PER CHAT first, then group by mode. Doing it in one pass with LEFT JOINs
  // would fan each chat out by (messages × links × usage rows) and force `sum(DISTINCT …)`
  // to de-duplicate it — which silently discards two chats that happen to have spent the
  // same number of tokens. Per-chat scalars have no fan-out to undo.
  const chatRows = await db.execute(sql`
    WITH scoped_chats AS (
      SELECT c.id, c.mode
        FROM brain_chats c
       WHERE c.tenant_id = ${tenantId}
         AND c.is_archived = false
         AND c.created_at >= ${since}
    ),
    spend AS (
      SELECT u.chat_id                               AS chat_id,
             sum(coalesce(u.total_tokens, 0))        AS tokens,
             sum(coalesce(u.cost_usd_millicents, 0)) AS cost
        FROM llm_usage_log u
       WHERE u.tenant_id = ${tenantId}
         AND u.created_at >= ${since}
         AND u.chat_id IS NOT NULL
       GROUP BY 1
    ),
    per_chat AS (
      SELECT
        s.mode,
        EXISTS (SELECT 1 FROM brain_chat_messages m WHERE m.chat_id = s.id) AS engaged,
        (SELECT count(*) FROM chat_ticket_links l
          WHERE l.chat_id = s.id AND l.tenant_id = ${tenantId})             AS tickets_linked,
        -- A linked TASK-tier ticket that ever had a run. Non-task tiers (spec,
        -- objective, portfolio) are not runnable, so they count as linked but can
        -- never count as dispatched.
        (SELECT count(*) FROM chat_ticket_links l
          WHERE l.chat_id = s.id AND l.tenant_id = ${tenantId}
            AND l.ticket_kind IN ('task', 'epic', 'gap')
            AND l.ticket_ref ~ '^[0-9]+$'
            AND EXISTS (SELECT 1 FROM ticket_runs r WHERE r.task_id = l.ticket_ref::integer)
        )                                                                   AS tickets_dispatched,
        coalesce(sp.tokens, 0)                                              AS tokens,
        coalesce(sp.cost, 0)                                                AS cost
      FROM scoped_chats s
      LEFT JOIN spend sp ON sp.chat_id = s.id
    )
    SELECT mode                                    AS mode,
           count(*)                                AS conversations,
           count(*) FILTER (WHERE engaged)         AS engaged,
           coalesce(sum(tickets_linked), 0)        AS tickets_linked,
           coalesce(sum(tickets_dispatched), 0)    AS tickets_dispatched,
           coalesce(sum(tokens), 0)                AS total_tokens,
           coalesce(sum(cost), 0)                  AS cost
      FROM per_chat
     GROUP BY mode
     ORDER BY mode
  `);

  const canvasRows = await db.execute(sql`
    SELECT mode, count(*) AS sessions
      FROM creation_sessions
     WHERE tenant_id = ${tenantId}
       AND status <> 'deleted'
       AND created_at >= ${since}
     GROUP BY mode
     ORDER BY mode
  `);

  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    rows: (chatRows.rows as Array<Record<string, unknown>>).map((r) => ({
      mode: String(r.mode ?? 'chat'),
      conversations: num(r.conversations),
      engaged: num(r.engaged),
      ticketsLinked: num(r.tickets_linked),
      ticketsDispatched: num(r.tickets_dispatched),
      totalTokens: num(r.total_tokens),
      costUsdMillicents: num(r.cost),
    })),
    canvasSessions: (canvasRows.rows as Array<Record<string, unknown>>).map((r) => ({
      mode: String(r.mode ?? 'chat'),
      sessions: num(r.sessions),
    })),
  };
}
