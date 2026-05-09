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
import { ExecutionRepository }  from './infrastructure/repositories/ExecutionRepository';
import { AuditRepository }      from './infrastructure/repositories/AuditRepository';

// Application services
import { ProjectService }  from './application/project/ProjectService';
import { TaskService }     from './application/task/TaskService';
import { TenantService }   from './application/tenant/TenantService';
import { AuthService }     from './application/auth/AuthService';
import { AgentService }    from './application/agent/AgentService';
import { RuntimeService }  from './application/runtime/RuntimeService';
import { AuditService }    from './application/audit/AuditService';
import { ClawService }     from './application/claw/ClawService';

// Routes
import { createProjectRoutes }     from './presentation/routes/projectRoutes';
import { createTaskRoutes }        from './presentation/routes/taskRoutes';
import { createTenantRoutes }      from './presentation/routes/tenantRoutes';
import { createTenantApiKeyRoutes } from './presentation/routes/tenantApiKeyRoutes';
import { createAuthRoutes }        from './presentation/routes/authRoutes';
import { createOAuthRoutes }       from './presentation/routes/oauthRoutes';
import { createAgentRoutes, createSkillRoutes } from './presentation/routes/agentRoutes';
import { createRuntimeRoutes }     from './presentation/routes/runtimeRoutes';
import { createAuditRoutes }       from './presentation/routes/auditRoutes';
import { createMarketplaceRoutes } from './presentation/routes/marketplaceRoutes';
import { createClawRoutes }        from './presentation/routes/clawRoutes';
import { ClawRepository }          from './infrastructure/repositories/ClawRepository';
import { IClawRepository }         from './domain/claw/IClawRepository';
import { createSkillAssignmentRoutes } from './presentation/routes/skillAssignmentRoutes';
import { createArtifactAssignmentRoutes } from './presentation/routes/artifactAssignmentRoutes';
import { createMarketplaceStatsRoutes } from './presentation/routes/marketplaceStatsRoutes';
import { createWorkforceRoutes }        from './presentation/routes/workforceRoutes';
import { createLlmRoutes }          from './presentation/routes/llmRoutes';
import { createAdminRoutes }        from './presentation/routes/adminRoutes';
import { createChatRoutes }         from './presentation/routes/chatRoutes';
import { createSpecRoutes }         from './presentation/routes/specRoutes';
import { createWorkflowRoutes }     from './presentation/routes/workflowRoutes';
import { createApprovalRoutes }     from './presentation/routes/approvalRoutes';
import { createApprovalRuleRoutes } from './presentation/routes/approvalRuleRoutes';
import { createTelemetryRoutes }    from './presentation/routes/telemetryRoutes';
import { createIntegrationRoutes }  from './presentation/routes/integrationRoutes';
import { createContributorRoutes }  from './presentation/routes/contributorRoutes';
import { createDevTeamRoutes }      from './presentation/routes/devTeamRoutes';
import { createReportRoutes }       from './presentation/routes/reportRoutes';
import { createBrainRoutes }       from './presentation/routes/brainRoutes';
import { createIdeRoutes }         from './presentation/routes/ideRoutes';
import { createIdeAiRoutes }       from './presentation/routes/ideAiRoutes';
import { BrainService }            from './application/brain/BrainService';
import { buildPaymentProvider }    from './infrastructure/payment';
import { createWebhookRoutes }     from './presentation/routes/webhookRoutes';
import { createManagedClawRoutes }     from './presentation/routes/managedClawRoutes';
import { createGitHubWebhookRoutes }   from './presentation/routes/githubWebhookRoutes';
import { createCostForecastRoutes }    from './presentation/routes/costForecastRoutes';
import { createDashboardRoutes }       from './presentation/routes/dashboardRoutes';
import { createTeamMemoryRoutes }      from './presentation/routes/teamMemoryRoutes';
import { createPublicApiRoutes }       from './presentation/routes/publicApiRoutes';

import { API_VERSION } from './version';
import {
  OPENAPI_VERSION,
  OPENAPI_TITLE,
  OPENAPI_DESCRIPTION,
} from './openapi/schema';

// Middleware
import { addCorsToResponse, corsMiddleware } from './presentation/middleware/cors';
import { errorHandler }   from './presentation/middleware/errorHandler';
import { rateLimitMiddleware } from './presentation/middleware/rateLimitMiddleware';
import { emulationMiddleware } from './presentation/middleware/emulationMiddleware';

// Durable Objects (must be re-exported so the Workers runtime can instantiate them)
export { ClawRelayDO } from './infrastructure/relay/ClawRelayDO';
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
  const executionRepo = new ExecutionRepository(db);
  const auditRepo     = new AuditRepository(db);
  const clawRepo      = new ClawRepository(db);

  // --- Payment provider (selected by PAYMENT_PROVIDER env var, defaults to "manual") ---
  const paymentProvider = buildPaymentProvider(env);

  // --- Application ---
  const projectService  = new ProjectService(projectRepo);
  const taskService     = new TaskService(taskRepo, projectRepo);
  const tenantService   = new TenantService(tenantRepo, paymentProvider);
  const authService     = new AuthService(userRepo, tenantRepo, auditRepo, env.JWT_SECRET);
  const agentService    = new AgentService(agentRepo, skillRepo, auditRepo);
  const runtimeService  = new RuntimeService(executionRepo, taskRepo, agentRepo, auditRepo);
  const auditService    = new AuditService(auditRepo);
  const clawService     = new ClawService(clawRepo);
  const brainService    = new BrainService(db);

  // --- Presentation ---
  const app = new Hono<HonoEnv>();

  app.use('*', corsMiddleware);
  // Rate limiting applied after auth middleware resolves tenantId
  app.use('/api/*', rateLimitMiddleware as Parameters<typeof app.use>[1]);
  // Emulation token interception — runs before authMiddleware in each router.
  // When X-Emulation-Token is present, validates the emulation JWT, enforces
  // read-only mode, and sets userId/tenantId/role from the emulation identity.
  // Not applied to /api/admin/* (emulation tokens are already blocked there).
  app.use('/api/*', emulationMiddleware as Parameters<typeof app.use>[1]);

  app.get('/health', (c) => c.json({ status: 'ok', worker: 'api.builderforce.ai', version: API_VERSION }));

  // OpenAPI 3.1 document — CoderClaw-facing endpoints (P4-4)
  app.get('/api/openapi.json', (c) => {
    const doc = {
      openapi: OPENAPI_VERSION,
      info: { title: OPENAPI_TITLE, description: OPENAPI_DESCRIPTION, version: API_VERSION },
      servers: [{ url: 'https://api.builderforce.ai', description: 'Production' }],
      paths: {
        '/api/claws': {
          post: { summary: 'Register a CoderClaw instance', operationId: 'registerClaw', tags: ['Claws'] },
        },
        '/api/claws/{id}/heartbeat': {
          patch: { summary: 'Send heartbeat', operationId: 'heartbeat', tags: ['Claws'] },
        },
        '/api/claws/{id}/forward': {
          post: { summary: 'Forward a remote task to a claw', operationId: 'forwardTask', tags: ['Claws'] },
        },
        '/api/claws/{id}/context-bundle': {
          get: { summary: 'Get last-synced .coderClaw/ context bundle', operationId: 'getContextBundle', tags: ['Claws'] },
        },
        '/api/claws/fleet': {
          get: { summary: 'List online claws in the fleet', operationId: 'getFleet', tags: ['Claws'] },
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

  // builderforceLLM — OpenAI-compatible multi-vendor LLM proxy (tenant or claw API key auth)
  app.route('/llm', createLlmRoutes());

  // Marketplace (no JWT required for read, required for write)
  app.route('/marketplace', createMarketplaceRoutes(db));

  // Public workforce registry (browse published agents without login)
  app.route('/api/workforce', createWorkforceRoutes());

  // Public Developer API (Bearer <developer_api_key> for read-only; tenant JWT for key management)
  app.route('/api/v1', createPublicApiRoutes(db));

  // Payment webhooks — raw body required, no JWT, mounted before any body parsers
  app.route('/api/webhooks', createWebhookRoutes(tenantService, paymentProvider));

  // GitHub webhook — raw body required for HMAC verification, no JWT
  app.route('/api/webhooks', createGitHubWebhookRoutes(db));

  // Public endpoints (no JWT required)
  app.route('/api/auth',    createAuthRoutes(authService, db));
  app.route('/api/auth',    createOAuthRoutes(db));

  // CoderClaw instances + skill assignments (tenant JWT inside each router)
  app.route('/api/claws',            createClawRoutes(db, clawService));
  app.route('/api/skill-assignments', createSkillAssignmentRoutes(db));
  app.route('/api/artifact-assignments', createArtifactAssignmentRoutes(db));
  app.route('/api/marketplace-stats', createMarketplaceStatsRoutes(db));

  // Chat persistence (claw-auth writes + tenant-JWT reads)
  app.route('/api', createChatRoutes(db));

  // Protected endpoints (JWT injected by authMiddleware inside each router)
  app.route('/api/projects', createProjectRoutes(projectService, db));
  app.route('/api/tasks',    createTaskRoutes(taskService, db));
  app.route('/api/tenants',  createTenantRoutes(tenantService, db));
  app.route('/api/tenants/:tenantId/api-keys', createTenantApiKeyRoutes(db));
  app.route('/api/agents',   createAgentRoutes(agentService));
  app.route('/api/skills',   createSkillRoutes(agentService));
  app.route('/api/runtime',  createRuntimeRoutes(runtimeService, db));
  app.route('/api/audit',    createAuditRoutes(auditService));
  app.route('/api/admin',    createAdminRoutes());
  app.route('/api/specs',    createSpecRoutes(db));
  app.route('/api/workflows', createWorkflowRoutes(db));
  app.route('/api/approvals',       createApprovalRoutes(db));
  app.route('/api/approval-rules',  createApprovalRuleRoutes(db));
  app.route('/api/telemetry',       createTelemetryRoutes(db));

  // Phase 6 — Dev Analytics & Team Intelligence
  app.route('/api/integrations',    createIntegrationRoutes(db, env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET));
  app.route('/api/contributors',    createContributorRoutes(db));
  app.route('/api/dev-teams',       createDevTeamRoutes(db));
  app.route('/api/reports',         createReportRoutes(db));
  app.route('/api/managed-claws',   createManagedClawRoutes(db));
  app.route('/api/cost-forecast',   createCostForecastRoutes(db));
  app.route('/api/dashboard',       createDashboardRoutes(db));
  app.route('/api/brain',     createBrainRoutes(brainService, db));
  app.route('/api/teams/memory', createTeamMemoryRoutes(db));
  app.route('/api/ide',       createIdeRoutes());
  app.route('/api/ai',        createIdeAiRoutes(projectService));

  app.onError(errorHandler);
  app.notFound((c) => addCorsToResponse(c, c.json({ error: 'Not found' }, 404)));

  return app;
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function optionCorsAllowOrigin(origin: string | null, corsOrigins: string | undefined): string {
  if (!origin) return '*';
  if (corsOrigins === '*') return '*';
  const allowed = (corsOrigins ?? 'https://builderforce.ai').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin) || DEV_ORIGINS.includes(origin)) return origin;
  return '*';
}

export default {
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
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
