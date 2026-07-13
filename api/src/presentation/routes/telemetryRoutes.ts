/**
 * Telemetry routes – /api/telemetry
 *
 * OTel-compatible span ingest and query endpoint for BuilderForce Agents agent telemetry.
 * Spans are forwarded here from the BuilderForce Agents workflow-telemetry module via
 * the X-Trace-Id header.
 *
 * POST /api/telemetry/spans        Ingest a batch of spans (agentHost API key auth)
 * GET  /api/telemetry/spans        Query spans by traceId, workflowId, or date range (JWT auth)
 * GET  /api/telemetry/traces       List distinct traces for a tenant (JWT auth)
 */

import { Hono } from 'hono';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { telemetrySpans } from '../../infrastructure/database/schema';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { MILLICENTS_PER_USD } from '../../domain/shared/money';

export function createTelemetryRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── POST /api/telemetry/spans ─────────────────────────────────────────────
  // Accepts a JSON array of WorkflowSpan objects (same shape as BuilderForce Agents emits).
  // Auth: ?agentHostId=&key= (agentHost API key) OR tenant JWT.
  router.post('/spans', async (c) => {
    let tenantId: number;
    let resolvedAgentHostId: number | null = null;

    const agentHostIdParam = Number(c.req.query('agentHostId') ?? '');
    const apiKey = c.req.query('key');
    if (!Number.isNaN(agentHostIdParam) && agentHostIdParam > 0 && apiKey) {
      const agentHost = await verifyAgentHostApiKey(db, agentHostIdParam, apiKey);
      if (!agentHost) return c.text('Unauthorized', 401);
      tenantId = agentHost.tenantId;
      resolvedAgentHostId = agentHost.id;
    } else {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (!tid) return c.text('Unauthorized', 401);
      tenantId = tid as number;
    }

    // Also accept traceId from header (set by BuilderForce Agents agentlink-relay)
    const headerTraceId = c.req.header('X-Trace-Id') ?? null;

    type IncomingSpan = {
      kind: string;
      workflowId?: string;
      taskId?: string;
      agentRole?: string;
      description?: string;
      ts?: string;
      durationMs?: number;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCostUsd?: number;
      error?: string;
      traceId?: string;
      agentHostId?: string;
    };

    let spans: IncomingSpan[];
    try {
      const body = await c.req.json();
      spans = Array.isArray(body) ? body : [body];
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (spans.length === 0) return c.json({ inserted: 0 });
    if (spans.length > 500) return c.json({ error: 'Batch too large (max 500 spans)' }, 400);

    const now = new Date();
    const rows = spans.map((span) => ({
      tenantId,
      agentHostId:           resolvedAgentHostId,
      traceId:          span.traceId ?? headerTraceId ?? 'unknown',
      workflowId:       span.workflowId ?? null,
      taskId:           span.taskId ?? null,
      kind:             span.kind,
      agentRole:        span.agentRole ?? null,
      description:      span.description ?? null,
      durationMs:       span.durationMs ?? null,
      model:            span.model ?? null,
      inputTokens:      span.inputTokens ?? null,
      outputTokens:     span.outputTokens ?? null,
      // Store cost as millicents integer (avoids float precision issues)
      estimatedCostUsd: span.estimatedCostUsd != null
        ? Math.round(span.estimatedCostUsd * 100_000)
        : null,
      error:            span.error ?? null,
      ts:               span.ts ? new Date(span.ts) : now,
      createdAt:        now,
    }));

    await db.insert(telemetrySpans).values(rows);
    return c.json({ inserted: rows.length }, 201);
  });

  // All read routes require tenant JWT
  router.use('*', authMiddleware);

  // ── GET /api/telemetry/spans ──────────────────────────────────────────────
  // Query params: traceId, workflowId, agentHostId, from (ISO), to (ISO), limit (default 200)
  router.get('/spans', async (c) => {
    const tenantId    = c.get('tenantId') as number;
    const traceId     = c.req.query('traceId');
    const workflowId  = c.req.query('workflowId');
    const agentHostIdParam = c.req.query('agentHostId') ? Number(c.req.query('agentHostId')) : null;
    const from        = c.req.query('from');
    const to          = c.req.query('to');
    const limit       = Math.min(Number(c.req.query('limit') ?? '200'), 500);

    const conditions = [eq(telemetrySpans.tenantId, tenantId)];
    if (traceId)           conditions.push(eq(telemetrySpans.traceId, traceId));
    if (workflowId)        conditions.push(eq(telemetrySpans.workflowId, workflowId));
    if (agentHostIdParam != null) conditions.push(eq(telemetrySpans.agentHostId, agentHostIdParam));
    if (from)              conditions.push(gte(telemetrySpans.ts, new Date(from)));
    if (to)                conditions.push(lte(telemetrySpans.ts, new Date(to)));

    const rows = await db
      .select()
      .from(telemetrySpans)
      .where(and(...conditions))
      .orderBy(desc(telemetrySpans.ts))
      .limit(limit);

    // Convert millicents back to USD for clients
    const result = rows.map((r) => ({
      ...r,
      estimatedCostUsd: r.estimatedCostUsd != null ? r.estimatedCostUsd / MILLICENTS_PER_USD : null,
    }));

    return c.json({ spans: result, total: result.length });
  });

  // ── GET /api/telemetry/traces ─────────────────────────────────────────────
  // Returns distinct trace IDs with summary stats (span count, total cost, duration).
  router.get('/traces', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit    = Math.min(Number(c.req.query('limit') ?? '50'), 200);
    const from     = c.req.query('from');

    const conditions = [eq(telemetrySpans.tenantId, tenantId)];
    if (from) conditions.push(gte(telemetrySpans.ts, new Date(from)));

    // Fetch spans and group in JS (drizzle doesn't expose groupBy with custom aggregates nicely)
    const rows = await db
      .select({
        traceId:          telemetrySpans.traceId,
        workflowId:       telemetrySpans.workflowId,
        agentHostId:           telemetrySpans.agentHostId,
        kind:             telemetrySpans.kind,
        durationMs:       telemetrySpans.durationMs,
        estimatedCostUsd: telemetrySpans.estimatedCostUsd,
        ts:               telemetrySpans.ts,
      })
      .from(telemetrySpans)
      .where(and(...conditions))
      .orderBy(desc(telemetrySpans.ts))
      .limit(limit * 20); // over-fetch to aggregate

    const traceMap = new Map<string, {
      traceId: string;
      workflowId: string | null;
      agentHostId: number | null;
      spanCount: number;
      totalDurationMs: number;
      totalCostMillicents: number;
      firstSeen: Date;
      lastSeen: Date;
    }>();

    for (const row of rows) {
      const existing = traceMap.get(row.traceId);
      if (!existing) {
        traceMap.set(row.traceId, {
          traceId:             row.traceId,
          workflowId:          row.workflowId,
          agentHostId:              row.agentHostId,
          spanCount:           1,
          totalDurationMs:     row.durationMs ?? 0,
          totalCostMillicents: row.estimatedCostUsd ?? 0,
          firstSeen:           row.ts,
          lastSeen:            row.ts,
        });
      } else {
        existing.spanCount++;
        existing.totalDurationMs += row.durationMs ?? 0;
        existing.totalCostMillicents += row.estimatedCostUsd ?? 0;
        if (row.ts < existing.firstSeen) existing.firstSeen = row.ts;
        if (row.ts > existing.lastSeen) existing.lastSeen = row.ts;
      }
    }

    const traces = Array.from(traceMap.values())
      .slice(0, limit)
      .map((t) => ({
        ...t,
        totalCostUsd: t.totalCostMillicents / MILLICENTS_PER_USD,
        totalCostMillicents: undefined,
      }));

    return c.json({ traces, total: traces.length });
  });

  return router;
}
