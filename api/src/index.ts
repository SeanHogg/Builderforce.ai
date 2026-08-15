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
import { r2ProjectStoragePurge } from './application/ide/projectStorage';
import { TaskService }     from './application/task/TaskService';
import { TaskType }        from './domain/shared/types';
import { llmEpicDecomposer } from './application/task/EpicDecomposer';
import { TenantService }   from './application/tenant/TenantService';
import { AuthService }     from './application/auth/AuthService';
import { AgentService }    from './application/agent/AgentService';
import { buildRuntimeService } from './buildRuntimeService';
import { recommendTopAssignee } from './application/metrics/assigneeRecommender';
import { addDependency } from './application/task/taskDependencies';
import { asProjectId } from './domain/shared/types';
import { bumpCacheVersion } from './infrastructure/cache/readThroughCache';
import { AuditService }    from './application/audit/AuditService';
import { AgentHostService }     from './application/agentHost/AgentHostService';

// Routes
import { createProjectRoutes }     from './presentation/routes/projectRoutes';
import { createTaskRoutes } from './presentation/routes/taskRoutes';
import { createManagerRoutes } from './presentation/routes/managerRoutes';
import { createVscodeRoutes } from './presentation/routes/vscodeRoutes';
import { setExecutionBoardSink }   from './application/runtime/executionEvents';
import { makeExecutionBoardSink }  from './application/runtime/executionBoardBroadcast';
import { createMemberRoutes }      from './presentation/routes/memberRoutes';
import { createTenantRoutes }      from './presentation/routes/tenantRoutes';
import { createSegmentRoutes }     from './presentation/routes/segmentRoutes';
import { createEmbedRoutes }       from './presentation/routes/embedRoutes';
import { createGovernanceRoutes }  from './presentation/routes/governanceRoutes';
import { createAgentOpsRoutes }    from './presentation/routes/agentOpsRoutes';
import { createProductRoutes }     from './presentation/routes/productRoutes';
import { createAgileRoutes }       from './presentation/routes/agileRoutes';
import { createMeetingRoutes }     from './presentation/routes/meetingRoutes';
import { createCandidateBookingRoutes } from './presentation/routes/candidateBookingRoutes';
import { createHiringRoutes }      from './presentation/routes/hiringRoutes';
import { createCalendarRoutes }    from './presentation/routes/calendarRoutes';
import { createRoiRoutes }         from './presentation/routes/roiRoutes';
import { createPmoRoutes }         from './presentation/routes/pmoRoutes';
import { createTimeRoutes }        from './presentation/routes/timeRoutes';
import { createInsightsRoutes }    from './presentation/routes/insightsRoutes';
import { createAiImpactRoutes }    from './presentation/routes/aiImpactRoutes';
import { createAutonomyRoutes }    from './presentation/routes/autonomyRoutes';
import { createBenchmarkingRoutes } from './presentation/routes/benchmarkingRoutes';
import { createRecommendationsRoutes } from './presentation/routes/recommendationsRoutes';
import { createDevexRoutes }       from './presentation/routes/devexRoutes';
import { createDashboardsRoutes }  from './presentation/routes/dashboardsRoutes';
import { createDashboardPinsRoutes } from './presentation/routes/dashboardPinsRoutes';
import { createFinopsRoutes }      from './presentation/routes/finopsRoutes';
import { createDeckRoutes }        from './presentation/routes/deckRoutes';
import { createExportRoutes }      from './presentation/routes/exportRoutes';
import { createAlertRoutes }       from './presentation/routes/alertRoutes';
import { createInnovationRoutes }  from './presentation/routes/innovationRoutes';
import { createSeamRoutes }        from './presentation/routes/seamRoutes';
import { createBiRoutes }          from './presentation/routes/biRoutes';
import { createTenantApiKeyRoutes } from './presentation/routes/tenantApiKeyRoutes';
import { createMcpExtensionRoutes } from './presentation/routes/mcpExtensionRoutes';
import { createAuthRoutes }        from './presentation/routes/authRoutes';
import { createOAuthRoutes }       from './presentation/routes/oauthRoutes';
import { createAgentRoutes, createSkillRoutes } from './presentation/routes/agentRoutes';
import { createAgentRegistrationRoutes } from './presentation/routes/agentRegistrationRoutes';
import { AgentRegistrationService } from './application/agent/AgentRegistrationService';
import { createRuntimeRoutes }     from './presentation/routes/runtimeRoutes';
import { createAuditRoutes }       from './presentation/routes/auditRoutes';
import { createMarketplaceRoutes } from './presentation/routes/marketplaceRoutes';
import { createToolRoutes } from './presentation/routes/toolRoutes';
import { createRfpRoutes } from './presentation/routes/rfpRoutes';
import { ToolService } from './application/tools/ToolService';
import { AuditRunner } from './application/tools/AuditRunner';
import { createMarketingRoutes } from './presentation/routes/marketingRoutes';
import { createGuestRoutes } from './presentation/routes/guestRoutes';
import { createDemoRoutes } from './presentation/routes/demoRoutes';
import { GuestChatService } from './application/guest/GuestChatService';
import { GuestPromptService } from './application/marketing/GuestPromptService';
import { PlatformBroadcastService } from './application/marketing/PlatformBroadcastService';
import { MarketingService } from './application/marketing/MarketingService';
import { createAgentHostRoutes }        from './presentation/routes/agentHostRoutes';
import { AgentHostRepository }          from './infrastructure/repositories/AgentHostRepository';
import { IAgentHostRepository }         from './domain/agentHost/IAgentHostRepository';
import { createSkillAssignmentRoutes } from './presentation/routes/skillAssignmentRoutes';
import { createArtifactAssignmentRoutes } from './presentation/routes/artifactAssignmentRoutes';
import { createProjectAgentRoutes } from './presentation/routes/projectAgentRoutes';
import { createMarketplaceStatsRoutes } from './presentation/routes/marketplaceStatsRoutes';
import { createWorkforceRoutes }        from './presentation/routes/workforceRoutes';
import { createFreelancerRoutes, createEngagementRoutes } from './presentation/routes/freelancerRoutes';
import { createSalesRoutes } from './presentation/routes/salesRoutes';
import { createMessageRoutes } from './presentation/routes/messageRoutes';
import { createPayoutRoutes } from './presentation/routes/payoutRoutes';
import { createActivityRoutes, createTimecardRoutes } from './presentation/routes/activityRoutes';
import { createObjectRoutes } from './presentation/routes/objectRoutes';
import { createDomainRoutes } from './presentation/routes/domainRoutes';
import { createObjectRegistry } from './application/kernel/ObjectRegistry';
import { createDomainService } from './application/kernel/DomainService';
import { createTeamRosterService } from './application/kernel/TeamRoster';
import { createEntityService } from './application/domains/EntityService';
import { createJobRoutes, createNotificationRoutes } from './presentation/routes/jobRoutes';
import { createEmailPreferenceRoutes } from './presentation/routes/emailPreferenceRoutes';
import { createAccountBrainPreferenceRoutes } from './presentation/routes/accountBrainPreferenceRoutes';
import { createReleaseNoteRoutes } from './presentation/routes/releaseNoteRoutes';
import { runReleaseDigest } from './application/email/releaseDigest';
import { createFreelancerMessagingRoutes } from './presentation/routes/freelancerMessagingRoutes';
import { createGigMarketplaceRoutes, createEngagementBoardRoutes, createDeliverableRoutes } from './presentation/routes/gigMarketplaceRoutes';
import { createLimbicRoutes }           from './presentation/routes/limbicRoutes';
import { createPersonaRoutes }          from './presentation/routes/personaRoutes';
import { createPersonalityRoutes }      from './presentation/routes/personalityRoutes';
import { createLlmRoutes }          from './presentation/routes/llmRoutes';
import { createMcpServerRoutes }    from './presentation/routes/mcpServerRoutes';
import { createTenantModelRoutes }  from './presentation/routes/tenantModelRoutes';
import { createSemanticCacheRoutes } from './presentation/routes/semanticCacheRoutes';
import { createAdminRoutes }        from './presentation/routes/adminRoutes';
import { createChatRoutes }         from './presentation/routes/chatRoutes';
import { createSpecRoutes }         from './presentation/routes/specRoutes';
import { createWorkflowRoutes }     from './presentation/routes/workflowRoutes';
import { createWorkflowDefinitionRoutes } from './presentation/routes/workflowDefinitionRoutes';
import { createCreationSessionRoutes } from './presentation/routes/creationSessionRoutes';
import { createPublicResumeRoutes } from './presentation/routes/publicResumeRoutes';
import { resolvePublicResume } from './application/creation/publicResumeProjection';
import { createCreativeRoutes } from './presentation/routes/creativeRoutes';
import { createWorkflowTriggerRoutes } from './presentation/routes/workflowTriggerRoutes';
import { createApprovalRoutes }     from './presentation/routes/approvalRoutes';
import { createApprovalRuleRoutes } from './presentation/routes/approvalRuleRoutes';
import { createPendingPromptRoutes } from './presentation/routes/pendingPromptRoutes';
import { createTelemetryRoutes }    from './presentation/routes/telemetryRoutes';
import { createQaRoutes }           from './presentation/routes/qaRoutes';
import { createRepoAnalysisRoutes } from './presentation/routes/repoAnalysisRoutes';
import { createStudioVoiceCloneRoutes } from './presentation/routes/studioVoiceCloneRoutes';
import { createIntegrationRoutes }  from './presentation/routes/integrationRoutes';
import { createIntegrationCatalogRoutes } from './presentation/routes/integrationCatalogRoutes';
import { createDataSourceRoutes }  from './presentation/routes/dataSourceRoutes';
import { createConnectorRoutes }    from './presentation/routes/connectorRoutes';
import { createContributorRoutes }  from './presentation/routes/contributorRoutes';
import { runRepoActivitySweep }      from './application/contributors/runRepoActivitySweep';
import { createDevTeamRoutes }      from './presentation/routes/devTeamRoutes';
import { createTeamRoutes }         from './presentation/routes/teamRoutes';
import { createReportRoutes } from './presentation/routes/reportRoutes';
import { createAnalyticsRoutes }    from './presentation/routes/analyticsRoutes';
import { createPromptLibraryRoutes } from './presentation/routes/promptLibraryRoutes';
import { createBrainRoutes }       from './presentation/routes/brainRoutes';
import { createBrainFilesRoutes }  from './presentation/routes/brainFilesRoutes';
import { createSitesRoutes, tryServeHostedSite } from './presentation/routes/sitesRoutes';
import { canonicalApexRedirect } from './application/ide/siteHosting';
import { createSiteManageRoutes } from './presentation/routes/siteManageRoutes';
import { createGrowthRoutes, createCampaignTrackRoutes, createMarketingAssetRoutes } from './presentation/routes/campaignRoutes';
import { createMailboxRoutes }      from './presentation/routes/mailboxRoutes';
import { createDriveRoutes }        from './presentation/routes/driveRoutes';
import { createSocialRoutes }       from './presentation/routes/socialRoutes';
import { createYouTubeRoutes }      from './presentation/routes/youtubeRoutes';
import { maybeHandlePreviewIngress } from './application/runtime/previewIngress';
import { createIdeRoutes }         from './presentation/routes/ideRoutes';
import { createCompileRoutes }     from './presentation/routes/compileRoutes';
import { createChallengeRoutes }   from './presentation/routes/challengeRoutes';
import { createRealizationRoutes } from './presentation/routes/realizationRoutes';
import { createBackendRuntimeRoutes } from './presentation/routes/backendRuntimeRoutes';
import { createProjectBackendRoutes } from './presentation/routes/projectBackendRoutes';
import { createGameRoutes } from './presentation/routes/gameRoutes';
import { createHooksRoutes }       from './presentation/routes/hooksRoutes';
import { createIdeProjectRoutes }  from './presentation/routes/ideProjectRoutes';
import { createIdeAiRoutes }       from './presentation/routes/ideAiRoutes';
import { BrainService }            from './application/brain/BrainService';
import { buildPaymentProvider }    from './infrastructure/payment';
import { createWebhookRoutes }     from './presentation/routes/webhookRoutes';
import { createManagedAgentHostRoutes }     from './presentation/routes/managedAgentHostRoutes';
import { createGitHubWebhookRoutes }   from './presentation/routes/githubWebhookRoutes';
import { createGitHubActionsRoutes }   from './presentation/routes/githubActionsRoutes';
import { createDeployRoutes }          from './presentation/routes/deployRoutes';
import { createGitLabWebhookRoutes }   from './presentation/routes/gitlabWebhookRoutes';
import { createBitbucketWebhookRoutes } from './presentation/routes/bitbucketWebhookRoutes';
import { createLtiRoutes } from './presentation/routes/ltiRoutes';
import { createCostForecastRoutes }    from './presentation/routes/costForecastRoutes';
import { createDashboardRoutes }       from './presentation/routes/dashboardRoutes';
import { createConsumptionRoutes }     from './presentation/routes/consumptionRoutes';
import { createEvalRoutes }            from './presentation/routes/evalRoutes';
import { createDatasetRoutes }         from './presentation/routes/datasetRoutes';
import { createTeamMemoryRoutes }      from './presentation/routes/teamMemoryRoutes';
import { createPublicApiRoutes }       from './presentation/routes/publicApiRoutes';
import { createStudioRoutes }          from './presentation/routes/studioWeightRoutes';
import { createEvermindModelRoutes }   from './presentation/routes/evermindModelRoutes';
import { createProjectEvermindRoutes, createProjectEvermindAgentRoutes }  from './presentation/routes/projectEvermindRoutes';
import { createProjectFactsRoutes, createProjectFactsAgentRoutes }  from './presentation/routes/projectFactsRoutes';
// Cloud Agent Boards — agentic swimlanes, external board sync, PRD versioning, multi-repo PRs
import { createBoardRoutes }           from './presentation/routes/boardRoutes';
import { createKanbanRoutes }          from './presentation/routes/kanbanRoutes';
import { createBoardConnectionRoutes } from './presentation/routes/boardConnectionRoutes';
import { createMigrationRoutes } from './presentation/routes/migrationRoutes';
import { createBoardWebhookRoutes }    from './presentation/routes/boardWebhookRoutes';
import { createQualityRoutes }         from './presentation/routes/qualityRoutes';
import { createFeedbackRoutes }        from './presentation/routes/feedbackRoutes';
import { createFeedbackIngestRoutes }  from './presentation/routes/feedbackIngestRoutes';
import { createQualityIngestRoutes }   from './presentation/routes/qualityIngestRoutes';
import { createPrdRoutes }             from './presentation/routes/prdRoutes';
import { createRepoRoutes }            from './presentation/routes/repoRoutes';
import { createAgentRuntimeRoutes }    from './presentation/routes/agentRuntimeRoutes';
import { createGitProxyRoutes }        from './presentation/routes/gitProxyRoutes';
import { createAgentAssignmentRoutes } from './presentation/routes/agentAssignmentRoutes';
import { createSecurityReviewRoutes } from './presentation/routes/securityReviewRoutes';
import { createKnowledgeRoutes } from './presentation/routes/knowledgeRoutes';
import { createKnowledgeMarketRoutes } from './presentation/routes/knowledgeMarketRoutes';
import { createCreationListingRoutes, createPublicListingRoutes } from './presentation/routes/creationListingRoutes';
import { createWebSearchRoutes } from './presentation/routes/webSearchRoutes';

import { API_VERSION } from './version';
import {
  OPENAPI_VERSION,
  OPENAPI_TITLE,
  OPENAPI_DESCRIPTION,
} from './openapi/schema';
import { evaluateCronGate, openCronTick } from './application/runtime/cronWorkSignal';
import { createTickDispatchBudget } from './application/runtime/tickDispatchBudget';
import { applyCronControls, readCronControls } from './application/runtime/cronControls';
// Every scheduled sweep is declared ONCE in cronSweeps.ts and invoked through the
// shared runner, so the cron handler below and the superadmin force-run route
// (POST /api/admin/cron/:target) can never drift. See cronSweepRunner.ts.
import { CRON_SWEEPS } from './cronSweeps';
import {
  cadenceForCron,
  dispatchCronSweeps,
  sweepsForCadence,
} from './application/runtime/cronSweepRunner';
import { createIncidentRoutes } from './presentation/routes/incidentRoutes';
import { createMonitoringRoutes } from './presentation/routes/monitoringRoutes';
import { createMonitorWebhookRoutes } from './presentation/routes/monitorWebhookRoutes';
import { handleInboundEmail } from './application/workflow/inboundEmail';
// ── Insights-everywhere + enterprise-lens extensions (integration batch) ──
import { createCatalogAnalyticsRoutes } from './presentation/routes/catalogAnalyticsRoutes';
import { createFactsRoutes } from './presentation/routes/factsRoutes';
import { createPromptAnalyzerRoutes } from './presentation/routes/promptAnalyzerRoutes';
import { createMemberPersonaRoutes } from './presentation/routes/memberPersonaRoutes';
import { createLensSnapshotRoutes } from './presentation/routes/lensSnapshotRoutes';
import { createWorkforcePlanRoutes } from './presentation/routes/workforcePlanRoutes';
import { createEmpFeatureRoutes } from './presentation/routes/empFeatureRoutes';
import { createReleasesRoutes } from './presentation/routes/releasesRoutes';
import { createPulseRoutes } from './presentation/routes/pulseRoutes';
import { createEmpFinopsRoutes } from './presentation/routes/empFinopsRoutes';
import { createEmpMetricsRoutes } from './presentation/routes/empMetricsRoutes';
import { createForecastRoutes } from './presentation/routes/forecastRoutes';

// Middleware
import { addCorsToResponse, corsMiddleware, EXPOSED_HEADERS, ALLOWED_REQUEST_HEADERS } from './presentation/middleware/cors';
import { errorHandler }   from './presentation/middleware/errorHandler';
import { rateLimitMiddleware } from './presentation/middleware/rateLimitMiddleware';
import { emulationMiddleware } from './presentation/middleware/emulationMiddleware';
import {
  reportCaughtError,
  reportUnhandledError,
  configureCaughtErrorReporter,
  runWithCaughtErrorContext,
} from './application/observability/caughtErrorReporter';
import { persistCaughtError } from './infrastructure/observability/persistCaughtError';

configureCaughtErrorReporter(persistCaughtError);

// Durable Objects (must be re-exported so the Workers runtime can instantiate them)
export { AgentHostRelayDO } from './infrastructure/relay/AgentHostRelayDO';
export { SessionRoomDO } from './infrastructure/relay/SessionRoomDO';
export { CeremonyRoomDO } from './infrastructure/relay/CeremonyRoomDO';
export { GuestRoomDO } from './infrastructure/relay/GuestRoomDO';
export { AnalysisRunnerDO } from './infrastructure/relay/AnalysisRunnerDO';
export { CloudRunnerDO } from './infrastructure/relay/CloudRunnerDO';
export { ProjectEvermindCoordinatorDO } from './infrastructure/relay/ProjectEvermindCoordinatorDO';
export { AgentContainerDO } from './infrastructure/relay/AgentContainerDO';
export { QaRunnerContainerDO } from './infrastructure/relay/QaRunnerContainerDO';
export { TenantRateLimiterDO } from './infrastructure/ratelimit/TenantRateLimiterDO';

// ---------------------------------------------------------------------------
// Composition root: build the full Hono app for a single request,
// injecting the concrete infrastructure implementations.
// ---------------------------------------------------------------------------

// Exported so the in-process MCP catalog can replay platform actions through the
// real /api routes (reusing their logic + role-gate authz) via `app.request(...)`.
// Imported dynamically by the catalog to avoid a static import cycle.
export function buildApp(env: Env): Hono<HonoEnv> {
  const db = buildDatabase(env);

  // --- Infrastructure ---
  const projectRepo   = new ProjectRepository(db);
  const taskRepo      = new TaskRepository(db);
  const tenantRepo    = new TenantRepository(db);
  const userRepo      = new UserRepository(db);
  const agentRepo     = new AgentRepository(db);
  const skillRepo      = new SkillRepository(db);
  const auditRepo     = new AuditRepository(db, env);
  const agentHostRepo      = new AgentHostRepository(db);

  // --- Payments (Stripe only; missing secrets fail per-route, never at boot) ---
  const paymentProvider = buildPaymentProvider(env);

  // --- Application ---
  const projectService  = new ProjectService(projectRepo, taskRepo, r2ProjectStoragePurge(env));
  const taskService     = new TaskService(taskRepo, projectRepo, llmEpicDecomposer(env),
    (projectId, roleKey) => recommendTopAssignee(env, db, projectId, roleKey ? { roleKey } : {}),
    // Epic fan-out records its planned SEQUENCE as real precedence edges, through the
    // same validated writer (DAG guard, same-project check) the REST/MCP paths use —
    // a decomposition's order is data, not a detail of the plan that produced it.
    async (projectId, predecessorTaskId, successorTaskId) => {
      const project = await projectRepo.findById(asProjectId(projectId));
      if (!project) return;
      const result = await addDependency(db, project.tenantId as number, successorTaskId, predecessorTaskId);
      if (result.ok) await bumpCacheVersion(env, `task-deps-version:project:${projectId}`).catch((error) => {
        reportCaughtError(error, { source: "index.ts", operation: "taskService" });
      });
    });
  const tenantService   = new TenantService(tenantRepo, paymentProvider, env);
  const toolService     = new ToolService(db);
  const auditRunner     = new AuditRunner(db, toolService, taskService);
  const marketingService = new MarketingService(db);
  const guestChatService = new GuestChatService(db);
  const guestPromptService = new GuestPromptService(db);
  const platformBroadcastService = new PlatformBroadcastService(db);
  const authService     = new AuthService(userRepo, tenantRepo, auditRepo, env.JWT_SECRET);
  const agentService    = new AgentService(agentRepo, skillRepo);
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

  app.use('*', (c, next) => runWithCaughtErrorContext({
    env: c.env,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    waitUntil: (task) => c.executionCtx.waitUntil(task),
  }, next));

  app.use('*', corsMiddleware);

  // Live container-preview ingress (Replit-parity phase 2, flag-gated). A request on
  // `preview.builderforce.ai` is proxied (HTTP + WebSocket) through the run's container
  // DO to a dev server it started. Inert (404) unless PREVIEW_INGRESS_ENABLED is set —
  // runs BEFORE site-hosting so the reserved `preview` label reaches the proxy, not R2.
  app.use('*', async (c, next) => {
    const res = await maybeHandlePreviewIngress(c.env, c.req.raw);
    if (res) return res;
    return next();
  });

  // Canonical-host redirect. The greedy `*.builderforce.ai/*` route delivers
  // hostnames owned by OTHER workers to this one — a Custom Domain does not
  // reliably beat a wildcard zone route — so `www.builderforce.ai` landed here
  // and 404'd as JSON instead of serving the frontend. Runs before site hosting
  // so a reserved alias never reaches an R2 lookup. See canonicalApexRedirect.
  app.use('*', async (c, next) => {
    const redirect = canonicalApexRedirect(c.req.raw);
    if (redirect) return redirect;
    return next();
  });

  // Published-site hosting: a request whose Host is a `<sub>.builderforce.ai`
  // hosting subdomain (delivered by the worker's wildcard route) is served
  // straight from R2 as a public website — it never touches the API routers or
  // auth. Reserved/platform hosts (api.builderforce.ai, www, …) return null from
  // subdomainFromHost and fall through to next() and normal routing.
  app.use('*', async (c, next) => {
    // `executionCtx` is unavailable in some test harnesses; without it the
    // traffic flush is awaited inline rather than skipped, so a request is
    // never served uncounted.
    let waitUntil: ((p: Promise<unknown>) => void) | undefined;
    try {
      const ctx = c.executionCtx;
      waitUntil = (p) => ctx.waitUntil(p);
    } catch {
      waitUntil = undefined;
    }
    const res = await tryServeHostedSite(c.env, c.req.raw, waitUntil);
    if (res) return res;
    return next();
  });

  // Rate limiting applied after auth middleware resolves tenantId
  app.use('/api/*', rateLimitMiddleware as Parameters<typeof app.use>[1]);
  // The metered LLM gateway (`/llm/*`) and the public `/v1/*` surface (seam +
  // semantic cache) carry per-tenant billable traffic just like `/api/*`, so they
  // get the same per-tenant sliding-window limit. Mounted BEFORE their routers
  // (app.route('/llm'|'/v1', …) below) so every gateway path is throttled. The
  // middleware resolves the tenant from the machine-key/JWT bearer and falls
  // through for anonymous callers, so intentionally-public paths stay unlimited.
  app.use('/llm/*', rateLimitMiddleware as Parameters<typeof app.use>[1]);
  app.use('/v1/*',  rateLimitMiddleware as Parameters<typeof app.use>[1]);
  // The remote MCP server runs the same billable tools as /v1/mcp/call, and is
  // reachable by any third-party MCP client, so it takes the same limit.
  app.use('/mcp',   rateLimitMiddleware as Parameters<typeof app.use>[1]);
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
      servers: [
        { url: 'https://builderforce.ai/gateway', description: 'Production (primary domain — one whitelisted host for all traffic; prefer this)' },
        { url: 'https://api.builderforce.ai', description: 'Production (direct API subdomain)' },
      ],
      paths: {
        '/api/agent-registrations': {
          get: { summary: 'List canonical agent registrations', operationId: 'listAgentRegistrations', tags: ['Agents'] },
          post: { summary: 'Register an agent runtime', operationId: 'registerAgent', tags: ['Agents'] },
        },
        '/api/agent-registrations/frameworks': {
          get: { summary: 'List supported frameworks and protocols', operationId: 'listAgentFrameworks', tags: ['Agents'] },
        },
        '/api/agent-registrations/{id}/capabilities': {
          post: { summary: 'Report discovered agent capabilities and health', operationId: 'reportAgentCapabilities', tags: ['Agents'] },
        },
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

  // The callback surface a self-hosted backend uses. Authenticated by the same
  // tenant API key its model calls carry, NOT by a user JWT — the caller is a
  // Lambda / Cloud Run / Function App, not a browser.
  app.route('/api/backend-runtime', createBackendRuntimeRoutes(db));

  // Marketplace (no JWT required for read, required for write)
  app.route('/marketplace', createMarketplaceRoutes(db));

  // Public workforce registry (browse published agents without login)
  app.route('/api/workforce', createWorkforceRoutes());

  // Freelance worker marketplace: for-hire human profiles (public browse without
  // login for public profiles), cross-tenant engagements (hire/interview/terminate),
  // and the activity-signal → billable-timecard pipeline.
  app.route('/api/freelancers', createFreelancerRoutes());
  app.route('/api/sales', createSalesRoutes(db));
  // Person-to-person messaging (the sales hub's communication channel). Sits
  // beside /api/sales rather than inside it because the threads are the kernel's,
  // not the CRM's — sales is only the first audience with a reason to use them.
  app.route('/api/messages', createMessageRoutes(db));
  app.route('/api/engagements', createEngagementRoutes(db));
  app.route('/api/activity', createActivityRoutes(db));
  // LTI 1.3: the LMS-facing half of the teaching vocabulary — a signed launch, the
  // roster coming in through NRPS and marks going back through AGS. Unauthenticated
  // by design: every endpoint authenticates the PLATFORM cryptographically rather
  // than carrying a Builderforce session, which is what an LMS launch is.
  app.route('/api/lti', createLtiRoutes());

  // Anonymous guest routes must precede the generic `/api/:domain/...` router
  // below. That router installs auth middleware at its mount root, so registering
  // it first intercepts `/api/guest/*` before route-shape validation and turns
  // room creation, invite joins, and WebSocket upgrades into tenant-auth 401s.
  app.route('/api/guest', createGuestRoutes(guestChatService, guestPromptService, platformBroadcastService));

  // ── The kernel, exposed ONCE (PRD 20 §6.3) ────────────────────────────────
  //
  // `/api/objects/:id` and its five relations replace the six-to-forty
  // per-subsystem copies of each: one timeline endpoint, one comment thread, one
  // member list, one share sheet with one revocation path, one revision history.
  // `/api/<domain>` is the roster as a route surface — fifteen groups, one per
  // seat, each answering the same four questions so a surface can be built once.
  //
  // Both take an application-layer PORT rather than a database: `src/index.ts` is
  // outside the presentation layer, so this is where the connection is bound to
  // the use cases and the route files stay free of `src/infrastructure`.
  app.route('/api/objects', createObjectRoutes(createObjectRegistry(db, env)));
  app.route('/api/timecards', createTimecardRoutes());
  // Two-sided marketplace: job postings + proposals (bidding) and the in-app feed.
  app.route('/api/jobs', createJobRoutes());
  // The Recruiter seat: funnel conversion, candidate self-schedule links, lawful basis
  // and retention, and aggregate diversity reporting.
  app.route('/api/hiring', createHiringRoutes(db));
  app.route('/api/notifications', createNotificationRoutes());

  // Email language + consent. The /unsubscribe leg is intentionally PUBLIC (no
  // session) — it is the CAN-SPAM opt-out link carried in every lifecycle mail.
  app.route('/api/email-preferences', createEmailPreferenceRoutes(db));
  app.route('/api/account/brain-preferences', createAccountBrainPreferenceRoutes(db));
  // Platform release notes — public published changelog (footer "What's new"
  // panel) + superadmin authoring + manual weekly-digest trigger.
  app.route('/api/release-notes', createReleaseNoteRoutes(db));
  // Gig Marketplace (0293): publish a ticket as a gig, a hired freelancer's scoped
  // board access, and deliverable proposals the employer AI-evaluates.
  app.route('/api/marketplace', createGigMarketplaceRoutes());
  app.route('/api/engagement-board', createEngagementBoardRoutes(db));
  app.route('/api/deliverables', createDeliverableRoutes(db));
  // In-platform messaging (0298): employer<->freelancer threads scoped to an
  // engagement / job / proposal, with attachments + notification-fed unread counts.
  app.route('/api/conversations', createFreelancerMessagingRoutes());

  // Limbic affective layer — serves the shared compiler's directive block to
  // clients that can't bundle it (the VS Code built-in agent).
  app.route('/api/limbic', createLimbicRoutes(db));

  // Diagnostics & Tools — list/get/compute are public (free preview);
  // save/runs apply auth + manager role inside the router.
  app.route('/api/tools', createToolRoutes(toolService, auditRunner, db, runtimeService));
  // RFP / RFQ Response — pre-sales proposal generation (PRD 15). Reuses the diagnostics
  // scan (freshness gate) + audit runner (re-scan) grounded in the same toolService.
  app.route('/api/rfp', createRfpRoutes(db, toolService, auditRunner));
  app.route('/api/marketing', createMarketingRoutes(marketingService));
  // Sales-cycle demo accounts — public one-click persona demo sessions, funnel
  // telemetry, book-a-demo leads, and the (guarded) deploy-hook reseed.
  app.route('/api/demo', createDemoRoutes());

  // Signed vision attachments — public, but each object is gated by a short-lived
  // HMAC (?exp&sig minted at /api/brain/uploads/sign). Lets an upstream LLM
  // provider fetch an oversize image without the tenant JWT. No JWT here.
  app.route('/api/brain-files', createBrainFilesRoutes());

  // Monitor-signal webhooks — public, gated per-monitor by a secret token; the
  // tenant is resolved from the monitor row. External monitoring tools POST breach/
  // heartbeat signals here. No tenant JWT.
  app.route('/api/monitor-webhooks', createMonitorWebhookRoutes(db));

  // Published IDE (Designer) sites — public static hosting from R2. Served at
  // <sub>.builderforce.ai via the wildcard route; the path form
  // /api/sites/<sub>/... is the always-on fallback. No JWT (these are public websites).
  // Project backend ingress — where a provider's webhook lands (an inbound SMS,
  // an IVR leg on a live call, a delivery-status callback). Public by necessity:
  // Twilio cannot present a session. Authentication is per MESSAGE — each handler
  // declares how its caller is proved and an unverified request never runs a step.
  // The token in the path only prevents enumeration. See hooksRoutes.ts.
  app.route('/hooks', createHooksRoutes(db));

  app.route('/api/sites', createSitesRoutes());

  // Campaign open / click / unsubscribe. Hit by a recipient's MAIL CLIENT, so it
  // is mounted here with the other unauthenticated public surfaces — the only
  // credential is the unguessable per-recipient token in the path.
  app.route('/api/campaign-track', createCampaignTrackRoutes(db));

  // Campaign logos and images. Also hit by a recipient's mail client — an image
  // behind authMiddleware renders as a broken box in every inbox — so it is
  // public and addressed only by the asset's unguessable token.
  app.route('/api/campaign-assets', createMarketingAssetRoutes(db));

  // Candidate self-scheduling. Opened by a CANDIDATE, who has no account and should not
  // be asked to make one to pick an interview time — the requirement that kept interview
  // scheduling a manual email thread while a correct availability solver sat unused with
  // one internal consumer. The only credential is the unguessable token in the path, and
  // it resolves to exactly one interview's offered slots.
  app.route('/api/booking', createCandidateBookingRoutes(db));

  // Public Developer API (Bearer <developer_api_key> for read-only; tenant JWT for key management)
  app.route('/api/v1', createPublicApiRoutes(db));

  // Payment webhooks — raw body required, no JWT, mounted before any body parsers
  app.route('/api/webhooks', createWebhookRoutes(tenantService, paymentProvider));

  // GitHub webhook — raw body required for HMAC verification, no JWT
  app.route('/api/webhooks', createGitHubWebhookRoutes(db, runtimeService));
  // The GitHub Actions execution surface: the runner script it downloads, and the
  // OIDC-authenticated op callback it drives the agent loop through. Deliberately
  // NOT under authMiddleware — an Actions runner has no tenant JWT; it proves
  // identity with a short-lived GitHub OIDC token instead (see the route file).
  app.route('/api/runtime/github-actions', createGitHubActionsRoutes(db, runtimeService));

  // GitHub Actions deploy ingress — no JWT: a CI runner has no tenant token.
  // Authenticated by a GitHub OIDC token (which repo is calling) and authorized
  // by the repo↔project binding. See deployRoutes.ts.
  app.route('/api/deploy', createDeployRoutes());

  // GitLab + Bitbucket webhooks — ingest commits/MRs/PRs/issues into activity_events
  // (token / HMAC verified), the live twins of the cron poller, AND feed pipeline /
  // build-status results into the same CI → auto-fix loop as GitHub.
  app.route('/api/webhooks', createGitLabWebhookRoutes(db, runtimeService));
  app.route('/api/webhooks', createBitbucketWebhookRoutes(db, runtimeService));

  // Public workflow trigger entrypoints (webhook) — addressed by per-trigger
  // token, optional HMAC; no JWT. Mounted with the other public webhook routes.
  app.route('/api/workflow-triggers', createWorkflowTriggerRoutes(db));

  // Public Quality error ingest — keyed (bfq_ ingest key) or HMAC-signed webhooks;
  // no JWT. Tenant/project are resolved from the credential, never the request.
  app.route('/api/quality-ingest', createQualityIngestRoutes(db));

  // Public Product Feedback ingest — keyed (bff_ ingest key); no JWT. The
  // embeddable feedback snippet posts here from any application that carries it.
  app.route('/api/feedback-ingest', createFeedbackIngestRoutes(db));

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
  // Personality LEARNING + TRACKING (Gaps 6 & 7) — usage events + outcome-driven
  // trait reinforcement (propose/apply/dismiss). Reinforcement reads real run
  // outcomes (run_model_outcomes) so a suggestion is LIVE from real data.
  app.route('/api/personality', createPersonalityRoutes(db));

  // Chat persistence (agentHost-auth writes + tenant-JWT reads)
  app.route('/api', createChatRoutes(db));

  // Protected endpoints (JWT injected by authMiddleware inside each router)
  app.route('/api/projects', createProjectRoutes(projectService, db));
  app.route('/api/tasks',    createTaskRoutes(taskService, db, runtimeService));
  app.route('/api/kanban',   createKanbanRoutes(db, async (args) => {
    // Materialize a participation-manifest work item as a child task (%-complete rollup).
    const child = await taskService.createTask({
      projectId: args.projectId, title: args.title, taskType: TaskType.TASK, parentTaskId: args.parentTaskId,
      assignedAgentRef: args.assignedAgentRef ?? null, assignedUserId: args.assignedUserId ?? null,
    }, args.tenantId);
    return { id: Number(child.id) };
  }));
  // The Manager surface owns an accountability CHAT (0376), so it needs the Brain
  // service — the chat is an ordinary Brain chat and the manager answers through the
  // ordinary addressed-agent reply loop, rather than a second conversation system.
  app.route('/api/manager',  createManagerRoutes(db, runtimeService, brainService));
  app.route('/api/vscode',   createVscodeRoutes(db, tenantService));
  app.route('/api/members',  createMemberRoutes(db));
  app.route('/api/tenants',  createTenantRoutes(tenantService, db));
  app.route('/api/segments', createSegmentRoutes(db));
  app.route('/api/embed',    createEmbedRoutes(db));
  app.route('/api/governance', createGovernanceRoutes(db));
  // Agent Ops: coordination (leases + blackboard), memory governance, rehearsal (0370-0372).
  app.route('/api/agent-ops',  createAgentOpsRoutes(db));
  app.route('/api/product',  createProductRoutes(db));
  app.route('/api/agile',    createAgileRoutes(db));
  // Live video/audio collaboration: meetings (WebRTC mesh + scheduling) and the
  // per-user calendar connections that back scheduling.
  app.route('/api/meetings', createMeetingRoutes(db));
  app.route('/api/calendar', createCalendarRoutes(db));
  // Connected mailboxes (Microsoft 365 / Gmail) — the inbox the canvas renders
  // and the identity a campaign can send from.
  app.route('/api/mailbox',  createMailboxRoutes(db));
  app.route('/api/drive',    createDriveRoutes(db));
  // Where an earner's money goes — the sixth connection port, same shape as the
  // two above it (consent or a typed credential, sealed, with a reconnect state).
  app.route('/api/payouts',  createPayoutRoutes(db));
  // Connected social accounts — the feed the canvas renders and the accounts a
  // social campaign publishes to. Accounts themselves are connector connections,
  // so connecting one still happens through /api/connectors.
  app.route('/api/social',   createSocialRoutes(db));
  app.route('/api/youtube',  createYouTubeRoutes(db));
  app.route('/api/roi',      createRoiRoutes(db));
  app.route('/api/pmo',      createPmoRoutes(db));
  app.route('/api/time',     createTimeRoutes(db));
  app.route('/api/insights',   createInsightsRoutes(db));
  // Additional insight lenses (each is its own router mounted on the same prefix;
  // Hono merges them — distinct subpaths, each carries its own authMiddleware).
  app.route('/api/insights',   createAiImpactRoutes(db));
  app.route('/api/insights',   createAutonomyRoutes(db));
  app.route('/api/insights',   createBenchmarkingRoutes(db));
  app.route('/api/insights',   createRecommendationsRoutes(db));
  app.route('/api/devex',      createDevexRoutes(db));
  app.route('/api/dashboards', createDashboardsRoutes(db));
  app.route('/api/dashboard-pins', createDashboardPinsRoutes(db));
  app.route('/api/finops',     createFinopsRoutes(db));
  app.route('/api/decks',      createDeckRoutes(db));
  app.route('/api/exports',    createExportRoutes());
  app.route('/api/alerts',     createAlertRoutes(db));
  app.route('/api/innovation', createInnovationRoutes(db));
  app.route('/api/bi',       createBiRoutes(db));
  // Cross-domain (channel-3) seams — server-to-server, scoped tenant API keys.
  app.route('/v1',           createSeamRoutes(db));
  // Builderforce as a standard remote MCP server (JSON-RPC 2.0 / Streamable HTTP,
  // stateless). This is the endpoint third-party MCP clients and marketplaces
  // (Anthropic Connectors, AWS AI Agents & Tools, Gemini Enterprise) consume; it
  // shares its catalog and dispatch with /v1/mcp/* via `mcpGateway`.
  app.route('/mcp',          createMcpServerRoutes());
  app.route('/api/tenants/:tenantId/api-keys', createTenantApiKeyRoutes(db));
  app.route('/api/tenants/:tenantId/mcp-extensions', createMcpExtensionRoutes(db));
  app.route('/api/agents',   createAgentRoutes(agentService));
  app.route('/api/agent-registrations', createAgentRegistrationRoutes(new AgentRegistrationService(db, auditRepo)));
  app.route('/api/skills',   createSkillRoutes(agentService));
  app.route('/api/runtime',  createRuntimeRoutes(runtimeService, db));
  app.route('/api/audit',    createAuditRoutes(auditService));
  app.route('/api/admin',    createAdminRoutes());
  app.route('/api/specs',    createSpecRoutes(db));
  // Canonical spec subresources. The legacy /api/prd/specs/* mount below stays as
  // a compatibility entry point while canvas and extension clients migrate.
  app.route('/api/specs',    createPrdRoutes(db, ''));
  app.route('/api/workflows', createWorkflowRoutes(db));
  app.route('/api/workflow-definitions', createWorkflowDefinitionRoutes(db));
  app.route('/api/creation-sessions', createCreationSessionRoutes(db));
  app.route('/api/public/resumes', createPublicResumeRoutes((token) => resolvePublicResume(db, token)));
  app.route('/api/approvals',       createApprovalRoutes(db, runtimeService));
  app.route('/api/approval-rules',  createApprovalRuleRoutes(db));
  app.route('/api/telemetry',       createTelemetryRoutes(db));
  app.route('/api/qa',              createQaRoutes(db, taskService, runtimeService));
  app.route('/api/repo-analysis',   createRepoAnalysisRoutes(db, taskService));
  app.route('/api/studio/voice-clones', createStudioVoiceCloneRoutes(db));

  // Phase 6 — Dev Analytics & Team Intelligence
  // Public integration catalog — the projection the marketing page renders.
  // Registered FIRST so the literal `catalog` segment wins over `/:id` in the
  // authenticated router below.
  app.route('/api/integrations/catalog', createIntegrationCatalogRoutes());
  app.route('/api/integrations',    createIntegrationRoutes(db, env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET));
  // The canvas's read-only view of the SAME connected warehouses — list, schema,
  // and one bounded SELECT. Same credential store, same encryption secret.
  app.route('/api/data-sources',    createDataSourceRoutes(db, env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET));
  app.route('/api/connectors',      createConnectorRoutes(db));
  app.route('/api/contributors',    createContributorRoutes(db));
  app.route('/api/dev-teams',       createDevTeamRoutes(db));
  app.route('/api/reports',         createReportRoutes(db));
  app.route('/api/analytics',       createAnalyticsRoutes(db));
  app.route('/api/prompts',         createPromptLibraryRoutes(db));
  // ── Insights-everywhere + enterprise-lens extensions (integration batch) ──
  app.route('/api/members',           createEmpMetricsRoutes(db));       // EMP-12..20 member metrics
  app.route('/api/member-personas',   createMemberPersonaRoutes(db));    // persona-role 2D RBAC
  app.route('/api/insights',          createLensSnapshotRoutes(db));     // annual-calendar lens snapshots
  app.route('/api/insights',          createEmpFeatureRoutes(db));       // cross-team benchmark, delay taxonomy, export
  app.route('/api/workforce',         createWorkforcePlanRoutes(db));    // blended human+agent workforce planning
  app.route('/api/finops',            createEmpFinopsRoutes(db));        // R&D derived-vs-reported reconciliation
  app.route('/api/releases',          createReleasesRoutes(db));         // EMP-10a release picker
  app.route('/api/pulse',             createPulseRoutes(db));            // EMP-15 pulse survey
  app.route('/api/catalog-analytics', createCatalogAnalyticsRoutes(db)); // catalog adoption trends
  app.route('/api/facts',             createFactsRoutes(db));            // FACTS library
  app.route('/api/prompt-analyzer',   createPromptAnalyzerRoutes(db));   // prompt telemetry → improved version
  app.route('/api/insights',          createForecastRoutes(db));         // forecasting + anomaly lens
  app.route('/api/managed-agent-hosts',   createManagedAgentHostRoutes(db));
  app.route('/api/managed-claws',          createManagedAgentHostRoutes(db)); // @deprecated back-compat alias
  app.route('/api/cost-forecast',   createCostForecastRoutes(db));
  app.route('/api/dashboard',       createDashboardRoutes(db));
  app.route('/api/consumption',     createConsumptionRoutes(db));
  app.route('/api/eval',            createEvalRoutes(db));
  app.route('/api/dataset',         createDatasetRoutes(db));
  app.route('/api/brain',     createBrainRoutes(brainService, db));
  // Owned web corpus: crawl/frontier/index administration plus authenticated search.
  app.route('/api/search',    createWebSearchRoutes(db));
  // Order matters: the team-memory mesh lives at the static /api/teams/memory and
  // MUST be registered before the Workforce Teams CRUD, whose GET /:id would
  // otherwise match "memory" as an id and shadow it (Hono runs the first-
  // registered matching handler — verified, static is NOT auto-prioritized).
  app.route('/api/teams/memory', createTeamMemoryRoutes(db));
  app.route('/api/teams',        createTeamRoutes(db));
  app.route('/api/ide',       createIdeRoutes());
  app.route('/api/compile',   createCompileRoutes(db, runtimeService));
  // Paste a brief (a contest, an RFP, a hackathon prompt) → extracted requirements,
  // a matched blueprint, a plan, and — on an explicit second call — a built project.
  app.route('/api/challenges', createChallengeRoutes(db, runtimeService));
  // Idea → REAL. Eight proof forms (demo video, clickable prototype, smoke test,
  // wizard-of-oz, proof of concept, pilot, phone line, live system), each built,
  // published to a URL and wired to its own forms. See application/realization.
  app.route('/api/realizations', createRealizationRoutes(db, runtimeService));
  // Operating a project's server-side half: hosting strategy, live handlers, the
  // per-project secret vault, and the inbound-delivery log.
  app.route('/api/projects',  createProjectBackendRoutes(db));
  // Shipping a canvas-authored game to somewhere it can actually be PLAYED: a
  // sandboxed frame, an installable web app on a phone, a real APK or iOS build,
  // or a Roblox place. See application/game/gameTarget.ts.
  app.route('/api/projects',  createGameRoutes(db));
  app.route('/api/ide-projects', createIdeProjectRoutes(projectService, db));
  app.route('/api/ai',        createIdeAiRoutes(projectService));
  app.route('/api/studio/models', createEvermindModelRoutes(db));
  // Creative generation — the generator Canvas's `creative.*` capabilities name.
  // Geometry kinds are authored as a parametric spec and evaluated server-side;
  // text kinds are authored directly and shape-checked. Free pool only.
  app.route('/api/creative', createCreativeRoutes());
  app.route('/api/projects',  createProjectEvermindRoutes(db));
  app.route('/api/agent/projects', createProjectEvermindAgentRoutes(db));
  app.route('/api/projects',  createProjectFactsRoutes(db));
  app.route('/api/agent/projects', createProjectFactsAgentRoutes(db));
  app.route('/api/studio',    createStudioRoutes());

  // Owner-side control of a published site: custom domain, form collections and
  // their submissions, and the traffic rollup (migration 0412).
  app.route('/api/projects',  createSiteManageRoutes(db));
  // Tenant marketing — audiences, verified senders, campaigns, sending. Mounted
  // at /api/growth, NOT /api/marketing: that prefix already belongs to our own
  // marketing-site visitor telemetry (marketingRoutes.ts), whose `/track`
  // endpoint is deliberately anonymous and must not inherit this router's
  // authMiddleware.
  app.route('/api/growth', createGrowthRoutes(db));

  // Cloud Agent Boards
  app.route('/api/boards',            createBoardRoutes(db));
  app.route('/api/board-connections', createBoardConnectionRoutes(db));
  app.route('/api/board-webhooks',    createBoardWebhookRoutes(db));
  // Platform migration / import wizard (Jira/Monday/Rally/GitLab/Bitbucket → BF).
  app.route('/api/migrations',        createMigrationRoutes(db, env));
  // Product Quality / error observability (tenant JWT) — error groups + fix dispatch.
  app.route('/api/quality',           createQualityRoutes(db, taskService, runtimeService));
  app.route('/api/feedback',          createFeedbackRoutes(db));
  app.route('/api/prd',               createPrdRoutes(db));
  app.route('/api/repos',             createRepoRoutes(db));
  app.route('/api/agent-runtime',     createAgentRuntimeRoutes(db));
  app.route('/api/git-proxy',         createGitProxyRoutes(db));
  app.route('/api/agent-assignments', createAgentAssignmentRoutes(db));
  app.route('/api/security',          createSecurityReviewRoutes(db));
  app.route('/api/incidents',         createIncidentRoutes(db));
  app.route('/api/monitoring',        createMonitoringRoutes(db));
  app.route('/api/knowledge',         createKnowledgeRoutes(db));
  app.route('/api/knowledge-market',  createKnowledgeMarketRoutes(db)); // PUBLIC browse (logged-out)

  // Selling what you built on the canvas. Two mounts because they are two auth
  // models: publishing/earning/paying out needs the workspace token, while browse,
  // detail and LAUNCH are public — a marketplace whose products only run after a
  // sign-up is a catalogue of screenshots.
  app.route('/api/creation-listings', createCreationListingRoutes(db));
  app.route('/api/listings',          createPublicListingRoutes(db)); // PUBLIC browse + launch

  // The domain router is intentionally LAST among `/api` mounts. It owns dynamic
  // `/api/:domain/*` paths and installs blanket auth for them; mounting it earlier
  // makes that middleware intercept unrelated routes registered below it (including
  // the public knowledge marketplace and marketplace stats feeds) before their own
  // handlers can run.
  app.route('/api', createDomainRoutes(createDomainService(db, env), createEntityService(db, env), createTeamRosterService(db, env)));

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

/**
 * Same-origin gateway prefix. Requests that arrive via `builderforce.ai/gateway/*`
 * (a Cloudflare route pointing the primary apex at this worker — see wrangler.toml)
 * carry a `/gateway` path prefix that we strip here, BEFORE any routing or CORS
 * handling, so the entire API surface is byte-identical whether a caller reached us
 * on api.builderforce.ai or on the whitelisted primary domain. Corporate firewalls
 * that block the `api.` subdomain but allow the apex use this path. Requests that
 * arrive directly on api.builderforce.ai have no prefix and pass through untouched.
 */
const GATEWAY_PATH_PREFIX = '/gateway';

function stripGatewayPrefix(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === GATEWAY_PATH_PREFIX) {
    url.pathname = '/';
  } else if (url.pathname.startsWith(`${GATEWAY_PATH_PREFIX}/`)) {
    url.pathname = url.pathname.slice(GATEWAY_PATH_PREFIX.length);
  } else {
    return request;
  }
  return new Request(url.toString(), request);
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
   * Cloudflare scheduled() handler — fires on the cron triggers declared in
   * api/wrangler.toml `[triggers] crons`. It owns exactly two decisions:
   *
   *   1. WHICH sweeps this tick runs — `event.cron` maps to a cadence group over
   *      the shared CRON_SWEEPS registry, so the expensive daily/weekly work never
   *      runs on the every-5-minute tick.
   *   2. WHETHER the frequent tick runs at all — the KV work-gate that lets Neon
   *      compute autosuspend.
   *
   * Everything else — per-sweep isolation, log lines, the shared dispatch budget —
   * belongs to the runner, so the superadmin force-run route
   * (POST /api/admin/cron/:target) executes the identical set of sweeps BY
   * CONSTRUCTION instead of keeping a second copy of this fan-out in step.
  */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return runWithCaughtErrorContext({
      env,
      method: 'CRON',
      path: `cron:${event.cron}`,
      waitUntil: (task) => ctx.waitUntil(task),
    }, async () => {
      const cadence = cadenceForCron(event.cron);

      if (cadence === 'frequent') {
        // KV work-gate — the single change that lets Neon compute autosuspend.
        // Reads KV ONLY (no Postgres): SKIP the whole DB fan-out below on an idle
        // platform so the endpoint scales to zero, RUN it when a write signalled
        // pending work (dispatch within 5 min) or the floor interval elapsed
        // (safety net for a missed signal). Fails open. See cronWorkSignal.ts.
        const tickNowMs = Date.now();
        const gate = await evaluateCronGate(env, tickNowMs);
        if (!gate.run) {
          // Nothing pending and the floor is not due — leave Postgres asleep.
          return;
        }
        // Consume the signal + stamp the floor BEFORE firing sweeps, so a paced
        // backlog re-signalled mid-tick survives the consume and keeps the next
        // tick hot.
        await openCronTick(env, tickNowMs, gate.floorDue);
      }

      const controls = await readCronControls(env);
      const sweeps = sweepsForCadence(applyCronControls(CRON_SWEEPS, controls), cadence);
      if (sweeps.length === 0) return;

      // ONE per-tenant dispatch ceiling for this whole tick, shared by every sweep
      // that can start a billable run. Each sweep used to enforce its own private
      // 25/tenant, so the ceilings never composed and a tenant could take 25 from
      // the executor plus more from the manager in the same five minutes.
      dispatchCronSweeps(sweeps, { env, budget: createTickDispatchBudget(), controls }, (p) => ctx.waitUntil(p));
    });
  },

  /**
   * Cloudflare Email Routing handler — receives inbound mail for addressed
   * `inbound-email` workflow triggers (local-part = trigger token). Requires the
   * Email Routing binding to be provisioned (see Gap Register). Typed loosely so
   * the build doesn't depend on the email-types being present.
  */
  async email(message: ForwardableEmailLike, env: Env, ctx: ExecutionContext): Promise<void> {
    return runWithCaughtErrorContext({
      env,
      method: 'EMAIL',
      path: `email:${message.to}`,
      waitUntil: (task) => ctx.waitUntil(task),
    }, async () => {
      ctx.waitUntil((async () => {
        let text = '';
        try {
          if (message.raw) text = await new Response(message.raw as ReadableStream).text();
        } catch (error) { /* best-effort body read */ 
          reportCaughtError(error, { source: "index.ts", operation: "email" });
        }
        const result = await handleInboundEmail(env, {
          to: message.to,
          from: message.from,
          subject: message.headers?.get?.('subject') ?? undefined,
          text,
        });
        if (!result.ok) console.warn('[email:wf-trigger] not dispatched:', result.error);
      })().catch((error) => reportCaughtError(error, {
        source: 'index.ts',
        operation: 'email workflow trigger',
      })));
    });
  },
  async fetch(rawRequest: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Normalize the same-origin gateway path (builderforce.ai/gateway/*) → the bare
    // API surface before anything else looks at the request. No-op for direct
    // api.builderforce.ai traffic.
    const request = stripGatewayPrefix(rawRequest);
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
          'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
          // Shared list — the middleware sets the SAME value on the actual
          // response, which is the placement browsers actually honour.
          'Access-Control-Expose-Headers': EXPOSED_HEADERS,
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    // Guard the composition root + top-level dispatch. buildApp() (DB/client
    // construction, service wiring) and any throw that escapes Hono would
    // otherwise bubble to the Workers runtime as a bare Error 1101 page WITH NO
    // CORS HEADERS — which browsers surface as a misleading "No
    // Access-Control-Allow-Origin header is present" / net::ERR_FAILED on EVERY
    // endpoint at once, hiding the real 500. Return a CORS'd JSON 500 instead so
    // the browser can read the actual failure and the login page shows a real error.
    try {
      return await buildApp(env).fetch(request, env, ctx);
    } catch (err) {
      await reportUnhandledError(err, {
        source: 'index.ts',
        operation: 'top-level fetch',
      }, {
        env,
        method: request.method,
        path: new URL(request.url).pathname,
      });
      const origin = request.headers.get('Origin');
      const allow = optionCorsAllowOrigin(origin, env.CORS_ORIGINS);
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allow,
          'Access-Control-Expose-Headers': 'x-request-id',
          Vary: 'Origin',
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;
