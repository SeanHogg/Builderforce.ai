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
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  qaCredentials,
  qaFlows,
  qaJourneyEvents,
  qaRunSteps,
  qaRuns,
  qaTargets,
  qaTests,
} from '../../infrastructure/database/schema';
import { QaFlowService } from '../../application/qa/QaFlowService';
import { QaGeneratorService } from '../../application/qa/QaGeneratorService';
import {
  inferPersonaRole,
  type QaCredentialPublic,
  type QaRunReport,
  type QaStep,
  shortHash,
  toSlug,
} from '../../application/qa/qaTypes';
import { decryptSecretFromStorage, encryptSecretForStorage } from '../../infrastructure/auth/MfaService';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const MAX_EVENT_BATCH = 200;

interface IncomingEvent {
  seq?: number;
  type: string;
  route?: string;
  selector?: string;
  label?: string;
  value?: string;
  meta?: unknown;
  ts?: string;
}

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
  return env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
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

export function createQaRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Every QA endpoint requires an authenticated tenant.
  router.use('*', authMiddleware);

  // ── POST /events ──────────────────────────────────────────────────────────
  router.post('/events', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const userId    = c.get('userId') as string | undefined;

    let body: { sessionId?: string; events?: IncomingEvent[] };
    try {
      const json = await c.req.json();
      body = Array.isArray(json) ? { events: json } : json;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const sessionId = (body.sessionId ?? c.req.query('sessionId') ?? '').slice(0, 64);
    const events = Array.isArray(body.events) ? body.events : [];
    if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);
    if (events.length === 0) return c.json({ inserted: 0 });
    if (events.length > MAX_EVENT_BATCH) return c.json({ error: `Batch too large (max ${MAX_EVENT_BATCH})` }, 400);

    const now = new Date();
    const rows = events
      .filter((e) => typeof e?.type === 'string')
      .map((e, i) => ({
        tenantId,
        segmentId,
        userId: userId ?? null,
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

    if (rows.length > 0) await db.insert(qaJourneyEvents).values(rows);
    return c.json({ inserted: rows.length }, 201);
  });

  // ── GET /events ───────────────────────────────────────────────────────────
  router.get('/events', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? '200'), 1000);
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
    const body = await c.req.json().catch(() => ({})) as { sinceDays?: number; minRoutes?: number; maxFlows?: number; projectId?: number; maxEvents?: number };
    const result = await new QaFlowService(db).aggregate(tenantId, segmentId, body);
    return c.json(result);
  });

  // ── POST /flows/crawl ─────────────────────────────────────────────────────
  router.post('/flows/crawl', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const body = await c.req.json().catch(() => ({})) as { routes?: string[]; name?: string; projectId?: number };
    const routes = (body.routes ?? []).filter((r) => typeof r === 'string' && r.startsWith('/'));
    if (routes.length === 0) return c.json({ error: 'routes[] (absolute paths) required' }, 400);

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
    const body = await c.req.json().catch(() => ({})) as { name?: string; startRoute?: string; steps?: QaStep[]; description?: string; projectId?: number; personaRole?: string };
    if (!body.name || !Array.isArray(body.steps)) return c.json({ error: 'name and steps[] required' }, 400);
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
    const body = await c.req.json().catch(() => ({})) as { flowId?: string };
    if (!body.flowId) return c.json({ error: 'flowId required' }, 400);

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
    const body = await c.req.json().catch(() => ({})) as { status?: string; credentialId?: string | null };
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
    const report = await c.req.json().catch(() => null) as QaRunReport | null;
    if (!report || typeof report.status !== 'string') return c.json({ error: 'Invalid run report' }, 400);

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
    const limit = Math.min(Number(c.req.query('limit') ?? '100'), 500);
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
      .orderBy(qaRunSteps.seq);
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
      .orderBy(desc(qaTargets.isDefault), desc(qaTargets.updatedAt));
    return c.json({ targets: rows });
  });

  router.post('/projects/:projectId/targets', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    const body = await c.req.json().catch(() => ({})) as { name?: string; baseUrl?: string; isDefault?: boolean };
    if (!body.name || !body.baseUrl) return c.json({ error: 'name and baseUrl required' }, 400);
    const [target] = await db
      .insert(qaTargets)
      .values({ tenantId, segmentId, projectId, name: body.name, baseUrl: body.baseUrl, isDefault: body.isDefault ?? false, updatedAt: new Date() })
      .returning();
    return c.json({ target }, 201);
  });

  router.patch('/targets/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json().catch(() => ({})) as { name?: string; baseUrl?: string; isDefault?: boolean; status?: string };
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
      .orderBy(desc(qaCredentials.updatedAt));
    return c.json({ credentials: rows.map(toPublicCredential) });
  });

  router.post('/projects/:projectId/credentials', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const projectId = Number(c.req.param('projectId'));
    const body = await c.req.json().catch(() => ({})) as { label?: string; role?: string; username?: string; password?: string; loginUrl?: string; loginSelectors?: unknown };
    if (!body.label || !body.username || !body.password) return c.json({ error: 'label, username, password required' }, 400);
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
    if (!cred) return c.json({ error: 'Failed to create credential' }, 500);
    return c.json({ credential: toPublicCredential(cred) }, 201);
  });

  router.patch('/credentials/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json().catch(() => ({})) as { label?: string; role?: string; username?: string; password?: string; loginUrl?: string; status?: string };
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
    let password: string;
    try {
      password = await decryptSecretFromStorage(cred.secretEnc, credentialKey(c.env));
    } catch {
      return c.json({ error: 'Credential secret could not be decrypted' }, 500);
    }
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
      db.select().from(qaTargets).where(and(eq(qaTargets.tenantId, tenantId), eq(qaTargets.projectId, projectId), eq(qaTargets.status, 'active'))).orderBy(desc(qaTargets.isDefault)),
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

  return router;
}
