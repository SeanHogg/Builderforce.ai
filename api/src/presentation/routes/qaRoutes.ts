/**
 * Agentic QA routes — /api/qa
 *
 * Capture → aggregate → generate → execute → report. All routes require a
 * tenant JWT (the frontend capture client uses the logged-in user's tenant
 * token; the CI harness logs in as the QA tenant and uses its token).
 *
 *   POST  /events            Ingest a batch of client journey events
 *   GET   /events            Recent journey events (debug)
 *   POST  /flows/aggregate   Collapse journeys into qa_flows
 *   POST  /flows/crawl       Seed a crawl flow from an explicit route map
 *   POST  /flows             Create a manual flow
 *   GET   /flows             List flows
 *   POST  /generate          Generate a Playwright spec for a flow (LLM)
 *   GET   /tests             List generated tests (CI harness pulls 'active')
 *   GET   /tests/:id         One test (spec source)
 *   PATCH /tests/:id         Update test status (activate / archive)
 *   POST  /runs              CI posts back an execution report
 *   GET   /runs              Recent runs (results UI)
 *   GET   /runs/:id          One run + its steps
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { qaFlows, qaJourneyEvents, qaRunSteps, qaRuns, qaTests } from '../../infrastructure/database/schema';
import { QaFlowService } from '../../application/qa/QaFlowService';
import { QaGeneratorService } from '../../application/qa/QaGeneratorService';
import { type QaRunReport, type QaStep, shortHash, toSlug } from '../../application/qa/qaTypes';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
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

export function createQaRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Every QA endpoint requires an authenticated tenant.
  router.use('*', authMiddleware);

  // ── POST /events ──────────────────────────────────────────────────────────
  // Body: { sessionId, events: IncomingEvent[] }  (events also accepted as a
  // bare array with a top-level sessionId query param). Fire-and-store; capture
  // must never break the app, so malformed rows are skipped, not rejected.
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
    const body = await c.req.json().catch(() => ({})) as { sinceDays?: number; minRoutes?: number; maxFlows?: number };
    const result = await new QaFlowService(db).aggregate(tenantId, segmentId, body);
    return c.json(result);
  });

  // ── POST /flows/crawl ─────────────────────────────────────────────────────
  // Seed a crawl flow from an explicit route map (the AI-crawl mode: no real
  // usage needed). Produces one flow that visits each route and asserts health.
  router.post('/flows/crawl', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const body = await c.req.json().catch(() => ({})) as { routes?: string[]; name?: string };
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
        tenantId, segmentId, name, slug, source: 'crawl',
        description: `AI-crawl smoke over ${routes.length} route(s).`,
        startRoute: routes[0] ?? null,
        steps: JSON.stringify(steps), frequency: 0, status: 'active', updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qaFlows.tenantId, qaFlows.slug],
        set: { steps: JSON.stringify(steps), startRoute: routes[0] ?? null, updatedAt: now },
      })
      .returning();
    return c.json({ flow }, 201);
  });

  // ── POST /flows (manual) ──────────────────────────────────────────────────
  router.post('/flows', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const body = await c.req.json().catch(() => ({})) as { name?: string; startRoute?: string; steps?: QaStep[]; description?: string };
    if (!body.name || !Array.isArray(body.steps)) return c.json({ error: 'name and steps[] required' }, 400);
    const slug = `manual-${toSlug(body.name)}-${shortHash(JSON.stringify(body.steps))}`;
    const now = new Date();
    const [flow] = await db
      .insert(qaFlows)
      .values({
        tenantId, segmentId, name: body.name, slug, source: 'manual',
        description: body.description ?? null, startRoute: body.startRoute ?? null,
        steps: JSON.stringify(body.steps), frequency: 0, status: 'active', updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qaFlows.tenantId, qaFlows.slug],
        set: { steps: JSON.stringify(body.steps), updatedAt: now },
      })
      .returning();
    return c.json({ flow }, 201);
  });

  // ── GET /flows ────────────────────────────────────────────────────────────
  router.get('/flows', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select()
      .from(qaFlows)
      .where(eq(qaFlows.tenantId, tenantId))
      .orderBy(desc(qaFlows.frequency), desc(qaFlows.updatedAt))
      .limit(200);
    return c.json({ flows: rows.map((f) => ({ ...f, steps: parseSteps(f.steps) })), total: rows.length });
  });

  // ── POST /generate ────────────────────────────────────────────────────────
  // Body: { flowId }. Generates (or regenerates, bumping version) a Playwright
  // spec for the flow and upserts it into qa_tests.
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

    const steps = parseSteps(flow.steps);
    const gen = await new QaGeneratorService(c.env).generate({
      name: flow.name, slug: flow.slug, description: flow.description, startRoute: flow.startRoute, steps,
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
        tenantId, segmentId, flowId: flow.id, name: flow.name, slug: testSlug,
        framework: 'playwright', spec: gen.spec, stepsModel: JSON.stringify(gen.steps),
        model: gen.model, generatedBy: userId ?? null, version: (existing?.version ?? 0) + 1,
        status: 'active', updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [qaTests.tenantId, qaTests.slug],
        set: {
          spec: gen.spec, stepsModel: JSON.stringify(gen.steps), model: gen.model,
          version: (existing?.version ?? 0) + 1, generatedBy: userId ?? null,
          status: 'active', updatedAt: now,
        },
      })
      .returning();
    return c.json({ test, usedModel: gen.model ?? 'deterministic-fallback' }, 201);
  });

  // ── GET /tests ────────────────────────────────────────────────────────────
  router.get('/tests', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const status = c.req.query('status');
    const conditions = [eq(qaTests.tenantId, tenantId)];
    if (status) conditions.push(eq(qaTests.status, status));
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
  router.patch('/tests/:id', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json().catch(() => ({})) as { status?: string };
    if (!body.status) return c.json({ error: 'status required' }, 400);
    const [test] = await db
      .update(qaTests)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(qaTests.id, c.req.param('id')), eq(qaTests.tenantId, tenantId)))
      .returning();
    if (!test) return c.json({ error: 'Test not found' }, 404);
    return c.json({ test });
  });

  // ── POST /runs ────────────────────────────────────────────────────────────
  // CI harness posts back one test's execution result + per-step detail.
  router.post('/runs', async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string | undefined;
    const report = await c.req.json().catch(() => null) as QaRunReport | null;
    if (!report || typeof report.status !== 'string') return c.json({ error: 'Invalid run report' }, 400);

    // Resolve the test by id or slug (CI usually knows the slug it ran).
    let testId: string | null = report.testId ?? null;
    if (!testId && report.testSlug) {
      const [t] = await db
        .select({ id: qaTests.id })
        .from(qaTests)
        .where(and(eq(qaTests.tenantId, tenantId), eq(qaTests.slug, report.testSlug)))
        .limit(1);
      testId = t?.id ?? null;
    }

    const now = new Date();
    const totalSteps = report.steps?.length ?? null;
    const passedSteps = report.steps?.filter((s) => s.status === 'passed').length ?? null;
    const [run] = await db
      .insert(qaRuns)
      .values({
        tenantId, segmentId, testId, runKey: report.runKey ?? null,
        trigger: 'ci', status: report.status,
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
    const limit = Math.min(Number(c.req.query('limit') ?? '100'), 500);
    const rows = await db
      .select({
        id: qaRuns.id, testId: qaRuns.testId, status: qaRuns.status, browser: qaRuns.browser,
        targetUrl: qaRuns.targetUrl, commitSha: qaRuns.commitSha, durationMs: qaRuns.durationMs,
        totalSteps: qaRuns.totalSteps, passedSteps: qaRuns.passedSteps, errorMessage: qaRuns.errorMessage,
        createdAt: qaRuns.createdAt, testName: qaTests.name, testSlug: qaTests.slug,
      })
      .from(qaRuns)
      .leftJoin(qaTests, eq(qaRuns.testId, qaTests.id))
      .where(eq(qaRuns.tenantId, tenantId))
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

  return router;
}
