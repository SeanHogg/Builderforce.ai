/**
 * Quality management routes — /api/quality (tenant JWT).
 *
 * The authenticated half of the Quality pillar: manage ingest sources (mint the
 * one-time bfq_ ingest key + optional webhook secret), browse fingerprint-grouped
 * errors, triage them (resolve/ignore), and — the payoff — turn a group into a
 * fix: create a task seeded with the stack trace/context and dispatch a cloud
 * agent to it (→ PR) via the same path the CI auto-fix loop uses.
 *
 * Reads are served through the canonical read-through cache, invalidated by the
 * ingest engine's version-token bump (per project + per tenant).
 */

import { Hono } from 'hono';
import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { errorSources, errorGroups, errorEvents, projects } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { encryptCredentials } from '../../application/integrations/credentialCrypto';
import {
  QUALITY_SOURCES, QUALITY_SOURCE_IDS, getQualitySourceMeta,
} from '../../application/quality/qualitySourceCatalog';
import {
  getOrSetCached, getCacheVersion, bumpCacheVersion,
} from '../../infrastructure/cache/readThroughCache';
import { qualityGroupsVersionKey, qualityGroupsTenantVersionKey } from '../../application/quality/ingestEngine';
import { dispatchCloudRunForTask } from './runtimeRoutes';
import { TaskPriority } from '../../domain/shared/types';
import type { TaskService } from '../../application/task/TaskService';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Encryption secret for sealing a webhook secret (same resolver integrations use). */
function integrationSecret(env: Env): string {
  return (env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET) as string;
}

/** Decode a `<lastSeenISO>|<id>` keyset cursor; null when absent/malformed. */
function parseGroupsCursor(raw: string | undefined): { ts: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf('|');
  if (sep <= 0) return null;
  const ts = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(ts.getTime()) || !id) return null;
  return { ts, id };
}

/** Map an error level to a fix-task priority. */
function levelToPriority(level: string): TaskPriority {
  if (level === 'fatal') return TaskPriority.URGENT;
  if (level === 'error') return TaskPriority.HIGH;
  if (level === 'warning') return TaskPriority.MEDIUM;
  return TaskPriority.LOW;
}

/** Render a sample stack (array of frames or raw string) into a readable block. */
function renderStack(stack: unknown): string {
  if (!stack) return '';
  if (typeof stack === 'string') return stack.slice(0, 4000);
  if (Array.isArray(stack)) {
    return stack
      .slice(0, 30)
      .map((f) => {
        const fr = (f ?? {}) as Record<string, unknown>;
        return `  at ${fr.function ?? '<anonymous>'} (${fr.file ?? '?'}:${fr.line ?? '?'}:${fr.column ?? '?'})`;
      })
      .join('\n');
  }
  return '';
}

/** Build the agent fix brief from a group + its sample event. */
function buildFixBrief(group: { title: string; type: string | null; environment: string | null; eventCount: number; userCount: number }, sample: Record<string, unknown> | null): string {
  const lines: string[] = [];
  lines.push(`A production error was reported by the Quality pillar and needs a fix.`);
  lines.push('');
  lines.push(`**Error:** ${group.title}`);
  if (group.type) lines.push(`**Type:** ${group.type}`);
  if (group.environment) lines.push(`**Environment:** ${group.environment}`);
  lines.push(`**Occurrences:** ${group.eventCount} event(s), ~${group.userCount} user(s) affected`);
  const url = sample && typeof sample.url === 'string' ? sample.url : null;
  if (url) lines.push(`**Where:** ${url}`);
  const stack = renderStack(sample?.stack);
  if (stack) {
    lines.push('', '**Stack trace:**', '```', stack, '```');
  }
  lines.push('', 'Reproduce, find the root cause, fix it, and open a PR. Keep the change minimal and add a regression test where practical.');
  return lines.join('\n');
}

export function createQualityRoutes(db: Db, taskService: TaskService, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Source catalog (static, no DB) ────────────────────────────────────────
  router.get('/source-catalog', (c) => c.json({ sources: QUALITY_SOURCES }));

  // ── List sources (no secrets) ─────────────────────────────────────────────
  router.get('/sources', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select({
        id: errorSources.id, source: errorSources.source, name: errorSources.name,
        projectId: errorSources.projectId, enabled: errorSources.enabled, status: errorSources.status,
        lastEventAt: errorSources.lastEventAt, createdAt: errorSources.createdAt,
        hasWebhookSecret: sql<boolean>`${errorSources.webhookSecretEnc} IS NOT NULL`,
      })
      .from(errorSources)
      .where(eq(errorSources.tenantId, tenantId))
      .orderBy(desc(errorSources.createdAt));
    return c.json({ sources: rows });
  });

  // ── Create a source (mints the ingest key once) ───────────────────────────
  router.post('/sources', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ projectId?: number; source?: string; name?: string; webhookSecret?: string | null }>();

    if (!body.projectId || !body.source || !body.name) {
      return c.json({ error: 'projectId, source and name are required' }, 400);
    }
    if (!QUALITY_SOURCE_IDS.includes(body.source)) {
      return c.json({ error: `source must be one of: ${QUALITY_SOURCE_IDS.join(', ')}` }, 400);
    }
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    // Mint a universal ingest key (keyed posting works for every source); store
    // only its hash. A webhook source may also carry an HMAC secret.
    const rawKey = generateApiKey('bfq');
    const keyHash = await hashSecret(rawKey);

    let webhookSecretEnc: string | null = null;
    let webhookSecretIv: string | null = null;
    if (body.webhookSecret) {
      const sealed = await encryptCredentials({ secret: body.webhookSecret }, integrationSecret(c.env as Env), tenantId);
      webhookSecretEnc = sealed.enc;
      webhookSecretIv = sealed.iv;
    }

    const [row] = await db
      .insert(errorSources)
      .values({
        tenantId, projectId: body.projectId, source: body.source, name: body.name,
        keyHash, webhookSecretEnc, webhookSecretIv, createdBy: userId ?? null,
      })
      .returning({ id: errorSources.id, source: errorSources.source, name: errorSources.name, projectId: errorSources.projectId });
    if (!row) return c.json({ error: 'Failed to create source' }, 500);

    return c.json({
      source: row,
      // Shown ONCE — the raw key is never stored or retrievable again.
      ingestKey: rawKey,
      webhookUrl: `/api/quality-ingest/webhooks/${row.id}`,
      otlpEndpoint: `/api/quality-ingest/otlp`,
      eventsEndpoint: `/api/quality-ingest/events`,
    }, 201);
  });

  // ── Update a source (rename / enable / pause) ─────────────────────────────
  router.patch('/sources/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; enabled?: boolean; status?: string }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.status !== undefined && ['active', 'paused'].includes(body.status)) patch.status = body.status;

    const [row] = await db
      .update(errorSources)
      .set(patch)
      .where(and(eq(errorSources.id, id), eq(errorSources.tenantId, tenantId)))
      .returning({ id: errorSources.id });
    if (!row) return c.json({ error: 'Source not found' }, 404);
    return c.json({ ok: true });
  });

  // ── Delete a source ───────────────────────────────────────────────────────
  router.delete('/sources/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .delete(errorSources)
      .where(and(eq(errorSources.id, id), eq(errorSources.tenantId, tenantId)))
      .returning({ id: errorSources.id });
    if (!row) return c.json({ error: 'Source not found' }, 404);
    return c.json({ ok: true });
  });

  // ── List error groups (cached, version-token invalidated) ─────────────────
  router.get('/groups', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const status = c.req.query('status') ?? null;
    const level = c.req.query('level') ?? null;
    const sourceId = c.req.query('sourceId') ?? null;
    const limit = Math.min(Number(c.req.query('limit') ?? '100'), 200);
    // Keyset cursor `<lastSeenISO>|<id>` — stable pagination past the page cap.
    const cursor = parseGroupsCursor(c.req.query('cursor'));

    const versionKey = projectId ? qualityGroupsVersionKey(projectId) : qualityGroupsTenantVersionKey(tenantId);
    const ver = await getCacheVersion(c.env as Env, versionKey);
    const cacheKey = `quality-groups:t:${tenantId}:p:${projectId ?? 'all'}:s:${status ?? ''}:l:${level ?? ''}:src:${sourceId ?? ''}:n:${limit}:c:${cursor ? `${cursor.ts.toISOString()}|${cursor.id}` : ''}:v:${ver}`;

    const groups = await getOrSetCached(c.env as Env, cacheKey, async () => {
      const conds = [eq(errorGroups.tenantId, tenantId)];
      if (projectId) conds.push(eq(errorGroups.projectId, projectId));
      if (status) conds.push(eq(errorGroups.status, status));
      if (level) conds.push(eq(errorGroups.level, level));
      if (sourceId) conds.push(eq(errorGroups.sourceId, sourceId));
      // Keyset: rows strictly "after" the cursor in (lastSeen desc, id desc) order.
      if (cursor) {
        conds.push(
          or(
            lt(errorGroups.lastSeen, cursor.ts),
            and(eq(errorGroups.lastSeen, cursor.ts), lt(errorGroups.id, cursor.id)),
          )!,
        );
      }
      return db
        .select({
          id: errorGroups.id, projectId: errorGroups.projectId, sourceId: errorGroups.sourceId,
          fingerprint: errorGroups.fingerprint, title: errorGroups.title, type: errorGroups.type,
          level: errorGroups.level, status: errorGroups.status, eventCount: errorGroups.eventCount,
          userCount: errorGroups.userCount, firstSeen: errorGroups.firstSeen, lastSeen: errorGroups.lastSeen,
          environment: errorGroups.environment, release: errorGroups.release, taskId: errorGroups.taskId,
        })
        .from(errorGroups)
        .where(and(...conds))
        .orderBy(desc(errorGroups.lastSeen), desc(errorGroups.id))
        .limit(limit);
    });

    // A full page implies more rows may follow — hand back the keyset cursor.
    const last = groups.length === limit ? groups[groups.length - 1] : undefined;
    const nextCursor = last ? `${new Date(last.lastSeen).toISOString()}|${last.id}` : null;
    return c.json({ groups, nextCursor });
  });

  // ── Group detail (sample + recent events + trend + exact affected users) ──
  router.get('/groups/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [group] = await db
      .select()
      .from(errorGroups)
      .where(and(eq(errorGroups.id, id), eq(errorGroups.tenantId, tenantId)))
      .limit(1);
    if (!group) return c.json({ error: 'Group not found' }, 404);

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [recent, trend, distinct] = await Promise.all([
      db.select({ ts: errorEvents.ts, userKey: errorEvents.userKey, release: errorEvents.release, environment: errorEvents.environment, payload: errorEvents.payload })
        .from(errorEvents).where(eq(errorEvents.groupId, id)).orderBy(desc(errorEvents.ts)).limit(20),
      db.select({ day: sql<string>`date_trunc('day', ${errorEvents.ts})`, count: sql<number>`count(*)` })
        .from(errorEvents).where(and(eq(errorEvents.groupId, id), gte(errorEvents.ts, since)))
        .groupBy(sql`date_trunc('day', ${errorEvents.ts})`).orderBy(sql`date_trunc('day', ${errorEvents.ts})`),
      db.select({ n: sql<number>`count(distinct ${errorEvents.userKey})` }).from(errorEvents).where(eq(errorEvents.groupId, id)),
    ]);

    return c.json({
      group,
      recentEvents: recent,
      trend: trend.map((t) => ({ day: t.day, count: Number(t.count) })),
      affectedUsers: Number(distinct[0]?.n ?? 0),
    });
  });

  // ── Triage: set status (resolve / ignore / reopen) ────────────────────────
  router.patch('/groups/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ status?: string }>();
    if (!body.status || !['unresolved', 'resolved', 'ignored'].includes(body.status)) {
      return c.json({ error: 'status must be unresolved | resolved | ignored' }, 400);
    }
    const [row] = await db
      .update(errorGroups)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(errorGroups.id, id), eq(errorGroups.tenantId, tenantId)))
      .returning({ id: errorGroups.id, projectId: errorGroups.projectId });
    if (!row) return c.json({ error: 'Group not found' }, 404);
    await bumpCacheVersion(c.env as Env, qualityGroupsVersionKey(row.projectId));
    await bumpCacheVersion(c.env as Env, qualityGroupsTenantVersionKey(tenantId));
    return c.json({ ok: true });
  });

  // ── Fix with agent: create a task from the group and dispatch a cloud run ──
  router.post('/groups/:id/fix', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');

    const [group] = await db
      .select()
      .from(errorGroups)
      .where(and(eq(errorGroups.id, id), eq(errorGroups.tenantId, tenantId)))
      .limit(1);
    if (!group) return c.json({ error: 'Group not found' }, 404);
    if (group.taskId) return c.json({ error: 'A fix task already exists for this group', taskId: group.taskId }, 409);

    const brief = buildFixBrief(group, (group.samplePayload as Record<string, unknown> | null) ?? null);
    const task = await taskService.createTask(
      {
        projectId: group.projectId,
        title: `Fix: ${group.title}`.slice(0, 255),
        description: brief,
        priority: levelToPriority(group.level),
      },
      tenantId,
    );

    await db
      .update(errorGroups)
      .set({ status: 'fixing', taskId: task.id as unknown as number, updatedAt: new Date() })
      .where(eq(errorGroups.id, id));
    await bumpCacheVersion(c.env as Env, qualityGroupsVersionKey(group.projectId));
    await bumpCacheVersion(c.env as Env, qualityGroupsTenantVersionKey(tenantId));

    // Context-free dispatch (the CI auto-fix path): resolves a default cloud agent
    // + surface and starts the run; the PR is opened on completion by the engine.
    const executionId = await dispatchCloudRunForTask(
      c.env as Env, db, runtimeService,
      (p) => c.executionCtx.waitUntil(p),
      { taskId: task.id as unknown as number, tenantId, submittedBy: `quality:${userId ?? 'system'}` },
    );

    return c.json({ taskId: task.id, executionId }, 202);
  });

  return router;
}
