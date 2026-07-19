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
 * ── Why the op protocol is shared verbatim ───────────────────────────────────
 * Once authenticated, this delegates to the SAME `handleContainerOp` the
 * container surface uses. The ops (llm / write / event / memory / platform_tool
 * / heartbeat / finalize / fail) are the surface-agnostic contract; only the
 * transport and the auth differ. Forking that handler per surface would
 * guarantee the two drift — steering, compaction, metering and PR-finalize
 * semantics all live inside it.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { verifyGitHubOidcToken } from '../../application/ide/githubOidc';
import {
  handleContainerOp,
  loadContainerRunContext,
  markCloudExecutionRunning,
  prepareCloudRun,
  gitSecret,
} from '../../application/runtime/cloudAgentEngine';
import { resolveTicketRepoContext } from '../../application/repos/commitFileAsPendingChange';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import { CONTAINER_MAX_STEPS } from '../../application/runtime/cloudAgentTools';
import { executions } from '../../infrastructure/database/schema';
import { BUILDERFORCE_AGENT_OIDC_AUDIENCE } from '../../application/runtime/githubActionsWorkflow';
import { renderAgentRunnerScript } from '../../application/runtime/githubActionsRunner';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

export function createGitHubActionsRoutes(db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
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

    const body = (await c.req.json().catch(() => null)) as {
      executionId?: number;
      op?: string;
      args?: Record<string, unknown>;
    } | null;
    if (!body?.executionId || !body.op) {
      return c.json({ error: 'Body must include executionId and op.' }, 400);
    }

    const [owner, repo] = verified.claims.repository.split('/');
    const sql = neon(env.NEON_DATABASE_URL);

    // The repo↔project binding is the first half of the authorization, mirroring
    // deployRoutes. Prefer the default binding when a repo backs more than one.
    const [binding] = await sql`
      SELECT pr.project_id, pr.tenant_id
      FROM project_repositories pr
      WHERE pr.provider = 'github'
        AND lower(pr.owner) = lower(${owner})
        AND lower(pr.repo)  = lower(${repo})
      ORDER BY pr.is_default DESC, pr.created_at ASC
      LIMIT 1`;

    if (!binding) {
      return c.json(
        {
          error:
            `Repository "${verified.claims.repository}" is not linked to a Builderforce project.`,
        },
        404,
      );
    }

    const ctx = await loadContainerRunContext(env, db, body.executionId);
    if (!ctx) return c.json({ error: 'Execution not found.' }, 404);

    // The second half of the authorization, and the one that matters most: a
    // workflow in repo X may only drive executions belonging to the tenant and
    // project that repo X is bound to. Without this, a valid OIDC token from any
    // Builderforce-linked repo could drive any execution in the platform —
    // reading another tenant's task context and spending their LLM budget.
    //
    // Answered as a flat 403 with no detail: distinguishing "wrong tenant" from
    // "no such execution" would confirm the existence of other tenants' runs.
    if (ctx.tenantId !== Number(binding.tenant_id) || ctx.projectId !== Number(binding.project_id)) {
      return c.json({ error: 'This repository may not drive that execution.' }, 403);
    }

    /**
     * `spec` — the one op this surface needs that the container does not.
     *
     * The container is PUSH-driven: runtimeRoutes builds the prompts and POSTs
     * them into the container's /run. A `workflow_dispatch` payload carries only
     * the execution id, so a pull-driven runner has to ASK for the same spec as
     * its first call. Hence this lives here rather than in handleContainerOp —
     * it is a property of the transport, not of the agent protocol.
     *
     * This is also where the run is marked RUNNING. Dispatch only proved GitHub
     * queued the job; a runner asking for its spec is the first evidence one
     * actually started, which is the true parity point with the container's
     * post-/run markCloudExecutionRunning.
     */
    if (body.op === 'spec') {
      const [execRow] = await db
        .select({ payload: executions.payload })
        .from(executions)
        .where(eq(executions.id, body.executionId))
        .limit(1);

      const artifacts = await resolveArtifacts(db, {
        tenantId: ctx.tenantId,
        taskId: ctx.taskId,
        cloudAgentRef: ctx.cloudAgentRef,
      }).catch(() => undefined);

      const { systemPrompt, userContent } = await prepareCloudRun(
        env, db, body.executionId,
        { id: ctx.taskId, title: ctx.taskTitle, description: ctx.taskDescription },
        ctx.tenantId, ctx.projectId, ctx.agentLabel, ctx.model, artifacts,
        ctx.cloudAgentRef, execRow?.payload ?? undefined,
        // The runner has a real shell, exactly like the container.
        { shell: true },
      );

      // Which branch to work on. Unlike the container there is no clone URL:
      // actions/checkout has already cloned, and the workflow's GITHUB_TOKEN
      // (contents: write) is what authorises the push — so no credential of
      // ours ever reaches the runner.
      const repo = await resolveTicketRepoContext(db, gitSecret(env), ctx.tenantId, ctx.taskId);

      await markCloudExecutionRunning(runtimeService, body.executionId).catch(() => {});

      return c.json({
        systemPrompt,
        userContent,
        maxSteps: CONTAINER_MAX_STEPS,
        repo: repo.ok ? { baseBranch: repo.ctx.base, headBranch: repo.ctx.branch } : null,
      });
    }

    const result = await handleContainerOp(
      env,
      db,
      runtimeService,
      ctx,
      body.executionId,
      body.op,
      body.args ?? {},
    );
    return c.json(result.body as Record<string, unknown>, result.status as 200);
  });

  return router;
}
