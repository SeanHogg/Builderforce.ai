/**
 * Voice-of-Customer inbox — the ONE use case for `customer_feedback`: the host's
 * ingest (`POST /v1/ingest/feedback`) and the segment's triage
 * (`GET /api/reports/feedback`, `PATCH /api/reports/feedback/:id`).
 *
 * Deliberately NOT folded into Product Feedback (`feedback_submissions`, the
 * snippet / in-app panel / provider webhooks / superadmin roll-up). That is a
 * project-scoped backlog intake whose rows open human-gated tickets; this is a
 * segment-scoped VoC stream the host (BurnRateOS) pushes for an end-client, keyed
 * by the host's event id, with no project and no ticket until a person triages it.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { customerFeedback, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

export const FEEDBACK_STATUSES = ['new', 'triaged', 'dismissed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const KNOWN_STATUSES = new Set<string>(FEEDBACK_STATUSES);

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && KNOWN_STATUSES.has(value);
}

export interface CustomerFeedbackEvent {
  tenantId: number;
  segmentId: string;
  /** The host's event id — unique per segment, so a re-delivery is idempotent. */
  eventId: string;
  text: string;
  widgetId?: string | null;
  sentiment?: string | null;
  contact?: string | null;
}

/**
 * Record one host-pushed feedback event. Idempotent on (segment, external_ref): a
 * re-delivered event returns the existing row with `deduped: true` rather than a
 * duplicate candidate.
 */
export async function ingestCustomerFeedback(
  db: Db,
  event: CustomerFeedbackEvent,
): Promise<{ id: string | null; status: string; deduped: boolean }> {
  const [row] = await db
    .insert(customerFeedback)
    .values({
      tenantId: event.tenantId,
      segmentId: event.segmentId,
      externalRef: event.eventId,
      widgetId: event.widgetId ?? null,
      text: event.text,
      sentiment: event.sentiment ?? null,
      contact: event.contact ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: customerFeedback.id, status: customerFeedback.status });
  if (row) return { id: row.id, status: row.status, deduped: false };

  const [existing] = await db
    .select({ id: customerFeedback.id, status: customerFeedback.status })
    .from(customerFeedback)
    .where(scopedToTenant(
      customerFeedback, event.tenantId,
      eq(customerFeedback.segmentId, event.segmentId), eq(customerFeedback.externalRef, event.eventId),
    ))
    .limit(1);
  return { id: existing?.id ?? null, status: existing?.status ?? 'new', deduped: true };
}

/** The segment's feedback, newest first; an unknown status filter is ignored. */
export function listCustomerFeedback(db: Db, tenantId: number, segmentId: string, statusFilter?: string) {
  const conds = [eq(customerFeedback.tenantId, tenantId), eq(customerFeedback.segmentId, segmentId)];
  if (isFeedbackStatus(statusFilter)) conds.push(eq(customerFeedback.status, statusFilter));
  return db
    .select({
      id: customerFeedback.id,
      externalRef: customerFeedback.externalRef,
      widgetId: customerFeedback.widgetId,
      text: customerFeedback.text,
      sentiment: customerFeedback.sentiment,
      contact: customerFeedback.contact,
      status: customerFeedback.status,
      triagedTaskId: customerFeedback.triagedTaskId,
      triagedAt: customerFeedback.triagedAt,
      createdAt: customerFeedback.createdAt,
    })
    .from(customerFeedback)
    .where(and(...conds))
    .orderBy(desc(customerFeedback.createdAt))
    .limit(200);
}

export type TriageResult =
  | { ok: true; row: { id: string; status: string; triagedTaskId: number | null } }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Flip a feedback row's status. When triaging into the backlog it may link the task
 * it became — validated to the same segment so a triage can't point at another
 * end-client's task. (Spawning the task is a task-domain concern; the caller passes
 * the created/linked id.) Re-opening or dismissing clears any triage linkage.
 */
export async function triageCustomerFeedback(
  db: Db,
  tenantId: number,
  segmentId: string,
  id: string,
  status: FeedbackStatus,
  taskId?: number | null,
): Promise<TriageResult> {
  let triagedTaskId: number | null = null;
  if (status === 'triaged' && typeof taskId === 'number') {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId), eq(tasks.segmentId, segmentId)))
      .limit(1);
    if (!task) return { ok: false, status: 400, error: 'taskId not found in this segment' };
    triagedTaskId = task.id;
  }

  const patch = status === 'triaged'
    ? { status, triagedAt: new Date(), triagedTaskId }
    : { status, triagedAt: null, triagedTaskId: null };

  const [updated] = await db
    .update(customerFeedback)
    .set(patch)
    .where(and(
      eq(customerFeedback.id, id),
      eq(customerFeedback.tenantId, tenantId),
      eq(customerFeedback.segmentId, segmentId),
    ))
    .returning({ id: customerFeedback.id, status: customerFeedback.status, triagedTaskId: customerFeedback.triagedTaskId });
  return updated ? { ok: true, row: updated } : { ok: false, status: 404, error: 'feedback not found' };
}
