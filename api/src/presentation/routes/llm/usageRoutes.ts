/**
 * Tenant consumption + builder Insights surfaces.
 *
 * GET /v1/usage?days=30                — tenant-scoped LLM consumption (all members)
 * GET /v1/builder-insights             — the cheap, cacheable "current state" snapshot
 * GET /v1/builder-insights/stream      — the SSE push surface of the same snapshot
 */
import type { Hono } from 'hono';
import type { Env, HonoEnv } from '../../../env';
import { reportCaughtError } from '../../../application/observability/caughtErrorReporter';
import { requestDb } from '../../../application/shared/dbHandle';
import { tenantUsageDetail, tenantUsageSummary } from '../../../application/llm/usageReports';
import { getCachedBuilderInsightsSnapshot } from '../../../application/insights/builderInsights';
import { positiveIntOrNull, boundedIntParam, daysParam, limitParam } from '../queryParams';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountUsageRoutes(router: Hono<HonoEnv>): void {
  router.get('/v1/usage', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const days = daysParam(c.req.query('days'), 30, 90);
    // A thin adapter over THE usage query use case (application/llm/usageQuery), which
    // resolves the ledger's own database — the operational one in production.
    const core = requestDb(c);

    // ── Detail mode — row-level pageable per-call ledger for reconciliation
    // against the caller's own usage table. Same auth, same tenant scoping.
    if (c.req.query('detail') === 'true') {
      const limit = limitParam(c.req.query('limit'), 100, 500);
      const page  = boundedIntParam(c.req.query('page'), { def: 1, min: 1 });
      return c.json(await tenantUsageDetail(core, access.tenantId, { days, limit, page }));
    }

    const summary = await tenantUsageSummary(c.env as Env, core, access.tenantId, access.userId, days);
    return c.json({
      days,
      tenantId: access.tenantId,
      plan: access.plan,
      effectivePlan: access.effectivePlan,
      billingStatus: access.billingStatus,
      ...summary,
    });
  });

  // Builder-level Insights snapshot — the cheap, cacheable "current state" the IDE/CLI
  // poll-once or render on demand. Tenant (and caller) scoped, optionally narrowed to
  // one project via ?projectId= (bad/blank values collapse to whole-tenant scope).
  router.get('/v1/builder-insights', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const db = requestDb(c);
    const snapshot = await getCachedBuilderInsightsSnapshot(db, c.env, {
      tenantId: access.tenantId,
      userId: access.userId,
      projectId: positiveIntOrNull(c.req.query('projectId')),
    });
    return c.json(snapshot);
  });

  // Server-Sent Events — the PUSH surface. Emits a snapshot immediately, then one
  // every 60s (up to ~5 min), then closes; the client reconnects. Aborts on client
  // disconnect. Every tick reads the SAME read-through cache as the plain GET (never a
  // direct rebuild): one open editor per user/project costs at most one snapshot build
  // per KV TTL, and every other editor/window on that scope shares it. The tick matches
  // the cache's effective KV TTL (Workers KV clamps to a 60s minimum), so a faster tick
  // would only re-emit the same frame. Each tick is wrapped so a transient DB error
  // emits an `event: error` frame rather than tearing down the stream. Cloudflare
  // Workers compatible (ReadableStream + new Response).
  router.get('/v1/builder-insights/stream', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const db = requestDb(c);
    const scope = {
      tenantId: access.tenantId,
      userId: access.userId,
      projectId: positiveIntOrNull(c.req.query('projectId')),
    };
    const signal = c.req.raw.signal;
    const MAX_TICKS = 6;
    const INTERVAL_MS = 60_000;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch (error) {
            /* controller already closed */
            reportCaughtError(error, { source: 'presentation/routes/llm/usageRoutes.ts', operation: 'emit' });
          }
        };

        for (let tick = 0; tick < MAX_TICKS; tick++) {
          if (signal?.aborted) break;
          try {
            const snapshot = await getCachedBuilderInsightsSnapshot(db, c.env, scope);
            emit(`data: ${JSON.stringify(snapshot)}\n\n`);
          } catch (err) {
            emit(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message || 'tick_failed' })}\n\n`);
          }
          if (tick === MAX_TICKS - 1) break;
          // Wait for the next tick, but bail early if the client disconnects.
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              if (signal) signal.removeEventListener('abort', finish);
              resolve();
            };
            const timer = setTimeout(finish, INTERVAL_MS);
            if (signal) signal.addEventListener('abort', finish, { once: true });
          });
          if (signal?.aborted) break;
        }
        try {
          controller.close();
        } catch (error) {
          /* already closed */
          reportCaughtError(error, { source: 'presentation/routes/llm/usageRoutes.ts', operation: 'start' });
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });
}
