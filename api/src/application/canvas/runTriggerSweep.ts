/**
 * THE TRIGGER SWEEP — the half that made "the board speaks first" true.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * `trigger` was declared as the object "that makes the board speak first — a bound
 * threshold that is evaluated rather than watched by a person who has to remember to
 * look". Its only evaluator was `canvas_evaluate_triggers`, a FRONTEND tool: it ran when
 * somebody opened the board and the model chose to call it. So a threshold was checked
 * exactly when a person was already looking at it, which is the one circumstance in which
 * they did not need telling. A contract auto-renewed, an invoice aged, a statutory
 * deadline passed, and the board that held all three said nothing until it was opened.
 *
 * ── WHY THE COMPARISON IS NOT IN THIS FILE ──────────────────────────────────────
 * Two evaluators is how a board comes to report `armed` on screen and `breached` in a
 * digest, with nothing to say which one lied. The comparison lives in
 * `@builderforce/creation-canvas-contract/triggers`, which the frontend and this file
 * both alias, so there is ONE rule. This module is the part the tool cannot be: reading
 * saved boards, writing the state back, and telling somebody.
 *
 * ── WHAT IT WRITES, AND WHAT IT REFUSES TO ──────────────────────────────────────
 * It writes `state` and `lastEvaluatedAt` onto the trigger's own `content` — both fields
 * the spec already marks `bookkeeping`, i.e. written by the evaluator and never authored.
 * It writes NOTHING else. In particular it does not perform the trigger's `thenDo`
 * actions: those are authored instructions with owners, several of them irreversible
 * (chase a customer, schedule a payment), and a sweep that executed them would be an
 * unattended agent acting on a threshold nobody re-read. The board says what happened;
 * a person or an explicitly delegated agent decides.
 *
 * ── ONE ACTIVITY ROW PER TRANSITION, NOT PER PASS ───────────────────────────────
 * A breach is logged when the state CHANGES into `breached`. Logging every pass would put
 * one row per trigger per day into `activity_log` forever, and an alert that repeats
 * nightly is one nobody reads by the end of the week — the same reasoning
 * `runAlertSweep` and the escalation sweep already apply. Re-arming is logged too: "the
 * invoice was paid" is exactly as much news as "the invoice went overdue".
 *
 * ── COST ────────────────────────────────────────────────────────────────────────
 * Three statements per pass regardless of tenant count, per the caching-and-performance
 * standard: one to find the sessions that actually hold a trigger, one to load those
 * sessions' objects, one batched write for the rows whose state moved. No per-tenant
 * fan-out, no N+1, and a hard ceiling on sessions per pass so a pathological workspace
 * cannot make the sweep unbounded. Sessions with no trigger cost nothing at all, which is
 * almost all of them ([[neon-cost-under-5-dollars]]).
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { evaluateBoardTriggers, type ResolvedTrigger, type TriggerBoardObject } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, creationSessions } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { recordActivity } from '../activity/activityLog';

/**
 * How many boards one pass will evaluate.
 *
 * A ceiling rather than a page cursor because the sweep is idempotent and daily: a
 * workspace beyond this is evaluated on the next tick, which is a delay, while an
 * unbounded scan is an outage. `skipped` is REPORTED rather than swallowed so the ceiling
 * shows up in the sweep's log line instead of looking like full coverage — the "no silent
 * caps" rule.
 */
const MAX_SESSIONS_PER_PASS = 500;

/** Beyond this a board is not a board, and loading all of it to find six triggers is
 *  waste. Matches the canvas's own practical ceiling. */
const MAX_OBJECTS_PER_SESSION = 2_000;

export interface TriggerSweepResult {
  /** Boards that held at least one trigger and were evaluated. */
  boards: number;
  /** Triggers evaluated across every board. */
  evaluated: number;
  /** Triggers whose stored state changed this pass. */
  changed: number;
  /** Transitions INTO breached — what a digest leads with. */
  breached: number;
  /** Transitions OUT of breached. */
  resolved: number;
  /** Triggers that could not be evaluated (no watched object, no deadline, no value). */
  unbound: number;
  /** Boards left for the next tick because of {@link MAX_SESSIONS_PER_PASS}. */
  skipped: number;
}

interface ObjectRow {
  id: string;
  sessionId: string;
  kind: string;
  content: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A saved row in the shape the shared engine speaks. `content` holds the authored
 *  fields (title, status, and the spec's own); `canvas_data` holds geometry, which an
 *  evaluation has no use for and is deliberately not loaded. */
function toBoardObject(row: ObjectRow): TriggerBoardObject {
  const content = asRecord(row.content);
  return {
    id: row.id,
    kind: row.kind,
    title: typeof content.title === 'string' ? content.title : '',
    data: content,
  };
}

/**
 * A one-line account of a transition, for the activity row.
 *
 * Says the NUMBER in the units the reader thinks in — days for a deadline, the raw value
 * for a metric — because "trigger breached" with no figure is a notification that sends
 * somebody to open the board to find out what it meant, which is the round trip the whole
 * sweep exists to remove.
 */
export function describeTransition(resolved: ResolvedTrigger, breached: boolean): string {
  const { observed } = resolved.evaluation;
  const what = resolved.watchedTitle ? `"${resolved.watchedTitle}"` : 'its watched object';
  if (resolved.deadlineField && typeof observed === 'number') {
    const when = observed < 0
      ? `${Math.abs(observed)} day${Math.abs(observed) === 1 ? '' : 's'} overdue`
      : observed === 0 ? 'due today' : `due in ${observed} day${observed === 1 ? '' : 's'}`;
    return breached
      ? `${what} is ${when} (${resolved.deadlineField}).`
      : `${what} is no longer inside the warning window (${when}).`;
  }
  const value = observed == null ? 'no value' : String(observed);
  return breached
    ? `${what} is at ${value}, past the ${resolved.comparator ?? 'below'} threshold of ${String(resolved.threshold ?? '—')}.`
    : `${what} is back within its threshold at ${value}.`;
}

/**
 * Evaluate every saved trigger and write back the ones that moved.
 *
 * Idempotent: a trigger whose state has not changed is not written, so running twice in a
 * day produces no rows and no activity — which is what lets the operator force-run it
 * from `POST /api/admin/cron/:target` to check a fix without polluting the ledger.
 */
export async function runTriggerSweep(env: Env, db: Db): Promise<TriggerSweepResult> {
  const empty: TriggerSweepResult = { boards: 0, evaluated: 0, changed: 0, breached: 0, resolved: 0, unbound: 0, skipped: 0 };

  // 1 — the sessions that actually hold a trigger. Everything else costs nothing.
  const sessionRows = await db
    .selectDistinct({ id: creationSessions.id, tenantId: creationSessions.tenantId, title: creationSessions.title })
    .from(creationSessions)
    .innerJoin(creationSessionObjects, eq(creationSessionObjects.sessionId, creationSessions.id))
    .where(and(eq(creationSessions.status, 'active'), eq(creationSessionObjects.kind, 'trigger')))
    .limit(MAX_SESSIONS_PER_PASS + 1);

  if (!sessionRows.length) return empty;

  const skipped = Math.max(0, sessionRows.length - MAX_SESSIONS_PER_PASS);
  const sessions = sessionRows.slice(0, MAX_SESSIONS_PER_PASS);
  const sessionIds = sessions.map((row) => row.id);

  // 2 — every object on those boards, in ONE statement. A per-session query here would be
  // the N+1 the standard forbids, and with a 500-board ceiling it would be 500 of them.
  const objectRows = await db
    .select({
      id: creationSessionObjects.id,
      sessionId: creationSessionObjects.sessionId,
      kind: creationSessionObjects.kind,
      content: creationSessionObjects.content,
    })
    .from(creationSessionObjects)
    .where(inArray(creationSessionObjects.sessionId, sessionIds))
    .limit(MAX_OBJECTS_PER_SESSION * sessions.length);

  const bySession = new Map<string, ObjectRow[]>();
  for (const row of objectRows) {
    const list = bySession.get(row.sessionId);
    if (list) list.push(row); else bySession.set(row.sessionId, [row]);
  }

  const now = Date.now();
  const evaluatedAt = new Date(now).toISOString();
  const result: TriggerSweepResult = { ...empty, skipped };

  /** Rows whose stored state moved, plus what to say about each. Collected across every
   *  board so the write is one batch rather than one statement per trigger. */
  const writes: Array<{
    id: string;
    state: string;
    tenantId: number;
    sessionId: string;
    sessionTitle: string;
    resolved: ResolvedTrigger;
    wasBreached: boolean;
    isBreached: boolean;
  }> = [];

  for (const session of sessions) {
    const rows = bySession.get(session.id) ?? [];
    if (!rows.length) continue;
    const board = rows.map(toBoardObject);
    const evaluations = evaluateBoardTriggers(board, now);
    if (!evaluations.length) continue;
    result.boards += 1;
    result.evaluated += evaluations.length;

    for (const entry of evaluations) {
      if (entry.evaluation.state === 'unbound') result.unbound += 1;
      const stored = board.find((node) => node.id === entry.triggerId);
      const previous = String(stored?.data.state ?? '');
      if (previous === entry.evaluation.state) continue;
      const wasBreached = previous === 'breached';
      const isBreached = entry.evaluation.state === 'breached';
      writes.push({
        id: entry.triggerId,
        state: entry.evaluation.state,
        tenantId: session.tenantId,
        sessionId: session.id,
        sessionTitle: session.title,
        resolved: entry,
        wasBreached,
        isBreached,
      });
    }
  }

  if (!writes.length) return result;

  // 3 — one batched write. `jsonb ||` merges the two bookkeeping keys onto whatever the
  // object already holds rather than replacing `content`, so a concurrent authored edit
  // to another field on the same card is not clobbered by the sweep.
  await db.execute(sql`
    UPDATE creation_session_objects AS o
       SET content = COALESCE(o.content, '{}'::jsonb) || v.patch,
           updated_at = NOW()
      FROM (VALUES ${sql.join(
        writes.map((write) => sql`(${write.id}::uuid, ${JSON.stringify({ state: write.state, lastEvaluatedAt: evaluatedAt })}::jsonb)`),
        sql`, `,
      )}) AS v(id, patch)
     WHERE o.id = v.id
  `);

  result.changed = writes.length;
  result.breached = writes.filter((write) => write.isBreached).length;
  result.resolved = writes.filter((write) => write.wasBreached && !write.isBreached).length;

  // Only real transitions reach the ledger — see the header on why a nightly repeat is
  // an alert nobody reads. `recordActivity` is best-effort by design and never throws,
  // so a logging failure cannot cost the state write that already succeeded.
  await Promise.all(writes
    .filter((write) => write.isBreached || write.wasBreached)
    .map((write) => recordActivity(env, db, {
      tenantId: write.tenantId,
      actor: { type: 'system', ref: null, name: 'Canvas triggers' },
      verb: write.isBreached ? 'trigger.breached' : 'trigger.rearmed',
      targetType: 'creation_object',
      targetId: write.id,
      targetLabel: write.resolved.triggerTitle.slice(0, 300),
      summary: describeTransition(write.resolved, write.isBreached),
      metadata: {
        sessionId: write.sessionId,
        sessionTitle: write.sessionTitle,
        watchedTitle: write.resolved.watchedTitle,
        watchedKind: write.resolved.watchedKind,
        deadlineField: write.resolved.deadlineField,
        comparator: write.resolved.comparator,
        threshold: write.resolved.threshold,
        observed: write.resolved.evaluation.observed,
        // The authored instructions, carried so a digest can name the action and its
        // owner without re-reading the board.
        thenDo: write.resolved.thenDo.slice(0, 10),
      },
    })));

  return result;
}
