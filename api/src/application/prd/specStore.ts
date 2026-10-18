/**
 * Spec store — the ONE use case behind every spec / PRD surface.
 *
 * Specs used to be read and written inline by three routers: `/api/specs`
 * (portal + agent write-back), `/api/tasks/:id/specs` (the task's linked PRDs) and
 * the agent-host `/spec` + `/tasks/:taskId/specs` reads. Each carried its own copy
 * of the select list and tenant predicate, and they had already drifted (the host
 * read checked the spec's tenant but not the junction's; the task read the
 * opposite). The task and agent-host paths are now FILTERED views over this module:
 * same rows, same scoping, different filter.
 *
 * Task ↔ PRD linking itself stays in `taskPrd.linkSpecToTask` (shared with the
 * cloud-execution PRD gate); this module calls it rather than re-implementing it.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projects, specs, specStatusEnum, taskSpecs, tasks, workflows } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpTicketSearchVersion } from '../../infrastructure/cache/readThroughCache';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { linkSpecToTask } from './taskPrd';
import { importSpecFromBoard, type SpecImportResult } from './importSpec';

/** Read off the column so the API, the Brain tools and Postgres cannot disagree. */
export const SPEC_STATUSES = specStatusEnum.enumValues;
export type SpecStatus = (typeof SPEC_STATUSES)[number];

export type SpecRow = typeof specs.$inferSelect;

export interface UpsertSpecInput {
  id?: string | null;
  projectId?: number | null;
  goal: string;
  status?: SpecStatus | null;
  kind?: string;
  prd?: string | null;
  archSpec?: string | null;
  taskList?: unknown;
  /** When present, link the spec to this task as its primary PRD (agent write-back). */
  taskId?: number | null;
}

export interface PatchSpecInput {
  goal?: string;
  status?: SpecStatus;
  prd?: string | null;
  archSpec?: string | null;
  taskList?: unknown;
}

/** Load a tenant-owned spec, or null. */
export async function getSpec(db: Db, tenantId: number, id: string): Promise<SpecRow | null> {
  const [row] = await db.select().from(specs).where(scopedToTenant(specs, tenantId, eq(specs.id, id))).limit(1);
  return row ?? null;
}

/**
 * Create or upsert a spec. Returns null when `id` names another tenant's spec:
 * the conflict target is the global PK, so without this check a caller could
 * overwrite a foreign spec by guessing its id.
 */
export async function upsertSpec(
  db: Db,
  env: Env,
  scope: { tenantId: number; agentHostId: number | null },
  input: UpsertSpecInput,
): Promise<SpecRow | null> {
  const { tenantId, agentHostId } = scope;
  const specId = input.id ?? crypto.randomUUID();
  const now = new Date();
  const goal = input.goal.trim();

  if (input.id) {
    const [existing] = await db.select({ tenantId: specs.tenantId }).from(specs).where(eq(specs.id, specId));
    if (existing && existing.tenantId !== tenantId) return null;
  }

  const taskList = input.taskList != null ? JSON.stringify(input.taskList) : null;
  await db
    .insert(specs)
    .values({
      id: specId,
      tenantId,
      projectId: input.projectId ?? null,
      agentHostId,
      goal,
      status: input.status ?? 'draft',
      kind: input.kind ?? 'feature',
      prd: input.prd ?? null,
      archSpec: input.archSpec ?? null,
      taskList,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [specs.id],
      set: {
        goal,
        status: input.status ?? 'draft',
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        prd: input.prd ?? null,
        archSpec: input.archSpec ?? null,
        taskList,
        updatedAt: now,
      },
    });

  // Agent write-back: "agents update the task's PRD as they work" lands on the
  // task's linked spec, but only for a task inside the caller's tenant.
  if (input.taskId != null) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, input.taskId), eq(projects.tenantId, tenantId)));
    if (task) await linkSpecToTask(db, { taskId: input.taskId, specId, tenantId, isPrimary: true });
  }

  // A spec is a link-picker ticket kind — orphan the chat↔ticket typeahead cache.
  await bumpTicketSearchVersion(env, tenantId);
  return getSpec(db, tenantId, specId);
}

/**
 * Import a board ticket (GitHub / Linear / Jira) into a spec. The import itself
 * lives in `importSpec`; this is the door both the HTTP route and the Brain tool
 * use, so the typeahead bump cannot be forgotten by one of them.
 * @throws SpecImportError on a refusable import (the caller maps it).
 */
export async function importSpec(
  db: Db,
  env: Env,
  args: Parameters<typeof importSpecFromBoard>[2],
): Promise<SpecImportResult> {
  const result = await importSpecFromBoard(db, env, args);
  await bumpTicketSearchVersion(env, args.tenantId);
  return result;
}

/** The tenant's specs, newest first, optionally narrowed by project and kind. */
export function listSpecs(
  db: Db,
  tenantId: number,
  filter: { projectId?: number | null; kind?: string | null; limit?: number } = {},
): Promise<SpecRow[]> {
  return db
    .select()
    .from(specs)
    .where(scopedToTenant(
      specs, tenantId,
      filter.projectId != null ? eq(specs.projectId, filter.projectId) : undefined,
      filter.kind ? eq(specs.kind, filter.kind) : undefined,
    ))
    .orderBy(desc(specs.updatedAt))
    .limit(filter.limit ?? LIST_ROW_CAP);
}

/** Partial update; only keys present are written. Null when the spec is not the tenant's. */
export async function patchSpec(db: Db, tenantId: number, id: string, input: PatchSpecInput): Promise<SpecRow | null> {
  const [row] = await db
    .update(specs)
    .set({
      ...(input.goal !== undefined ? { goal: input.goal.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.prd !== undefined ? { prd: input.prd } : {}),
      ...(input.archSpec !== undefined ? { archSpec: input.archSpec } : {}),
      ...(input.taskList !== undefined ? { taskList: JSON.stringify(input.taskList) } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(specs, tenantId, eq(specs.id, id)))
    .returning();
  return row ?? null;
}

/** Delete a tenant's spec; true when a row went. */
export async function deleteSpec(db: Db, tenantId: number, id: string): Promise<boolean> {
  const rows = await db.delete(specs).where(scopedToTenant(specs, tenantId, eq(specs.id, id))).returning({ id: specs.id });
  return rows.length > 0;
}

/** Workflows linked to a spec; null when the spec is not the tenant's. */
export async function listSpecWorkflows(db: Db, tenantId: number, specId: string) {
  if (!(await getSpec(db, tenantId, specId))) return null;
  return db.select().from(workflows).where(scopedToTenant(workflows, tenantId, eq(workflows.specId, specId)));
}

/** Point an existing workflow at a spec; false when the spec is not the tenant's. */
export async function linkWorkflowToSpec(db: Db, tenantId: number, specId: string, workflowId: string): Promise<boolean> {
  if (!(await getSpec(db, tenantId, specId))) return false;
  await db
    .update(workflows)
    .set({ specId, updatedAt: new Date() })
    .where(scopedToTenant(workflows, tenantId, eq(workflows.id, workflowId)));
  return true;
}

// ── Task-filtered view (/api/tasks/:id/specs + agent-host /tasks/:taskId/specs) ──

/** The PRDs linked to a task, primary first. Both the junction AND the spec are tenant-checked. */
export function listTaskSpecs(db: Db, tenantId: number, taskId: number) {
  return db
    .select({
      id: specs.id, goal: specs.goal, status: specs.status, prd: specs.prd,
      archSpec: specs.archSpec, taskList: specs.taskList, projectId: specs.projectId,
      isPrimary: taskSpecs.isPrimary, createdAt: specs.createdAt, updatedAt: specs.updatedAt,
    })
    .from(taskSpecs)
    .innerJoin(specs, eq(specs.id, taskSpecs.specId))
    .where(scopedToTenant(taskSpecs, tenantId, eq(taskSpecs.taskId, taskId), eq(specs.tenantId, tenantId)))
    .orderBy(desc(taskSpecs.isPrimary), desc(specs.updatedAt))
    .limit(LIST_ROW_CAP);
}

/** Attach an existing spec to a task; false when the spec is not the tenant's. */
export async function attachSpecToTask(
  db: Db,
  args: { tenantId: number; taskId: number; specId: string; isPrimary?: boolean },
): Promise<boolean> {
  if (!(await getSpec(db, args.tenantId, args.specId))) return false;
  await linkSpecToTask(db, args);
  return true;
}

/** Detach a spec from a task (the spec itself is kept). */
export async function detachSpecFromTask(db: Db, args: { tenantId: number; taskId: number; specId: string }): Promise<void> {
  await db
    .delete(taskSpecs)
    .where(scopedToTenant(taskSpecs, args.tenantId, eq(taskSpecs.taskId, args.taskId), eq(taskSpecs.specId, args.specId)));
}

// ── Project-filtered view (agent-host /spec) ─────────────────────────────────

/** The project's newest spec that is being worked (ready / in_progress), or null. */
export async function findActiveProjectSpec(db: Db, tenantId: number, projectId: number): Promise<SpecRow | null> {
  const [row] = await db
    .select()
    .from(specs)
    .where(scopedToTenant(specs, tenantId, eq(specs.projectId, projectId), inArray(specs.status, ['ready', 'in_progress'])))
    .orderBy(desc(specs.updatedAt))
    .limit(1);
  return row ?? null;
}
