/**
 * RepoService — application service for multi-repo associations and
 * PR/branch dispatch.
 *
 * IO is funneled through two injected collaborators so the orchestration can be
 * unit-tested without a real database or durable object:
 *   - `db`         : a Drizzle Db (or a minimal fake exposing the same methods)
 *   - `dispatcher` : (agentHostId, message) => Promise<boolean> — in the route this
 *                    is wired to env.AGENT_HOST_RELAY.get(idFromName(agentHostId)).fetch(...)
 *
 * Every query is tenant-scoped. JSON payload columns (matchHints) are stored as
 * text → JSON.stringify on write.
 */
import { and, eq } from 'drizzle-orm';
import {
  projectRepositories,
  repoBranches,
  pullRequests,
  tasks,
  projects,
  specs,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { resolveRepoForTask } from './resolveRepo';
import { buildPrDispatchMessage, type CreatePrMessage } from './prDispatch';

export type AgentHostDispatcher = (agentHostId: number, message: CreatePrMessage) => Promise<boolean>;

export type RepoMatchHints = {
  labels?: string[];
  keywords?: string[];
  pathGlobs?: string[];
};

export type AddRepoInput = {
  projectId: number;
  provider: string;
  owner: string;
  repo: string;
  host?: string;
  defaultBranch?: string | null;
  cloneUrlHttps?: string | null;
  isDefault?: boolean;
  matchHints?: RepoMatchHints | null;
  credentialId?: string | null;
  segmentId?: string | null;
};

export type DispatchPrResult =
  | { ok: true; prId: string; agentHostId: number; message: CreatePrMessage }
  | { ok: false; code: 'task_not_found' | 'no_repo' | 'no_agent_host' | 'dispatch_failed'; reason: string };

export class RepoService {
  constructor(
    private readonly db: Db,
    private readonly dispatcher: AgentHostDispatcher,
  ) {}

  /** List repos associated with a project (tenant-scoped). */
  async listRepos(projectId: number, tenantId: number) {
    return this.db
      .select()
      .from(projectRepositories)
      .where(
        and(
          eq(projectRepositories.projectId, projectId),
          eq(projectRepositories.tenantId, tenantId),
        ),
      );
  }

  /** Associate a new repo with a project. */
  async addRepo(input: AddRepoInput, tenantId: number) {
    const now = new Date();
    const [row] = await this.db
      .insert(projectRepositories)
      .values({
        tenantId,
        segmentId: input.segmentId ?? null,
        projectId: input.projectId,
        provider: input.provider,
        host: input.host ?? 'github.com',
        owner: input.owner,
        repo: input.repo,
        defaultBranch: input.defaultBranch ?? null,
        cloneUrlHttps: input.cloneUrlHttps ?? null,
        isDefault: input.isDefault ?? false,
        matchHints: input.matchHints != null ? JSON.stringify(input.matchHints) : null,
        credentialId: input.credentialId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  }

  /**
   * Resolve the repo for a task, build the create_pr message, dispatch it to the
   * assigned agentHost, and record a pullRequests row (status 'open') + a repoBranches
   * row. Returns a discriminated result so the route maps it to HTTP codes
   * (e.g. no_agent_host → 409, no_repo → 409, task_not_found → 404).
   */
  async dispatchPrCreation(taskId: number, tenantId: number): Promise<DispatchPrResult> {
    // Load the task scoped through its project to the tenant.
    const [taskRow] = await this.db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        specId: tasks.specId,
        source: tasks.source,
        assignedAgentHostId: tasks.assignedAgentHostId,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)));

    if (!taskRow) {
      return { ok: false, code: 'task_not_found', reason: 'Task not found' };
    }

    if (taskRow.assignedAgentHostId == null) {
      return {
        ok: false,
        code: 'no_agent_host',
        reason: 'Task has no assigned agentHost; assign a agentHost before dispatching a pull request.',
      };
    }

    const repos = await this.listRepos(taskRow.projectId, tenantId);
    const resolution = resolveRepoForTask(
      {
        labels: undefined,
        description: taskRow.description ?? undefined,
        explicitRepoId: undefined,
      },
      repos.map((r) => ({ id: r.id, isDefault: r.isDefault, matchHints: r.matchHints })),
    );

    if (!resolution) {
      return {
        ok: false,
        code: 'no_repo',
        reason: 'Could not resolve a target repository for this task (no match, no default, or ambiguous).',
      };
    }

    const repoRow = repos.find((r) => r.id === resolution.repoId);
    if (!repoRow) {
      return { ok: false, code: 'no_repo', reason: 'Resolved repository not found' };
    }

    // Optionally enrich PR body with the linked spec/PRD.
    let prd: { specId?: string | null; body?: string | null } | undefined;
    if (taskRow.specId) {
      const [specRow] = await this.db
        .select({ id: specs.id, prd: specs.prd })
        .from(specs)
        .where(and(eq(specs.id, taskRow.specId), eq(specs.tenantId, tenantId)));
      if (specRow) prd = { specId: specRow.id, body: specRow.prd };
    }

    const message = buildPrDispatchMessage(
      {
        provider: repoRow.provider,
        host: repoRow.host,
        owner: repoRow.owner,
        repo: repoRow.repo,
        defaultBranch: repoRow.defaultBranch,
      },
      {
        id: taskRow.id,
        title: taskRow.title,
        description: taskRow.description,
        ticketRef: taskRow.source ?? null,
      },
      prd,
    );

    const agentHostId = taskRow.assignedAgentHostId;
    const delivered = await this.dispatcher(agentHostId, message);

    const now = new Date();

    // Record the branch we asked the agentHost to create.
    await this.db.insert(repoBranches).values({
      tenantId,
      segmentId: repoRow.segmentId ?? null,
      repoId: repoRow.id,
      taskId: taskRow.id,
      name: message.branchName,
      baseBranch: message.base,
      createdBy: `agentHost:${agentHostId}`,
      createdAt: now,
    });

    // Record the pull request as 'open' (the agentHost later calls recordPrResult).
    const [prRow] = await this.db
      .insert(pullRequests)
      .values({
        tenantId,
        segmentId: repoRow.segmentId ?? null,
        projectId: taskRow.projectId,
        repoId: repoRow.id,
        taskId: taskRow.id,
        specId: taskRow.specId ?? null,
        provider: repoRow.provider,
        branchName: message.branchName,
        baseBranch: message.base,
        status: 'open',
        externalTicketRef: message.ticketRef,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!prRow) {
      return { ok: false, code: 'dispatch_failed', reason: 'Failed to record pull request' };
    }

    if (!delivered) {
      return {
        ok: false,
        code: 'dispatch_failed',
        reason: 'Pull request recorded but agentHost did not acknowledge dispatch.',
      };
    }

    return { ok: true, prId: prRow.id, agentHostId, message };
  }

  /** AgentHost callback: record the resulting PR number / url / status. */
  async recordPrResult(
    prId: string,
    tenantId: number,
    result: { number?: number | null; url?: string | null; status?: string | null },
  ) {
    const status = normalizePrStatus(result.status);
    const [row] = await this.db
      .update(pullRequests)
      .set({
        ...(result.number != null ? { number: result.number } : {}),
        ...(result.url != null ? { url: result.url } : {}),
        ...(status != null ? { status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(pullRequests.id, prId), eq(pullRequests.tenantId, tenantId)))
      .returning();
    return row ?? null;
  }
}

const PR_STATUSES = new Set(['draft', 'open', 'merged', 'closed']);

export function normalizePrStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const lower = status.toLowerCase();
  return PR_STATUSES.has(lower) ? lower : null;
}
