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
 * POST   /api/repos/pull-requests/:id/result           AgentHost callback: record PR number/url/status
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
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentHostRelayDO } from '../../infrastructure/relay/AgentHostRelayDO';
import { RepoService, type AgentHostDispatcher } from '../../application/repos/RepoService';
import { resolveRepoCredential, isResolveError } from '../../application/repos/resolveRepoCredential';
import type { CreatePrMessage } from '../../application/repos/prDispatch';

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
          : { ok: false, message: `GitHub API returned ${res.status}` };
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

    return c.json(row, 201);
  });

  // GET /api/repos/projects/:projectId/repositories
  router.get('/projects/:projectId/repositories', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);

    const service = new RepoService(db, makeAgentHostDispatcher(c.env));
    const repos = await service.listRepos(projectId, tenantId);
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

  // DELETE /api/repos/repositories/:id
  router.delete('/repositories/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await db
      .delete(projectRepositories)
      .where(and(eq(projectRepositories.id, id), eq(projectRepositories.tenantId, tenantId)));
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

  return router;
}
