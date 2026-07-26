/**
 * rehearsalService — start, run and read rehearsals.
 *
 * A rehearsal is NOT a second engine. It is the real loop
 * ({@link runCloudToolLoop}), the real prompt prep ({@link prepareCloudRun}), the real
 * tool registry and the real model, with two options set:
 *
 *   decorateProvider: shadowProvider(...)   → every effect recorded, never performed
 *   suppressFinalize: true                  → no PR, no ticket mutation, no summary
 *
 * That is the whole trick, and it is why a rehearsal predicts anything: if it forked
 * the loop it would measure the fork. The seam is one function passed in, so the engine
 * has no idea rehearsal exists (Open/Closed).
 *
 * THREE KINDS
 *   dry_run — run this ticket now against the current tree. "What would the agent do?"
 *   replay  — re-run a past execution pinned to the ref it originally saw. This is the
 *             one that makes agent changes measurable: same ticket, same tree, so a
 *             difference in outcome is a difference in the AGENT, not in main.
 *   trial   — one agent over N recent tickets, rolled up. "Is this configuration better
 *             than the one we are running?"
 *
 * Every rehearsal drives a real `executions` row with `mode='rehearsal'`, so it inherits
 * audit, telemetry and cancellation for free; `liveExecution()` keeps those rows out of
 * every delivery metric.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { executions, ideAgents, projects, rehearsalSteps, rehearsals, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ShadowRecorder, shadowProvider } from './shadowProvider';
import { prepareCloudRun, runCloudToolLoop } from '../runtime/cloudAgentEngine';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export const REHEARSAL_KINDS = ['dry_run', 'replay', 'trial'] as const;
export type RehearsalKind = (typeof REHEARSAL_KINDS)[number];
export const isRehearsalKind = (v: unknown): v is RehearsalKind =>
  typeof v === 'string' && (REHEARSAL_KINDS as readonly string[]).includes(v);

/** Steps a rehearsal may take. Lower than a live run's budget on purpose: a rehearsal
 *  is a probe, and its cost is paid on top of the real work, not instead of it. */
const REHEARSAL_MAX_STEPS = 12;
/** How many past tickets a single trial covers. */
export const TRIAL_MAX_TICKETS = 5;

export interface StartRehearsalInput {
  tenantId: number;
  kind: RehearsalKind;
  /** dry_run / replay: the ticket. trial: ignored (tickets are selected from history). */
  taskId?: number;
  /** replay: the execution to re-run. */
  sourceExecutionId?: number;
  /** Agent to rehearse. Defaults to the ticket's assigned agent. */
  agentRef?: string;
  /** Model override, e.g. to A/B a pin. Defaults to the run's normal selection. */
  model?: string;
  /** The user who started it — a `users.id`, which is a VARCHAR(36) string, NOT a number. */
  createdBy?: string | null;
  /** trial: how many recent tickets to cover (clamped to {@link TRIAL_MAX_TICKETS}). */
  ticketCount?: number;
}

export interface RehearsalSummary {
  id: string;
  kind: RehearsalKind;
  status: string;
  agentRef: string | null;
  agentLabel: string;
  model: string | null;
  taskId: number | null;
  taskTitle?: string | null;
  sourceExecutionId: number | null;
  frozenRef: string | null;
  executionId: number | null;
  steps: number;
  suppressedWrites: number;
  finishedOk: boolean | null;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RehearsalStepRow {
  seq: number;
  op: string;
  target: string | null;
  detail: unknown;
}

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

/**
 * Run ONE rehearsal end-to-end and return its id. Synchronous by design: a rehearsal is
 * bounded at {@link REHEARSAL_MAX_STEPS} and the caller wants the report, not a job id.
 * The row is written first and always completed (success or failure), so a crashed
 * rehearsal is visible as `failed` rather than stuck at `queued` forever.
 */
export async function runRehearsal(env: Env, db: Db, input: StartRehearsalInput): Promise<string> {
  const { tenantId } = input;

  // ── Resolve what we are rehearsing ────────────────────────────────────────────
  let taskId = input.taskId ?? null;
  let frozenRef: string | null = null;
  let sourceExecutionId = input.sourceExecutionId ?? null;

  if (input.kind === 'replay' && sourceExecutionId) {
    const [src] = await db
      .select({ taskId: executions.taskId, payload: executions.payload, cloudAgentRef: executions.cloudAgentRef })
      .from(executions)
      .where(and(eq(executions.id, sourceExecutionId), eq(executions.tenantId, tenantId)))
      .limit(1);
    if (!src) throw new Error(`execution ${sourceExecutionId} not found in this workspace`);
    taskId = src.taskId;
    // The ref the original run read from, when the payload recorded one. Absent on
    // older rows — the replay then reads the current base, which is still a replay of
    // the PROMPT even if not of the tree, and the report says which it was.
    frozenRef = extractFrozenRef(src.payload);
  }

  if (!taskId) throw new Error('a rehearsal needs a ticket');

  // `tasks` carries no tenant_id — a ticket belongs to a tenant THROUGH its project,
  // so every tenant check here joins `projects`. Getting that wrong would be a
  // cross-tenant read, which is why it is never written as a bare `tasks` predicate.
  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      projectId: tasks.projectId,
      assignedAgentRef: tasks.assignedAgentRef,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!task) throw new Error(`ticket ${taskId} not found in this workspace`);

  const agentRef = input.agentRef ?? task.assignedAgentRef ?? null;
  const agentLabel = await resolveAgentLabel(db, tenantId, agentRef);
  const projectId = task.projectId ?? 0;

  const [row] = await db
    .insert(rehearsals)
    .values({
      tenantId,
      projectId: task.projectId,
      kind: input.kind,
      status: 'running',
      agentRef,
      agentLabel,
      model: input.model ?? null,
      taskId: task.id,
      sourceExecutionId,
      frozenRef,
      createdBy: input.createdBy ?? null,
      startedAt: new Date(),
    })
    .returning({ id: rehearsals.id });
  if (!row) throw new Error('could not create the rehearsal record');
  const rehearsalId = row.id;

  // ── The shadow execution ──────────────────────────────────────────────────────
  // A real row, so audit/telemetry/cancel work; `mode='rehearsal'` keeps it out of
  // every delivery metric (see executionMode.ts).
  const [exec] = await db
    .insert(executions)
    .values({
      taskId: task.id,
      tenantId,
      submittedBy: `rehearsal:${input.kind}`,
      status: 'running',
      mode: 'rehearsal',
      cloudAgentRef: agentRef,
      payload: JSON.stringify({ rehearsalId, kind: input.kind, frozenRef }),
      startedAt: new Date(),
    })
    .returning({ id: executions.id });
  if (!exec) {
    await db.update(rehearsals).set({ status: 'failed', errorMessage: 'could not create the shadow execution', completedAt: new Date() }).where(scopedToTenant(rehearsals, tenantId, eq(rehearsals.id, rehearsalId)));
    throw new Error('could not create the shadow execution');
  }
  const executionId = exec.id;
  await db.update(rehearsals).set({ executionId }).where(scopedToTenant(rehearsals, tenantId, eq(rehearsals.id, rehearsalId)));

  const recorder = new ShadowRecorder();
  const taskRow = { id: task.id, title: task.title, description: task.description };

  try {
    // `readOnly` is load-bearing, not a nicety: prep runs BEFORE the shadow provider
    // wraps anything, and by default it drafts a PRD, commits it to the real ticket
    // branch and records a personality event. Without this flag a rehearsal's very
    // first act would be a real commit.
    const prep = await prepareCloudRun(
      env, db, executionId, taskRow, tenantId, projectId, agentLabel, input.model, undefined, agentRef ?? undefined,
      undefined, { readOnly: true },
    );

    const result = await runCloudToolLoop(
      env, db, executionId, tenantId, taskRow, agentRef ?? undefined, agentLabel, input.model,
      `${prep.systemPrompt}\n\n${REHEARSAL_DIRECTIVE}`,
      prep.userContent,
      async () => false,
      projectId,
      {
        maxSteps: REHEARSAL_MAX_STEPS,
        execParams: prep.execParams,
        decorateProvider: (p) => shadowProvider(p, recorder),
        suppressFinalize: true,
        ...(frozenRef ? { frozenReadRef: frozenRef } : {}),
      },
    );

    if (recorder.steps.length > 0) {
      await db.insert(rehearsalSteps).values(
        recorder.steps.map((s, i) => ({
          rehearsalId,
          tenantId,
          seq: i + 1,
          op: s.op,
          target: s.target.slice(0, 512),
          detail: JSON.stringify(s.detail),
        })),
      );
    }

    await db
      .update(rehearsals)
      .set({
        status: 'completed',
        steps: recorder.steps.length,
        suppressedWrites: recorder.writeCount,
        finishedOk: result.finished === true && result.ok,
        summary: result.output.slice(0, 20_000),
        completedAt: new Date(),
      })
      .where(scopedToTenant(rehearsals, tenantId, eq(rehearsals.id, rehearsalId)));

    await db
      .update(executions)
      .set({ status: 'completed', result: result.output.slice(0, 20_000), completedAt: new Date() })
      .where(scopedToTenant(executions, tenantId, eq(executions.id, executionId)));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(rehearsals)
      .set({ status: 'failed', errorMessage: message.slice(0, 2000), completedAt: new Date() })
      .where(scopedToTenant(rehearsals, tenantId, eq(rehearsals.id, rehearsalId)));
    await db
      .update(executions)
      .set({ status: 'failed', errorMessage: message.slice(0, 2000), completedAt: new Date() })
      .where(scopedToTenant(executions, tenantId, eq(executions.id, executionId)))
      .catch((writeError) => console.error('[rehearsal] execution failure transition failed', {
        rehearsalId,
        executionId,
        tenantId,
        originalError: message,
        writeError: writeError instanceof Error ? `${writeError.name}: ${writeError.message}` : String(writeError),
      }));
  }

  return rehearsalId;
}

/**
 * A TRIAL: rehearse one agent across the most recent completed tickets of a project and
 * return every rehearsal id. Sequential on purpose — concurrent rehearsals of one agent
 * would contend for the same model pool as live delivery work, and a trial is never the
 * urgent thing on the platform.
 */
export async function runTrial(
  env: Env,
  db: Db,
  input: { tenantId: number; projectId?: number | null; agentRef: string; model?: string; ticketCount?: number; createdBy?: string | null },
): Promise<string[]> {
  const limit = Math.min(Math.max(1, Math.trunc(input.ticketCount ?? 3)), TRIAL_MAX_TICKETS);
  const recent = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      input.projectId
        ? and(eq(projects.tenantId, input.tenantId), eq(tasks.projectId, input.projectId))
        : eq(projects.tenantId, input.tenantId),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);

  const ids: string[] = [];
  for (const t of recent) {
    ids.push(
      await runRehearsal(env, db, {
        tenantId: input.tenantId,
        kind: 'trial',
        taskId: t.id,
        agentRef: input.agentRef,
        ...(input.model ? { model: input.model } : {}),
        createdBy: input.createdBy ?? null,
      }).catch(() => ''),
    );
  }
  return ids.filter(Boolean);
}

/**
 * List rehearsals for the workspace (optionally one project). Ticket titles are joined
 * in ONE extra query keyed by the ids on the page — never a title lookup per row.
 * Deliberately uncached: the list changes on every rehearsal, it is operator-facing
 * rather than hot-path, and a stale list after "Run rehearsal" is the one thing a user
 * would immediately notice.
 */
export async function listRehearsals(
  db: Db,
  tenantId: number,
  opts?: { projectId?: number | null; limit?: number },
): Promise<RehearsalSummary[]> {
  const limit = Math.min(Math.max(1, Math.trunc(opts?.limit ?? 50)), 200);
  const rows = await db
    .select()
    .from(rehearsals)
    .where(
      opts?.projectId
        ? and(eq(rehearsals.tenantId, tenantId), eq(rehearsals.projectId, opts.projectId))
        : eq(rehearsals.tenantId, tenantId),
    )
    .orderBy(desc(rehearsals.createdAt))
    .limit(limit);

  const taskIds = [...new Set(rows.map((r) => r.taskId).filter((id): id is number => id != null))];
  const titles = new Map<number, string>();
  if (taskIds.length > 0) {
    // The ids came from tenant-scoped `rehearsals` rows, so they are already this
    // tenant's; one batched title lookup, never a query per row.
    const titleRows = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    for (const t of titleRows) titles.set(t.id, t.title);
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as RehearsalKind,
    status: r.status,
    agentRef: r.agentRef,
    agentLabel: r.agentLabel,
    model: r.model,
    taskId: r.taskId,
    taskTitle: r.taskId != null ? (titles.get(r.taskId) ?? null) : null,
    sourceExecutionId: r.sourceExecutionId,
    frozenRef: r.frozenRef,
    executionId: r.executionId,
    steps: r.steps,
    suppressedWrites: r.suppressedWrites,
    finishedOk: r.finishedOk,
    summary: r.summary,
    errorMessage: r.errorMessage,
    createdAt: iso(r.createdAt)!,
    completedAt: iso(r.completedAt),
  }));
}

/** One rehearsal plus the effects it suppressed — the report. */
export async function getRehearsal(
  db: Db,
  tenantId: number,
  id: string,
): Promise<{ rehearsal: RehearsalSummary; steps: RehearsalStepRow[] } | null> {
  const [r] = await db
    .select()
    .from(rehearsals)
    .where(and(eq(rehearsals.tenantId, tenantId), eq(rehearsals.id, id)))
    .limit(1);
  if (!r) return null;

  const [stepRows, titleRow] = await Promise.all([
    db
      .select({ seq: rehearsalSteps.seq, op: rehearsalSteps.op, target: rehearsalSteps.target, detail: rehearsalSteps.detail })
      .from(rehearsalSteps)
      .where(and(eq(rehearsalSteps.tenantId, tenantId), eq(rehearsalSteps.rehearsalId, id)))
      .orderBy(rehearsalSteps.seq),
    r.taskId != null
      ? db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, r.taskId)).limit(1)
      : Promise.resolve([] as Array<{ title: string }>),
  ]);

  return {
    rehearsal: {
      id: r.id,
      kind: r.kind as RehearsalKind,
      status: r.status,
      agentRef: r.agentRef,
      agentLabel: r.agentLabel,
      model: r.model,
      taskId: r.taskId,
      taskTitle: titleRow[0]?.title ?? null,
      sourceExecutionId: r.sourceExecutionId,
      frozenRef: r.frozenRef,
      executionId: r.executionId,
      steps: r.steps,
      suppressedWrites: r.suppressedWrites,
      finishedOk: r.finishedOk,
      summary: r.summary,
      errorMessage: r.errorMessage,
      createdAt: iso(r.createdAt)!,
      completedAt: iso(r.completedAt),
    },
    steps: stepRows.map((s) => ({
      seq: s.seq,
      op: s.op,
      target: s.target,
      detail: safeJson(s.detail),
    })),
  };
}

// ── internals ─────────────────────────────────────────────────────────────────────

/** Prepended to the rehearsal's system prompt so the agent knows the stakes without
 *  being told to behave differently — the point is to observe its NORMAL behaviour. */
const REHEARSAL_DIRECTIVE =
  '[REHEARSAL] This run is a rehearsal: your file writes, memory writes and escalations are RECORDED '
  + 'and then discarded, and no pull request will open. Work exactly as you normally would and produce '
  + 'the real, complete change — the recording is what gets reviewed, so a placeholder here is a '
  + 'placeholder in the report.';

function safeJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Pull the git ref a past run read from out of its payload, when it recorded one. */
function extractFrozenRef(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const candidates = [parsed.baseSha, parsed.headSha, parsed.base, parsed.ref];
    for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim();
    return null;
  } catch {
    return null;
  }
}

async function resolveAgentLabel(db: Db, tenantId: number, agentRef: string | null): Promise<string> {
  if (!agentRef) return 'agent';
  const [a] = await db
    .select({ name: ideAgents.name })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, agentRef)))
    .limit(1);
  return a?.name ?? 'agent';
}
