/**
 * Commitments that came out of a conversation (PRD 19 §9).
 *
 * ── WHY THIS IS NOT A TASK ──────────────────────────────────────────────────
 * `action_items` says it in its own docstring: "captured mid-discussion with no
 * board, no estimate and no lane". That is the whole justification for the table,
 * and it is the reason this is not a thin wrapper over `TaskService`. A retro
 * produces fifteen commitments in ten minutes; making each one a `work_items` row
 * means choosing a board, a lane and an estimate fifteen times, and the actual
 * outcome of that friction is that nobody records them at all.
 *
 * So an action item is deliberately cheap: a title, an owner, a due date. What it
 * has that a sticky note does not is {@link promoteToWorkItem} — the one-way door
 * from "we said we would" to "it is on the board", which stamps
 * `promoted_work_item_ref` so the commitment and the ticket stay joined and the
 * retro can be replayed six weeks later to ask which commitments were real.
 *
 * ── THE MERGE ───────────────────────────────────────────────────────────────
 * Three BurnRateOS modules wrote this shape and none of them shared it:
 * `retrospectives` (retro actions), `operationalCadence` (1:1 and check-in
 * follow-ups) and `pitchDeck` (review comments that became work). Each had its own
 * columns, its own status vocabulary and its own idea of "done". They converge
 * here on ONE table keyed by `source_ref`, which is what makes "every open
 * commitment from every ceremony" a single query instead of a union of three.
 *
 * Builderforce contributed the half BurnRateOS had no equivalent for: kernel
 * `objects` registration, so a commitment is addressable and can be discussed,
 * and the promotion pointer.
 */

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { actionItems } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { registerObject } from '../kernel/ObjectRegistry';

/** `action_items.status`. `dropped` is not `done`: a commitment nobody intends to
 *  keep is a real outcome and hiding it as completion is how a retro learns
 *  nothing. */
export const ACTION_STATUSES = ['open', 'in_progress', 'done', 'dropped'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const isActionStatus = (v: unknown): v is ActionStatus =>
  typeof v === 'string' && (ACTION_STATUSES as readonly string[]).includes(v);

/**
 * Where the commitment was made.
 *
 * ONE column, `source_ref`, and no companion `source_kind` — which is the
 * schema's own decision and the right one. The thing a commitment came out of is
 * already an `objects` row (a ceremony, a thread, a document), so its id IS the
 * kind-and-identity: resolving it through the registry answers "what was this"
 * without a second, unenforceable string that can disagree with the first. That
 * is the polymorphic-pointer failure `check-polymorphic-fk` exists to catch.
 */
export type ActionSource = { ref: string };

export class ActionItemError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ActionItemError';
  }
}

export type ActionItemInput = {
  title: string;
  detail?: string | null;
  ownerRef?: string | null;
  dueAt?: Date | null;
  source?: ActionSource;
};

const requireTitle = (t: string): string => {
  const s = t.trim();
  if (!s) throw new ActionItemError('title is required');
  return s.slice(0, 300);
};

/**
 * Every commitment, newest first, optionally narrowed to a source or an owner.
 *
 * `openOnly` defaults to TRUE. The question a standup asks is "what is still
 * outstanding", and a list that defaults to including six months of completed
 * items answers a question nobody asked while burying the one they did.
 */
export async function listActionItems(
  db: Db,
  tenantId: number,
  filter: { source?: ActionSource; ownerRef?: string; openOnly?: boolean } = {},
) {
  const where = [];
  if (filter.source?.ref) where.push(eq(actionItems.sourceRef, filter.source.ref));
  if (filter.ownerRef) where.push(eq(actionItems.ownerRef, filter.ownerRef));
  if (filter.openOnly !== false) where.push(inArray(actionItems.status, ['open', 'in_progress']));

  return db
    .select()
    .from(actionItems)
    .where(scopedToTenant(actionItems, tenantId, where.length ? and(...where) : undefined))
    .orderBy(asc(actionItems.dueAt), desc(actionItems.createdAt));
}

export async function createActionItem(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: ActionItemInput,
  createdBy: string | null = null,
) {
  const title = requireTitle(input.title);

  const [inserted] = await db
    .insert(actionItems)
    .values({
      tenantId,
      sourceRef: input.source?.ref ?? null,
      title,
      detail: input.detail ?? null,
      ownerRef: input.ownerRef ?? null,
      dueAt: input.dueAt ?? null,
      status: 'open',
      createdBy,
    })
    .returning();
  if (!inserted) throw new ActionItemError('could not create the action item');

  // Registered after the insert, because `refId` is the serial the insert
  // produced — the same order `companyObjectId` and `createLandingPage` use.
  const registered = await registerObject(db, env, {
    tenantId,
    kind: 'action_item',
    refId: inserted.id,
    domain: 'delivery',
    title,
  });
  const [row] = await db
    .update(actionItems)
    .set({ objectId: registered.id, updatedAt: new Date() })
    .where(scopedToTenant(actionItems, tenantId, eq(actionItems.id, inserted.id)))
    .returning();
  if (!row) throw new ActionItemError('could not create the action item');

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'action_item.created',
    targetType: 'action_item',
    targetId: String(row.id),
    objectId: registered.id,
    metadata: { title, sourceRef: row.sourceRef, ownerRef: row.ownerRef },
  });
  return row;
}

export async function updateActionItem(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  patch: Partial<ActionItemInput & { status: ActionStatus }>,
) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = requireTitle(patch.title);
  if (patch.detail !== undefined) values.detail = patch.detail;
  if (patch.ownerRef !== undefined) values.ownerRef = patch.ownerRef;
  if (patch.dueAt !== undefined) values.dueAt = patch.dueAt;
  if (patch.status !== undefined) {
    if (!isActionStatus(patch.status)) throw new ActionItemError(`status must be one of: ${ACTION_STATUSES.join(', ')}`);
    values.status = patch.status;
  }

  const [row] = await db
    .update(actionItems)
    .set(values)
    .where(scopedToTenant(actionItems, tenantId, eq(actionItems.id, id)))
    .returning();
  if (!row) throw new ActionItemError('action item not found', 404);

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'action_item.updated',
    targetType: 'action_item',
    targetId: String(id),
    metadata: { fields: Object.keys(values).filter((k) => k !== 'updatedAt') },
  });
  return row;
}

/**
 * The one-way door: this commitment is now a ticket.
 *
 * ONE-WAY on purpose. `promoted_work_item_ref` is set only if it is currently
 * null, so a second promotion cannot silently repoint the commitment at a
 * different ticket and orphan the first — which is how a retro ends up claiming
 * credit for work that was already tracked elsewhere. Re-promoting is a 409, not
 * a quiet overwrite.
 *
 * The work item itself is created by whoever owns work items; this records the
 * JOIN. Creating the ticket here would mean this module knowing about boards,
 * lanes and estimates, which is exactly the knowledge an action item exists to
 * not need.
 */
export async function promoteToWorkItem(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  workItemRef: string,
) {
  const ref = workItemRef.trim();
  if (!ref) throw new ActionItemError('workItemRef is required');

  const [row] = await db
    .update(actionItems)
    .set({ promotedWorkItemRef: ref, status: 'in_progress', updatedAt: new Date() })
    .where(scopedToTenant(actionItems, tenantId, and(
      eq(actionItems.id, id),
      isNull(actionItems.promotedWorkItemRef),
    )))
    .returning();

  if (!row) {
    // Distinguish "no such item" from "already promoted" — they need different
    // fixes and a single 404 sends the caller looking for the wrong one.
    const [existing] = await db
      .select({ promoted: actionItems.promotedWorkItemRef })
      .from(actionItems)
      .where(scopedToTenant(actionItems, tenantId, eq(actionItems.id, id)))
      .limit(1);
    if (!existing) throw new ActionItemError('action item not found', 404);
    throw new ActionItemError(`already promoted to ${existing.promoted}`, 409);
  }

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'action_item.promoted',
    targetType: 'action_item',
    targetId: String(id),
    metadata: { workItemRef: ref },
  });
  return row;
}

/**
 * Did the commitments made in this ceremony actually happen?
 *
 * The number a retro needs six weeks later, and the reason `source_ref` exists.
 * `dropped` is reported separately from `done` rather than folded into a single
 * completion rate — a team that drops half its commitments and a team that
 * completes half of them are not the same team, and one rate cannot tell them
 * apart.
 */
export async function sourceFollowThrough(db: Db, tenantId: number, source: ActionSource) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${actionItems.status} = 'done')::int`,
      dropped: sql<number>`count(*) filter (where ${actionItems.status} = 'dropped')::int`,
      open: sql<number>`count(*) filter (where ${actionItems.status} in ('open','in_progress'))::int`,
      overdue: sql<number>`count(*) filter (where ${actionItems.status} in ('open','in_progress') and ${actionItems.dueAt} < now())::int`,
      promoted: sql<number>`count(*) filter (where ${actionItems.promotedWorkItemRef} is not null)::int`,
    })
    .from(actionItems)
    .where(scopedToTenant(actionItems, tenantId, eq(actionItems.sourceRef, source.ref)));

  return row ?? { total: 0, done: 0, dropped: 0, open: 0, overdue: 0, promoted: 0 };
}

/** Every commitment that is past its due date and still open, oldest first —
 *  the standup's actual agenda. */
export async function overdueActionItems(db: Db, tenantId: number) {
  return db
    .select()
    .from(actionItems)
    .where(scopedToTenant(actionItems, tenantId, and(
      inArray(actionItems.status, ['open', 'in_progress']),
      isNotNull(actionItems.dueAt),
      sql`${actionItems.dueAt} < now()`,
    )))
    .orderBy(asc(actionItems.dueAt));
}
