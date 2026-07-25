/**
 * stallWatch — the persistence half of the AI Manager's stuck-ticket accountability.
 *
 * `stallTriage.ts` decides WHAT is wrong with a ticket and what would fix it. This
 * module remembers what the manager already tried, so the next pass can answer the
 * only question that separates autonomy from a retry storm: **did my fix work?**
 *
 * HOW "DID IT WORK?" IS ANSWERED
 * Cheaply, and without re-reading transition history every pass. When the manager
 * applies a remedy it stamps the ticket's status at that moment into
 * `observed_status`. On the next pass:
 *
 *   • status CHANGED  → the ticket moved. The remedy (or something) worked, so the
 *                       attempt counter resets to zero.
 *   • status IDENTICAL → the ticket did not move. The counter carries, and at
 *                       {@link MAX_REMEDY_ATTEMPTS} `escalateIfIneffective` converts
 *                       the remedy to `escalate_human`.
 *
 * That ceiling is the generalised fix for the merge livelock this work uncovered
 * (40,580 `sync_pr` actions against 10 merges). The remedy there was correct; nothing
 * ever checked whether it moved anything. Nothing in this module may repeat that:
 * every remedy it records is one it will later grade.
 *
 * The register is CURRENT STATE — one open row per ticket, closed the moment the
 * ticket starts moving again. The per-pass event stream already lives in
 * `manager_actions`; writing an event per ticket per pass here would recreate the
 * write amplification the gap register flags on `auto_run_skipped`.
 */
import { and, asc, desc, eq, isNull, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { managerStallWatch, tasks } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  escalateIfIneffective, isManagerActionable, MAX_REMEDY_ATTEMPTS,
  type StallDiagnosis, type StallCause, type StallRemedy,
} from './stallTriage';

/** Cap the register read so a pathological project cannot return an unbounded set. */
export const MAX_REGISTER_ROWS = 200;

const REGISTER_TTL_SECONDS = 60;

const registerKey = (tenantId: number, projectId: number | null) =>
  `manager:stalls:${tenantId}:${projectId ?? 'all'}`;

/** One open row from the register. */
export interface StallWatchRow {
  taskId: number;
  title: string;
  status: string;
  cause: StallCause;
  remedy: StallRemedy;
  detail: string;
  attempts: number;
  idleMs: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastAttemptAt: Date | null;
  escalatedAt: Date | null;
}

/** The open row the manager needs in order to grade its previous attempt. */
export interface OpenStall {
  id: string;
  taskId: number;
  cause: string;
  remedy: string;
  observedStatus: string;
  attempts: number;
  escalatedAt: Date | null;
}

/**
 * Load every OPEN stall row for a project, keyed by task. One query per pass — the
 * triage stage grades N tickets against this map rather than issuing N reads.
 */
export async function loadOpenStalls(db: Db, projectId: number): Promise<Map<number, OpenStall>> {
  const rows = await db
    .select({
      id: managerStallWatch.id,
      taskId: managerStallWatch.taskId,
      cause: managerStallWatch.cause,
      remedy: managerStallWatch.remedy,
      observedStatus: managerStallWatch.observedStatus,
      attempts: managerStallWatch.attempts,
      escalatedAt: managerStallWatch.escalatedAt,
    })
    .from(managerStallWatch)
    .where(and(eq(managerStallWatch.projectId, projectId), isNull(managerStallWatch.resolvedAt)))
    .limit(MAX_REGISTER_ROWS * 2);

  const byTask = new Map<number, OpenStall>();
  for (const r of rows) byTask.set(r.taskId, r as OpenStall);
  return byTask;
}

/**
 * How many consecutive times the manager has applied `diagnosis.remedy` to this
 * ticket WITHOUT it moving. PURE.
 *
 * Zero whenever the comparison is not like-for-like — no prior row, the ticket moved
 * since the last attempt, or the diagnosis changed to a different remedy. A different
 * remedy deserves its own budget: "I tried assigning it three times" says nothing
 * about whether driving a sign-off will work.
 */
export function priorAttemptsFor(
  open: OpenStall | undefined,
  currentStatus: string,
  diagnosis: StallDiagnosis,
): number {
  if (!open) return 0;
  if (open.observedStatus !== currentStatus) return 0;
  if (open.remedy !== diagnosis.remedy) return 0;
  return open.attempts;
}

/**
 * Grade the previous attempt and decide this pass's verdict. PURE.
 *
 * Returns the diagnosis with escalation already folded in, plus the attempt count the
 * caller should persist once it has (or has not) applied the remedy.
 */
export function gradeStall(
  open: OpenStall | undefined,
  currentStatus: string,
  diagnosis: StallDiagnosis,
): { verdict: StallDiagnosis; priorAttempts: number } {
  const priorAttempts = priorAttemptsFor(open, currentStatus, diagnosis);
  return { verdict: escalateIfIneffective(diagnosis, priorAttempts), priorAttempts };
}

/**
 * Open or update the ticket's register row.
 *
 * `applied` is whether the manager actually performed the remedy this pass — only
 * then does the attempt counter advance, because an attempt that never happened
 * cannot have failed. A pass that merely re-observes an escalated ticket refreshes
 * `last_seen_at` and nothing else, so the register stays honest about how long
 * something has been waiting on a human.
 */
export async function recordStall(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    projectId: number;
    taskId: number;
    status: string;
    idleMs: number;
    verdict: StallDiagnosis;
    priorAttempts: number;
    applied: boolean;
  },
): Promise<void> {
  const now = new Date();
  const attempts = args.applied ? args.priorAttempts + 1 : args.priorAttempts;
  const escalatedAt = args.verdict.escalated ? now : null;

  try {
    await db
      .insert(managerStallWatch)
      .values({
        tenantId: args.tenantId,
        projectId: args.projectId,
        taskId: args.taskId,
        cause: args.verdict.cause,
        remedy: args.verdict.remedy,
        detail: args.verdict.detail,
        observedStatus: args.status,
        attempts,
        idleMs: Math.max(0, Math.round(args.idleMs)),
        firstSeenAt: now,
        lastSeenAt: now,
        lastAttemptAt: args.applied ? now : null,
        escalatedAt,
      })
      // The partial-unique index is on (task_id) WHERE resolved_at IS NULL, so this
      // targets the OPEN row only — a previously resolved row stays as history and its
      // attempt count never resurrects onto a fresh stall.
      .onConflictDoUpdate({
        target: managerStallWatch.taskId,
        targetWhere: isNull(managerStallWatch.resolvedAt),
        set: {
          cause: args.verdict.cause,
          remedy: args.verdict.remedy,
          detail: args.verdict.detail,
          observedStatus: args.status,
          attempts,
          idleMs: Math.max(0, Math.round(args.idleMs)),
          lastSeenAt: now,
          // Preserve the ORIGINAL attempt timestamp on an observe-only pass.
          ...(args.applied ? { lastAttemptAt: now } : {}),
          // Escalation is sticky: once handed to a human it stays stamped until the
          // ticket actually moves and the row is resolved.
          ...(escalatedAt ? { escalatedAt } : {}),
          updatedAt: now,
        },
      });
    await invalidateCached(env, registerKey(args.tenantId, args.projectId));
    await invalidateCached(env, registerKey(args.tenantId, null));
  } catch {
    /* the register is observability — never let it fail the manager pass */
  }
}

/**
 * Close the open rows for tickets that are moving again. Batched: the common healthy
 * pass resolves several at once and must not cost one round-trip each.
 */
export async function resolveStalls(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; taskIds: number[] },
): Promise<number> {
  if (args.taskIds.length === 0) return 0;
  try {
    const now = new Date();
    await db
      .update(managerStallWatch)
      .set({ resolvedAt: now, updatedAt: now })
      .where(and(
        eq(managerStallWatch.projectId, args.projectId),
        isNull(managerStallWatch.resolvedAt),
        inArray(managerStallWatch.taskId, args.taskIds),
      ));
    await invalidateCached(env, registerKey(args.tenantId, args.projectId));
    await invalidateCached(env, registerKey(args.tenantId, null));
    return args.taskIds.length;
  } catch {
    return 0;
  }
}

export interface StallRegister {
  /** Open stalls, worst (longest idle) first. */
  rows: StallWatchRow[];
  /** Open stalls the manager has handed to a human. */
  escalated: number;
  /** Open stalls the manager is still working itself. */
  working: number;
  /** Count per cause, largest first — the "why is work stuck here" summary. */
  byCause: Array<{ cause: StallCause; count: number }>;
  /** The escalation ceiling, so a reader can compare `attempts` without knowing it. */
  maxAttempts: number;
}

/**
 * Read the register for a project (or the whole workspace when `projectId` is null).
 *
 * Cached read-through: this is a dashboard/MCP read that several surfaces poll, and
 * the manager pass invalidates it on every write, so a short TTL is safe and keeps a
 * polled panel off the database.
 */
export async function getStallRegister(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId?: number | null },
): Promise<StallRegister> {
  const projectId = args.projectId ?? null;
  const cached = await getOrSetCached(
    env,
    registerKey(args.tenantId, projectId),
    async () => {
      const rows = await db
        .select({
          taskId: managerStallWatch.taskId,
          title: tasks.title,
          status: tasks.status,
          cause: managerStallWatch.cause,
          remedy: managerStallWatch.remedy,
          detail: managerStallWatch.detail,
          attempts: managerStallWatch.attempts,
          idleMs: managerStallWatch.idleMs,
          firstSeenAt: managerStallWatch.firstSeenAt,
          lastSeenAt: managerStallWatch.lastSeenAt,
          lastAttemptAt: managerStallWatch.lastAttemptAt,
          escalatedAt: managerStallWatch.escalatedAt,
        })
        .from(managerStallWatch)
        .innerJoin(tasks, eq(tasks.id, managerStallWatch.taskId))
        .where(and(
          eq(managerStallWatch.tenantId, args.tenantId),
          isNull(managerStallWatch.resolvedAt),
          ...(projectId != null ? [eq(managerStallWatch.projectId, projectId)] : []),
        ))
        // Escalated first (they need a human), then longest-idle.
        .orderBy(sql`${managerStallWatch.escalatedAt} asc nulls last`, desc(managerStallWatch.idleMs))
        .limit(MAX_REGISTER_ROWS);
      return rows;
    },
    { kvTtlSeconds: REGISTER_TTL_SECONDS },
  );

  // Dates survive the KV round-trip as ISO strings; normalise so every caller gets Dates.
  const rows: StallWatchRow[] = (cached as StallWatchRow[]).map((r) => ({
    ...r,
    cause: r.cause as StallCause,
    remedy: r.remedy as StallRemedy,
    idleMs: Number(r.idleMs) || 0,
    firstSeenAt: new Date(r.firstSeenAt),
    lastSeenAt: new Date(r.lastSeenAt),
    lastAttemptAt: r.lastAttemptAt ? new Date(r.lastAttemptAt) : null,
    escalatedAt: r.escalatedAt ? new Date(r.escalatedAt) : null,
  }));

  return { ...summarizeRegister(rows), rows };
}

/**
 * Roll the open rows into the counts the register header shows. PURE — split out so
 * the summary is unit-tested without a database, and so the MCP tool and the UI can
 * both derive it from the same code path.
 */
export function summarizeRegister(rows: readonly StallWatchRow[]): Omit<StallRegister, 'rows'> {
  const counts = new Map<StallCause, number>();
  let escalated = 0;
  for (const r of rows) {
    counts.set(r.cause, (counts.get(r.cause) ?? 0) + 1);
    if (r.escalatedAt) escalated += 1;
  }
  return {
    escalated,
    working: rows.length - escalated,
    byCause: [...counts.entries()]
      .map(([cause, count]) => ({ cause, count }))
      .sort((a, b) => b.count - a.count),
    maxAttempts: MAX_REMEDY_ATTEMPTS,
  };
}

/** Re-exported so callers wire the triage stage from one import. */
export { isManagerActionable, MAX_REMEDY_ATTEMPTS };

/**
 * Oldest open stalls across a workspace, for the tenant-wide escalation view.
 * Used by the MCP tool so an agent can ask "what is stuck everywhere" in one call.
 */
export async function listEscalatedStalls(
  db: Db,
  tenantId: number,
  limit = 50,
): Promise<Array<{ taskId: number; projectId: number; cause: string; detail: string; escalatedAt: Date }>> {
  const rows = await db
    .select({
      taskId: managerStallWatch.taskId,
      projectId: managerStallWatch.projectId,
      cause: managerStallWatch.cause,
      detail: managerStallWatch.detail,
      escalatedAt: managerStallWatch.escalatedAt,
    })
    .from(managerStallWatch)
    .where(and(
      eq(managerStallWatch.tenantId, tenantId),
      isNull(managerStallWatch.resolvedAt),
      sql`${managerStallWatch.escalatedAt} is not null`,
    ))
    .orderBy(asc(managerStallWatch.escalatedAt))
    .limit(limit);
  return rows as Array<{ taskId: number; projectId: number; cause: string; detail: string; escalatedAt: Date }>;
}
