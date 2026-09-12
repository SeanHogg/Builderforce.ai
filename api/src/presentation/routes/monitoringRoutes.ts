/**
 * Monitoring routes — /api/monitoring
 *
 * The visual monitoring surface: diagram boards, monitor pins overlaid on them, a
 * manual signal-test, and the incident/monitor reporting rollup. A monitor breach
 * opens an incident (MonitoringService → IncidentService), so this surface is the
 * proactive front-door to the on-call investigation loop.
 *
 * The diagram image itself is uploaded via the shared POST /api/brain/upload (R2), and
 * we store the returned key on the board; boards/monitors are served in-app.
 *
 *   GET/POST/PATCH/DELETE  /boards[/:id]                  (list MEMBER+, writes MANAGER+)
 *   POST                   /boards/:id/monitors           (MANAGER+)
 *   PATCH/DELETE           /monitors/:id                  (MANAGER+)
 *   GET                    /monitors/:id                  monitor + event history (MEMBER+)
 *   POST                   /monitors/:id/test-signal      manual ok/breach (MANAGER+)
 *   GET                    /report                         incident + monitor rollup (MEMBER+)
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole, isManager } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';

import { monitoringVersionKey, incidentVersionKey } from '../../application/insights/versionKeys';
import { MonitoringService, type MonitorType } from '../../application/monitoring/MonitoringService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseOptionalBody, z, zJsonObject } from './requestBody';

const zMonitorType = z.enum(['heartbeat', 'http_check', 'webhook', 'metric_threshold', 'manual']) satisfies z.ZodType<MonitorType>;

/** Create AND patch a board. `name` stays optional so the create's own "name is required" wins. */
const BoardBody = z.object({
  name: z.string().optional(),
  projectId: z.number().nullish(),
  imageKey: z.string().nullish(),
  imageWidth: z.number().nullish(),
  imageHeight: z.number().nullish(),
});

/**
 * Create AND patch a monitor. Nullable columns take `null` (clears on a patch);
 * NOT NULL ones (label, position, type, severity, active) are optional only.
 * `config` is stored whole as JSON, so every key is kept.
 */
const MonitorBody = z.object({
  label: z.string().optional(),
  description: z.string().nullish(),
  posX: z.number().optional(),
  posY: z.number().optional(),
  monitorType: zMonitorType.optional(),
  config: zJsonObject.nullish(),
  affectedSystem: z.string().nullish(),
  severity: z.string().optional(),
  escalationPolicyId: z.string().nullish(),
  projectId: z.number().nullish(),
  active: z.boolean().optional(),
});

const TestSignalBody = z.object({
  status: z.enum(['ok', 'breach']).optional(),
  value: z.number().optional(),
  message: z.string().nullish(),
});

export function createMonitoringRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const invalidate = (c: { env: HonoEnv['Bindings'] }, tenantId: number) => new MonitoringService(db).invalidate(c.env, tenantId);

  // ── Reporting (folds monitor + incident version tokens) ────────────────────
  router.get('/report', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json(await new MonitoringService(db).getCachedReport(c.env, tenantId));
  });

  // ── Boards ─────────────────────────────────────────────────────────────────
  router.get('/boards', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ boards: await new MonitoringService(db).getCachedBoards(c.env, tenantId) });
  });
  router.post('/boards', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, BoardBody);
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const row = await new MonitoringService(db).createBoard(tenantId, { name: b.name, projectId: b.projectId ?? null, imageKey: b.imageKey ?? null, imageWidth: b.imageWidth ?? null, imageHeight: b.imageHeight ?? null });
    await invalidate(c, tenantId);
    return c.json({ board: row }, 201);
  });
  router.get('/boards/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const data = await new MonitoringService(db).getBoard(tenantId, c.req.param('id'));
    if (!data) return c.json({ error: 'Board not found' }, 404);
    return c.json(data);
  });
  router.patch('/boards/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, BoardBody);
    await new MonitoringService(db).updateBoard(tenantId, c.req.param('id'), b);
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.delete('/boards/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new MonitoringService(db).deleteBoard(tenantId, c.req.param('id'));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });

  // ── Monitors ─────────────────────────────────────────────────────────────
  router.post('/boards/:id/monitors', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, MonitorBody);
    if (!b.label?.trim()) return c.json({ error: 'label is required' }, 400);
    const row = await new MonitoringService(db).createMonitor(tenantId, c.req.param('id'), {
      label: b.label, description: b.description ?? null, posX: b.posX, posY: b.posY,
      monitorType: b.monitorType, config: b.config ?? undefined, affectedSystem: b.affectedSystem ?? null,
      severity: b.severity, escalationPolicyId: b.escalationPolicyId ?? null, projectId: b.projectId ?? null,
    });
    await invalidate(c, tenantId);
    return c.json({ monitor: row }, 201);
  });
  router.get('/monitors/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const svc = new MonitoringService(db);
    const data = await svc.getMonitor(tenantId, c.req.param('id'));
    if (!data) return c.json({ error: 'Monitor not found' }, 404);
    // The signal URL embeds the monitor's webhook secret (external tools POST there),
    // so mint it ONLY for a MANAGER+; a plain member still gets the monitor + event
    // history, just without the forge-able secret. The getMonitor read itself never
    // carries the raw secret.
    let signalUrl: string | null = null;
    if (isManager(c)) {
      const token = await svc.resolveSignalToken(tenantId, c.req.param('id'));
      signalUrl = token ? `${c.env.APP_URL ?? ''}/api/monitor-webhooks/${data.monitor.id}?token=${token}` : null;
    }
    return c.json({ ...data, signalUrl });
  });
  router.patch('/monitors/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, MonitorBody);
    // `config` is NOT NULL: a null reads as "not changing it", never a failed write.
    await new MonitoringService(db).updateMonitor(tenantId, c.req.param('id'), { ...b, config: b.config ?? undefined });
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.delete('/monitors/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new MonitoringService(db).deleteMonitor(tenantId, c.req.param('id'));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.post('/monitors/:id/test-signal', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, TestSignalBody);
    const res = await new MonitoringService(db).recordSignal(tenantId, c.req.param('id'), { status: b.status, value: b.value, message: b.message ?? null }, c.env);
    await invalidate(c, tenantId);
    return c.json(res);
  });

  return router;
}
