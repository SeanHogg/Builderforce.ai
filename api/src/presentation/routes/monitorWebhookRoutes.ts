/**
 * Monitor-signal webhook — /api/monitor-webhooks/:monitorId
 *
 * The inbound endpoint external monitoring tools (Datadog / Grafana / a cron heartbeat
 * / a custom script) POST to when a monitor's condition changes. Mounted OUTSIDE tenant
 * auth (external callers have no JWT) — trust is a per-monitor secret token, and the
 * tenantId is taken from the monitor row, never the request (mirrors board-webhooks).
 *
 * A bare POST (no body) counts as a healthy heartbeat ping. A JSON body may carry
 * { status: ok|breach|up|down|firing|resolved, value: number, message: string }.
 */
import { Hono } from 'hono';
import { MonitoringService } from '../../application/monitoring/MonitoringService';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { monitoringVersionKey } from '../../application/insights/versionKeys';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Normalize the many "it's broken / it's fine" vocabularies to our two states. */
function normalizeStatus(raw: unknown): 'ok' | 'breach' | undefined {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return undefined;
  if (/^(ok|up|healthy|resolved|resolve|recovered|success)$/.test(s)) return 'ok';
  if (/^(breach|down|alert|alerting|firing|error|fail|failed|critical|triggered)$/.test(s)) return 'breach';
  return undefined;
}

export function createMonitorWebhookRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/:monitorId', async (c) => {
    const monitorId = c.req.param('monitorId');
    const token = c.req.query('token') ?? c.req.header('x-monitor-token') ?? '';

    const svc = new MonitoringService(db);
    const monitor = await svc.monitorForSignal(monitorId);
    if (!monitor || !monitor.webhookSecret) return c.json({ error: 'unknown monitor' }, 404);
    if (token !== monitor.webhookSecret) return c.json({ error: 'invalid token' }, 401);

    const body = (await c.req.json().catch(() => ({}))) as { status?: unknown; value?: unknown; message?: unknown };
    const signal = {
      status: normalizeStatus(body.status),
      value: typeof body.value === 'number' ? body.value : undefined,
      message: typeof body.message === 'string' ? body.message.slice(0, 500) : null,
    };

    const res = await svc.recordSignal(monitor.tenantId, monitorId, signal, c.env as Env);
    await bumpCacheVersion(c.env as Env, monitoringVersionKey(monitor.tenantId)).catch(() => {});
    return c.json({ ok: true, status: res.status });
  });

  return router;
}
