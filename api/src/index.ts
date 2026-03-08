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

// Routes
import { createProjectRoutes }     from './presentation/routes/projectRoutes';
import { createTaskRoutes }        from './presentation/routes/taskRoutes';
import { createTenantRoutes }      from './presentation/routes/tenantRoutes';
import { createAuthRoutes }        from './presentation/routes/authRoutes';
import { createAgentRoutes, createSkillRoutes } from './presentation/routes/agentRoutes';
import { createRuntimeRoutes }     from './presentation/routes/runtimeRoutes';
import { createAuditRoutes }       from './presentation/routes/auditRoutes';
import { createMarketplaceRoutes } from './presentation/routes/marketplaceRoutes';
import { createClawRoutes }        from './presentation/routes/clawRoutes';
import { createSkillAssignmentRoutes } from './presentation/routes/skillAssignmentRoutes';
import { createArtifactAssignmentRoutes } from './presentation/routes/artifactAssignmentRoutes';
import { createMarketplaceStatsRoutes } from './presentation/routes/marketplaceStatsRoutes';
import { createLlmRoutes }          from './presentation/routes/llmRoutes';
import { createAdminRoutes }        from './presentation/routes/adminRoutes';
import { createChatRoutes }         from './presentation/routes/chatRoutes';
import { createSpecRoutes }         from './presentation/routes/specRoutes';
import { createWorkflowRoutes }     from './presentation/routes/workflowRoutes';
import { createApprovalRoutes }     from './presentation/routes/approvalRoutes';
import { createBrainRoutes }       from './presentation/routes/brainRoutes';
import { createIdeRoutes }         from './presentation/routes/ideRoutes';
import { createIdeAiRoutes }       from './presentation/routes/ideAiRoutes';
import { BrainService }            from './application/brain/BrainService';

// Middleware
import { addCorsToResponse, corsMiddleware } from './presentation/middleware/cors';
import { errorHandler }   from './presentation/middleware/errorHandler';

// Durable Objects (must be re-exported so the Workers runtime can instantiate them)
export { ClawRelayDO } from './infrastructure/relay/ClawRelayDO';

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

  // --- Application ---
  const projectService  = new ProjectService(projectRepo);
  const taskService     = new TaskService(taskRepo, projectRepo);
  const tenantService   = new TenantService(tenantRepo);
  const authService     = new AuthService(userRepo, tenantRepo, auditRepo, env.JWT_SECRET);
  const agentService    = new AgentService(agentRepo, skillRepo, auditRepo);
  const runtimeService  = new RuntimeService(executionRepo, taskRepo, agentRepo, auditRepo);
  const auditService    = new AuditService(auditRepo);
  const brainService    = new BrainService(db);

  // --- Presentation ---
  const app = new Hono<HonoEnv>();

  app.use('*', corsMiddleware);

  app.get('/health', (c) => c.json({ status: 'ok', worker: 'api.builderforce.ai' }));

  // coderClawLLM — OpenAI-compatible LLM proxy (no JWT, keyed by OPENROUTER_API_KEY)
  app.route('/llm', createLlmRoutes());

  // Marketplace (no JWT required for read, required for write)
  app.route('/marketplace', createMarketplaceRoutes(db));

  // Public endpoints (no JWT required)
  app.route('/api/auth',    createAuthRoutes(authService, db));

  // CoderClaw instances + skill assignments (tenant JWT inside each router)
  app.route('/api/claws',            createClawRoutes(db));
  app.route('/api/skill-assignments', createSkillAssignmentRoutes(db));
  app.route('/api/artifact-assignments', createArtifactAssignmentRoutes(db));
  app.route('/api/marketplace-stats', createMarketplaceStatsRoutes(db));

  // Chat persistence (claw-auth writes + tenant-JWT reads)
  app.route('/api', createChatRoutes(db));

  // Protected endpoints (JWT injected by authMiddleware inside each router)
  app.route('/api/projects', createProjectRoutes(projectService, db));
  app.route('/api/tasks',    createTaskRoutes(taskService));
  app.route('/api/tenants',  createTenantRoutes(tenantService, db));
  app.route('/api/agents',   createAgentRoutes(agentService));
  app.route('/api/skills',   createSkillRoutes(agentService));
  app.route('/api/runtime',  createRuntimeRoutes(runtimeService, db));
  app.route('/api/audit',    createAuditRoutes(auditService));
  app.route('/api/admin',    createAdminRoutes());
  app.route('/api/specs',    createSpecRoutes(db));
  app.route('/api/workflows', createWorkflowRoutes(db));
  app.route('/api/approvals', createApprovalRoutes(db));
  app.route('/api/brain',     createBrainRoutes(brainService, db));
  app.route('/api/ide',       createIdeRoutes());
  app.route('/api/ai',        createIdeAiRoutes());

  app.onError(errorHandler);
  app.notFound((c) => addCorsToResponse(c, c.json({ error: 'Not found' }, 404)));

  return app;
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
