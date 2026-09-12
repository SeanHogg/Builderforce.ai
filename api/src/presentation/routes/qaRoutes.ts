import { statusResponse } from '../middleware/errorResponse';
import { integrationCredentialSecret } from '../../application/integrations/integrationCredentialSecret';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Agentic QA routes — /api/qa
 *
 * Per-project QA automation suite: capture → aggregate → generate → execute →
 * report, with a per-project credential library (test personas).
 *
 * All routes require a tenant JWT. The frontend capture client uses the
 * logged-in user's tenant token; the CI harness logs in as the QA tenant.
 *
 *   Capture / flows / tests / runs
 *     POST  /events                          Ingest a batch of client journey events
 *     GET   /events                          Recent journey events (debug)
 *     POST  /flows/aggregate                 Collapse journeys into qa_flows
 *     POST  /flows/crawl                     Seed a crawl flow from a route map
 *     POST  /flows                           Create a manual flow
 *     GET   /flows                           List flows (?projectId)
 *     POST  /generate                        Generate a Playwright spec for a flow (LLM), resolving its persona
 *     GET   /tests                           List generated tests (?projectId, ?status)
 *     GET   /tests/:id                       One test (spec source)
 *     PATCH /tests/:id                       Update test status / persona credential
 *     POST  /runs                            CI posts back an execution report
 *     GET   /runs                            Recent runs (?projectId)
 *     GET   /runs/:id                        One run + its steps
 *   Targets (per project site-under-test)
 *     GET   /projects/:projectId/targets     List targets
 *     POST  /projects/:projectId/targets     Create a target
 *     PATCH /targets/:id                     Update a target
 *     DELETE /targets/:id                    Delete a target
 *   Credentials (per-project persona library — passwords encrypted at rest)
 *     GET   /projects/:projectId/credentials List personas (password redacted)
 *     POST  /projects/:projectId/credentials Create a persona (encrypts password)
 *     PATCH /credentials/:id                 Update a persona (re-encrypts if password sent)
 *     DELETE /credentials/:id                Delete a persona
 *     GET   /credentials/:id/secret          Decrypted secret for the CI harness (DEVELOPER+)
 *   Harness
 *     GET   /projects/:projectId/runner-bundle  Target + active tests + persona list in one call
 */

import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  projects,
  qaCredentials,
  qaExplorations,
  qaFindings,
  qaFlows,
  qaJourneyEvents,
  qaRoutingSettings,
  qaRunSteps,
  qaRuns,
  qaSchedules,
  qaTargets,
  qaTests,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { isValidCron, nextCronTime } from '../../domain/workflowSchedule';
import { projectInTenant, loadProjectInTenant } from '../../application/project/projectOwnership';
import { deriveTargetZones } from '../../application/qa/deriveTargetRoutes';
import { fireEventTriggers } from '../../application/workflow/eventTriggers';
import { getFindingScreenshot, putFindingScreenshot } from '../../application/qa/findingScreenshots';
import { wildcardPath } from '@builderforce/hono-wildcard-path';
import { QaFlowService } from '../../application/qa/QaFlowService';
import { QaGeneratorService } from '../../application/qa/QaGeneratorService';
import { QaHeatmapService, QA_HEAT_VERSION_KEY } from '../../application/qa/QaHeatmapService';
import {
  QaFindingRouter,
  meetsSeverityThreshold,
  severityRank,
  type QaFindingLike,
} from '../../application/qa/QaFindingRouter';
import { getProjectQualityTrend, QA_QUALITY_VERSION_KEY } from '../../application/qa/QaQualityService';
import { onTaskLandedInLane } from '../../application/swimlane/laneEntryTrigger';
import { dispatchQaRunner } from '../../application/qa/dispatchQaRunner';
import {
  buildExplorationPlan,
  defaultFindingSeverity,
  findingFingerprint,
  inferPersonaRole,
  QA_FINDING_TYPES,
  QA_SEVERITIES,
  QA_STEP_ACTIONS,
  type QaCredentialPublic,
  type QaHeatZone,
  type QaStep,
  shortHash,
  toSlug,
} from '../../application/qa/qaTypes';
import { parseBody, z, zNonEmptyString, zOptionalString, zPositiveInt } from './requestBody';
import { decryptSecretFromStorage, encryptSecretForStorage } from '../../infrastructure/auth/MfaService';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { TenantRole } from '../../domain/shared/types';
import type { TaskService } from '../../application/task/TaskService';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { daysParam, limitParam } from './queryParams';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';

const MAX_EVENT_BATCH = 200;

// ── Request bodies ───────────────────────────────────────────────────────────

const JourneyEvent = z.object({
  seq: z.number().optional(),
  type: z.string(),
  route: z.string().optional(),
  selector: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  meta: z.unknown().optional(),
  ts: z.string().optional(),
});
/** The capture client posts either a bare event array or `{ sessionId, projectId, events }`. */
const EventsBody = z.union([
  z.array(JourneyEvent),
  z.object({
    sessionId: z.string().optional(),
    projectId: z.union([z.number(), z.string()]).nullable().optional(),
    events: z.array(JourneyEvent).optional(),
  }),
]);

const QaStepBody = z.object({
  action: z.enum(QA_STEP_ACTIONS),
  selector: z.string().optional(),
  route: z.string().optional(),
  value: z.string().optional(),
  assertion: z.string().optional(),
  label: z.string().optional(),
  heat: z.number().optional(),
});

const AggregateBody = z.object({
  sinceDays: z.number().optional(),
  minRoutes: z.number().optional(),
  maxFlows: z.number().optional(),
  projectId: zPositiveInt.optional(),
  maxEvents: z.number().optional(),
});

const CrawlBody = z.object({
  routes: z.array(z.string().startsWith('/')).min(1, 'routes[] (absolute paths) required'),
  name: zOptionalString,
  projectId: zPositiveInt.optional(),
});

const ManualFlowBody = z.object({
  name: zNonEmptyString,
  startRoute: zOptionalString,
  steps: z.array(QaStepBody),
  description: zOptionalString,
  projectId: zPositiveInt.optional(),
  personaRole: zOptionalString,
});

const GenerateBody = z.object({ flowId: zNonEmptyString });

const TestPatchBody = z.object({
  status: z.string().optional(),
  credentialId: z.string().nullable().optional(),
});

const RunStepReport = z.object({
  seq: z.number().int(),
  action: z.string(),
  selector: z.string().optional(),
  status: z.enum(['passed', 'failed', 'skipped']),
  durationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  screenshotKey: z.string().optional(),
});
/** `QaRunReport` (qaTypes) as a schema — the CI harness's execution report. */
const RunReportBody = z.object({
  testId: z.string().nullable().optional(),
  testSlug: z.string().nullable().optional(),
  projectId: zPositiveInt.nullable().optional(),
  credentialId: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  status: z.enum(['passed', 'failed', 'error', 'skipped']),
  browser: z.string().optional(),
  targetUrl: z.string().optional(),
  commitSha: z.string().optional(),
  runKey: z.string().optional(),
  durationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  logs: z.string().optional(),
  screenshotKeys: z.array(z.string()).optional(),
  steps: z.array(RunStepReport).optional(),
});

const TargetCreateBody = z.object({
  name: zNonEmptyString,
  baseUrl: zNonEmptyString,
  isDefault: z.boolean().optional(),
});
const TargetPatchBody = z.object({
  name: z.string().optional(),
  baseUrl: z.string().optional(),
  isDefault: z.boolean().optional(),
  status: z.string().optional(),
});

const CredentialCreateBody = z.object({
  label: zNonEmptyString,
  role: zOptionalString,
  username: zNonEmptyString,
  password: zNonEmptyString,
  loginUrl: zOptionalString,
  loginSelectors: z.unknown().optional(),
});
const CredentialPatchBody = z.object({
  label: z.string().optional(),
  role: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  loginUrl: z.string().optional(),
  status: z.string().optional(),
});

const ExplorationCreateBody = z.object({
  projectId: zPositiveInt.optional(),
  targetId: z.string().optional(),
  credentialId: z.string().optional(),
  heatBudget: z.number().optional(),
  sinceDays: z.number().optional(),
});

const ExplorationClaimBody = z.object({
  explorationId: z.string().optional(),
  projectId: zPositiveInt.optional(),
});

/** `QaFindingReport` (qaTypes) as a schema. `type` defaults to `console` downstream. */
const FindingReport = z.object({
  type: z.enum(QA_FINDING_TYPES).optional(),
  severity: z.enum(QA_SEVERITIES).optional(),
  route: z.string().nullable().optional(),
  selector: z.string().nullable().optional(),
  message: z.string(),
  detail: z.string().nullable().optional(),
  heat: z.number().optional(),
  screenshotKey: z.string().nullable().optional(),
});
const FindingsBody = z.object({ findings: z.array(FindingReport).optional() });

/** `QaExplorationOutcome` (qaTypes) as a schema; every field is a patch, so all optional. */
const ExplorationOutcomeBody = z.object({
  status: z.enum(['running', 'passed', 'failed', 'error']).optional(),
  zonesExplored: z.number().int().optional(),
  browser: z.string().optional(),
  targetUrl: z.string().optional(),
  commitSha: z.string().optional(),
  runKey: z.string().optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
});

const zCron = z.string().refine(isValidCron, 'A valid cron expression is required');
const ScheduleCreateBody = z.object({
  cron: zCron,
  timezone: zOptionalString,
  targetId: z.string().optional(),
  credentialId: z.string().optional(),
  heatBudget: z.number().optional(),
  sinceDays: z.number().optional(),
  enabled: z.boolean().optional(),
});
const SchedulePatchBody = z.object({
  cron: zCron.optional(),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
  targetId: z.string().nullable().optional(),
  credentialId: z.string().nullable().optional(),
  heatBudget: z.number().optional(),
  sinceDays: z.number().optional(),
});

const RoutingSettingsBody = z.object({
  enabled: z.boolean().optional(),
  minSeverity: z.enum(QA_SEVERITIES).optional(),
  targetLaneKey: z.string().nullable().optional(),
  maxPerBatch: z.number().optional(),
});

function parseSteps(raw: string | null): QaStep[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as QaStep[]) : [];
  } catch {
    return [];
  }
}

/** Key material for encrypting/decrypting credential secrets. Mirrors the
 *  integrations fallback (INTEGRATION_ENCRYPTION_SECRET → JWT_SECRET). */
function credentialKey(env: Env): string {
  return integrationCredentialSecret(env);
}

type CredentialRow = typeof qaCredentials.$inferSelect;

function toPublicCredential(row: CredentialRow): QaCredentialPublic {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    role: row.role,
    username: row.username,
    loginUrl: row.loginUrl,
    status: row.status,
  };
}

export function createQaRoutes(db: Db, taskService: TaskService, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const findingRouter = new QaFindingRouter(db, taskService);

  // Every QA endpoint requires an authenticated tenant.
  router.use('*', authMiddleware);

  // ── POST /events ──────────────────────────────────────────────────────────
  router.post('/events', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId    = c.get('userId') as string | undefined;

    const json = await parseBody(c, EventsBody);
    const body = Array.isArray(json) ? { events: json } : json;

    const sessionId = (body.sessionId ?? c.req.query('sessionId') ?? '').slice(0, 64);
    // The site-under-test this batch was captured on. Absent = the Builderforce
    // app shell itself, which belongs to no customer project — the meaning every
    // pre-0955 row already carries. Heat ranks per project when it is present.
    const rawProjectId = body.projectId ?? c.req.query('projectId');
    const projectIdNum = rawProjectId == null || rawProjectId === '' ? null : Number(rawProjectId);
    const projectId = projectIdNum !== null && Number.isInteger(projectIdNum) && projectIdNum > 0 ? projectIdNum : null;
    // A caller may only attribute events to a project in its OWN tenant —
    // otherwise a batch could poison another workspace's ranking.
    if (projectId !== null && !(await projectInTenant(db, tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const events = body.events ?? [];
    if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);
    if (events.length === 0) return c.json({ inserted: 0 });
    if (events.length > MAX_EVENT_BATCH) return c.json({ error: `Batch too large (max ${MAX_EVENT_BATCH})` }, 400);

    const now = new Date();
    const rows = events
      .map((e, i) => ({
        tenantId,
        segmentId,
        userId: userId ?? null,
        projectId,
        sessionId,
        seq:      typeof e.seq === 'number' ? e.seq : i,
        type:     e.type.slice(0, 32),
        route:    e.route ? e.route.slice(0, 512) : null,
        selector: e.selector ? e.selector.slice(0, 4000) : null,
        label:    e.label ? e.label.slice(0, 255) : null,
        value:    e.value ? e.value.slice(0, 255) : null,
        meta:     e.meta != null ? JSON.stringify(e.meta).slice(0, 8000) : null,
        ts:       e.ts ? new Date(e.ts) : now,
        createdAt: now,
      }));

    if (rows.length > 0) {
      await db.insert(qaJourneyEvents).values(rows);
      // New interactions move the heatmap — bump the per-tenant version token so
      // the next /heatmap read recomputes instead of serving a stale ranking.
      void bumpCacheVersion(c.env as Env, QA_HEAT_VERSION_KEY(tenantId)).catch((error) => {
        reportCaughtError(error, { source: "presentation/routes/qaRoutes.ts", operation: "createQaRoutes" });
      });
    }
    return c.json({ inserted: rows.length }, 201);
  });

  // ── GET /events ───────────────────────────────────────────────────────────
  router.get('/events', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit = limitParam(c.req.query('limit'), 200, 1000);
    const rows = await db
      .select()
      .from(qaJourneyEvents)
      .where(eq(qaJourneyEvents.tenantId, tenantId))
      .orderBy(desc(qaJourneyEvents.ts))
      .limit(limit);
    return c.json({ events: rows, total: rows.length });
  });

  // ── POST /flows/aggregate ─────────────────────────────────────────────────
  router.post('/flows/aggregate', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const body = await parseBody(c, AggregateBody);
    const result = await new QaFlowService(db).aggregate(tenantId, segmentId, body);
    return c.json(result);
  });

  // ── POST /flows/crawl ─────────────────────────────────────────────────────
  router.post('/flows/crawl', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const body = await parseBody(c, CrawlBody);
    const routes = body.routes;

    const steps: QaStep[] = [];
    for (const route of routes) {
      steps.push({ action: 'goto', route });
      steps.push({ action: 'expect', assertion: `route ${route} renders without an error boundary` });
    }
    const name = body.name ?? 'Authenticated route smoke crawl';
    const slug = `crawl-${toSlug(name)}-${shortHash(routes.join('>'))}`;
    const now = new Date();
    const [flow] = await db
      .insert(qaFlows)
      .values({
        tenantId, segmentId, projectId: body.projectId, name, slug, source: 'crawl',
        description: `AI-crawl smoke over ${routes.length} route(s).`,
        startRoute: routes[0] ?? null, personaRole: inferPersonaRole(routes),
        steps: JSON.stringify(steps), frequency: 0, status: 'active', updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qaFlows.tenantId, qaFlows.slug],
        set: { steps: JSON.stringify(steps), startRoute: routes[0] ?? null, personaRole: inferPersonaRole(routes), updatedAt: now },
      })
      .returning();
    return c.json({ flow }, 201);
  });

  // ── POST /flows (manual) ──────────────────────────────────────────────────
  router.post('/flows', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const body = await parseBody(c, ManualFlowBody);
    const slug = `manual-${toSlug(body.name)}-${shortHash(JSON.stringify(body.steps))}`;
    const now = new Date();
    const [flow] = await db
      .insert(qaFlows)
      .values({
        tenantId, segmentId, projectId: body.projectId, name: body.name, slug, source: 'manual',
        description: body.description ?? null, startRoute: body.startRoute ?? null,
        personaRole: body.personaRole ?? null,
        steps: JSON.stringify(body.steps), frequency: 0, status: 'active', updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qaFlows.tenantId, qaFlows.slug],
        set: { steps: JSON.stringify(body.steps), personaRole: body.personaRole ?? null, updatedAt: now },
      })
      .returning();
    return c.json({ flow }, 201);
  });

  // ── GET /flows ────────────────────────────────────────────────────────────
  router.get('/flows', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const conditions = [eq(qaFlows.tenantId, tenantId)];
    if (projectId != null) conditions.push(eq(qaFlows.projectId, projectId));
    const rows = await db
      .select()
      .from(qaFlows)
      .where(and(...conditions))
      .orderBy(desc(qaFlows.frequency), desc(qaFlows.updatedAt))
      .limit(200);
    return c.json({ flows: rows.map((f) => ({ ...f, steps: parseSteps(f.steps) })), total: rows.length });
  });

  // ── POST /generate ────────────────────────────────────────────────────────
  // Resolves the flow's persona (personaRole → a project credential, human-
  // overridable via PATCH), generates the spec persona-aware, and upserts the test.
  router.post('/generate', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId    = c.get('userId') as string | undefined;
    const body = await parseBody(c, GenerateBody);

    const [flow] = await db
      .select()
      .from(qaFlows)
      .where(and(eq(qaFlows.id, body.flowId), eq(qaFlows.tenantId, tenantId)))
      .limit(1);
    if (!flow) return c.json({ error: 'Flow not found' }, 404);

    // Resolve the persona credential: explicit flow.credentialId wins; else
    // match the inferred personaRole within the project; else the first active
    // project credential as a default.
    let credential: CredentialRow | undefined;
    if (flow.projectId != null) {
      const projectCreds = await db
        .select()
        .from(qaCredentials)
        .where(and(eq(qaCredentials.tenantId, tenantId), eq(qaCredentials.projectId, flow.projectId), eq(qaCredentials.status, 'active')));
      credential = flow.credentialId
        ? projectCreds.find((p) => p.id === flow.credentialId)
        : undefined;
      if (!credential && flow.personaRole) credential = projectCreds.find((p) => p.role === flow.personaRole);
      if (!credential) credential = projectCreds[0];
    }

    const steps = parseSteps(flow.steps);
    const gen = await new QaGeneratorService(c.env, c.get('tenantId') as number).generate({
      name: flow.name, slug: flow.slug, description: flow.description, startRoute: flow.startRoute, steps,
      persona: credential ? { label: credential.label, role: credential.role } : (flow.personaRole ? { role: flow.personaRole } : null),
    });

    const testSlug = `test-${flow.slug}`;
    const now = new Date();
    const [existing] = await db
      .select({ id: qaTests.id, version: qaTests.version })
      .from(qaTests)
      .where(and(eq(qaTests.tenantId, tenantId), eq(qaTests.slug, testSlug)))
      .limit(1);

    const [test] = await db
      .insert(qaTests)
      .values({
        tenantId, segmentId, projectId: flow.projectId, flowId: flow.id,
        credentialId: credential?.id ?? null, personaRole: flow.personaRole,
        name: flow.name, slug: testSlug, framework: 'playwright', spec: gen.spec,
        stepsModel: JSON.stringify(gen.steps), model: gen.model, generatedBy: userId ?? null,
        version: (existing?.version ?? 0) + 1, status: 'active', updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qaTests.tenantId, qaTests.slug],
        set: {
          spec: gen.spec, stepsModel: JSON.stringify(gen.steps), model: gen.model,
          credentialId: credential?.id ?? null, personaRole: flow.personaRole,
          version: (existing?.version ?? 0) + 1, generatedBy: userId ?? null,
          status: 'active', updatedAt: now,
        },
      })
      .returning();
    return c.json({
      test,
      usedModel: gen.model ?? 'deterministic-fallback',
      persona: credential ? toPublicCredential(credential) : null,
    }, 201);
  });

  // ── GET /tests ────────────────────────────────────────────────────────────
  router.get('/tests', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const status = c.req.query('status');
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const conditions = [eq(qaTests.tenantId, tenantId)];
    if (status) conditions.push(eq(qaTests.status, status));
    if (projectId != null) conditions.push(eq(qaTests.projectId, projectId));
    const rows = await db
      .select()
      .from(qaTests)
      .where(and(...conditions))
      .orderBy(desc(qaTests.updatedAt))
      .limit(500);
    return c.json({ tests: rows, total: rows.length });
  });

  // ── GET /tests/:id ────────────────────────────────────────────────────────
  router.get('/tests/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [test] = await db
      .select()
      .from(qaTests)
      .where(and(eq(qaTests.id, c.req.param('id')), eq(qaTests.tenantId, tenantId)))
      .limit(1);
    if (!test) return c.json({ error: 'Test not found' }, 404);
    return c.json({ test });
  });

  // ── PATCH /tests/:id ──────────────────────────────────────────────────────
  // Update status and/or reassign the persona credential (human override).
  router.patch('/tests/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, TestPatchBody);
    if (body.status === undefined && body.credentialId === undefined) return c.json({ error: 'status or credentialId required' }, 400);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) patch.status = body.status;
    if (body.credentialId !== undefined) patch.credentialId = body.credentialId;
    const [test] = await db
      .update(qaTests)
      .set(patch)
      .where(and(eq(qaTests.id, c.req.param('id')), eq(qaTests.tenantId, tenantId)))
      .returning();
    if (!test) return c.json({ error: 'Test not found' }, 404);
    return c.json({ test });
  });

  // ── POST /runs ────────────────────────────────────────────────────────────
  router.post('/runs', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const report = await parseBody(c, RunReportBody);

    // Resolve the test by id or slug; inherit project/credential from it when
    // the harness didn't supply them.
    let testRow: typeof qaTests.$inferSelect | undefined;
    if (report.testId) {
      [testRow] = await db.select().from(qaTests).where(and(eq(qaTests.id, report.testId), eq(qaTests.tenantId, tenantId))).limit(1);
    } else if (report.testSlug) {
      [testRow] = await db.select().from(qaTests).where(and(eq(qaTests.tenantId, tenantId), eq(qaTests.slug, report.testSlug))).limit(1);
    }

    const now = new Date();
    const totalSteps = report.steps?.length ?? null;
    const passedSteps = report.steps?.filter((s) => s.status === 'passed').length ?? null;
    const [run] = await db
      .insert(qaRuns)
      .values({
        tenantId, segmentId,
        projectId: report.projectId ?? testRow?.projectId ?? null,
        testId: testRow?.id ?? null,
        credentialId: report.credentialId ?? testRow?.credentialId ?? null,
        targetId: report.targetId ?? null,
        runKey: report.runKey ?? null, trigger: 'ci', status: report.status,
        browser: report.browser ?? null, targetUrl: report.targetUrl ?? null,
        commitSha: report.commitSha ?? null, durationMs: report.durationMs ?? null,
        totalSteps, passedSteps, errorMessage: report.errorMessage ?? null,
        screenshotKeys: report.screenshotKeys ? JSON.stringify(report.screenshotKeys) : null,
        logs: report.logs ? report.logs.slice(0, 20_000) : null,
        startedAt: report.durationMs ? new Date(now.getTime() - report.durationMs) : now,
        finishedAt: now, createdAt: now,
      })
      .returning();

    if (run && report.steps && report.steps.length > 0) {
      await db.insert(qaRunSteps).values(
        report.steps.slice(0, 500).map((s) => ({
          runId: run.id, seq: s.seq, action: s.action.slice(0, 32),
          selector: s.selector ?? null, status: s.status, durationMs: s.durationMs ?? null,
          errorMessage: s.errorMessage ?? null, screenshotKey: s.screenshotKey ?? null,
        })),
      );
    }
    return c.json({ run }, 201);
  });

  // ── GET /runs ─────────────────────────────────────────────────────────────
  router.get('/runs', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const limit = limitParam(c.req.query('limit'), 100, 500);
    const conditions = [eq(qaRuns.tenantId, tenantId)];
    if (projectId != null) conditions.push(eq(qaRuns.projectId, projectId));
    const rows = await db
      .select({
        id: qaRuns.id, testId: qaRuns.testId, status: qaRuns.status, browser: qaRuns.browser,
        targetUrl: qaRuns.targetUrl, commitSha: qaRuns.commitSha, durationMs: qaRuns.durationMs,
        totalSteps: qaRuns.totalSteps, passedSteps: qaRuns.passedSteps, errorMessage: qaRuns.errorMessage,
        createdAt: qaRuns.createdAt, testName: qaTests.name, testSlug: qaTests.slug,
        credentialLabel: qaCredentials.label, credentialRole: qaCredentials.role,
      })
      .from(qaRuns)
      .leftJoin(qaTests, eq(qaRuns.testId, qaTests.id))
      .leftJoin(qaCredentials, eq(qaRuns.credentialId, qaCredentials.id))
      .where(and(...conditions))
      .orderBy(desc(qaRuns.createdAt))
      .limit(limit);
    return c.json({ runs: rows, total: rows.length });
  });

  // ── GET /runs/:id ─────────────────────────────────────────────────────────
  router.get('/runs/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [run] = await db
      .select()
      .from(qaRuns)
      .where(and(eq(qaRuns.id, c.req.param('id')), eq(qaRuns.tenantId, tenantId)))
      .limit(1);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    const steps = await db
      .select()
      .from(qaRunSteps)
      .where(eq(qaRunSteps.runId, run.id))
      .orderBy(qaRunSteps.seq).limit(LIST_ROW_CAP);
    return c.json({ run: { ...run, screenshotKeys: run.screenshotKeys ? JSON.parse(run.screenshotKeys) : [] }, steps });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Targets — per-project site(s)-under-test
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/projects/:projectId/targets', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    const rows = await db
      .select()
      .from(qaTargets)
      .where(and(eq(qaTargets.tenantId, tenantId), eq(qaTargets.projectId, projectId)))
      .orderBy(desc(qaTargets.isDefault), desc(qaTargets.updatedAt)).limit(LIST_ROW_CAP);
    return c.json({ targets: rows });
  });

  router.post('/projects/:projectId/targets', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    const body = await parseBody(c, TargetCreateBody);
    const [target] = await db
      .insert(qaTargets)
      .values({ tenantId, segmentId, projectId, name: body.name, baseUrl: body.baseUrl, isDefault: body.isDefault ?? false, updatedAt: new Date() })
      .returning();
    return c.json({ target }, 201);
  });

  router.patch('/targets/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, TargetPatchBody);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['name', 'baseUrl', 'isDefault', 'status'] as const) if (body[k] !== undefined) patch[k] = body[k];
    const [target] = await db
      .update(qaTargets).set(patch)
      .where(and(eq(qaTargets.id, c.req.param('id')), eq(qaTargets.tenantId, tenantId)))
      .returning();
    if (!target) return c.json({ error: 'Target not found' }, 404);
    return c.json({ target });
  });

  router.delete('/targets/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [target] = await db
      .delete(qaTargets)
      .where(and(eq(qaTargets.id, c.req.param('id')), eq(qaTargets.tenantId, tenantId)))
      .returning();
    if (!target) return c.json({ error: 'Target not found' }, 404);
    return c.json({ deleted: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Credentials — per-project persona library (passwords encrypted at rest)
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/projects/:projectId/credentials', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    const rows = await db
      .select()
      .from(qaCredentials)
      .where(and(eq(qaCredentials.tenantId, tenantId), eq(qaCredentials.projectId, projectId)))
      .orderBy(desc(qaCredentials.updatedAt)).limit(LIST_ROW_CAP);
    return c.json({ credentials: rows.map(toPublicCredential) });
  });

  router.post('/projects/:projectId/credentials', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    const body = await parseBody(c, CredentialCreateBody);
    const secretEnc = await encryptSecretForStorage(body.password, credentialKey(c.env));
    const [cred] = await db
      .insert(qaCredentials)
      .values({
        tenantId, segmentId, projectId, label: body.label, role: body.role ?? null,
        username: body.username, secretEnc, loginUrl: body.loginUrl ?? null,
        loginSelectors: body.loginSelectors != null ? JSON.stringify(body.loginSelectors) : null,
        status: 'active', updatedAt: new Date(),
      })
      .returning();
    if (!cred) throw new Error('qa_credentials insert returned no row');
    return c.json({ credential: toPublicCredential(cred) }, 201);
  });

  router.patch('/credentials/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, CredentialPatchBody);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['label', 'role', 'username', 'loginUrl', 'status'] as const) if (body[k] !== undefined) patch[k] = body[k];
    if (body.password) patch.secretEnc = await encryptSecretForStorage(body.password, credentialKey(c.env));
    const [cred] = await db
      .update(qaCredentials).set(patch)
      .where(and(eq(qaCredentials.id, c.req.param('id')), eq(qaCredentials.tenantId, tenantId)))
      .returning();
    if (!cred) return c.json({ error: 'Credential not found' }, 404);
    return c.json({ credential: toPublicCredential(cred) });
  });

  router.delete('/credentials/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [cred] = await db
      .delete(qaCredentials)
      .where(and(eq(qaCredentials.id, c.req.param('id')), eq(qaCredentials.tenantId, tenantId)))
      .returning();
    if (!cred) return c.json({ error: 'Credential not found' }, 404);
    return c.json({ deleted: true });
  });

  // ── GET /credentials/:id/secret ───────────────────────────────────────────
  // Returns the DECRYPTED secret for the CI harness to drive the site's login
  // form. DEVELOPER+ only. The plaintext password is necessary here: arbitrary
  // external sites have no token API to inject, so the runner must type real
  // credentials into the login form.
  router.get('/credentials/:id/secret', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string | undefined;
    const [cred] = await db
      .select()
      .from(qaCredentials)
      .where(and(eq(qaCredentials.id, c.req.param('id')), eq(qaCredentials.tenantId, tenantId)))
      .limit(1);
    if (!cred) return c.json({ error: 'Credential not found' }, 404);
    // A secret that no longer decrypts (rotated key, corrupt row) is an invariant
    // failure the global handler reports; the caller never sees the crypto error.
    const password = await decryptSecretFromStorage(cred.secretEnc, credentialKey(c.env));
    // This endpoint returns a decrypted plaintext site password — the most
    // sensitive read in the system. Record who fetched which credential [1553].
    await writeAdminAudit(db, 'QA_CREDENTIAL_SECRET_VIEWED', userId ?? null, {
      tenantId,
      metadata:  { credentialId: cred.id },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    });
    return c.json({
      id: cred.id,
      username: cred.username,
      password,
      loginUrl: cred.loginUrl,
      loginSelectors: cred.loginSelectors ? JSON.parse(cred.loginSelectors) : null,
    });
  });

  // ── GET /projects/:projectId/runner-bundle ────────────────────────────────
  // One call for the CI harness: the default target, active tests (with the
  // persona each runs as), and the redacted credential list. Secrets are then
  // fetched per-credential from /credentials/:id/secret.
  router.get('/projects/:projectId/runner-bundle', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));

    const [targets, tests, creds] = await Promise.all([
      db.select().from(qaTargets).where(and(eq(qaTargets.tenantId, tenantId), eq(qaTargets.projectId, projectId), eq(qaTargets.status, 'active'))).orderBy(desc(qaTargets.isDefault)).limit(LIST_ROW_CAP),
      db.select({ id: qaTests.id, slug: qaTests.slug, name: qaTests.name, spec: qaTests.spec, credentialId: qaTests.credentialId })
        .from(qaTests).where(and(eq(qaTests.tenantId, tenantId), eq(qaTests.projectId, projectId), eq(qaTests.status, 'active'))),
      db.select().from(qaCredentials).where(and(eq(qaCredentials.tenantId, tenantId), eq(qaCredentials.projectId, projectId), eq(qaCredentials.status, 'active'))),
    ]);

    return c.json({
      target: targets[0] ?? null,
      tests: tests.filter((t) => t.spec),
      credentials: creds.map(toPublicCredential),
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Agentic Tester (migration 0206) — heatmap → exploration plan → containerised
  // browser run → captured findings → board-task feedback.
  // ═══════════════════════════════════════════════════════════════════════════

  type ExplorationRow = typeof qaExplorations.$inferSelect;

  function parsePlan(raw: string | null): QaStep[] {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as QaStep[]) : [];
    } catch {
      return [];
    }
  }

  function parseZones(raw: string | null): QaHeatZone[] {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as QaHeatZone[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Auto-route a batch of freshly-captured findings to a fix agent when the
   * project opts in. For each finding at/above the policy's min-severity (capped at
   * `maxPerBatch`, worst-first): open the board task, move it into the project's
   * auto-fix lane, and fire the SAME lane auto-run trigger a board drag uses. Pure
   * best-effort — off the harness response path and never throwing — so a routing
   * failure never blocks finding ingestion. No-op when routing is disabled, the
   * project has no staffed fix lane, or no finding clears the threshold.
   */
  async function autoRouteFindings(env: Env, tenantId: number, projectId: number, candidates: QaFindingLike[]): Promise<void> {
    // Scope the policy lookup by tenant: qaRoutingSettings.projectId is UNIQUE and
    // projects.id is an enumerable serial, so loading by projectId alone would honor
    // a foreign tenant's routing row for an id that happens to collide.
    const [policy] = await db.select().from(qaRoutingSettings)
      .where(and(eq(qaRoutingSettings.tenantId, tenantId), eq(qaRoutingSettings.projectId, projectId))).limit(1);
    if (!policy || !policy.enabled) return;

    const laneKey = await findingRouter.resolveAutoFixLaneKey(projectId, policy.targetLaneKey);
    if (!laneKey) return; // no staffed fix lane → leave findings in the backlog for manual triage

    const queue = candidates
      .filter((f) => !f.taskId && meetsSeverityThreshold(f.severity, policy.minSeverity))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, Math.max(1, policy.maxPerBatch));

    for (const finding of queue) {
      try {
        const { taskId, deduped } = await findingRouter.createTaskFromFinding(finding, tenantId, { autoRouted: true });
        // A reused open task already has its own run/lane state — don't re-dispatch
        // or yank it back into the fix lane; the finding is just linked to it.
        if (deduped) continue;
        // Move the ticket into the fix lane (the lane key IS the task status) and
        // fire the canonical lane auto-run trigger — same path as a board drag.
        await taskService.updateTask(taskId, { status: laneKey });
        await onTaskLandedInLane(env, db, {
          tenantId, projectId, taskId, status: laneKey, submittedBy: 'system:qa-autoroute', runtimeService,
        });
      } catch (error) {
        // One finding's routing failure must not abort the rest of the batch.
      
        reportCaughtError(error, { source: "presentation/routes/qaRoutes.ts", operation: "autoRouteFindings" });
      }
    }
  }

  /** Resolve the target row (explicit, else the project's default) for a run. */
  async function resolveTarget(tenantId: number, projectId: number | null, targetId: string | null) {
    if (targetId) {
      const [t] = await db.select().from(qaTargets)
        .where(and(eq(qaTargets.id, targetId), eq(qaTargets.tenantId, tenantId))).limit(1);
      if (t) return t;
    }
    if (projectId != null) {
      const [t] = await db.select().from(qaTargets)
        .where(and(eq(qaTargets.tenantId, tenantId), eq(qaTargets.projectId, projectId), eq(qaTargets.status, 'active')))
        .orderBy(desc(qaTargets.isDefault), desc(qaTargets.updatedAt)).limit(1);
      if (t) return t;
    }
    return null;
  }

  // ── GET /heatmap ──────────────────────────────────────────────────────────
  // Ranked hot zones (recency-weighted interaction frequency) — the data the
  // agentic tester decides what to exercise from. Cached per tenant.
  router.get('/heatmap', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const sinceDays = c.req.query('sinceDays') ? Number(c.req.query('sinceDays')) : undefined;
    const limit     = c.req.query('limit') ? limitParam(c.req.query('limit'), 50, 500) : undefined;
    // A project-scoped read ranks that project's own site traffic (plus the
    // app-shell events that belong to no project); omitting it pools the tenant.
    const projectIdRaw = c.req.query('projectId');
    const projectId = projectIdRaw ? Number(projectIdRaw) : null;
    if (projectId !== null && !(await projectInTenant(db, tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const zones = await new QaHeatmapService(db, c.env as Env).rankZones(tenantId, { sinceDays, limit, projectId });
    return c.json({ zones, total: zones.length });
  });

  // ── POST /explorations ──────────────────────────────────────────────────────
  // Plan + queue an agentic exploration: snapshot the heatmap, derive an ordered
  // plan over the hottest zones, and persist it. A containerised harness then
  // claims it, drives a browser through the plan, and posts findings back.
  router.post('/explorations', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId    = c.get('userId') as string | undefined;
    const body = await parseBody(c, ExplorationCreateBody);

    const projectId = body.projectId ?? null;
    const heatBudget = Math.min(Math.max(1, body.heatBudget ?? 20), 100);
    const sinceDays = Math.min(Math.max(1, body.sinceDays ?? 30), 180);

    const target = await resolveTarget(tenantId, projectId, body.targetId ?? null);
    // Project mode requires a known site to drive; self-test (no project) runs
    // against the harness's BF_BASE_URL.
    if (projectId != null && !target) {
      return c.json({ error: 'Project has no active QA target (root URL). Add one first.' }, 400);
    }

    let zones = await new QaHeatmapService(db, c.env as Env)
      .rankZones(tenantId, { sinceDays, limit: heatBudget * 3, projectId });
    if (zones.length === 0) {
      // No interaction history yet (e.g. a just-deployed app with no captured
      // usage). Derive the routes the site's own root page links to, so the first
      // exploration covers the app rather than only its home page. Degrades to
      // the root alone when the target is unreachable. Once real usage is
      // captured, the heatmap takes over and this is never reached.
      zones = await deriveTargetZones(c.env as Env, target?.baseUrl ?? null, heatBudget);
    }
    const plan = buildExplorationPlan(zones, heatBudget);

    const [exploration] = await db.insert(qaExplorations).values({
      tenantId, segmentId, projectId,
      targetId: target?.id ?? null,
      credentialId: body.credentialId ?? null,
      status: 'queued', trigger: 'manual',
      heatBudget, sinceDays,
      plan: JSON.stringify(plan),
      heatZones: JSON.stringify(zones),
      model: null,
      zonesPlanned: zones.length,
      targetUrl: target?.baseUrl ?? null,
      createdBy: userId ?? null,
      updatedAt: new Date(),
    }).returning();

    // Dispatch the managed runner now so "Run" drains immediately. No-op (row
    // stays queued for an external runner) when the container binding is absent.
    let dispatched = false;
    if (exploration) {
      dispatched = await dispatchQaRunner(c.env as Env, { explorationId: exploration.id, tenantId, projectId }).catch(() => false);
    }

    return c.json({ exploration, plannedSteps: plan.length, dispatched }, 201);
  });

  // ── GET /explorations ───────────────────────────────────────────────────────
  router.get('/explorations', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const limit = limitParam(c.req.query('limit'), 50, 200);
    const conditions = [eq(qaExplorations.tenantId, tenantId)];
    if (projectId != null) conditions.push(eq(qaExplorations.projectId, projectId));
    const rows = await db.select({
      id: qaExplorations.id, projectId: qaExplorations.projectId, status: qaExplorations.status,
      trigger: qaExplorations.trigger, heatBudget: qaExplorations.heatBudget,
      zonesPlanned: qaExplorations.zonesPlanned, zonesExplored: qaExplorations.zonesExplored,
      findingsCount: qaExplorations.findingsCount, model: qaExplorations.model,
      targetUrl: qaExplorations.targetUrl, summary: qaExplorations.summary,
      errorMessage: qaExplorations.errorMessage, startedAt: qaExplorations.startedAt,
      finishedAt: qaExplorations.finishedAt, createdAt: qaExplorations.createdAt,
    })
      .from(qaExplorations)
      .where(and(...conditions))
      .orderBy(desc(qaExplorations.createdAt))
      .limit(limit);
    return c.json({ explorations: rows, total: rows.length });
  });

  // ── GET /explorations/:id ────────────────────────────────────────────────────
  // Detail + its findings (newest first), and the heat-zone snapshot it ran on.
  router.get('/explorations/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [exploration] = await db.select().from(qaExplorations)
      .where(and(eq(qaExplorations.id, c.req.param('id')), eq(qaExplorations.tenantId, tenantId))).limit(1);
    if (!exploration) return c.json({ error: 'Exploration not found' }, 404);
    const findings = await db.select().from(qaFindings)
      .where(scopedToTenant(qaFindings, tenantId, eq(qaFindings.explorationId, exploration.id)))
      .orderBy(desc(qaFindings.heat), desc(qaFindings.createdAt)).limit(LIST_ROW_CAP);
    return c.json({
      exploration: { ...exploration, plan: parsePlan(exploration.plan), heatZones: parseZones(exploration.heatZones) },
      findings,
    });
  });

  /** Build the harness bundle for a claimed/known exploration: where to run, as
   *  whom, and the plan to execute. Secrets are fetched per-credential from the
   *  existing /credentials/:id/secret endpoint. */
  async function explorationBundle(tenantId: number, exploration: ExplorationRow) {
    const target = await resolveTarget(tenantId, exploration.projectId, exploration.targetId);
    let credential: QaCredentialPublic | null = null;
    if (exploration.credentialId) {
      const [cred] = await db.select().from(qaCredentials)
        .where(and(eq(qaCredentials.id, exploration.credentialId), eq(qaCredentials.tenantId, tenantId))).limit(1);
      if (cred) credential = toPublicCredential(cred);
    }
    return {
      exploration: { id: exploration.id, status: exploration.status, projectId: exploration.projectId, heatBudget: exploration.heatBudget },
      target: target ? { id: target.id, name: target.name, baseUrl: target.baseUrl } : null,
      credential,
      plan: parsePlan(exploration.plan),
    };
  }

  // ── POST /explorations/claim ─────────────────────────────────────────────────
  // The containerised harness's one entry point. Claims a specific queued
  // exploration (explorationId) or the oldest queued one (optionally for a
  // project), flips it to running, and returns the run bundle. Returns
  // { exploration: null } when there's nothing to do.
  router.post('/explorations/claim', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, ExplorationClaimBody);

    // Pick the candidate id (explicit, else oldest queued).
    let candidateId = body.explorationId ?? null;
    if (!candidateId) {
      const conditions = [eq(qaExplorations.tenantId, tenantId), eq(qaExplorations.status, 'queued')];
      if (body.projectId != null) conditions.push(eq(qaExplorations.projectId, body.projectId));
      const [next] = await db.select({ id: qaExplorations.id }).from(qaExplorations)
        .where(and(...conditions)).orderBy(asc(qaExplorations.createdAt)).limit(1);
      candidateId = next?.id ?? null;
    }
    if (!candidateId) return c.json({ exploration: null });

    const now = new Date();
    // Conditional claim: only the harness that flips queued→running wins.
    const [claimed] = await db.update(qaExplorations)
      .set({ status: 'running', startedAt: now, updatedAt: now })
      .where(and(eq(qaExplorations.id, candidateId), eq(qaExplorations.tenantId, tenantId), eq(qaExplorations.status, 'queued')))
      .returning();

    let row = claimed;
    if (!row && body.explorationId) {
      // Explicit id that was already running (resume) — return its bundle.
      const [existing] = await db.select().from(qaExplorations)
        .where(and(eq(qaExplorations.id, candidateId), eq(qaExplorations.tenantId, tenantId), eq(qaExplorations.status, 'running'))).limit(1);
      row = existing;
    }
    if (!row) return c.json({ exploration: null }); // raced — someone else claimed it
    return c.json(await explorationBundle(tenantId, row));
  });

  // ── POST /explorations/:id/screenshot ────────────────────────────────────────
  // The harness uploads the page image it captured at the moment a finding was
  // recorded, and gets back the key to attach to that finding. Raw bytes rather
  // than multipart: the runner has an image buffer, not a form.
  router.post('/explorations/:id/screenshot', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [exploration] = await db.select({ id: qaExplorations.id }).from(qaExplorations)
      .where(and(eq(qaExplorations.id, c.req.param('id')), eq(qaExplorations.tenantId, tenantId))).limit(1);
    if (!exploration) return c.json({ error: 'Exploration not found' }, 404);

    const result = await putFindingScreenshot((c.env as { UPLOADS?: R2Bucket }).UPLOADS, {
      tenantId,
      explorationId: exploration.id,
      contentType: c.req.header('content-type') ?? '',
      bytes: await c.req.arrayBuffer(),
    });
    if (!result.ok) return statusResponse(c, { error: result.reason }, result.status, { source: 'presentation/routes/qaRoutes.ts', operation: 'ingestReport' });
    return c.json({ screenshotKey: result.key }, 201);
  });

  // ── GET /screenshots/* ───────────────────────────────────────────────────────
  // Stream a stored screenshot back to the findings UI. The tenant is IN the key,
  // so another workspace's key cannot resolve here even if it were guessed.
  router.get('/screenshots/*', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const key = wildcardPath(c);
    const obj = await getFindingScreenshot((c.env as { UPLOADS?: R2Bucket }).UPLOADS, tenantId, key);
    if (!obj) return c.json({ error: 'Screenshot not found' }, 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.contentType,
        'Content-Length': String(obj.size),
        // Immutable: the key contains a uuid, so a given key's bytes never change.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });

  // ── POST /explorations/:id/findings ──────────────────────────────────────────
  // The harness posts a batch of captured runtime errors. Deduped per run by
  // fingerprint; the rolled-up findingsCount is refreshed from the table.
  router.post('/explorations/:id/findings', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const [exploration] = await db.select().from(qaExplorations)
      .where(and(eq(qaExplorations.id, c.req.param('id')), eq(qaExplorations.tenantId, tenantId))).limit(1);
    if (!exploration) return c.json({ error: 'Exploration not found' }, 404);

    const body = await parseBody(c, FindingsBody);
    const incoming = (body.findings ?? []).slice(0, 500);
    if (incoming.length === 0) return c.json({ inserted: 0 });

    const now = new Date();
    const rows = incoming
      .filter((f) => f.message.length > 0)
      .map((f) => {
        const type = f.type ?? 'console';
        const heat = typeof f.heat === 'number' ? f.heat : 0;
        return {
          explorationId: exploration.id, tenantId, segmentId,
          projectId: exploration.projectId,
          type,
          severity: f.severity ?? defaultFindingSeverity(type, heat),
          route: f.route ? f.route.slice(0, 512) : null,
          selector: f.selector ? f.selector.slice(0, 4000) : null,
          message: f.message.slice(0, 4000),
          detail: f.detail ? f.detail.slice(0, 20_000) : null,
          heat,
          screenshotKey: f.screenshotKey ? f.screenshotKey.slice(0, 512) : null,
          status: 'open',
          fingerprint: findingFingerprint({ type, route: f.route, selector: f.selector, message: f.message }),
          createdAt: now,
        };
      });

    let inserted: QaFindingLike[] = [];
    if (rows.length > 0) {
      // Dedupe within the run — re-posting the same error is a no-op. `returning`
      // gives us only the rows that were actually inserted (not the deduped ones),
      // which is exactly the set eligible for auto-routing.
      inserted = await db
        .insert(qaFindings)
        .values(rows)
        .onConflictDoNothing({ target: [qaFindings.explorationId, qaFindings.fingerprint] })
        .returning({
          id: qaFindings.id, explorationId: qaFindings.explorationId, projectId: qaFindings.projectId,
          type: qaFindings.type, severity: qaFindings.severity, route: qaFindings.route,
          selector: qaFindings.selector, message: qaFindings.message, detail: qaFindings.detail,
          heat: qaFindings.heat, taskId: qaFindings.taskId, fingerprint: qaFindings.fingerprint,
        });
      // A new finding moves the quality trend — invalidate the cached rollup.
      void bumpCacheVersion(c.env as Env, QA_QUALITY_VERSION_KEY(tenantId)).catch((error) => {
        reportCaughtError(error, { source: "presentation/routes/qaRoutes.ts", operation: "createQaRoutes" });
      });
    }

    // Refresh the rolled-up count from the source of truth.
    const all = await db.select({ id: qaFindings.id }).from(qaFindings).where(scopedToTenant(qaFindings, tenantId, eq(qaFindings.explorationId, exploration.id)));
    await db.update(qaExplorations).set({ findingsCount: all.length, updatedAt: new Date() })
      .where(scopedToTenant(qaExplorations, tenantId, eq(qaExplorations.id, exploration.id)));

    // Opt-in autonomous remediation: route qualifying findings to a fix agent off
    // the harness response path (best-effort; no-op unless the project enabled it).
    if (inserted.length > 0 && exploration.projectId != null) {
      const projectId = exploration.projectId;
      c.executionCtx.waitUntil(autoRouteFindings(c.env as Env, tenantId, projectId, inserted));
    }

    // Workflow triggers: one event per GENUINELY NEW finding (`inserted`, not
    // `rows` — a re-posted fingerprint is not new information and must not
    // re-fire someone's escalation). Off the response path; a trigger failure
    // must never cost the harness its findings.
    if (inserted.length > 0) {
      const env = c.env as Env;
      c.executionCtx.waitUntil(Promise.all(inserted.map((f) => fireEventTriggers(db, {
        tenantId, env,
        eventType: 'qa-finding',
        payload: {
          findingId: f.id, explorationId: f.explorationId, projectId: f.projectId,
          type: f.type, severity: f.severity, route: f.route, message: f.message, heat: f.heat,
        },
        match: { findingSeverity: f.severity, findingType: f.type },
      }).catch(() => undefined))).then(() => undefined));
    }

    return c.json({ inserted: rows.length, findingsCount: all.length }, 201);
  });

  // ── PATCH /explorations/:id ──────────────────────────────────────────────────
  // The harness reports the rolled-up run outcome (running → passed/failed/error).
  router.patch('/explorations/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [exploration] = await db.select({ id: qaExplorations.id }).from(qaExplorations)
      .where(and(eq(qaExplorations.id, c.req.param('id')), eq(qaExplorations.tenantId, tenantId))).limit(1);
    if (!exploration) return c.json({ error: 'Exploration not found' }, 404);

    const body = await parseBody(c, ExplorationOutcomeBody);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) patch.status = body.status;
    if (body.zonesExplored !== undefined) patch.zonesExplored = body.zonesExplored;
    if (body.browser !== undefined) patch.browser = body.browser;
    if (body.targetUrl !== undefined) patch.targetUrl = body.targetUrl;
    if (body.commitSha !== undefined) patch.commitSha = body.commitSha;
    if (body.runKey !== undefined) patch.runKey = body.runKey;
    if (body.summary !== undefined) patch.summary = body.summary?.slice(0, 8000);
    if (body.errorMessage !== undefined) patch.errorMessage = body.errorMessage?.slice(0, 8000);
    if (body.status && ['passed', 'failed', 'error'].includes(body.status)) patch.finishedAt = new Date();

    const [updated] = await db.update(qaExplorations).set(patch)
      .where(and(eq(qaExplorations.id, c.req.param('id')), eq(qaExplorations.tenantId, tenantId))).returning();

    // A finished run is a fact a workflow can react to — "the nightly explore
    // failed, tell the team" — and it fires ONCE per run, on the terminal
    // transition only, so a mid-run progress PATCH cannot spam it.
    if (updated && body.status && ['passed', 'failed', 'error'].includes(body.status)) {
      const env = c.env as Env;
      c.executionCtx.waitUntil(fireEventTriggers(db, {
        tenantId, env,
        eventType: 'qa-exploration-complete',
        payload: {
          explorationId: updated.id, projectId: updated.projectId, status: updated.status,
          findingsCount: updated.findingsCount, zonesExplored: updated.zonesExplored,
          targetUrl: updated.targetUrl, summary: updated.summary, browser: updated.browser,
        },
        match: { explorationOutcome: updated.status },
      }).then(() => undefined).catch(() => undefined));
    }
    return c.json({ exploration: updated });
  });

  // ── POST /findings/:id/task ──────────────────────────────────────────────────
  // Feed a finding back into the loop: open a board task on its project so an
  // agent (or human) can fix it, link them, and mark the finding task_created.
  router.post('/findings/:id/task', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [finding] = await db.select().from(qaFindings)
      .where(and(eq(qaFindings.id, c.req.param('id')), eq(qaFindings.tenantId, tenantId))).limit(1);
    if (!finding) return c.json({ error: 'Finding not found' }, 404);
    if (finding.taskId) return c.json({ error: 'A task already exists for this finding', taskId: finding.taskId }, 409);
    if (finding.projectId == null) {
      return c.json({ error: 'This finding has no project — self-test findings cannot create board tasks.' }, 400);
    }

    // createTaskFromFinding throws typed domain errors (ValidationError /
    // ConflictError) for the caller's mistakes; anything else is an invariant
    // failure for the global handler, not a 400 wearing its message.
    const { taskId, plain, deduped } = await findingRouter.createTaskFromFinding(finding, tenantId, { env: c.env as Env });
    return c.json({ task: plain, deduped, finding: { ...finding, status: 'task_created', taskId } }, 201);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Schedules — run the Agentic Tester on a cadence (platform-driven, no CI).
  // The */5 cron sweep (runQaExplorationSweep) enqueues an exploration per due
  // schedule. Configured per project in Observability ▸ Agentic QA.
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/projects/:projectId/schedules', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    const rows = await db
      .select()
      .from(qaSchedules)
      .where(and(eq(qaSchedules.tenantId, tenantId), eq(qaSchedules.projectId, projectId)))
      .orderBy(desc(qaSchedules.updatedAt)).limit(LIST_ROW_CAP);
    return c.json({ schedules: rows });
  });

  router.post('/projects/:projectId/schedules', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId    = c.get('userId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    const body = await parseBody(c, ScheduleCreateBody);
    const timezone = body.timezone ?? 'UTC';
    const [schedule] = await db
      .insert(qaSchedules)
      .values({
        tenantId, segmentId, projectId,
        targetId: body.targetId ?? null, credentialId: body.credentialId ?? null,
        cron: body.cron, timezone,
        enabled: body.enabled ?? true,
        heatBudget: Math.min(Math.max(1, body.heatBudget ?? 20), 100),
        sinceDays: Math.min(Math.max(1, body.sinceDays ?? 30), 180),
        nextRunAt: nextCronTime(body.cron, new Date(), timezone),
        createdBy: userId ?? null, updatedAt: new Date(),
      })
      .returning();
    return c.json({ schedule }, 201);
  });

  router.patch('/schedules/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, SchedulePatchBody);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['cron', 'timezone', 'enabled', 'targetId', 'credentialId', 'heatBudget', 'sinceDays'] as const) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    // Re-arm next_run_at when the cadence changes or the schedule is (re)enabled.
    if (body.cron !== undefined || body.enabled === true) {
      const [existing] = await db.select().from(qaSchedules)
        .where(and(eq(qaSchedules.id, c.req.param('id')), eq(qaSchedules.tenantId, tenantId))).limit(1);
      if (existing) patch.nextRunAt = nextCronTime(body.cron ?? existing.cron, new Date(), body.timezone ?? existing.timezone);
    }
    const [schedule] = await db
      .update(qaSchedules).set(patch)
      .where(and(eq(qaSchedules.id, c.req.param('id')), eq(qaSchedules.tenantId, tenantId)))
      .returning();
    if (!schedule) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ schedule });
  });

  router.delete('/schedules/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [schedule] = await db
      .delete(qaSchedules)
      .where(and(eq(qaSchedules.id, c.req.param('id')), eq(qaSchedules.tenantId, tenantId)))
      .returning();
    if (!schedule) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ deleted: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Routing settings (migration 0214) — per-project policy for auto-routing the
  // Agentic Tester's findings to a fix agent. Off by default (auto-routing spends
  // on agent runs). The findings-ingestion path reads this to decide.
  // ═══════════════════════════════════════════════════════════════════════════

  /** The defaults a project that has never configured routing reads as. */
  const ROUTING_DEFAULTS = { enabled: false, minSeverity: 'high', targetLaneKey: null as string | null, maxPerBatch: 5 };

  router.get('/projects/:projectId/routing', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    const [row] = await db.select().from(qaRoutingSettings)
      .where(and(eq(qaRoutingSettings.tenantId, tenantId), eq(qaRoutingSettings.projectId, projectId))).limit(1);
    return c.json({
      settings: row
        ? { enabled: row.enabled, minSeverity: row.minSeverity, targetLaneKey: row.targetLaneKey, maxPerBatch: row.maxPerBatch }
        : ROUTING_DEFAULTS,
    });
  });

  router.put('/projects/:projectId/routing', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId    = c.get('userId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    const body = await parseBody(c, RoutingSettingsBody);
    const minSeverity = body.minSeverity ?? ROUTING_DEFAULTS.minSeverity;
    const targetLaneKey = body.targetLaneKey ? body.targetLaneKey.slice(0, 120) : null;
    const maxPerBatch = Math.min(Math.max(1, Math.trunc(body.maxPerBatch ?? ROUTING_DEFAULTS.maxPerBatch)), 50);

    // Ownership gate: projects.id is an enumerable serial and qaRoutingSettings.projectId
    // is UNIQUE (global conflict target), so without this check tenant A could upsert
    // over tenant B's routing row by supplying B's projectId in the URL.
    const ownedProject = await loadProjectInTenant(db, tenantId, projectId, { id: projects.id });
    if (!ownedProject) return c.json({ error: 'Project not found' }, 404);

    const now = new Date();
    const [row] = await db
      .insert(qaRoutingSettings)
      .values({ tenantId, segmentId, projectId, enabled: body.enabled ?? false, minSeverity, targetLaneKey, maxPerBatch, createdBy: userId ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: qaRoutingSettings.projectId,
        set: { enabled: body.enabled ?? false, minSeverity, targetLaneKey, maxPerBatch, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error('qa_routing_settings upsert returned no row');
    return c.json({ settings: { enabled: row.enabled, minSeverity: row.minSeverity, targetLaneKey: row.targetLaneKey, maxPerBatch: row.maxPerBatch } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Quality trend (migration 0214) — the QA / Tech-Lead lens. Escaped defects
  // (findings) + caught defects (CI build failures) + which model/agent produced
  // the work (run_model_outcomes), rolled up per project + window. Cached.
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/quality', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const days = daysParam(c.req.query('days'), 30, 180);
    const trend = await getProjectQualityTrend(c.env as Env, db, tenantId, projectId, days);
    return c.json({ trend });
  });

  return router;
}
