/**
 * Ticket 3089 — Brain-created project with no repo.
 *
 * Symptom: a board-dispatched coder returned prose ("No repo bound") because
 * Brain `projects.create` mints a `projects` row and nothing else. REST create
 * (`POST /api/projects`, /upsert, /scaffold, starter-workspace) already runs
 * {@link provisionProject}; the MCP door did not. Scratch-repo-at-create is
 * rejected: Brain tenants typically have no git provider / OAuth, so minting a
 * GitHub repo would fail or hang on credentials. The IDE workspace always
 * exists as the R2 prefix `ide/projects/{id}/` — that is the working tree
 * coding-dispatch already falls back to when `repo` is null.
 *
 * This module is the CREATE-TIME half of that routing:
 *   - repo-connected → `{ kind: 'repo' }` (dispatch clones git; we do nothing)
 *   - otherwise bind an `ide_projects` row so Designer and dispatch resolve the
 *     same storage project, then optionally seed starter files / board / Evermind.
 *
 * Wire from MCP `projects.create` (builtinMcpService) after
 * `createProjectWithGeneratedKey`. REST already calls `provisionProject`; it
 * should also call {@link ensureProjectCodingTarget} for the IDE bind.
 */
import type { Db } from '../infrastructure/database/connection';
import type { Env } from '../env';
import type { Project } from '../domain/project/Project';
import { ensureIdeProjectForStorage } from '../application/project/ideProjectBinding';
import { provisionProject } from '../application/project/provisionProject';
import { reportCaughtError } from '../application/observability/caughtErrorReporter';

export type ProjectCodingTarget =
  | { kind: 'repo'; repoFullName: string }
  | { kind: 'workspace'; storageProjectId: number; ideProjectId: number; created: boolean }
  | { kind: 'none'; reason: string };

/** The project fields this use case needs. A `Project` domain instance satisfies this. */
export interface CodingTargetProject {
  id: number;
  sourceControlRepoFullName?: string | null;
  githubRepoUrl?: string | null;
}

export interface EnsureCodingTargetOpts {
  /**
   * Seed starter files + board + Evermind. REST create already does this via
   * `provisionProject` and should pass nothing. MCP `projects.create` should
   * pass a callback (or use {@link afterBrainProjectCreate}) so a Brain-born
   * designer project is not an empty R2 prefix when the coder lands.
   */
  provision?: (project: CodingTargetProject) => Promise<void>;
}

/** Same gate {@link templateForProject} uses — a linked repo is the coding target. */
export function hasConnectedRepo(project: CodingTargetProject): boolean {
  return !!(project.sourceControlRepoFullName || project.githubRepoUrl);
}

/**
 * The agent-host workspace files route coding-dispatch fetches/pushes when
 * `DispatchDetail.repo` is null. Kept here so create-time routing and the
 * runtime path cannot drift on the URL shape.
 */
export function workspaceFilesPath(agentHostId: number | string, projectId: number): string {
  return `/api/agent-hosts/${agentHostId}/workspace/${projectId}/files`;
}

/**
 * Route a newly-created (or existing) project onto a coding working tree.
 *
 * Idempotent: a second call on a bound project returns `{ created: false }`.
 * A provision failure is reported, not thrown — the project row already exists
 * and the caller has already been told about it (same posture as provisionProject).
 */
export async function ensureProjectCodingTarget(
  db: Db,
  tenantId: number,
  project: CodingTargetProject,
  opts: EnsureCodingTargetOpts = {},
): Promise<ProjectCodingTarget> {
  const repoFullName = (project.sourceControlRepoFullName || project.githubRepoUrl || '').trim();
  if (hasConnectedRepo(project) && repoFullName) {
    return { kind: 'repo', repoFullName };
  }

  if (opts.provision) {
    try {
      await opts.provision(project);
    } catch (error) {
      reportCaughtError(error, {
        source: 'services/ensureProjectCodingTarget.ts',
        operation: 'provision',
      });
    }
  }

  const binding = await ensureIdeProjectForStorage(db, tenantId, project.id);
  if (!binding) {
    return {
      kind: 'none',
      reason: 'project is not in tenant — cannot bind IDE workspace',
    };
  }
  return {
    kind: 'workspace',
    storageProjectId: project.id,
    ideProjectId: binding.id,
    created: binding.created,
  };
}

/**
 * The Brain / MCP create door: provision the project (starter files + board +
 * Evermind) then bind the IDE workspace so a board-dispatched coder has a
 * working tree instead of returning prose.
 *
 * Provision is best-effort (matches REST). The IDE bind is the load-bearing
 * step for dispatch; if it cannot bind, the result is `{ kind: 'none' }`.
 */
export async function afterBrainProjectCreate(
  env: Env,
  db: Db,
  tenantId: number,
  project: Project,
): Promise<ProjectCodingTarget> {
  return ensureProjectCodingTarget(db, tenantId, project, {
    provision: () => provisionProject(env, db, tenantId, project),
  });
}
