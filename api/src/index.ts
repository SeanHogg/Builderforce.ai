/**
 * Cloudflare Worker entry point – api.builderforce.ai
 *
 * All infrastructure dependencies are wired per-request via a factory so
 * each Worker invocation gets its own short-lived Neon connection.
 *
 * Layer order (outermost → innermost):
 *   Presentation → Application → Domain ← Infrastructure
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from './env';

import { buildDatabase } from './infrastructure/database/connection';

// Repositories
import { ProjectRepository }   from './infrastructure/repositories/ProjectRepository';
import { TaskRepository }       from './infrastructure/repositories/TaskRepository';
import { TenantRepository }     from './infrastructure/repositories/TenantRepository';
import { UserRepository }       from './infrastructure/repositories/UserRepository';
import { AgentRepository }      from './infrastructure/repositories/AgentRepository';
import { SkillRepository }       from './infrastructure/repositories/SkillRepository';
import { AuditRepository }      from './infrastructure/repositories/AuditRepository';

// Application services
import { ProjectService }  from './application/project/ProjectService';
import { TaskService }     from './application/task/TaskService';
import { TenantService }   from './application/tenant/TenantService';
import { AuthService }     from './application/auth/AuthService';
import { AgentService }    from './application/agent/AgentService';
import { buildRuntimeService } from './buildRuntimeService';
import { recommendTopAssignee } from './application/metrics/assigneeRecommender';
import { AuditService }    from './application/audit/AuditService';
import { AgentHostService }     from './application/agentHost/AgentHostService';

// Routes
import { createProjectRoutes }     from './presentation/routes/projectRoutes';
import { createTaskRoutes } from './presentation/routes/taskRoutes';
import { createVscodeRoutes } from './presentation/routes/vscodeRoutes';
import { setExecutionBoardSink }   from './application/runtime/executionEvents';
import { makeExecutionBoardSink }  from './application/runtime/executionBoardBroadcast';
import { createMemberRoutes }      from './presentation/routes/memberRoutes';
import { createTenantRoutes }      from './presentation/routes/tenantRoutes';
import { createSegmentRoutes }     from './presentation/routes/segmentRoutes';
import { createEmbedRoutes }       from './presentation/routes/embedRoutes';
import { createGovernanceRoutes }  from './presentation/routes/governanceRoutes';
import { createProductRoutes }     from './presentation/routes/productRoutes';
import { createAgileRoutes }       from './presentation/routes/agileRoutes';
import { createRoiRoutes }         from './presentation/routes/roiRoutes';
import { createSeamRoutes }        from './presentation/routes/seamRoutes';
import { createBiRoutes }          from './presentation/routes/biRoutes';
import { createTenantApiKeyRoutes } from './presentation/routes/tenantApiKeyRoutes';
import { createMcpExtensionRoutes } from './presentation/routes/mcpExtensionRoutes';
import { createAuthRoutes }        from './presentation/routes/authRoutes';
import { createOAuthRoutes }       from './presentation/routes/oauthRoutes';
import { createAgentRoutes, createSkillRoutes } from './presentation/routes/agentRoutes';
import { createRuntimeRoutes }     from './presentation/routes/runtimeRoutes';
import { createAuditRoutes }       from './presentation/routes/auditRoutes';
import { createMarketplaceRoutes } from './presentation/routes/marketplaceRoutes';
import { createAgentHostRoutes }        from './presentation/routes/agentHostRoutes';
import { AgentHostRepository }          from './infrastructure/repositories/AgentHostRepository';
import { IAgentHostRepository }         from './domain/agentHost/IAgentHostRepository';
import { createSkillAssignmentRoutes } from './presentation/routes/skillAssignmentRoutes';
import { createArtifactAssignmentRoutes } from './presentation/routes/artifactAssignmentRoutes';
import { createProjectAgentRoutes } from './presentation/routes/projectAgentRoutes';
import { createMarketplaceStatsRoutes } from './presentation/routes/marketplaceStatsRoutes';
import { createWorkforceRoutes }        from './presentation/routes/workforceRoutes';
import { createPersonaRoutes }          from './presentation/routes/personaRoutes';
import { createLlmRoutes }          from './presentation/routes/llmRoutes';
import { createTenantModelRoutes }  from './presentation/routes/tenantModelRoutes';
import { createSemanticCacheRoutes } from './presentation/routes/semanticCacheRoutes';
import { createAdminRoutes }        from './presentation/routes/adminRoutes';
import { createChatRoutes }         from './presentation/routes/chatRoutes';
import { createSpecRoutes }         from './presentation/routes/specRoutes';
import { createWorkflowRoutes }     from './presentation/routes/workflowRoutes';
import { createWorkflowDefinitionRoutes } from './presentation/routes/workflowDefinitionRoutes';
import { createWorkflowTriggerRoutes } from './presentation/routes/workflowTriggerRoutes';
import { createApprovalRoutes }     from './presentation/routes/approvalRoutes';
import { createApprovalRuleRoutes } from './presentation/routes/approvalRuleRoutes';
import { createPendingPromptRoutes } from './presentation/routes/pendingPromptRoutes';
import { createTelemetryRoutes }    from './presentation/routes/telemetryRoutes';
import { createQaRoutes }           from './presentation/routes/qaRoutes';
import { createRepoAnalysisRoutes } from './presentation/routes/repoAnalysisRoutes';
import { createStudioVoiceCloneRoutes } from './presentation/routes/studioVoiceCloneRoutes';
import { createIntegrationRoutes }  from './presentation/routes/integrationRoutes';
import { createContributorRoutes }  from './presentation/routes/contributorRoutes';
import { createDevTeamRoutes }      from './presentation/routes/devTeamRoutes';
import { createTeamRoutes }         from './presentation/routes/teamRoutes';
import { createReportRoutes }       from './presentation/routes/reportRoutes';
import { createAnalyticsRoutes }    from './presentation/routes/analyticsRoutes';
import { createPromptLibraryRoutes } from './presentation/routes/promptLibraryRoutes';
import { createBrainRoutes }       from './presentation/routes/brainRoutes';
import { createBrainFilesRoutes }  from './presentation/routes/brainFilesRoutes';
import { createSitesRoutes, tryServeHostedSite } from './presentation/routes/sitesRoutes';
import { createIdeRoutes }         from './presentation/routes/ideRoutes';
import { createIdeAiRoutes }       from './presentation/routes/ideAiRoutes';
import { BrainService }            from './application/brain/BrainService';
import { buildPaymentProvider }    from './infrastructure/payment';
import { createWebhookRoutes }     from './presentation/routes/webhookRoutes';
import { createManagedAgentHostRoutes }     from './presentation/routes/managedAgentHostRoutes';
import { createGitHubWebhookRoutes }   from './presentation/routes/githubWebhookRoutes';
import { createCostForecastRoutes }    from './presentation/routes/costForecastRoutes';
import { createDashboardRoutes }       from './presentation/routes/dashboardRoutes';
import { createTeamMemoryRoutes }      from './presentation/routes/teamMemoryRoutes';
import { createPublicApiRoutes }       from './presentation/routes/publicApiRoutes';
import { createStudioRoutes }          from './presentation/routes/studioWeightRoutes';
// Cloud Agent Boards — agentic swimlanes, external board sync, PRD versioning, multi-repo PRs
import { createBoardRoutes }           from './presentation/routes/boardRoutes';
import { createBoardConnectionRoutes } from './presentation/routes/boardConnectionRoutes';
import { createBoardWebhookRoutes }    from './presentation/routes/boardWebhookRoutes';
import { createPrdRoutes }             from './presentation/routes/prdRoutes';
import { createRepoRoutes }            from './presentation/routes/repoRoutes';
import { createAgentRuntimeRoutes }    from './presentation/routes/agentRuntimeRoutes';
import { createGitProxyRoutes }        from './presentation/routes/gitProxyRoutes';
import { createAgentAssignmentRoutes } from './presentation/routes/agentAssignmentRoutes';
import { createSecurityReviewRoutes } from './presentation/routes/securityReviewRoutes';

import { API_VERSION } from './version';
import {
  OPENAPI_VERSION,
  OPENAPI_TITLE,
  OPENAPI_DESCRIPTION,
} from './openapi/schema';
import { runVendorHealthCron } from './application/llm/vendorHealthCron';
import { runRetentionPurge } from './application/maintenance/retentionPurge';
import { runDueTriggers } from './application/workflow/runDueTriggers';
import { processPendingCloudWorkflows } from './application/workflow/cloudExecutor';
import { reapStaleExecutions } from './application/runtime/staleExecutionReaper';
import { runWebhookRetrySweep } from './application/seams/webhookService';
import { runBoardSyncSweep } from './application/boardsync/runBoardSyncSweep';
import { runParkedWorkflowSweep } from './application/swimlane/resumeParkedWorkflows';
import { runQaExplorationSweep } from './application/qa/runQaExplorationSweep';
import { handleInboundEmail } from './application/workflow/inboundEmail';

// Middleware
import { addCorsToResponse, corsMiddleware } from './presentation/middleware/cors';
import { errorHandler }   from './presentation/middleware/errorHandler';
import { rateLimitMiddleware } from './presentation/middleware/rateLimitMiddleware';
import { emulationMiddleware } from './presentation/middleware/emulationMiddleware';

// Durable Objects (must be re-exported so the Workers runtime can instantiate them)
export { AgentHostRelayDO } from './infrastructure/relay/AgentHostRelayDO';
export { SessionRoomDO } from './infrastructure/relay/SessionRoomDO';
export { CeremonyRoomDO } from './infrastructure/relay/CeremonyRoomDO';
export { AnalysisRunnerDO } from './infrastructure/relay/AnalysisRunnerDO';
export { CloudRunnerDO } from './infrastructure/relay/CloudRunnerDO';
export { AgentContainerDO } from './infrastructure/relay/AgentContainerDO';
export { QaRunnerContainerDO } from './infrastructure/relay/QaRunnerContainerDO';
export { TenantRateLimiterDO } from './infrastructure/ratelimit/TenantRateLimiterDO';

// ---------------------------------------------------------------------------
// Composition root: build the full Hono app for a single request,
// injecting the concrete infrastructure implementations.
// ---------------------------------------------------------------------------

function buildApp(env: Env): Hono<HonoEnv> {
  const db = buildDatabase(env);

  // --- Infrastructure ---
  const projectRepo   = new ProjectRepository(db);
  const taskRepo      = new TaskRepository(db);
  const tenantRepo    = new TenantRepository(db);
  const userRepo      = new UserRepository(db);
  const agentRepo     = new AgentRepository(db);
  const skillRepo      = new SkillRepository(db);
  const auditRepo     = new AuditRepository(db);
  const agentHostRepo      = new AgentHostRepository(db);

  // --- Payment provider (selected by PAYMENT_PROVIDER env var, defaults to "manual") ---
  const paymentProvider = buildPaymentProvider(env);

  // --- Application ---
  const projectService  = new ProjectService(projectRepo);
  const taskService     = new TaskService(taskRepo, projectRepo, undefined,
    (projectId) => recommendTopAssignee(env, db, projectId));
  const tenantService   = new TenantService(tenantRepo, paymentProvider);
  const authService     = new AuthService(userRepo, tenantRepo, auditRepo, env.JWT_SECRET);
  const agentService    = new AgentService(agentRepo, skillRepo, auditRepo);
  // RuntimeService.update is the single canonical execution-status transition;
  // its full wiring (self-heal, lane sync, autonomous chaining, audit) lives in
  // buildRuntimeService so the durable CloudRunnerDO shares the EXACT same instance
  // behavior instead of open-coding raw status writes.
  const runtimeService  = buildRuntimeService(env, db);
  const auditService    = new AuditService(auditRepo);
  const agentHostService     = new AgentHostService(agentHostRepo);
  const brainService    = new BrainService(db);

  // Wire execution lifecycle events to the project's live board room so a run's
  // progress (pending→running→done) pushes to every board/calendar/list viewer,
  // not just whoever opened the run's drawer. Idempotent per isolate (last writer
  // wins with an equivalent closure); needs env+db, which the events hub lacks.
  setExecutionBoardSink(makeExecutionBoardSink(env, db));

  // --- Presentation ---
  const app = new Hono<HonoEnv>();

  app.use('*', corsMiddleware);

  // Published-site hosting: a request whose Host is a `<sub>.builderforce.ai`
  // hosting subdomain (delivered by the worker's wildcard route) is served
  // straight from R2 as a public website — it never touches the API routers or
  // auth. Reserved/platform hosts (api.builderforce.ai, www, …) return null from
  // subdomainFromHost and fall through to next() and normal routing.
  app.use('*', async (c, next) => {
    const res = await tryServeHostedSite(c.env, c.req.header('host'), c.req.path);
    if (res) return res;
    return next();
  });

  // Rate limiting applied after auth middleware resolves tenantId
  app.use('/api/*', rateLimitMiddleware as Parameters<typeof app.use>[1]);
  // Emulation token interception — runs before authMiddleware in each router.
  // When X-Emulation-Token is present, validates the emulation JWT, enforces
  // read-only mode, and sets userId/tenantId/role from the emulation identity.
  // Not applied to /api/admin/* (emulation tokens are already blocked there).
  app.use('/api/*', emulationMiddleware as Parameters<typeof app.use>[1]);

  app.get('/health', (c) => c.json({ status: 'ok', worker: 'api.builderforce.ai', version: API_VERSION }));

  // OpenAPI 3.1 document — BuilderForce Agents-facing endpoints (P4-4)
  app.get('/api/openapi.json', (c) => {
    const doc = {
      openapi: OPENAPI_VERSION,
      info: { title: OPENAPI_TITLE, description: OPENAPI_DESCRIPTION, version: API_VERSION },
      servers: [{ url: 'https://api.builderforce.ai', description: 'Production' }],
      paths: {
        '/api/agent-hosts': {
          post: { summary: 'Register a BuilderForce Agents instance', operationId: 'registerAgentHost', tags: ['AgentHosts'] },
        },
        '/api/agent-hosts/{id}/heartbeat': {
          patch: { summary: 'Send heartbeat', operationId: 'heartbeat', tags: ['AgentHosts'] },
        },
        '/api/agent-hosts/{id}/forward': {
          post: { summary: 'Forward a remote task to a agentHost', operationId: 'forwardTask', tags: ['AgentHosts'] },
        },
        '/api/agent-hosts/{id}/context-bundle': {
          get: { summary: 'Get last-synced .builderforce/ context bundle', operationId: 'getContextBundle', tags: ['AgentHosts'] },
        },
        '/api/agent-hosts/fleet': {
          get: { summary: 'List online agentHosts in the fleet', operationId: 'getFleet', tags: ['AgentHosts'] },
        },
        '/api/telemetry/spans': {
          post: { summary: 'Ingest telemetry spans', operationId: 'ingestSpans', tags: ['Telemetry'] },
          get:  { summary: 'Query telemetry spans', operationId: 'querySpans', tags: ['Telemetry'] },
        },
        '/api/workflows': {
          post: { summary: 'Register a workflow', operationId: 'registerWorkflow', tags: ['Workflows'] },
          get:  { summary: 'List workflows', operationId: 'listWorkflows', tags: ['Workflows'] },
        },
        '/api/workflows/{id}/graph': {
          get: { summary: 'Get workflow dependency graph', operationId: 'getWorkflowGraph', tags: ['Workflows'] },
        },
        '/api/teams/memory': {
          post: { summary: 'Store a team memory entry', operationId: 'postTeamMemory', tags: ['Teams'] },
          get:  { summary: 'Get recent team memory entries', operationId: 'getTeamMemory', tags: ['Teams'] },
        },
      },
    };
    return c.json(doc);
  });

  // builderforceLLM — OpenAI-compatible multi-vendor LLM proxy (tenant or agentHost API key auth)
  app.route('/llm', createLlmRoutes());

  // Tenant "LLM" objects — named, reusable model configs selectable anywhere by
  // the ref `tenant_model:<slug>` (cloud agents, on-prem hosts, the Designer Brain).
  app.route('/api/llm/models', createTenantModelRoutes(db));

  // Shared (L2) semantic response cache — the web app and the agent runtime both
  // query it so a paraphrased answer from one surface is reusable by the other.
  app.route('/v1/semantic-cache', createSemanticCacheRoutes());

  // Marketplace (no JWT required for read, required for write)
  app.route('/marketplace', createMarketplaceRoutes(db));

  // Public workforce registry (browse published agents without login)
  app.route('/api/workforce', createWorkforceRoutes());

  // Signed vision attachments — public, but each object is gated by a short-lived
  // HMAC (?exp&sig minted at /api/brain/uploads/sign). Lets an upstream LLM
  // provider fetch an oversize image without the tenant JWT. No JWT here.
  app.route('/api/brain-files', createBrainFilesRoutes());

  // Published IDE (Designer) sites — public static hosting from R2. Served at
  // <sub>.builderforce.ai via the wildcard route; the path form
  // /api/sites/<sub>/... is the always-on fallback. No JWT (these are public websites).
  app.route('/api/sites', createSitesRoutes());

  // Public Developer API (Bearer <developer_api_key> for read-only; tenant JWT for key management)
  app.route('/api/v1', createPublicApiRoutes(db));

  // Payment webhooks — raw body required, no JWT, mounted before any body parsers
  app.route('/api/webhooks', createWebhookRoutes(tenantService, paymentProvider));

  // GitHub webhook — raw body required for HMAC verification, no JWT
  app.route('/api/webhooks', createGitHubWebhookRoutes(db, runtimeService));

  // Public workflow trigger entrypoints (webhook) — addressed by per-trigger
  // token, optional HMAC; no JWT. Mounted with the other public webhook routes.
  app.route('/api/workflow-triggers', createWorkflowTriggerRoutes(db));

  // Anonymous landing-prompt handoff: POST / is public (pre-auth); /claim applies
  // web-auth per-route so it can associate the row to the now-known user.
  app.route('/api/pending-prompts', createPendingPromptRoutes(db));

  // Public endpoints (no JWT required)
  app.route('/api/auth',    createAuthRoutes(authService, db));
  app.route('/api/auth',    createOAuthRoutes(db));

  // BuilderForce Agents instances + skill assignments (tenant JWT inside each router)
  app.route('/api/agent-hosts',            createAgentHostRoutes(db, agentHostService));
  // @deprecated back-compat aliases for the old CoderClaw "claw" routes. Field agents
  // built before the BuilderForce Agents rebrand still call /api/claws. Remove once the
  // deployed agent fleet has upgraded to the /api/agent-hosts paths (see Gap Register).
  app.route('/api/claws',                  createAgentHostRoutes(db, agentHostService));
  // @deprecated back-compat alias for the agent-runtime's relay client, which still
  // targets /api/agentNodes/:id/{upstream,heartbeat,assignment-context}. Without this
  // the periodic heartbeat 404s and lastSeenAt never refreshes — which the online-status
  // rule (domain/agentHost/onlineStatus.ts) reads as "offline after 15 min". Remove once
  // the runtime is repointed to /api/agent-hosts (see Gap Register).
  app.route('/api/agentNodes',             createAgentHostRoutes(db, agentHostService));
  app.route('/api/skill-assignments', createSkillAssignmentRoutes(db));
  app.route('/api/artifact-assignments', createArtifactAssignmentRoutes(db));
  app.route('/api/project-agents', createProjectAgentRoutes(db));
  app.route('/api/marketplace-stats', createMarketplaceStatsRoutes(db));
  app.route('/api/personas', createPersonaRoutes(db));

  // Chat persistence (agentHost-auth writes + tenant-JWT reads)
  app.route('/api', createChatRoutes(db));

  // Protected endpoints (JWT injected by authMiddleware inside each router)
  app.route('/api/projects', createProjectRoutes(projectService, db));
  app.route('/api/tasks',    createTaskRoutes(taskService, db, runtimeService));
  app.route('/api/vscode',   createVscodeRoutes(db, tenantService));
  app.route('/api/members',  createMemberRoutes(db));
  app.route('/api/tenants',  createTenantRoutes(tenantService, db));
  app.route('/api/segments', createSegmentRoutes(db));
  app.route('/api/embed',    createEmbedRoutes(db));
  app.route('/api/governance', createGovernanceRoutes(db));
  app.route('/api/product',  createProductRoutes(db));
  app.route('/api/agile',    createAgileRoutes(db));
  app.route('/api/roi',      createRoiRoutes(db));
  app.route('/api/bi',       createBiRoutes(db));
  // Cross-domain (channel-3) seams — server-to-server, scoped tenant API keys.
  app.route('/v1',           createSeamRoutes(db));
  app.route('/api/tenants/:tenantId/api-keys', createTenantApiKeyRoutes(db));
  app.route('/api/tenants/:tenantId/mcp-extensions', createMcpExtensionRoutes(db));
  app.route('/api/agents',   createAgentRoutes(agentService));
  app.route('/api/skills',   createSkillRoutes(agentService));
  app.route('/api/runtime',  createRuntimeRoutes(runtimeService, db));
  app.route('/api/audit',    createAuditRoutes(auditService));
  app.route('/api/admin',    createAdminRoutes());
  app.route('/api/specs',    createSpecRoutes(db));
  app.route('/api/workflows', createWorkflowRoutes(db));
  app.route('/api/workflow-definitions', createWorkflowDefinitionRoutes(db));
  app.route('/api/approvals',       createApprovalRoutes(db, runtimeService));
  app.route('/api/approval-rules',  createApprovalRuleRoutes(db));
  app.route('/api/telemetry',       createTelemetryRoutes(db));
  app.route('/api/qa',              createQaRoutes(db, taskService));
  app.route('/api/repo-analysis',   createRepoAnalysisRoutes(db, taskService));
  app.route('/api/studio/voice-clones', createStudioVoiceCloneRoutes(db));

  // Phase 6 — Dev Analytics & Team Intelligence
  app.route('/api/integrations',    createIntegrationRoutes(db, env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET));
  app.route('/api/contributors',    createContributorRoutes(db));
  app.route('/api/dev-teams',       createDevTeamRoutes(db));
  app.route('/api/reports',         createReportRoutes(db));
  app.route('/api/analytics',       createAnalyticsRoutes(db));
  app.route('/api/prompts',         createPromptLibraryRoutes(db));
  app.route('/api/managed-agent-hosts',   createManagedAgentHostRoutes(db));
  app.route('/api/managed-claws',          createManagedAgentHostRoutes(db)); // @deprecated back-compat alias
  app.route('/api/cost-forecast',   createCostForecastRoutes(db));
  app.route('/api/dashboard',       createDashboardRoutes(db));
  app.route('/api/brain',     createBrainRoutes(brainService, db));
  // Order matters: the team-memory mesh lives at the static /api/teams/memory and
  // MUST be registered before the Workforce Teams CRUD, whose GET /:id would
  // otherwise match "memory" as an id and shadow it (Hono runs the first-
  // registered matching handler — verified, static is NOT auto-prioritized).
  app.route('/api/teams/memory', createTeamMemoryRoutes(db));
  app.route('/api/teams',        createTeamRoutes(db));
  app.route('/api/ide',       createIdeRoutes());
  app.route('/api/ai',        createIdeAiRoutes(projectService));
  app.route('/api/studio',    createStudioRoutes());

  // Cloud Agent Boards
  app.route('/api/boards',            createBoardRoutes(db));
  app.route('/api/board-connections', createBoardConnectionRoutes(db));
  app.route('/api/board-webhooks',    createBoardWebhookRoutes(db));
  app.route('/api/prd',               createPrdRoutes(db));
  app.route('/api/repos',             createRepoRoutes(db));
  app.route('/api/agent-runtime',     createAgentRuntimeRoutes(db));
  app.route('/api/git-proxy',         createGitProxyRoutes(db));
  app.route('/api/agent-assignments', createAgentAssignmentRoutes(db));
  app.route('/api/security',          createSecurityReviewRoutes(db));

  app.onError(errorHandler);
  app.notFound((c) => addCorsToResponse(c, c.json({ error: 'Not found' }, 404)));

  return app;
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

/** Minimal shape of a Cloudflare Email Routing message — typed locally so the
 *  build doesn't require the email-message types to be installed. */
interface ForwardableEmailLike {
  readonly from: string;
  readonly to: string;
  readonly headers?: { get?: (name: string) => string | null };
  readonly raw?: unknown;
}

function optionCorsAllowOrigin(origin: string | null, corsOrigins: string | undefined): string {
  if (!origin) return '*';
  if (corsOrigins === '*') return '*';
  const allowed = (corsOrigins ?? 'https://builderforce.ai').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin) || DEV_ORIGINS.includes(origin)) return origin;
  return '*';
}

export default {
  /**
   * Cloudflare scheduled() handler — fires on cron triggers declared in
   * api/wrangler.toml `[triggers] crons`:
   *   - `0 9 * * *`  daily LLM vendor health probe (change-detected, email-quiet).
   *   - every-5-min tick: workflow-trigger sweep — fire due schedule + rss
   *     triggers, then advance any pending cloud-runtime workflows.
   *
   * Each branch is isolated so a failure in one can't poison the others. We key
   * off `event.cron` so the expensive vendor probe only runs on the daily tick.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 9 * * *') {
      ctx.waitUntil(
        runVendorHealthCron(env).catch((err) => {
          console.error('[cron:llm-health] failed', err);
        }),
      );
      // Daily retention purge of unbounded diagnostic/telemetry log tables
      // (llm_traces, llm_failover_log, llm_health_probes, qa_journey_events).
      ctx.waitUntil(
        runRetentionPurge(env).catch((err) => {
          console.error('[cron:retention] failed', err);
        }),
      );
    }
    // Trigger sweep + cloud executor run on the frequent tick. (Also run when no
    // cron string is supplied, e.g. a manual `wrangler` invocation.)
    if (event.cron !== '0 9 * * *') {
      ctx.waitUntil(
        runDueTriggers(env)
          .then(() => processPendingCloudWorkflows(env))
          .catch((err) => {
            console.error('[cron:wf-triggers] failed', err);
          }),
      );
      // Fail executions stranded in running/pending by a crashed host or dropped
      // dispatch, so stuck rows can't accumulate (no heartbeat timeout exists).
      ctx.waitUntil(
        reapStaleExecutions(env).catch((err) => {
          console.error('[cron:exec-reaper] failed', err);
        }),
      );
      // Redeliver failed outbound webhook deliveries with capped exponential
      // backoff (at-least-once semantics for the cross-domain seam events).
      ctx.waitUntil(
        runWebhookRetrySweep(env).catch((err) => {
          console.error('[cron:webhook-retry] failed', err);
        }),
      );
      // Poll active external board connections whose interval has elapsed +
      // drain their reverse-sync outbox (inbound polling + reliable writeback).
      ctx.waitUntil(
        runBoardSyncSweep(env).catch((err) => {
          console.error('[cron:board-sync] failed', err);
        }),
      );
      // Resume tickets parked on a run_workflow lane action whose spawned
      // workflow has now settled (advance on success / needs_attention on fail).
      ctx.waitUntil(
        runParkedWorkflowSweep(env).catch((err) => {
          console.error('[cron:wf-gate] failed', err);
        }),
      );
      // Agentic Tester scheduler — enqueue a heatmap-derived exploration for
      // every due qa_schedules row (the platform-native "run QA on a schedule"
      // surface; a runner claims the queued exploration).
      ctx.waitUntil(
        runQaExplorationSweep(env).catch((err) => {
          console.error('[cron:qa-sweep] failed', err);
        }),
      );
    }
  },

  /**
   * Cloudflare Email Routing handler — receives inbound mail for addressed
   * `inbound-email` workflow triggers (local-part = trigger token). Requires the
   * Email Routing binding to be provisioned (see Gap Register). Typed loosely so
   * the build doesn't depend on the email-types being present.
   */
  async email(message: ForwardableEmailLike, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        let text = '';
        try {
          if (message.raw) text = await new Response(message.raw as ReadableStream).text();
        } catch { /* best-effort body read */ }
        const result = await handleInboundEmail(env, {
          to: message.to,
          from: message.from,
          subject: message.headers?.get?.('subject') ?? undefined,
          text,
        });
        if (!result.ok) console.warn('[email:wf-trigger] not dispatched:', result.error);
      })().catch((err) => console.error('[email:wf-trigger] failed', err)),
    );
  },
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    // Handle OPTIONS without building the app so we never require NEON_DATABASE_URL for preflight.
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      const allow = optionCorsAllowOrigin(origin, env.CORS_ORIGINS);
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allow,
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          // SDK-emitted custom headers must be in this list or the browser
          // will block the preflight: `Idempotency-Key` (cron retries),
          // `X-Emulation-Token` (admin emulation flow), `X-AgentHost-Signature`
          // (agentHost-relay HMAC).
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key,X-Emulation-Token,X-AgentHost-Signature',
          // Echo the daily-budget snapshot headers so SDK consumers in the
          // browser can pre-emptively throttle without a second fetch.
          'Access-Control-Expose-Headers': 'x-request-id,x-builderforce-model,x-builderforce-retries,x-builderforce-product,x-builderforce-effective-plan,x-builderforce-daily-tokens-used,x-builderforce-daily-tokens-limit,x-builderforce-daily-tokens-remaining',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
