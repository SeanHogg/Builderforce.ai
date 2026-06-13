/**
 * Repo routes – /api/repos
 *
 * Multi-repo associations and PR/branch dispatch (Slice 4).
 *
 * POST   /api/repos/projects/:projectId/repositories   Associate a repo with a project
 * GET    /api/repos/projects/:projectId/repositories   List a project's repos
 * PATCH  /api/repos/repositories/:id                   Update a repo (incl. set isDefault)
 * DELETE /api/repos/repositories/:id                   Remove a repo association
 * POST   /api/repos/repositories/:id/default           Mark a repo as the project default
 * POST   /api/repos/tasks/:taskId/pull-request         Dispatch PR creation to the task's agentHost
 * GET    /api/repos/tasks/:taskId/pull-request         Latest recorded PR for a task + live provider detail
 * POST   /api/repos/pull-requests/:id/result           AgentHost callback: record PR number/url/status
 * POST   /api/repos/pull-requests/:id/merge            Approve & merge a recorded PR (in-product)
 * GET    /api/repos/projects/:projectId/pull-requests  List a project's pull requests
 *
 * Every query is tenant-scoped. The AGENT_HOST_RELAY dispatch mirrors runtimeRoutes.ts:
 *   env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId))).fetch(...)
 */
import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  projectRepositories,
  pullRequests,
  projects,
} from '../../infrastructure/database/schema';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import { RepoService, type AgentHostDispatcher } from '../../application/repos/RepoService';
import { resolveRepoCredential, isResolveError } from '../../application/repos/resolveRepoCredential';
import { importRepoContents } from '../../application/repos/importRepoContents';
import { githubStatusMessage } from '../../application/integrations/githubTestError';
import { mergePullRequest, normalizeMergeMethod } from '../../application/repos/mergePullRequest';
import { markPullRequestMergedById } from '../../application/repos/recordPullRequestRow';
import { getPullRequestDetail, invalidatePullRequestDetail } from '../../application/repos/getPullRequestDetail';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { CreatePrMessage } from '../../application/repos/prDispatch';

/** Read-through cache key for a project's repo list (the picker + SourceControl read
 *  this; it changes only on the CRUD routes below, which all invalidate it). */
function reposCacheKey(tenantId: number, projectId: number): string {
  return `project-repos:${tenantId}:${projectId}`;
}

type RepoHonoEnv = HonoEnv & {
  Bindings: HonoEnv['Bindings'] & {
    AGENT_HOST_RELAY?: DurableObjectNamespace<AgentHostRelayDO>;
  };
};

/** Build a dispatcher that pushes a create_pr message to a specific agentHost's relay DO. */
function makeAgentHostDispatcher(env: RepoHonoEnv['Bindings']): AgentHostDispatcher {
  return async (agentHostId: number, message: CreatePrMessage): Promise<boolean> => {
    if (!env.AGENT_HOST_RELAY) return false;
    const stub = env.AGENT_HOST_RELAY.get(env.AGENT_HOST_RELAY.idFromName(String(agentHostId)));
    const response = await stub.fetch('https://relay.internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    return response.ok;
  };
}

/**
 * Probe that a repo is actually reachable with its linked credential's token.
 * Used by the "Test" button in the project Integrations tab so an operator can
 * confirm a repo is accessible before dispatching agents against it. This is a
 * live provider round-trip by design (it verifies the token + repo visibility),
 * so it is intentionally not cached.
 */
async function probeRepoAccess(
  provider: string,
  host: string | null,
  owner: string,
  repo: string,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const where = `${owner}/${repo}`;
  try {
    switch (provider) {
      case 'github': {
        const apiRoot = !host || host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
        const res = await fetch(`${apiRoot}/repos/${owner}/${repo}`, {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Builderforce/1.0', Accept: 'application/vnd.github+json' },
        });
        return res.ok
          ? { ok: true, message: `Accessible (${where})` }
          : { ok: false, message: githubStatusMessage(res.status, 'repo', where) };
      }
      case 'gitlab': {
        const root = host && host !== 'github.com' ? `https://${host}` : 'https://gitlab.com';
        const res = await fetch(`${root}/api/v4/projects/${encodeURIComponent(where)}`, {
          headers: { Authorization: `Bearer ${token}`, 'PRIVATE-TOKEN': token },
        });
        return res.ok
          ? { ok: true, message: `Accessible (${where})` }
          : { ok: false, message: `GitLab API returned ${res.status}` };
      }
      case 'bitbucket': {
        const res = await fetch(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.ok
          ? { ok: true, message: `Accessible (${where})` }
          : { ok: false, message: `Bitbucket API returned ${res.status}` };
      }
      default:
        return { ok: false, message: `Accessibility test not available for provider: ${provider}` };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error during accessibility test' };
  }
}

export function createRepoRoutes(db: Db): Hono<RepoHonoEnv> {
  const router = new Hono<RepoHonoEnv>();
  router.use('*', authMiddleware);

  // ---- project_repositories CRUD --------------------------------------------

  // POST /api/repos/projects/:projectId/repositories
  router.post('/projects/:projectId/repositories', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);

    // Verify project belongs to tenant.
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const body = await c.req.json<{
      provider: string;
      owner: string;
      repo: string;
      host?: string;
      defaultBranch?: string | null;
      cloneUrlHttps?: string | null;
      isDefault?: boolean;
      matchHints?: { labels?: string[]; keywords?: string[]; pathGlobs?: string[] } | null;
      credentialId?: string | null;
    }>();

    if (!body.provider?.trim() || !body.owner?.trim() || !body.repo?.trim()) {
      return c.json({ error: 'provider, owner and repo are required' }, 400);
    }

    const service = new RepoService(db, makeAgentHostDispatcher(c.env));
    const row = await service.addRepo(
      {
        projectId,
        provider: body.provider.trim(),
        owner: body.owner.trim(),
        repo: body.repo.trim(),
        host: body.host?.trim(),
        defaultBranch: body.defaultBranch ?? null,
        cloneUrlHttps: body.cloneUrlHttps ?? null,
        isDefault: body.isDefault ?? false,
        matchHints: body.matchHints ?? null,
        credentialId: body.credentialId || null,
        segmentId: (c.get('segmentId') as string | undefined) ?? null,
      },
      tenantId,
    );

    await invalidateCached(c.env as Env, reposCacheKey(tenantId, projectId));
    return c.json(row, 201);
  });

  // GET /api/repos/projects/:projectId/repositories
  router.get('/projects/:projectId/repositories', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);

    const service = new RepoService(db, makeAgentHostDispatcher(c.env));
    const repos = await getOrSetCached(
      c.env as Env,
      reposCacheKey(tenantId, projectId),
      () => service.listRepos(projectId, tenantId),
      { kvTtlSeconds: 300, l1TtlMs: 30_000 },
    );
    return c.json({ repositories: repos });
  });

  // PATCH /api/repos/repositories/:id
  router.patch('/repositories/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const body = await c.req.json<{
      host?: string;
      owner?: string;
      repo?: string;
      provider?: string;
      defaultBranch?: string | null;
      cloneUrlHttps?: string | null;
      isDefault?: boolean;
      matchHints?: { labels?: string[]; keywords?: string[]; pathGlobs?: string[] } | null;
      credentialId?: string | null;
    }>();

    await db
      .update(projectRepositories)
      .set({
        ...(body.host !== undefined ? { host: body.host } : {}),
        ...(body.owner !== undefined ? { owner: body.owner } : {}),
        ...(body.repo !== undefined ? { repo: body.repo } : {}),
        ...(body.provider !== undefined ? { provider: body.provider } : {}),
        ...(body.defaultBranch !== undefined ? { defaultBranch: body.defaultBranch } : {}),
        ...(body.cloneUrlHttps !== undefined ? { cloneUrlHttps: body.cloneUrlHttps } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.matchHints !== undefined
          ? { matchHints: body.matchHints != null ? JSON.stringify(body.matchHints) : null }
          : {}),
        // Coerce '' → null: the column is a uuid FK, so an empty string would
        // make the update fail (and the row appear to "revert" to its old key).
        ...(body.credentialId !== undefined ? { credentialId: body.credentialId || null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));

    const [row] = await db
      .select()
      .from(projectRepositories)
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Repository not found' }, 404);
    await invalidateCached(c.env as Env, reposCacheKey(tenantId, row.projectId));
    return c.json(row);
  });

  // POST /api/repos/repositories/:id/default — set this repo as the project default,
  // clearing the flag on its siblings.
  router.post('/repositories/:id/default', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [target] = await db
      .select({ id: projectRepositories.id, projectId: projectRepositories.projectId })
      .from(projectRepositories)
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));
    if (!target) return c.json({ error: 'Repository not found' }, 404);

    // Clear default on all repos in the same project, then set it on the target.
    await db
      .update(projectRepositories)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(projectRepositories.projectId, target.projectId),
          eq(projectRepositories.tenantId, tenantId),
        ),
      );
    await db
      .update(projectRepositories)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));

    const [row] = await db
      .select()
      .from(projectRepositories)
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));
    await invalidateCached(c.env as Env, reposCacheKey(tenantId, target.projectId));
    return c.json(row);
  });

  // POST /api/repos/repositories/:id/test — confirm the repo is reachable with
  // its linked credential. Mirrors the integration-key "Test" probe so an
  // operator can validate end-to-end accessibility from the Integrations tab.
  router.post('/repositories/:id/test', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const env = c.env as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';

    const resolved = await resolveRepoCredential(db, secret, tenantId, id);
    if (isResolveError(resolved)) {
      // A genuinely missing repo is a 404; "no key" / "no token" are surfaced as
      // a non-OK test result the UI renders inline next to the row.
      if (resolved.status === 404 && resolved.error === 'Repository not found') {
        return c.json({ error: resolved.error }, 404);
      }
      return c.json({ ok: false, message: resolved.error });
    }

    const result = await probeRepoAccess(
      resolved.repo.provider,
      resolved.repo.host,
      resolved.repo.owner,
      resolved.repo.repo,
      resolved.token,
    );
    return c.json(result);
  });

  // GET /api/repos/repositories/:id/contents?ref=<branch> — read the repo's
  // files (server-side with the decrypted token) so the in-browser IDE can
  // hydrate its editable workspace from the connected repo. The token never
  // leaves the server; the client persists the returned manifest through its
  // normal saveFile path (which targets the correct storage backend).
  router.get('/repositories/:id/contents', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const env = c.env as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';

    const resolved = await resolveRepoCredential(db, secret, tenantId, id);
    if (isResolveError(resolved)) return c.json({ error: resolved.error }, resolved.status);

    const ref = (c.req.query('ref') || resolved.repo.defaultBranch || 'main').trim();
    const result = await importRepoContents({
      provider: resolved.repo.provider,
      host: resolved.repo.host,
      owner: resolved.repo.owner,
      repo: resolved.repo.repo,
      token: resolved.token,
      ref,
    });
    if (!result.ok) return c.json({ error: result.error ?? 'Failed to read repository' }, 502);
    return c.json(result);
  });

  // DELETE /api/repos/repositories/:id
  router.delete('/repositories/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    // Capture the projectId before deleting so we can bust its repo-list cache.
    const [row] = await db
      .select({ projectId: projectRepositories.projectId })
      .from(projectRepositories)
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));
    await db
      .delete(projectRepositories)
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));
    if (row) await invalidateCached(c.env as Env, reposCacheKey(tenantId, row.projectId));
    return c.body(null, 204);
  });

  // ---- PR / branch dispatch -------------------------------------------------

  // POST /api/repos/tasks/:taskId/pull-request — resolve repo + dispatch PR creation.
  router.post('/tasks/:taskId/pull-request', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ error: 'Invalid taskId' }, 400);

    const service = new RepoService(db, makeAgentHostDispatcher(c.env));
    const result = await service.dispatchPrCreation(taskId, tenantId);

    if (!result.ok) {
      switch (result.code) {
        case 'task_not_found':
          return c.json({ error: result.reason }, 404);
        case 'no_agent_host':
        case 'no_repo':
          // No assigned agentHost / no resolvable repo: do not broadcast — fail closed.
          return c.json({ error: result.reason }, 409);
        case 'dispatch_failed':
          return c.json({ error: result.reason }, 502);
      }
    }

    return c.json(
      {
        ok: true,
        pullRequestId: result.prId,
        agentHostId: result.agentHostId,
        branchName: result.message.branchName,
        base: result.message.base,
      },
      201,
    );
  });

  // POST /api/repos/pull-requests/:id/result — agentHost callback to record PR result.
  router.post('/pull-requests/:id/result', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const body = await c.req.json<{
      number?: number | null;
      url?: string | null;
      status?: string | null;
    }>();

    const service = new RepoService(db, makeAgentHostDispatcher(c.env));
    const row = await service.recordPrResult(id, tenantId, body);
    if (!row) return c.json({ error: 'Pull request not found' }, 404);
    return c.json(row);
  });

  // GET /api/repos/projects/:projectId/pull-requests
  router.get('/projects/:projectId/pull-requests', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);

    const rows = await db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.projectId, projectId), eq(pullRequests.tenantId, tenantId)))
      .orderBy(desc(pullRequests.createdAt));
    return c.json({ pullRequests: rows });
  });

  // GET /api/repos/tasks/:taskId/pull-request — the latest recorded PR for a task
  // plus its LIVE provider detail (status, mergeability, CI checks, diff stat) so
  // the in-product Pull Request tab can render review info + gate Approve & Merge.
  router.get('/tasks/:taskId/pull-request', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ error: 'Invalid taskId' }, 400);

    const [row] = await db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.taskId, taskId), eq(pullRequests.tenantId, tenantId)))
      .orderBy(desc(pullRequests.createdAt))
      .limit(1);
    // No PR yet for this task → 200 with nulls so the client renders "no PR"
    // without treating it as an error (exception-as-control-flow is avoided).
    if (!row) return c.json({ pullRequest: null, detail: null });

    // Live detail is best-effort: the recorded row always renders even if the
    // provider call (or credential resolution) fails — the UI degrades to the
    // recorded status + an "open on provider" link.
    let detail: Awaited<ReturnType<typeof getPullRequestDetail>> | null = null;
    if (row.repoId && row.number != null) {
      const env = c.env as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
      const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
      const resolved = await resolveRepoCredential(db, secret, tenantId, row.repoId);
      if (!isResolveError(resolved)) {
        detail = await getPullRequestDetail(
          c.env as Env,
          row.id,
          row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
          {
            provider: resolved.repo.provider, host: resolved.repo.host,
            owner: resolved.repo.owner, repo: resolved.repo.repo,
            token: resolved.token, number: row.number,
          },
        );
      }
    }

    return c.json({ pullRequest: row, detail });
  });

  // POST /api/repos/pull-requests/:id/merge — Approve & merge a recorded PR from
  // the product. Server-side with the tenant's decrypted token; records who
  // approved (audit) and busts the cached detail.
  router.post('/pull-requests/:id/merge', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');
    const body = await c.req.json<{ method?: string }>().catch(() => ({} as { method?: string }));

    const [row] = await db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.id, id), eq(pullRequests.tenantId, tenantId)))
      .limit(1);
    if (!row) return c.json({ error: 'Pull request not found' }, 404);
    if (row.status === 'merged') return c.json({ ok: true, alreadyMerged: true, pullRequest: row });
    if (!row.repoId) return c.json({ error: 'PR has no linked repo to merge against' }, 409);
    if (row.number == null) return c.json({ error: 'PR has no provider number yet (still being opened)' }, 409);

    const env = c.env as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
    const resolved = await resolveRepoCredential(db, secret, tenantId, row.repoId);
    if (isResolveError(resolved)) return c.json({ error: resolved.error }, resolved.status);

    const result = await mergePullRequest({
      provider: resolved.repo.provider, host: resolved.repo.host,
      owner: resolved.repo.owner, repo: resolved.repo.repo, token: resolved.token,
      number: row.number, method: normalizeMergeMethod(body.method),
      commitTitle: `Task #${row.taskId ?? ''}: merge ${row.branchName ?? ''}`.trim(),
    });

    if (!result.ok) {
      const httpStatus = result.code === 'unsupported' ? 501
        : (result.code === 'conflict' || result.code === 'not_mergeable') ? 409
        : 502;
      return c.json({ error: result.reason, code: result.code }, httpStatus);
    }

    const updated = await markPullRequestMergedById(db, id, tenantId, {
      mergeSha: result.sha ?? null,
      mergedBy: userId ?? null,
    });

    // Bust the cached live detail keyed by the PRE-merge updatedAt token.
    await invalidatePullRequestDetail(
      c.env as Env, id,
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    ).catch(() => { /* cache miss is fine */ });

    return c.json({ ok: true, merged: result.merged, sha: result.sha, pullRequest: updated ?? row });
  });

  return router;
}
