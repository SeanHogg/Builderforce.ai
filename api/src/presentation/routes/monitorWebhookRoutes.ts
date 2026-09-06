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
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { RequestValidationError } from '../../domain/shared/errors';
import { parseBody, z } from './requestBody';

/**
 * Vendor-shaped payloads (Datadog, Grafana, a script) carry many more keys than
 * these; only the three the handler reads are declared and a wrong-typed one is
 * ignored rather than refused, since the sender cannot act on a 400 anyway.
 */
const SignalBody = z.looseObject({
  status: z.unknown().optional(),
  value: z.preprocess((v) => (typeof v === 'number' ? v : undefined), z.number().optional()),
  message: z.preprocess((v) => (typeof v === 'string' ? v : undefined), z.string().optional()),
});

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

    // A bare POST (no body / non-JSON body) is a healthy heartbeat ping, so a
    // root-level parse failure reads as an empty signal rather than a 400.
    const body = await parseBody(c, SignalBody).catch((e: unknown) => {
      if (e instanceof RequestValidationError && e.issues[0]?.path === '') return {} as z.infer<typeof SignalBody>;
      throw e;
    });
    const signal = {
      status: normalizeStatus(body.status),
      value: body.value,
      message: body.message?.slice(0, 500) ?? null,
    };

    // `recordSignal` invalidates the monitoring reads itself — see MonitoringService.
    const res = await svc.recordSignal(monitor.tenantId, monitorId, signal, c.env as Env);
    return c.json({ ok: true, status: res.status });
  });

  return router;
}
