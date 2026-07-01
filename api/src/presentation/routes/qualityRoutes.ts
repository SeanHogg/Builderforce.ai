/**
 * Quality management routes — /api/quality (tenant JWT).
 *
 * The authenticated half of the Quality pillar:
 *   - Collectors: ONE per project (one ingest key = one embeddable snippet), or a
 *     tenant-level collector that routes a mixed stream to projects via mapping rules.
 *   - Integrations: provider webhooks (Sentry/PostHog/LogRocket) attached to a collector.
 *   - Mapping rules: route a tenant-level collector's events to a project.
 *   - Groups: browse/triage fingerprint-grouped errors and "Fix with agent".
 *
 * Reads are served through the canonical read-through cache, invalidated by the
 * ingest engine's version-token bump (per project + per tenant).
 */

import { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  errorCollectors, errorCollectorIntegrations, errorMappingRules, errorGroups, errorEvents, projects,
} from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { encryptCredentials, decryptCredentials } from '../../application/integrations/credentialCrypto';
import { pullSentryIssues } from '../../application/quality/sentryPull';
import { QUALITY_SOURCES, getQualitySourceMeta } from '../../application/quality/qualitySourceCatalog';
import {
  getOrSetCached, getCacheVersion, bumpCacheVersion,
} from '../../infrastructure/cache/readThroughCache';
import { qualityGroupsVersionKey, qualityGroupsTenantVersionKey, ingestErrorEvents } from '../../application/quality/ingestEngine';
import type { CollectorRef, MappingRule } from '../../application/quality/errorMapping';
import { dispatchCloudRunForTask } from './runtimeRoutes';
import { TaskPriority } from '../../domain/shared/types';
import type { TaskService } from '../../application/task/TaskService';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Encryption secret for sealing webhook/pull credentials (same resolver integrations use). */
function integrationSecret(env: Env): string {
  return (env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET) as string;
}

/** Postgres unique-constraint violation (e.g. a second collector for one project). */
function isUniqueViolation(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique constraint|23505/i.test(s);
}

const MAPPING_FIELDS = ['service', 'release', 'environment', 'url'];
const MAPPING_OPS = ['equals', 'contains', 'prefix'];
/** Valid match field: a known top-level field or a `tag:<key>`. */
function isValidMatchField(f: string): boolean {
  return MAPPING_FIELDS.includes(f) || (f.startsWith('tag:') && f.length > 4);
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
  lines.push(`**Occurrences:** ${group.eventCount} event(s), ${group.userCount} user(s) affected`);
  const url = sample && typeof sample.url === 'string' ? sample.url : null;
  if (url) lines.push(`**Where:** ${url}`);
  const stack = renderStack(sample?.stack);
  if (stack) lines.push('', '**Stack trace:**', '```', stack, '```');
  lines.push('', 'Reproduce, find the root cause, fix it, and open a PR. Keep the change minimal and add a regression test where practical.');
  return lines.join('\n');
}

export function createQualityRoutes(db: Db, taskService: TaskService, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Load a tenant-owned collector by id (CollectorRef shape), or null. */
  async function loadCollector(tenantId: number, id: string): Promise<(CollectorRef & { tenantId: number }) | null> {
    const [row] = await db
      .select({ id: errorCollectors.id, tenantId: errorCollectors.tenantId, projectId: errorCollectors.projectId, defaultProjectId: errorCollectors.defaultProjectId })
      .from(errorCollectors)
      .where(and(eq(errorCollectors.id, id), eq(errorCollectors.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }

  // ── Source/provider catalog (static, no DB) ───────────────────────────────
  router.get('/source-catalog', (c) => c.json({ sources: QUALITY_SOURCES }));

  // ── List collectors (+ attached integration providers; no secrets) ────────
  router.get('/collectors', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const cols = await db
      .select({
        id: errorCollectors.id, name: errorCollectors.name, projectId: errorCollectors.projectId,
        defaultProjectId: errorCollectors.defaultProjectId, enabled: errorCollectors.enabled,
        status: errorCollectors.status, lastEventAt: errorCollectors.lastEventAt, createdAt: errorCollectors.createdAt,
      })
      .from(errorCollectors)
      .where(eq(errorCollectors.tenantId, tenantId))
      .orderBy(desc(errorCollectors.createdAt));

    const ids = cols.map((c2) => c2.id);
    const ints = ids.length
      ? await db
          .select({ collectorId: errorCollectorIntegrations.collectorId, provider: errorCollectorIntegrations.provider })
          .from(errorCollectorIntegrations)
          .where(inArray(errorCollectorIntegrations.collectorId, ids))
      : [];
    const byCollector = new Map<string, string[]>();
    for (const i of ints) byCollector.set(i.collectorId, [...(byCollector.get(i.collectorId) ?? []), i.provider]);

    return c.json({ collectors: cols.map((co) => ({ ...co, providers: byCollector.get(co.id) ?? [] })) });
  });

  // ── Create a collector (mints the ingest key once) ────────────────────────
  router.post('/collectors', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ projectId?: number | null; name?: string; defaultProjectId?: number | null }>();
    if (!body.name) return c.json({ error: 'name is required' }, 400);

    // Validate any referenced project belongs to the tenant.
    const refProjectIds = [body.projectId, body.defaultProjectId].filter((p): p is number => typeof p === 'number');
    if (refProjectIds.length) {
      const owned = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.tenantId, tenantId), inArray(projects.id, refProjectIds)));
      if (owned.length !== new Set(refProjectIds).size) return c.json({ error: 'Project not found' }, 404);
    }

    const rawKey = generateApiKey('bfq');
    const keyHash = await hashSecret(rawKey);

    let row;
    try {
      [row] = await db
        .insert(errorCollectors)
        .values({
          tenantId, projectId: body.projectId ?? null, name: body.name,
          defaultProjectId: body.defaultProjectId ?? null, keyHash, createdBy: userId ?? null,
        })
        .returning({ id: errorCollectors.id, name: errorCollectors.name, projectId: errorCollectors.projectId });
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ error: 'This project already has an error collector' }, 409);
      throw e;
    }
    if (!row) return c.json({ error: 'Failed to create collector' }, 500);

    return c.json({
      collector: row,
      // Shown ONCE — the raw key is never stored or retrievable again.
      ingestKey: rawKey,
      eventsEndpoint: `/api/quality-ingest/events`,
      otlpEndpoint: `/api/quality-ingest/otlp`,
      webhookBase: `/api/quality-ingest/webhooks/${row.id}`,
    }, 201);
  });

  // ── Update a collector (rename / enable / pause / default project) ─────────
  router.patch('/collectors/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; enabled?: boolean; status?: string; defaultProjectId?: number | null }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.status !== undefined && ['active', 'paused'].includes(body.status)) patch.status = body.status;
    if (body.defaultProjectId !== undefined) {
      if (body.defaultProjectId !== null) {
        const [p] = await db.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.id, body.defaultProjectId), eq(projects.tenantId, tenantId))).limit(1);
        if (!p) return c.json({ error: 'Project not found' }, 404);
      }
      patch.defaultProjectId = body.defaultProjectId;
    }

    const [row] = await db
      .update(errorCollectors).set(patch)
      .where(and(eq(errorCollectors.id, id), eq(errorCollectors.tenantId, tenantId)))
      .returning({ id: errorCollectors.id });
    if (!row) return c.json({ error: 'Collector not found' }, 404);
    return c.json({ ok: true });
  });

  // ── Delete a collector ────────────────────────────────────────────────────
  router.delete('/collectors/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .delete(errorCollectors)
      .where(and(eq(errorCollectors.id, id), eq(errorCollectors.tenantId, tenantId)))
      .returning({ id: errorCollectors.id });
    if (!row) return c.json({ error: 'Collector not found' }, 404);
    return c.json({ ok: true });
  });

  // ── Integrations: list providers attached to a collector ──────────────────
  router.get('/collectors/:id/integrations', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    if (!(await loadCollector(tenantId, id))) return c.json({ error: 'Collector not found' }, 404);
    const rows = await db
      .select({
        provider: errorCollectorIntegrations.provider, createdAt: errorCollectorIntegrations.createdAt,
        hasSecret: sql<boolean>`${errorCollectorIntegrations.secretEnc} IS NOT NULL`,
        webhookUrl: sql<string>`'/api/quality-ingest/webhooks/' || ${errorCollectorIntegrations.collectorId} || '/' || ${errorCollectorIntegrations.provider}`,
      })
      .from(errorCollectorIntegrations)
      .where(eq(errorCollectorIntegrations.collectorId, id));
    return c.json({ integrations: rows });
  });

  // ── Integrations: attach/update a provider webhook on a collector ─────────
  router.post('/collectors/:id/integrations', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    if (!(await loadCollector(tenantId, id))) return c.json({ error: 'Collector not found' }, 404);

    const body = await c.req.json<{ provider?: string; secret?: string | null; apiToken?: string | null; scope?: string | null; baseUrl?: string | null }>();
    const meta = body.provider ? getQualitySourceMeta(body.provider) : undefined;
    if (!meta || !meta.supportsWebhook) {
      return c.json({ error: 'provider must be a webhook source (sentry, posthog, logrocket)' }, 400);
    }

    let secretEnc: string | null = null;
    let secretIv: string | null = null;
    const blob: Record<string, unknown> = {};
    if (body.secret) blob.secret = body.secret;
    if (body.apiToken) blob.apiToken = body.apiToken;
    if (body.scope) blob.scope = body.scope;
    if (body.baseUrl) blob.baseUrl = body.baseUrl;
    if (Object.keys(blob).length > 0) {
      const sealed = await encryptCredentials(blob, integrationSecret(c.env as Env), tenantId);
      secretEnc = sealed.enc; secretIv = sealed.iv;
    }

    await db
      .insert(errorCollectorIntegrations)
      .values({ collectorId: id, provider: body.provider!, secretEnc, secretIv })
      .onConflictDoUpdate({
        target: [errorCollectorIntegrations.collectorId, errorCollectorIntegrations.provider],
        set: { secretEnc, secretIv, updatedAt: new Date() },
      });

    return c.json({ ok: true, webhookUrl: `/api/quality-ingest/webhooks/${id}/${body.provider}` }, 201);
  });

  // ── Integrations: detach a provider ───────────────────────────────────────
  router.delete('/collectors/:id/integrations/:provider', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    if (!(await loadCollector(tenantId, id))) return c.json({ error: 'Collector not found' }, 404);
    await db.delete(errorCollectorIntegrations)
      .where(and(eq(errorCollectorIntegrations.collectorId, id), eq(errorCollectorIntegrations.provider, c.req.param('provider'))));
    return c.json({ ok: true });
  });

  // ── Integrations: Sentry backfill (seeds the model via the issues API) ─────
  router.post('/collectors/:id/integrations/sentry/backfill', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const collector = await loadCollector(tenantId, id);
    if (!collector) return c.json({ error: 'Collector not found' }, 404);

    const [integration] = await db
      .select({ secretEnc: errorCollectorIntegrations.secretEnc, secretIv: errorCollectorIntegrations.secretIv })
      .from(errorCollectorIntegrations)
      .where(and(eq(errorCollectorIntegrations.collectorId, id), eq(errorCollectorIntegrations.provider, 'sentry')))
      .limit(1);
    if (!integration?.secretEnc || !integration.secretIv) {
      return c.json({ error: 'Connect a Sentry integration with an API token + scope first' }, 400);
    }
    const blob = await decryptCredentials(integration.secretEnc, integration.secretIv, integrationSecret(c.env as Env), tenantId);
    const apiToken = typeof blob?.apiToken === 'string' ? blob.apiToken : '';
    const scope = typeof blob?.scope === 'string' ? blob.scope : '';
    const baseUrl = typeof blob?.baseUrl === 'string' ? blob.baseUrl : null;
    if (!apiToken || !scope) return c.json({ error: 'The Sentry integration has no API token / scope configured for backfill' }, 400);

    try {
      const events = await pullSentryIssues({ apiToken, scope, baseUrl }, fetch);
      const rules = collector.projectId == null ? await loadRulesForCollector(db, id) : [];
      const result = await ingestErrorEvents(db, c.env as Env, collector, events, rules);
      return c.json({ pulled: events.length, ...result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Backfill failed' }, 502);
    }
  });

  // ── Mapping rules (tenant-level collector → project routing) ──────────────
  router.get('/collectors/:id/rules', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    if (!(await loadCollector(tenantId, id))) return c.json({ error: 'Collector not found' }, 404);
    const rows = await db
      .select({
        id: errorMappingRules.id, matchField: errorMappingRules.matchField, matchOp: errorMappingRules.matchOp,
        matchValue: errorMappingRules.matchValue, projectId: errorMappingRules.projectId, priority: errorMappingRules.priority,
      })
      .from(errorMappingRules)
      .where(eq(errorMappingRules.collectorId, id))
      .orderBy(asc(errorMappingRules.priority));
    return c.json({ rules: rows });
  });

  router.post('/collectors/:id/rules', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const collector = await loadCollector(tenantId, id);
    if (!collector) return c.json({ error: 'Collector not found' }, 404);
    if (collector.projectId != null) return c.json({ error: 'Mapping rules apply only to a tenant-level collector' }, 400);

    const body = await c.req.json<{ matchField?: string; matchOp?: string; matchValue?: string; projectId?: number; priority?: number }>();
    if (!body.matchField || !isValidMatchField(body.matchField)) return c.json({ error: `matchField must be one of ${MAPPING_FIELDS.join(', ')} or tag:<key>` }, 400);
    const matchOp = body.matchOp && MAPPING_OPS.includes(body.matchOp) ? body.matchOp : 'equals';
    if (!body.matchValue) return c.json({ error: 'matchValue is required' }, 400);
    if (!body.projectId) return c.json({ error: 'projectId is required' }, 400);
    const [p] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, tenantId))).limit(1);
    if (!p) return c.json({ error: 'Project not found' }, 404);

    const [row] = await db
      .insert(errorMappingRules)
      .values({ tenantId, collectorId: id, matchField: body.matchField, matchOp, matchValue: body.matchValue, projectId: body.projectId, priority: body.priority ?? 100 })
      .returning({ id: errorMappingRules.id });
    return c.json({ id: row?.id }, 201);
  });

  router.delete('/collectors/:id/rules/:ruleId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    if (!(await loadCollector(tenantId, id))) return c.json({ error: 'Collector not found' }, 404);
    await db.delete(errorMappingRules)
      .where(and(eq(errorMappingRules.id, c.req.param('ruleId')), eq(errorMappingRules.collectorId, id), eq(errorMappingRules.tenantId, tenantId)));
    return c.json({ ok: true });
  });

  // ── List error groups (cached, version-token invalidated, keyset-paginated) ─
  router.get('/groups', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const status = c.req.query('status') ?? null;
    const level = c.req.query('level') ?? null;
    const collectorId = c.req.query('collectorId') ?? null;
    const limit = Math.min(Number(c.req.query('limit') ?? '100'), 200);
    const cursor = parseGroupsCursor(c.req.query('cursor'));

    const versionKey = projectId ? qualityGroupsVersionKey(projectId) : qualityGroupsTenantVersionKey(tenantId);
    const ver = await getCacheVersion(c.env as Env, versionKey);
    const cacheKey = `quality-groups:t:${tenantId}:p:${projectId ?? 'all'}:s:${status ?? ''}:l:${level ?? ''}:col:${collectorId ?? ''}:n:${limit}:c:${cursor ? `${cursor.ts.toISOString()}|${cursor.id}` : ''}:v:${ver}`;

    const groups = await getOrSetCached(c.env as Env, cacheKey, async () => {
      const conds = [eq(errorGroups.tenantId, tenantId)];
      if (projectId) conds.push(eq(errorGroups.projectId, projectId));
      if (status) conds.push(eq(errorGroups.status, status));
      if (level) conds.push(eq(errorGroups.level, level));
      if (collectorId) conds.push(eq(errorGroups.collectorId, collectorId));
      if (cursor) {
        conds.push(or(lt(errorGroups.lastSeen, cursor.ts), and(eq(errorGroups.lastSeen, cursor.ts), lt(errorGroups.id, cursor.id)))!);
      }
      return db
        .select({
          id: errorGroups.id, projectId: errorGroups.projectId, collectorId: errorGroups.collectorId,
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

    const last = groups.length === limit ? groups[groups.length - 1] : undefined;
    const nextCursor = last ? `${new Date(last.lastSeen).toISOString()}|${last.id}` : null;
    return c.json({ groups, nextCursor });
  });

  // ── Aggregate stats (volume collected, breakdowns, daily frequency) ───────
  // Powers the data-driven Quality charts + the collectors "data collected" card.
  // Project-scoped or tenant-wide; cached off the same version token as /groups.
  router.get('/stats', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = c.req.query('projectId') ? Number(c.req.query('projectId')) : null;
    const days = Math.min(Math.max(Number(c.req.query('days') ?? '30'), 1), 90);

    const versionKey = projectId ? qualityGroupsVersionKey(projectId) : qualityGroupsTenantVersionKey(tenantId);
    const ver = await getCacheVersion(c.env as Env, versionKey);
    const cacheKey = `quality-stats:t:${tenantId}:p:${projectId ?? 'all'}:d:${days}:v:${ver}`;

    const stats = await getOrSetCached(c.env as Env, cacheKey, async () => {
      const gconds = [eq(errorGroups.tenantId, tenantId)];
      if (projectId) gconds.push(eq(errorGroups.projectId, projectId));
      const since = new Date(Date.now() - days * 86_400_000);

      const events = sql<number>`coalesce(sum(${errorGroups.eventCount}), 0)`;
      const groupCount = sql<number>`count(*)`;

      // By-source volume (native SDK / OTLP / Sentry / PostHog / LogRocket): the
      // adapter is persisted on error_events, not error_groups, so this leg counts
      // event rows in-window by source (NULL source → 'native', the legacy default).
      const sourceExpr = sql<string>`coalesce(${errorEvents.source}, 'native')`;
      const bySourceConds = projectId
        ? and(eq(errorGroups.tenantId, tenantId), eq(errorGroups.projectId, projectId), gte(errorEvents.ts, since))
        : and(eq(errorEvents.tenantId, tenantId), gte(errorEvents.ts, since));

      const [byLevel, byStatus, bySource, byCollector, totalsRow, daily] = await Promise.all([
        db.select({ level: errorGroups.level, groups: groupCount, events })
          .from(errorGroups).where(and(...gconds)).groupBy(errorGroups.level),
        db.select({ status: errorGroups.status, groups: groupCount })
          .from(errorGroups).where(and(...gconds)).groupBy(errorGroups.status),
        projectId
          ? db.select({ source: sourceExpr, events: sql<number>`count(*)` })
              .from(errorEvents)
              .innerJoin(errorGroups, eq(errorEvents.groupId, errorGroups.id))
              .where(bySourceConds).groupBy(sourceExpr)
          : db.select({ source: sourceExpr, events: sql<number>`count(*)` })
              .from(errorEvents)
              .where(bySourceConds).groupBy(sourceExpr),
        db.select({
          collectorId: errorGroups.collectorId,
          name: sql<string | null>`max(${errorCollectors.name})`,
          groups: groupCount, events,
          lastEventAt: sql<string | null>`max(${errorGroups.lastSeen})`,
        })
          .from(errorGroups)
          .leftJoin(errorCollectors, eq(errorGroups.collectorId, errorCollectors.id))
          .where(and(...gconds)).groupBy(errorGroups.collectorId),
        db.select({
          groups: groupCount, events,
          users: sql<number>`coalesce(sum(${errorGroups.userCount}), 0)`,
        }).from(errorGroups).where(and(...gconds)),
        projectId
          ? db.select({ day: sql<string>`date_trunc('day', ${errorEvents.ts})`, count: sql<number>`count(*)` })
              .from(errorEvents)
              .innerJoin(errorGroups, eq(errorEvents.groupId, errorGroups.id))
              .where(and(eq(errorGroups.tenantId, tenantId), eq(errorGroups.projectId, projectId), gte(errorEvents.ts, since)))
              .groupBy(sql`date_trunc('day', ${errorEvents.ts})`).orderBy(sql`date_trunc('day', ${errorEvents.ts})`)
          : db.select({ day: sql<string>`date_trunc('day', ${errorEvents.ts})`, count: sql<number>`count(*)` })
              .from(errorEvents)
              .where(and(eq(errorEvents.tenantId, tenantId), gte(errorEvents.ts, since)))
              .groupBy(sql`date_trunc('day', ${errorEvents.ts})`).orderBy(sql`date_trunc('day', ${errorEvents.ts})`),
      ]);

      const totals = totalsRow[0] ?? { groups: 0, events: 0, users: 0 };
      return {
        windowDays: days,
        totals: { groups: Number(totals.groups), events: Number(totals.events), users: Number(totals.users) },
        byLevel: byLevel.map((r) => ({ level: r.level, groups: Number(r.groups), events: Number(r.events) })),
        byStatus: byStatus.map((r) => ({ status: r.status, groups: Number(r.groups) })),
        // In-window event volume attributed to the adapter that produced it.
        bySource: bySource.map((r) => ({ source: r.source, events: Number(r.events) })),
        byCollector: byCollector.map((r) => ({
          collectorId: r.collectorId, name: r.name ?? null,
          groups: Number(r.groups), events: Number(r.events),
          lastEventAt: r.lastEventAt ? new Date(r.lastEventAt).toISOString() : null,
        })),
        daily: daily.map((r) => ({ day: new Date(r.day).toISOString().slice(0, 10), count: Number(r.count) })),
      };
    });

    return c.json(stats);
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
    const [recent, trend] = await Promise.all([
      db.select({ ts: errorEvents.ts, userKey: errorEvents.userKey, release: errorEvents.release, environment: errorEvents.environment, payload: errorEvents.payload })
        .from(errorEvents).where(eq(errorEvents.groupId, id)).orderBy(desc(errorEvents.ts)).limit(20),
      db.select({ day: sql<string>`date_trunc('day', ${errorEvents.ts})`, count: sql<number>`count(*)` })
        .from(errorEvents).where(and(eq(errorEvents.groupId, id), gte(errorEvents.ts, since)))
        .groupBy(sql`date_trunc('day', ${errorEvents.ts})`).orderBy(sql`date_trunc('day', ${errorEvents.ts})`),
    ]);

    return c.json({
      group,
      recentEvents: recent,
      trend: trend.map((t) => ({ day: t.day, count: Number(t.count) })),
      // group.user_count is the EXACT distinct-user figure (error_group_users set,
      // never purged) — authoritative even after raw events age out via retention.
      affectedUsers: group.userCount,
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
      { projectId: group.projectId, title: `Fix: ${group.title}`.slice(0, 255), description: brief, priority: levelToPriority(group.level) },
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

/** Mapping rules for a tenant-level collector, ordered by ascending priority. */
async function loadRulesForCollector(db: Db, collectorId: string): Promise<MappingRule[]> {
  return db
    .select({
      matchField: errorMappingRules.matchField, matchOp: errorMappingRules.matchOp,
      matchValue: errorMappingRules.matchValue, projectId: errorMappingRules.projectId, priority: errorMappingRules.priority,
    })
    .from(errorMappingRules)
    .where(eq(errorMappingRules.collectorId, collectorId))
    .orderBy(asc(errorMappingRules.priority));
}
