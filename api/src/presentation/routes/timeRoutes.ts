/**
 * Time tracking — /api/time
 *
 * A member logs minutes against a task on a day. Logging for YOURSELF (human) is
 * open to any authed member; logging for / viewing ANOTHER member is MANAGER+.
 * Every write bumps the PMO version (the spine's human cost derives from logged
 * time) and the workforce-metrics version, and invalidates the per-member chart.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { tasks, timeEntries } from '../../infrastructure/database/schema';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { bumpWorkforceMetricsVersion } from '../../application/metrics/workforceMetrics';
import { computeMemberDailyHours, isoDay } from '../../application/timeTracking/timeTracking';
import { pmoVersionKey } from './pmoRoutes';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const MEMBER_KINDS = new Set(['human', 'cloud_agent', 'host_agent']);
const clampDays = (raw: number, def: number, max: number) =>
  Math.min(max, Math.max(1, Number.isFinite(raw) ? raw : def));

function timeVersionKey(tenantId: number): string { return `time-version:tenant:${tenantId}`; }
function isManagerPlus(role: unknown): boolean { return role === TenantRole.OWNER || role === TenantRole.MANAGER; }

/** Invalidate everything a time write touches: chart, spine cost, member metrics. */
async function bumpAfterWrite(env: Env, tenantId: number): Promise<void> {
  await Promise.all([
    bumpCacheVersion(env, timeVersionKey(tenantId)),
    bumpCacheVersion(env, pmoVersionKey(tenantId)),
    bumpWorkforceMetricsVersion(env, tenantId),
  ]);
}

export function createTimeRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Log time against a task ─────────────────────────────────────────────────
  router.post('/entries', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const role = c.get('role');
    const body = await c.req.json<{ taskId?: number; minutes?: number; entryDate?: string; note?: string; memberKind?: string; memberRef?: string }>();

    const taskId = Number(body.taskId);
    if (!Number.isFinite(taskId) || taskId <= 0) return c.json({ error: 'taskId is required' }, 400);
    const minutes = Math.round(Number(body.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) return c.json({ error: 'minutes must be a positive number' }, 400);

    // Default member = the current human user; a manager may log for another member.
    const memberKind = body.memberKind ?? 'human';
    const memberRef = body.memberRef ?? userId;
    if (!MEMBER_KINDS.has(memberKind)) return c.json({ error: 'invalid memberKind' }, 400);
    const loggingForOther = memberKind !== 'human' || memberRef !== userId;
    if (loggingForOther && !isManagerPlus(role)) return c.json({ error: 'only a manager can log time for another member' }, 403);

    // Task must belong to this segment.
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.segmentId, segmentId)));
    if (!task) return c.json({ error: 'task not found' }, 404);

    const entryDate = body.entryDate && /^\d{4}-\d{2}-\d{2}$/.test(body.entryDate) ? body.entryDate : isoDay(new Date());
    const rows = await db.insert(timeEntries)
      .values({ tenantId, segmentId, taskId, memberKind, memberRef, minutes, entryDate, source: 'manual', note: body.note?.trim() || null })
      .returning();
    await bumpAfterWrite(c.env as Env, tenantId);
    return c.json(rows[0], 201);
  });

  // ── Entries for a task (the task time panel) ────────────────────────────────
  router.get('/entries', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const taskId = Number(c.req.query('taskId'));
    if (!Number.isFinite(taskId) || taskId <= 0) return c.json({ error: 'taskId is required' }, 400);
    const rows = await db
      .select({ id: timeEntries.id, taskId: timeEntries.taskId, memberKind: timeEntries.memberKind, memberRef: timeEntries.memberRef, minutes: timeEntries.minutes, entryDate: timeEntries.entryDate, source: timeEntries.source, note: timeEntries.note })
      .from(timeEntries)
      .where(and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.segmentId, segmentId), eq(timeEntries.taskId, taskId)));
    return c.json({ entries: rows });
  });

  // ── A member's daily logged-hours chart ─────────────────────────────────────
  router.get('/member/:kind/:ref', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const role = c.get('role');
    const kind = c.req.param('kind');
    const ref = c.req.param('ref');
    if (!MEMBER_KINDS.has(kind)) return c.json({ error: 'invalid member kind' }, 400);
    // Self (human) is open; viewing anyone else is MANAGER+.
    if ((kind !== 'human' || ref !== userId) && !isManagerPlus(role)) return c.json({ error: 'forbidden' }, 403);
    const days = clampDays(Number(c.req.query('days')), 30, 180);

    const env = c.env as Env;
    const ver = await getCacheVersion(env, timeVersionKey(tenantId));
    const key = `time:member:${tenantId}:${segmentId}:${kind}:${ref}:${days}:v:${ver}`;
    const data = await getOrSetCached(
      env, key,
      () => computeMemberDailyHours(db, tenantId, segmentId, { kind, ref }, days, Date.now()),
      { kvTtlSeconds: 120, l1TtlMs: 30_000 },
    );
    return c.json(data);
  });

  // ── Delete an entry (own, or manager) ───────────────────────────────────────
  router.delete('/entries/:id', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const role = c.get('role');
    const id = c.req.param('id');
    const [entry] = await db.select({ id: timeEntries.id, memberKind: timeEntries.memberKind, memberRef: timeEntries.memberRef })
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.tenantId, tenantId), eq(timeEntries.segmentId, segmentId)));
    if (!entry) return c.json({ error: 'not found' }, 404);
    const isOwn = entry.memberKind === 'human' && entry.memberRef === userId;
    if (!isOwn && !isManagerPlus(role)) return c.json({ error: 'forbidden' }, 403);

    await db.delete(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.tenantId, tenantId), eq(timeEntries.segmentId, segmentId)));
    await bumpAfterWrite(c.env as Env, tenantId);
    return c.json({ deleted: id });
  });

  return router;
}
