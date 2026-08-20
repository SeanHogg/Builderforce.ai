/**
 * The half of board sync that PUSHES — and the writer `board_sync_outbox` never had.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * `SyncEngine.drainOutbox` reads pending rows, calls `provider.pushUpdate`,
 * retries with backoff and dead-letters. `drizzleStore` implements
 * `listPendingOutbox`, `markOutboxDone`, `markOutboxRetry` and `markOutboxDead`.
 * A cron sweep runs the drain on a schedule.
 *
 * Nothing anywhere in `api/src` ever INSERTED a row. A grep for a write to
 * `board_sync_outbox` outside the schema file found exactly none — so the entire
 * outbound direction was a fully-built, fully-tested, permanently empty queue. Every
 * "bidirectional sync" claim on the platform was one-directional in fact: tickets
 * flowed in from Jira/Freshdesk/ServiceNow and nothing ever flowed back.
 *
 * The specific symptom that surfaced it: an incident's status and severity are
 * mirrored onto its board task, and the help desk that raised the ticket never
 * heard about either — so a Freshdesk ticket stayed Open while the incident it
 * became was resolved days earlier.
 *
 * ── COALESCING, AND WHY IT IS NOT OPTIONAL ──────────────────────────────────
 * An incident moves open → acknowledged → mitigated → resolved in minutes, and
 * each transition would enqueue a row. Four sequential PUTs against a help desk
 * for one incident is rate-limit bait and produces three states nobody needed to
 * see. So a pending row for the same (connection, task) is MERGED rather than
 * added to: the queue holds "what this ticket should look like", not a replay of
 * how it got there. Merge order is last-write-wins per field, which is the only
 * correct reading — the newest severity is the severity.
 *
 * ── WHY IT IS BEST-EFFORT AT THE CALL SITE ──────────────────────────────────
 * A workspace with no external board has no links and enqueues nothing, and an
 * incident update must not fail because a help desk is unreachable. The drain
 * owns delivery, including its failures; this only records the intent.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { boardSyncOutbox, externalTicketLinks } from '../../infrastructure/database/schema';
import type { ChangeSet } from './providers';

export interface EnqueueResult {
  /** How many external tickets will be updated. 0 = nothing is linked. */
  queued: number;
  /** How many of those merged into a push that had not been drained yet. */
  merged: number;
}

/**
 * Record that a task's linked external tickets should be updated.
 *
 * Enqueues (or merges into) one pending outbox row per external link. Returns
 * counts for the caller's log line; never throws for the ordinary "nothing is
 * linked" case.
 */
export async function enqueueBoardPush(
  db: Db,
  args: { tenantId: number; taskId: number; changeSet: ChangeSet },
): Promise<EnqueueResult> {
  const fields = Object.entries(args.changeSet).filter(([, v]) => v !== undefined);
  if (!fields.length) return { queued: 0, merged: 0 };
  const changeSet = Object.fromEntries(fields) as ChangeSet;

  const links = await db
    .select({ connectionId: externalTicketLinks.connectionId })
    .from(externalTicketLinks)
    .where(and(
      eq(externalTicketLinks.tenantId, args.tenantId),
      eq(externalTicketLinks.taskId, args.taskId),
    ));
  if (!links.length) return { queued: 0, merged: 0 };

  const connectionIds = links.map((l) => l.connectionId);
  const pending = await db
    .select({ id: boardSyncOutbox.id, connectionId: boardSyncOutbox.connectionId, changeSet: boardSyncOutbox.changeSet })
    .from(boardSyncOutbox)
    .where(and(
      eq(boardSyncOutbox.tenantId, args.tenantId),
      eq(boardSyncOutbox.taskId, args.taskId),
      eq(boardSyncOutbox.status, 'pending'),
      inArray(boardSyncOutbox.connectionId, connectionIds),
    ));
  const pendingByConnection = new Map(pending.map((row) => [row.connectionId, row]));

  let queued = 0;
  let merged = 0;
  for (const connectionId of connectionIds) {
    const existing = pendingByConnection.get(connectionId);
    if (existing) {
      // Last-write-wins per field: the newest severity IS the severity, and
      // replaying the intermediate ones helps nobody.
      const before = parseChangeSet(existing.changeSet);
      await db
        .update(boardSyncOutbox)
        .set({
          changeSet: JSON.stringify({ ...before, ...changeSet }),
          // Reset the backoff clock: a merge is fresh intent, and inheriting a
          // failed row's `next_attempt_at` would delay a resolution notice by
          // however long the previous failure had earned.
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
        })
        .where(eq(boardSyncOutbox.id, existing.id));
      merged += 1;
      queued += 1;
      continue;
    }
    await db.insert(boardSyncOutbox).values({
      tenantId: args.tenantId,
      connectionId,
      taskId: args.taskId,
      changeSet: JSON.stringify(changeSet),
    });
    queued += 1;
  }

  return { queued, merged };
}

function parseChangeSet(raw: string | null): ChangeSet {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ChangeSet) : {};
  } catch {
    // A row whose JSON we cannot read is not a reason to drop the new intent —
    // the fresh change set replaces it wholesale.
    return {};
  }
}
