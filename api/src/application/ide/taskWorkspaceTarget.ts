/**
 * taskWorkspaceTarget — the IDE R2 workspace, used as a coding agent's WORKING
 * TREE when a task's project has no connected git repo.
 *
 * ── WHY THIS EXISTS (the decision, and the one it beat) ─────────────────────
 * A project created from the Brain has no connected git repo. `runCodingDispatch`
 * therefore resolved `repo: null` and fell into its "reasoning-only" branch: the
 * board dispatched a CODER and got prose back. Two fixes were on the table.
 *
 *   (a) Auto-provision a scratch repo at project-create, through the existing
 *       repo-provider ports, so `resolveTicketRepoContext` finds a real repo.
 *   (b) Give the run the project's IDE workspace (R2) as its working tree.
 *
 * (b) is what is implemented, and the reason is availability, not effort. A
 * Brain-created project belongs to a tenant that typically has NOTHING connected:
 * zero-setup onboarding creates a Default workspace + project before the user has
 * linked GitHub, so at project-create there is no provider to provision THROUGH,
 * no credential to encrypt, and no owner/org to create under. Option (a) can only
 * work for tenants that already solved the problem it is trying to solve; for
 * everyone else it would fail at create time and leave exactly the degrade we are
 * removing. The R2 workspace, by contrast, always exists — it is the same tree the
 * IDE and the WebContainer preview already build against (which is why the
 * single-prompt→app demo path sidesteps this today) — needs no OAuth, no token and
 * no external call, and its writes are visible in the IDE the moment they land.
 *
 * The consequence is stated plainly rather than hidden: a workspace run produces
 * FILES, not a branch and not a PR. When the project later connects a repo, the
 * existing IDE commit path (`/api/ide/projects/:id/commit`) pushes that workspace
 * into it. Reasoning-only remains reachable, but only as a genuine last resort —
 * no repo AND no workspace — and it now says which.
 *
 * ── LAYERING ────────────────────────────────────────────────────────────────
 * Routes call this; this calls {@link workspaceStore} (the ONE R2 access layer)
 * and the schema. Nothing here knows about HTTP.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ideProjects, projects, taskFileChanges, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  validateWorkspaceContent,
  validateWorkspacePath,
  writeWorkspaceFile,
} from './workspaceStore';

/** The workspace a repo-less run should write into. */
export interface TaskWorkspaceTarget {
  /** The `projects` row whose R2 prefix holds the files (`ide/projects/<id>/`). */
  projectId: number;
  /** Human label for the prompt / the run summary. */
  projectName: string;
}

/**
 * Resolve the workspace backing a task, or null when the task/project is gone.
 *
 * A task hangs off a `projects` row, and every projects row owns an R2 workspace
 * prefix. When that project is the CONTAINER of an IDE project (0224), the files
 * physically live under the child's `storageProjectId`, so that is what a run must
 * write into — otherwise the agent's files would land in a prefix the IDE never
 * opens. When a container holds several, the EARLIEST-created child wins: it is
 * the original build, and picking deterministically matters more than picking
 * cleverly — a run must not write into a different tree on its second pass.
 */
export async function resolveTaskWorkspaceTarget(
  db: Db,
  tenantId: number,
  taskId: number,
): Promise<TaskWorkspaceTarget | null> {
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return null;

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, task.projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!project) return null;

  const [child] = await db
    .select({ storageProjectId: ideProjects.storageProjectId, name: ideProjects.name })
    .from(ideProjects)
    .where(and(eq(ideProjects.tenantId, tenantId), eq(ideProjects.containerProjectId, project.id)))
    .orderBy(ideProjects.createdAt)
    .limit(1);

  return child
    ? { projectId: child.storageProjectId, projectName: child.name }
    : { projectId: project.id, projectName: project.name };
}

/** Is `projectId` a workspace this tenant owns? Guards every host-key read/write. */
export async function workspaceProjectInTenant(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return !!row;
}

export interface WorkspaceFile {
  path: string;
  content: string;
}

/**
 * Every text file in the workspace, for materialising it as a local working tree.
 * Bounded: binaries and oversized blobs are skipped (an agent cannot usefully edit
 * them and shipping them would blow the response), and the total is capped so a
 * huge workspace degrades to a partial tree rather than an unbounded response.
 */
export async function readTaskWorkspaceTree(
  bucket: R2Bucket,
  projectId: number,
  limits: { maxFiles?: number; maxBytes?: number } = {},
): Promise<{ files: WorkspaceFile[]; truncated: boolean }> {
  const maxFiles = limits.maxFiles ?? 600;
  const maxBytes = limits.maxBytes ?? 6 * 1024 * 1024;
  const entries = await listWorkspaceFiles(bucket, projectId);
  const files: WorkspaceFile[] = [];
  let bytes = 0;
  let truncated = entries.length > maxFiles;
  for (const entry of entries.slice(0, maxFiles)) {
    if (bytes + entry.size > maxBytes) { truncated = true; continue; }
    const content = await readWorkspaceFile(bucket, projectId, entry.path);
    if (content === null) continue;
    bytes += entry.size;
    files.push({ path: entry.path, content });
  }
  return { files, truncated };
}

export interface WorkspaceChangeSet {
  writes?: WorkspaceFile[];
  deletes?: string[];
}

export interface WorkspaceApplyResult {
  written: number;
  deleted: number;
  /** Paths refused by the path/content contract, with why. Never silently dropped. */
  rejected: Array<{ path: string; reason: string }>;
}

/**
 * Apply a run's changes to a workspace and record each one as a task file change,
 * so the ticket's Changes tab reads identically whether the run wrote to git or to
 * R2. Path + content validation is the workspaceStore's contract; a rejection is
 * reported back to the agent rather than swallowed.
 */
export async function applyTaskWorkspaceChanges(
  db: Db,
  bucket: R2Bucket,
  args: {
    tenantId: number;
    taskId: number;
    projectId: number;
    executionId?: number | null;
    agent: string;
    changes: WorkspaceChangeSet;
  },
): Promise<WorkspaceApplyResult> {
  const result: WorkspaceApplyResult = { written: 0, deleted: 0, rejected: [] };
  const changes: Array<{ path: string; change: 'created' | 'modified' | 'deleted' }> = [];

  for (const file of args.changes.writes ?? []) {
    const validPath = validateWorkspacePath(file.path);
    if (!validPath.ok) { result.rejected.push({ path: file.path, reason: validPath.reason }); continue; }
    const validContent = validateWorkspaceContent(file.path, file.content);
    if (!validContent.ok) { result.rejected.push({ path: file.path, reason: validContent.reason }); continue; }
    const existed = (await readWorkspaceFile(bucket, args.projectId, file.path)) !== null;
    const write = await writeWorkspaceFile(bucket, args.projectId, file.path, file.content);
    if (!write.ok) { result.rejected.push({ path: file.path, reason: write.reason }); continue; }
    result.written++;
    changes.push({ path: file.path, change: existed ? 'modified' : 'created' });
  }

  for (const path of args.changes.deletes ?? []) {
    const validPath = validateWorkspacePath(path);
    if (!validPath.ok) { result.rejected.push({ path, reason: validPath.reason }); continue; }
    await deleteWorkspaceFile(bucket, args.projectId, path);
    result.deleted++;
    changes.push({ path, change: 'deleted' });
  }

  if (changes.length > 0 && args.executionId != null) {
    await db
      .insert(taskFileChanges)
      .values(changes.map((c) => ({
        tenantId: args.tenantId,
        taskId: args.taskId,
        executionId: args.executionId as number,
        path: c.path,
        change: c.change,
        agent: args.agent,
      })))
      .catch(() => undefined);
  }
  return result;
}
