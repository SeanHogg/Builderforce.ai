/**
 * Guided arrival — flows, checklists, steps and how far one person got
 * (PRD 19 §9).
 *
 * ── FOUR TABLES, ONE FEATURE ────────────────────────────────────────────────
 * `onboarding_flows` → `onboarding_checklists` → `onboarding_tasks` is the
 * definition, `onboarding_progress` is one person's position in it. Only the flow
 * and the progress rows were named in the gap register, but building those two
 * without the middle pair would have produced a flow with no steps — the register
 * lists what BurnRateOS TOUCHED, not what a coherent feature needs.
 *
 * ── PROGRESSIVE DISCLOSURE GATES STATE, NEVER CAPABILITY ────────────────────
 * `onboarding_checklists.is_required` and `onboarding_tasks.is_required` already
 * carry the rule in their docstring: "a required step blocks, an optional one
 * nudges". {@link flowProgress} therefore reports `blocked` separately from
 * `remaining`, so a shell can hold a session on the first and merely prompt on
 * the second. Collapsing them is how an optional tour becomes a wall.
 *
 * ── SKIPPING IS A FIRST-CLASS OUTCOME ───────────────────────────────────────
 * `skipped` with a `skipped_reason` is a status, not a variant of done. A team
 * that skips "connect your repository" every time is telling you something, and a
 * completion rate that counts skips as completions makes that invisible —
 * {@link flowFunnel} reports them apart for exactly that reason.
 *
 * ── THE FLOW DEFINITION IS PLATFORM-OR-TENANT ───────────────────────────────
 * `onboarding_flows`, `_checklists` and `_tasks` are all NULLABLE on tenant: the
 * platform ships default flows and a tenant may define its own. Progress is NOT
 * nullable — it is always somebody's, in some workspace. That asymmetry is why
 * the definition reads use `scopedToNullableTenant` and progress uses
 * `scopedToTenant`.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  onboardingChecklists,
  onboardingFlows,
  onboardingProgress,
  onboardingTasks,
} from '../../infrastructure/database/schema';
import { scopedToNullableTenant, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';

/** `onboarding_flows.audience` — which arrival this flow serves. */
export const AUDIENCES = ['signup', 'invite', 'hire', 'employee', 'freelancer'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** `onboarding_progress.status`. */
export const PROGRESS_STATUSES = ['pending', 'in_progress', 'done', 'skipped'] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const isAudience = (v: unknown): v is Audience =>
  typeof v === 'string' && (AUDIENCES as readonly string[]).includes(v);
export const isProgressStatus = (v: unknown): v is ProgressStatus =>
  typeof v === 'string' && (PROGRESS_STATUSES as readonly string[]).includes(v);

export class OnboardingError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'OnboardingError';
  }
}

// ── The definition ──────────────────────────────────────────────────────────

/**
 * The whole flow — checklists and their steps, in order.
 *
 * Three queries regardless of size, assembled in memory. A per-checklist step
 * query would be the N+1 that appears the moment a flow has more than a couple of
 * sections, and onboarding is on the critical path of somebody's first minute.
 */
export async function flowDefinition(db: Db, tenantId: number | null, flowId: number) {
  const [flow] = await db
    .select()
    .from(onboardingFlows)
    .where(scopedToNullableTenant(onboardingFlows, tenantId, eq(onboardingFlows.id, flowId)))
    .limit(1);
  if (!flow) throw new OnboardingError('flow not found', 404);

  const checklists = await db
    .select()
    .from(onboardingChecklists)
    .where(scopedToNullableTenant(onboardingChecklists, tenantId, eq(onboardingChecklists.flowId, flowId)))
    .orderBy(asc(onboardingChecklists.position));

  const ids = checklists.map((c) => c.id);
  const tasks = ids.length === 0 ? [] : await db
    .select()
    .from(onboardingTasks)
    .where(scopedToNullableTenant(onboardingTasks, tenantId, inArray(onboardingTasks.checklistId, ids)))
    .orderBy(asc(onboardingTasks.position));

  const byChecklist = new Map<number, typeof tasks>();
  for (const t of tasks) {
    if (t.checklistId === null) continue;
    if (!byChecklist.has(t.checklistId)) byChecklist.set(t.checklistId, []);
    byChecklist.get(t.checklistId)!.push(t);
  }

  return {
    ...flow,
    checklists: checklists.map((c) => ({ ...c, tasks: byChecklist.get(c.id) ?? [] })),
  };
}

/** The enabled flows for an audience — what a new arrival of this kind sees.
 *  Tenant flows and platform defaults are both returned; the caller picks. */
export async function flowsForAudience(db: Db, tenantId: number | null, audience: Audience) {
  if (!isAudience(audience)) throw new OnboardingError(`audience must be one of: ${AUDIENCES.join(', ')}`);
  return db
    .select()
    .from(onboardingFlows)
    .where(scopedToNullableTenant(onboardingFlows, tenantId, and(
      eq(onboardingFlows.audience, audience),
      eq(onboardingFlows.enabled, true),
    )))
    .orderBy(asc(onboardingFlows.isDefault), asc(onboardingFlows.name));
}

export async function createFlow(
  db: Db,
  tenantId: number | null,
  input: { key: string; name: string; audience?: Audience; description?: string | null },
) {
  const key = input.key.trim().toLowerCase();
  if (!key) throw new OnboardingError('key is required');
  const audience = input.audience ?? 'signup';
  if (!isAudience(audience)) throw new OnboardingError(`audience must be one of: ${AUDIENCES.join(', ')}`);

  const [row] = await db
    .insert(onboardingFlows)
    .values({
      tenantId,
      key: key.slice(0, 64),
      name: input.name.trim().slice(0, 200),
      audience,
      description: input.description ?? null,
    })
    .returning();
  if (!row) throw new OnboardingError('could not create the flow');
  return row;
}

export async function addChecklist(
  db: Db,
  tenantId: number | null,
  flowId: number,
  input: { name: string; summary?: string | null; isRequired?: boolean },
) {
  const [tail] = await db
    .select({ next: sql<number>`coalesce(max(${onboardingChecklists.position}) + 1, 0)` })
    .from(onboardingChecklists)
    .where(scopedToNullableTenant(onboardingChecklists, tenantId, eq(onboardingChecklists.flowId, flowId)));

  const [row] = await db
    .insert(onboardingChecklists)
    .values({
      tenantId,
      flowId,
      name: input.name.trim().slice(0, 200),
      summary: input.summary ?? null,
      position: tail?.next ?? 0,
      isRequired: input.isRequired ?? false,
    })
    .returning();
  if (!row) throw new OnboardingError('could not add the checklist');
  return row;
}

export async function addTask(
  db: Db,
  tenantId: number | null,
  checklistId: number,
  input: { key: string; title: string; description?: string | null; actionHref?: string | null; completionKind?: 'manual' | 'event' | 'query'; completionRule?: unknown; isRequired?: boolean },
) {
  const key = input.key.trim().toLowerCase();
  if (!key) throw new OnboardingError('key is required');

  const [tail] = await db
    .select({ next: sql<number>`coalesce(max(${onboardingTasks.position}) + 1, 0)` })
    .from(onboardingTasks)
    .where(scopedToNullableTenant(onboardingTasks, tenantId, eq(onboardingTasks.checklistId, checklistId)));

  const [row] = await db
    .insert(onboardingTasks)
    .values({
      tenantId,
      checklistId,
      key: key.slice(0, 64),
      title: input.title.trim().slice(0, 300),
      description: input.description ?? null,
      actionHref: input.actionHref ?? null,
      completionKind: input.completionKind ?? 'manual',
      completionRule: input.completionRule ?? null,
      position: tail?.next ?? 0,
      isRequired: input.isRequired ?? false,
    })
    .returning();
  if (!row) throw new OnboardingError('could not add the task');
  return row;
}

// ── Progress ────────────────────────────────────────────────────────────────

/**
 * Record where somebody got to.
 *
 * Upserts on the unique (tenant, task, subject) key, so re-completing a step is
 * the same step rather than a second row. `completed_at` is stamped by the
 * transition and cleared when a step moves back — a `done` row with no completion
 * time, or a `pending` row that still carries one, are both states a completion
 * report has to special-case, so neither is representable.
 */
export async function setProgress(
  db: Db,
  tenantId: number,
  input: { flowId: number; taskId: number; subjectRef: string; status: ProgressStatus; skippedReason?: string | null },
) {
  if (!isProgressStatus(input.status)) {
    throw new OnboardingError(`status must be one of: ${PROGRESS_STATUSES.join(', ')}`);
  }
  const subjectRef = input.subjectRef.trim();
  if (!subjectRef) throw new OnboardingError('subjectRef is required');
  if (input.status === 'skipped' && !input.skippedReason) {
    throw new OnboardingError('a skipped step needs a reason — a skip with no reason teaches nothing');
  }

  const completedAt = input.status === 'done' ? new Date() : null;
  const values = {
    tenantId,
    flowId: input.flowId,
    taskId: input.taskId,
    subjectRef: subjectRef.slice(0, 64),
    status: input.status,
    completedAt,
    skippedReason: input.status === 'skipped' ? (input.skippedReason ?? null) : null,
  };

  const [row] = await db
    .insert(onboardingProgress)
    .values(values)
    .onConflictDoUpdate({
      target: [onboardingProgress.tenantId, onboardingProgress.taskId, onboardingProgress.subjectRef],
      set: {
        status: values.status,
        completedAt,
        skippedReason: values.skippedReason,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new OnboardingError('could not record progress');
  return row;
}

/**
 * One person's position in one flow.
 *
 * `blocked` is the required work still outstanding and `remaining` is everything
 * outstanding. A shell holds a session on the first and nudges on the second —
 * see the module docstring. A step nobody has touched counts as pending rather
 * than being absent, so the denominator is the flow and not the rows that happen
 * to exist.
 */
export async function flowProgress(db: Db, tenantId: number, flowId: number, subjectRef: string) {
  const definition = await flowDefinition(db, tenantId, flowId);
  const rows = await db
    .select({ taskId: onboardingProgress.taskId, status: onboardingProgress.status })
    .from(onboardingProgress)
    .where(scopedToTenant(onboardingProgress, tenantId, and(
      eq(onboardingProgress.flowId, flowId),
      eq(onboardingProgress.subjectRef, subjectRef.trim()),
    )));

  const byTask = new Map(rows.map((r) => [r.taskId, r.status]));
  const tasks = definition.checklists.flatMap((c) =>
    c.tasks.map((t) => ({
      taskId: t.id,
      key: t.key,
      title: t.title,
      actionHref: t.actionHref,
      isRequired: t.isRequired || c.isRequired,
      status: byTask.get(t.id) ?? 'pending',
    })));

  const settled = (s: string) => s === 'done' || s === 'skipped';
  const remaining = tasks.filter((t) => !settled(t.status));
  const blocked = remaining.filter((t) => t.isRequired);

  return {
    flow: { id: definition.id, key: definition.key, name: definition.name, audience: definition.audience },
    subjectRef,
    tasks,
    total: tasks.length,
    completed: tasks.filter((t) => t.status === 'done').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
    remaining: remaining.length,
    blocked: blocked.length,
    blockedTasks: blocked,
    // Percent over the whole flow, so it does not jump when a step is added.
    percent: tasks.length === 0 ? 100 : Math.round((tasks.filter((t) => settled(t.status)).length / tasks.length) * 100),
  };
}

/**
 * Where people fall out, per step.
 *
 * Skips are reported apart from completions — the whole point. A step everyone
 * skips is a step to remove or fix, and a completion rate that swallows skips
 * says the flow is working.
 */
export async function flowFunnel(db: Db, tenantId: number, flowId: number) {
  return db
    .select({
      taskId: onboardingProgress.taskId,
      subjects: sql<number>`count(distinct ${onboardingProgress.subjectRef})::int`,
      done: sql<number>`count(*) filter (where ${onboardingProgress.status} = 'done')::int`,
      skipped: sql<number>`count(*) filter (where ${onboardingProgress.status} = 'skipped')::int`,
      inProgress: sql<number>`count(*) filter (where ${onboardingProgress.status} = 'in_progress')::int`,
    })
    .from(onboardingProgress)
    .where(scopedToTenant(onboardingProgress, tenantId, eq(onboardingProgress.flowId, flowId)))
    .groupBy(onboardingProgress.taskId);
}

/** Mark a whole flow finished for somebody — every outstanding step done. Used by
 *  a "skip the tour" affordance, which is a decision the person made and is
 *  therefore recorded as one rather than as silence. */
export async function completeFlow(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  flowId: number,
  subjectRef: string,
  reason: string,
) {
  const definition = await flowDefinition(db, tenantId, flowId);
  const taskIds = definition.checklists.flatMap((c) => c.tasks.map((t) => t.id));
  if (taskIds.length === 0) return { skipped: 0 };

  const rows = await db
    .insert(onboardingProgress)
    .values(taskIds.map((taskId) => ({
      tenantId,
      flowId,
      taskId,
      subjectRef: subjectRef.trim().slice(0, 64),
      status: 'skipped' as const,
      skippedReason: reason.slice(0, 200),
    })))
    .onConflictDoNothing({
      target: [onboardingProgress.tenantId, onboardingProgress.taskId, onboardingProgress.subjectRef],
    })
    .returning({ id: onboardingProgress.id });

  await recordActivity(env, db, {
    tenantId, actor, verb: 'onboarding.flow_skipped',
    targetType: 'onboarding_flow', targetId: String(flowId),
    metadata: { subjectRef, reason, steps: rows.length },
  });
  return { skipped: rows.length };
}
