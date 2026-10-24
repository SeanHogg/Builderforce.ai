import { statusResponse } from '../middleware/errorResponse';
/**
 * githubActionsRoutes — the GitHub Actions agent execution surface.
 *
 * WHY THIS SURFACE EXISTS
 * The two existing cloud surfaces are both shaped by Cloudflare's limits: the
 * durable runner takes ONE LLM step per DO alarm tick to survive the ~30s
 * waitUntil wall, and the container surface is capped at `max_instances = 5`
 * with a 90s orphan reaper it has to heartbeat against. A GitHub Actions runner
 * has none of those constraints — a real filesystem, a real toolchain, a 6-hour
 * budget, and (for public repos) no marginal cost. For repo-bound agent work
 * that is simply a better executor.
 *
 * ── Why this looks nothing like the container's transport ────────────────────
 * The container surface is PUSH-driven: the Worker holds a DO stub and POSTs
 * work into a process it can reach. An Actions runner has no inbound network
 * path — you cannot call it. So dispatch inverts: the Worker fires
 * `workflow_dispatch`, GitHub schedules a runner, and the RUNNER calls back here
 * for every step. This route is the callback.
 *
 * ── Authentication: OIDC, not a shared secret ────────────────────────────────
 * The container authenticates with an HMAC token minted per execution and handed
 * to it over a trusted internal hop. That model does not transfer: putting a
 * bearer secret capable of driving `llm` ops (i.e. spending the tenant's LLM
 * budget) into a workflow environment is a materially worse trust boundary.
 *
 * Instead this follows the pattern already established by the deploy path
 * (`deployRoutes.ts` + `githubOidc.ts`): the workflow holds NO secret, requests a
 * short-lived OIDC token scoped to OUR audience, and we verify it against
 * GitHub's public keys. The `repository` claim is unforgeable, and — exactly as
 * in the deploy route — the repo↔project binding IS the authorization.
 *
 * The authorization check is deliberately stricter than the deploy route's,
 * because the capability granted is greater. A token proves "I am a workflow
 * running in repo X"; that is necessary but not sufficient. We additionally
 * require that the execution being driven belongs to the tenant AND project that
 * repo X is bound to. Without that second check, any repo linked to Builderforce
 * could drive ANY execution id in the system.
 *
 * ── What the runner may say ──────────────────────────────────────────────────
 * The runner is the run's SANDBOX, not its engine: the one engine (`cloudAgentEngine.ts`,
 * ticked by the run's CloudRunnerDO) drives every cloud run, and the runner serves its
 * shell and working tree with the same `sandboxCore.mjs` the Cloudflare Container does.
 * Once authenticated, every op goes to `handleSandboxCallback` — the spec, the engine's
 * next request and its result, a cancel poll, and timeline events. There is no model
 * turn, commit or finalize to ask for, because the runner decides none of them.
 */
import { Hono } from 'hono';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { verifyGitHubOidcToken } from '../../application/ide/githubOidc';
import { loadSandboxRunContext } from '../../application/runtime/cloudAgent/runContext';
import { handleSandboxCallback } from '../../application/runtime/sandbox/sandboxCallbacks';
import { projectRepositories } from '../../infrastructure/database/schema';
import { BUILDERFORCE_AGENT_OIDC_AUDIENCE } from '../../application/runtime/githubActionsWorkflow';
import { renderAgentRunnerScript } from '../../application/runtime/githubActionsRunner';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { parseOptionalBody, z, zJsonObject } from './requestBody';

/**
 * The runner's op envelope (`renderAgentRunnerScript` posts `{ executionId, op, args }`).
 * Both identity fields stay optional so an absent/empty body keeps answering the
 * route's own "must include executionId and op" 400. `args` is handed to
 * `handleSandboxCallback` whole, so every key it carries is kept.
 */
const OpBody = z.object({
  executionId: z.number().optional(),
  op: z.string().optional(),
  args: zJsonObject.nullish(),
});

export function createGitHubActionsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * The runner script the workflow downloads and executes.
   *
   * Served rather than committed into the tenant's repo on purpose: the workflow
   * file that lives in their repo stays small and stable, and the agent loop can
   * be fixed centrally without opening a PR against every tenant repository.
   *
   * Deliberately unauthenticated — it is non-secret code, and the runner needs it
   * BEFORE it has done anything else. It carries no credentials and no tenant
   * data; everything sensitive is behind the OIDC-authenticated /op below.
   */
  router.get('/runner.mjs', (c) => {
    return c.body(renderAgentRunnerScript(), 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      // Short cache: long enough that a multi-step run does not re-fetch, short
      // enough that a fix to the loop reaches runners within the hour.
      'Cache-Control': 'public, max-age=300',
    });
  });

  /**
   * The agent op callback. One route, the full op vocabulary — see the module
   * comment for why the protocol is shared with the container surface.
   */
  router.post('/op', async (c) => {
    const env = c.env as Env;

    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return c.json({ error: 'Missing GitHub OIDC token. The workflow needs `id-token: write`.' }, 401);
    }

    // Demand OUR audience specifically — a deploy-audience token must not be
    // replayable here.
    const verified = await verifyGitHubOidcToken(env, token, BUILDERFORCE_AGENT_OIDC_AUDIENCE);
    if (!verified.ok) return c.json({ error: verified.error }, 401);

    const body = await parseOptionalBody(c, OpBody);
    if (!body.executionId || !body.op) {
      return c.json({ error: 'Body must include executionId and op.' }, 400);
    }

    const [owner, repo] = verified.claims.repository.split('/');

    // The repo↔project binding is the first half of the authorization, mirroring
    // deployRoutes. Prefer the default binding when a repo backs more than one.
    const [binding] = await db
      .select({ projectId: projectRepositories.projectId, tenantId: projectRepositories.tenantId })
      .from(projectRepositories)
      .where(and(
        eq(projectRepositories.provider, 'github'),
        sql`lower(${projectRepositories.owner}) = lower(${owner})`,
        sql`lower(${projectRepositories.repo}) = lower(${repo})`,
      ))
      .orderBy(desc(projectRepositories.isDefault), asc(projectRepositories.createdAt))
      .limit(1);

    if (!binding) {
      return c.json(
        {
          error:
            `Repository "${verified.claims.repository}" is not linked to a Builderforce project.`,
        },
        404,
      );
    }

    const ctx = await loadSandboxRunContext(env, db, body.executionId);
    if (!ctx) return c.json({ error: 'Execution not found.' }, 404);

    // The second half of the authorization, and the one that matters most: a
    // workflow in repo X may only drive executions belonging to the tenant and
    // project that repo X is bound to. Without this, a valid OIDC token from any
    // Builderforce-linked repo could drive any execution in the platform —
    // reading another tenant's task context and spending their LLM budget.
    //
    // Answered as a flat 403 with no detail: distinguishing "wrong tenant" from
    // "no such execution" would confirm the existence of other tenants' runs.
    if (ctx.tenantId !== Number(binding.tenantId) || ctx.projectId !== Number(binding.projectId)) {
      return c.json({ error: 'This repository may not drive that execution.' }, 403);
    }

    const result = await handleSandboxCallback(env, db, ctx, body.executionId, body.op, body.args ?? {});
    return statusResponse(c, result.body as Record<string, unknown>, result.status, { source: 'presentation/routes/githubActionsRoutes.ts', operation: 'sandboxCallback' });
  });

  return router;
}
