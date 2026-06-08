/**
 * Shared task-PRD helpers — the single source of truth for drafting a task's
 * PRD and linking PRDs to tasks. Used by BOTH the cloud-execution path
 * (`runtimeRoutes.ensureTaskPrd`) and the swimlane auto-PRD gate
 * (`DrizzlePrdEnsurer`) so PRD generation + linking is never duplicated.
 *
 * Task <-> PRD is many-to-many via `task_specs` (0098); each task has at most one
 * primary PRD (the canonical one the agent reads/writes for that task).
 */
import { and, desc, eq } from 'drizzle-orm';
import { ideProxy } from '../llm/LlmProxyService';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { specs, taskSpecs } from '../../infrastructure/database/schema';

const PRD_SYSTEM_PROMPT =
  'You are a senior product architect drafting the WIP Product Requirements Document (PRD) that every ' +
  'downstream agent on this task will share. Write a concise, well-structured PRD in GitHub-flavored ' +
  'markdown covering: Problem & Goal, Target users / ICP roles (if relevant), Scope, Functional ' +
  'requirements, Acceptance criteria, and Out of scope. Output ONLY the PRD markdown — no preamble and ' +
  'no bracketed placeholders.';

/** Draft a PRD body for a task via the gateway. Returns trimmed markdown, or '' on failure. Never throws. */
export async function draftTaskPrd(
  env: Env,
  task: { title: string; description: string | null },
  model?: string,
): Promise<string> {
  try {
    const gen = await ideProxy(env).complete({
      messages: [
        { role: 'system', content: PRD_SYSTEM_PROMPT },
        { role: 'user', content: `Task: ${task.title}\n\n${task.description ?? ''}`.trim() },
      ],
      ...(model ? { model } : {}),
      useCase: 'prd_generation',
    });
    if (gen.response.status < 400) {
      const raw = await gen.response.json().catch(() => null);
      const content = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)
        ?.choices?.[0]?.message?.content;
      return (typeof content === 'string' ? content : '').trim();
    }
  } catch { /* generation failed — caller treats '' as "no PRD" */ }
  return '';
}

/** Prepend the agent-attribution header so PRD authorship is auditable. */
export function buildPrdWithAttribution(prdBody: string, agentLabel: string, taskId: number): string {
  return `> **PRD** — drafted by ${agentLabel} · task #${taskId}\n> _Each agent that updates this PRD signs its change below._\n\n${prdBody}`;
}

/** Resolve the task's canonical PRD: the primary link, else the most recent. Null if none. */
export async function findTaskPrimarySpec(
  db: Db,
  taskId: number,
): Promise<{ id: string; prd: string | null } | null> {
  try {
    const [row] = await db
      .select({ id: specs.id, prd: specs.prd })
      .from(taskSpecs)
      .innerJoin(specs, eq(specs.id, taskSpecs.specId))
      .where(eq(taskSpecs.taskId, taskId))
      .orderBy(desc(taskSpecs.isPrimary), desc(taskSpecs.createdAt))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Link a PRD to a task (idempotent upsert on the task_specs junction). When
 * `isPrimary`, demote any existing primary first so the one-primary-per-task
 * invariant (partial unique index) holds. Best-effort — never throws.
 */
export async function linkSpecToTask(
  db: Db,
  params: { taskId: number; specId: string; tenantId: number; isPrimary?: boolean },
): Promise<void> {
  const { taskId, specId, tenantId, isPrimary = false } = params;
  try {
    if (isPrimary) {
      await db
        .update(taskSpecs)
        .set({ isPrimary: false })
        .where(and(eq(taskSpecs.taskId, taskId), eq(taskSpecs.isPrimary, true)));
    }
    await db
      .insert(taskSpecs)
      .values({ taskId, specId, tenantId, isPrimary })
      .onConflictDoUpdate({ target: [taskSpecs.taskId, taskSpecs.specId], set: { isPrimary } });
  } catch { /* best-effort */ }
}

export type EnsureTaskPrdResult = { specId: string; prd: string; status: 'reused' | 'created' | 'updated' };

/**
 * Ensure a task has a PRD: reuse the task's primary PRD if it already has body
 * text, otherwise draft one, persist it at PROJECT level (so it shows on the
 * project PRD tab), and link it to the task as primary. Returns null when
 * generation produced nothing. The single generate→persist→link path shared by
 * the cloud-execution wrapper, the on-demand "Generate PRD" endpoint, and the
 * swimlane auto-PRD gate. Never throws.
 */
export async function ensureTaskPrdRecord(
  db: Db,
  env: Env,
  args: {
    taskId: number;
    tenantId: number;
    projectId: number;
    title: string;
    description: string | null;
    agentLabel: string;
    model?: string;
  },
): Promise<EnsureTaskPrdResult | null> {
  const existing = await findTaskPrimarySpec(db, args.taskId);
  if (existing?.prd?.trim()) return { specId: existing.id, prd: existing.prd.trim(), status: 'reused' };

  const body = await draftTaskPrd(env, { title: args.title, description: args.description }, args.model);
  if (!body) return null;
  const prd = buildPrdWithAttribution(body, args.agentLabel, args.taskId);

  const specId = existing?.id ?? crypto.randomUUID();
  const now = new Date();
  try {
    await db
      .insert(specs)
      .values({ id: specId, tenantId: args.tenantId, projectId: args.projectId, goal: args.title, status: 'draft', prd, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [specs.id], set: { prd, goal: args.title, updatedAt: now } });
  } catch { /* persistence failed — still return the PRD for use as context */ }

  await linkSpecToTask(db, { taskId: args.taskId, specId, tenantId: args.tenantId, isPrimary: true });
  return { specId, prd, status: existing?.id ? 'updated' : 'created' };
}
