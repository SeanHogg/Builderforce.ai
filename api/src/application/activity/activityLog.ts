/**
 * Unified activity / audit log — the ONE canonical write + read path for "who did
 * what, to what, when" across the whole workforce (team members, external talent /
 * hires, AI agents, and the platform itself).
 *
 * WRITE: `recordActivity(env, db, input)` — a best-effort, never-throws emitter
 * called from every mutation site. A mutation must never fail because its audit
 * write did, so failures are swallowed; on success it bumps the read cache so the
 * timeline reflects the new event immediately.
 *
 * ACTOR: polymorphic `(type, ref)` following the existing (kind, ref) convention.
 * `resolveActorFromContext` turns a request's JWT identity into an ActorIdentity,
 * classifying a tenant member as 'human' and an engaged external freelancer as
 * 'hire' (cached — membership/identity changes rarely). Agent-initiated mutations
 * pass an explicit actor via the `*Actor` constructors.
 *
 * READ: `getActivityLog(env, db, tenantId, filter)` — version-token cached,
 * keyset-paginated timeline with actor/target/verb/project filters.
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { activityLog, agentHosts, freelancerEngagements, ideAgents, tenantMembers, users } from '../../infrastructure/database/schema';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { buildTransactionalDatabase } from '../../infrastructure/database/connection';

export type ActorType = 'human' | 'hire' | 'cloud_agent' | 'host_agent' | 'system';

export interface ActorIdentity {
  type: ActorType;
  /** Id into the per-type table (users.id / ide_agents.id / agent_hosts.id); null for system. */
  ref: string | null;
  name: string;
  /** freelancer_engagements.id when the actor is an external hire. */
  engagementId?: string | null;
}

export interface ActivityInput {
  /** null only for platform-global events (e.g. a pre-tenant login/registration). */
  tenantId: number | null;
  segmentId?: string | null;
  projectId?: number | null;
  actor: ActorIdentity;
  /** Free-form action verb, e.g. 'task.created', 'comment.added', 'deploy.recorded'. */
  verb: string;
  targetType?: string | null;
  targetId?: string | number | null;
  targetLabel?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
}

/** The system/platform actor (cron sweeps, webhooks, automated maintenance). */
export const SYSTEM_ACTOR: ActorIdentity = { type: 'system', ref: null, name: 'System' };
/** Build an on-prem (host) agent actor. */
export function hostAgentActor(agentHostId: number | string, name: string): ActorIdentity {
  return { type: 'host_agent', ref: String(agentHostId), name };
}
/** Build a cloud agent actor (ide_agents.id value-ref). */
export function cloudAgentActor(agentRef: string, name: string): ActorIdentity {
  return { type: 'cloud_agent', ref: agentRef, name };
}

export function activityLogVersionKey(tenantId: number | null): string {
  return `activity-log:tenant:${tenantId ?? 'global'}`;
}

/**
 * Emit one activity/audit event. Best-effort: never throws — a mutation must not
 * fail because its audit write did. Bumps the read cache so the timeline reflects
 * the new event on the next read.
 */
export async function recordActivity(env: Env | undefined, db: Db, input: ActivityInput): Promise<void> {
  try {
    const activityDb = env?.NEON_TRANSACTIONAL_DATABASE_URL ? buildTransactionalDatabase(env) : db;
    await activityDb.insert(activityLog).values({
      tenantId: input.tenantId ?? null,
      segmentId: input.segmentId ?? null,
      projectId: input.projectId ?? null,
      actorType: input.actor.type,
      actorRef: input.actor.ref ?? null,
      actorName: input.actor.name ? input.actor.name.slice(0, 255) : null,
      engagementId: input.actor.engagementId ?? null,
      verb: input.verb,
      targetType: input.targetType ?? null,
      targetId: input.targetId != null ? String(input.targetId).slice(0, 64) : null,
      targetLabel: input.targetLabel ? input.targetLabel.slice(0, 300) : null,
      summary: input.summary ?? null,
      metadata: (input.metadata ?? null) as Record<string, unknown> | null,
      occurredAt: input.occurredAt ?? new Date(),
    });
    await bumpCacheVersion(env as Env, activityLogVersionKey(input.tenantId));
  } catch {
    // Best-effort — audit failures must not break the mutation.
  }
}

/**
 * Resolve the human/hire acting in this request into an ActorIdentity. Falls back
 * to the system actor for unauthenticated / agentHost-token paths (no user id).
 */
export async function resolveActorFromContext(env: Env | undefined, db: Db, c: Context<HonoEnv>): Promise<ActorIdentity> {
  const userId = c.get('userId') as string | undefined;
  const tenantId = c.get('tenantId') as number | undefined;
  if (!userId || !tenantId) return SYSTEM_ACTOR;
  return resolveHumanActor(env, db, tenantId, userId);
}

/**
 * Classify + name a user acting in a tenant: a tenant member is 'human'; an
 * external freelancer engaged in this tenant is 'hire' (with the engagement id).
 * Cached (300s) — membership and display names change rarely.
 */
export async function resolveHumanActor(env: Env | undefined, db: Db, tenantId: number, userId: string): Promise<ActorIdentity> {
  return getOrSetCached(env as Env, `actor:tenant:${tenantId}:user:${userId}`, async (): Promise<ActorIdentity> => {
    const [u] = await db
      .select({ displayName: users.displayName, username: users.username, email: users.email, accountType: users.accountType })
      .from(users).where(eq(users.id, userId)).limit(1);
    const name = u?.displayName || u?.username || u?.email || 'Unknown';

    const [member] = await db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId), eq(tenantMembers.isActive, true)))
      .limit(1);
    if (member) return { type: 'human', ref: userId, name, engagementId: null };

    const [eng] = await db
      .select({ id: freelancerEngagements.id })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.tenantId, tenantId),
        eq(freelancerEngagements.freelancerUserId, userId),
        inArray(freelancerEngagements.status, ['active', 'interviewing', 'invited']),
      ))
      .orderBy(desc(freelancerEngagements.createdAt)).limit(1);
    if (eng) return { type: 'hire', ref: userId, name, engagementId: eng.id };

    // Not a member and no engagement (e.g. owner acting before a membership
    // backfill) — classify by the global account type.
    return { type: u?.accountType === 'freelancer' ? 'hire' : 'human', ref: userId, name, engagementId: null };
  }, { kvTtlSeconds: 300 });
}

/**
 * Resolve an opaque authorship ref (work_deltas.createdBy, an agent self-ref,
 * etc.) into an ActorIdentity of ANY kind — tries user (human/hire), then cloud
 * agent (ide_agents), then on-prem host agent (agent_hosts). Cached (300s). Used
 * where the writer only knows a bare ref, not the request context.
 */
export async function resolveActorByRef(env: Env, db: Db, tenantId: number, ref: string | null | undefined): Promise<ActorIdentity> {
  if (!ref) return SYSTEM_ACTOR;
  return getOrSetCached(env, `actor-ref:tenant:${tenantId}:${ref}`, async (): Promise<ActorIdentity> => {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, ref)).limit(1);
    if (u) return resolveHumanActor(env, db, tenantId, ref);

    const [ca] = await db
      .select({ name: ideAgents.name })
      .from(ideAgents).where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, ref))).limit(1);
    if (ca) return { type: 'cloud_agent', ref, name: ca.name ?? ref };

    if (/^\d+$/.test(ref)) {
      const [ha] = await db
        .select({ name: agentHosts.name })
        .from(agentHosts).where(and(eq(agentHosts.tenantId, tenantId), eq(agentHosts.id, Number(ref)))).limit(1);
      if (ha) return { type: 'host_agent', ref, name: ha.name ?? ref };
    }
    // Unknown ref shape → treat as an agent self-ref (its own label).
    return { type: 'cloud_agent', ref, name: ref };
  }, { kvTtlSeconds: 300 });
}

// ── Read path ───────────────────────────────────────────────────────────────

export interface ActivityLogFilter {
  actorType?: string;
  actorRef?: string;
  targetType?: string;
  targetId?: string;
  projectId?: number;
  verb?: string;
  /** Keyset cursor: return rows with id < beforeId (id is monotonic). */
  beforeId?: number;
  limit?: number;
}

export interface ActivityLogRow {
  id: number;
  actorType: string;
  actorRef: string | null;
  actorName: string | null;
  engagementId: string | null;
  verb: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  summary: string | null;
  projectId: number | null;
  occurredAt: string;
  metadata: unknown;
}

export interface ActivityLogPage {
  events: ActivityLogRow[];
  nextCursor: number | null;
}

async function queryActivityLog(db: Db, tenantId: number, filter: ActivityLogFilter, limit: number): Promise<ActivityLogPage> {
  const conds = [eq(activityLog.tenantId, tenantId)];
  if (filter.actorType) conds.push(eq(activityLog.actorType, filter.actorType));
  if (filter.actorRef) conds.push(eq(activityLog.actorRef, filter.actorRef));
  if (filter.targetType) conds.push(eq(activityLog.targetType, filter.targetType));
  if (filter.targetId) conds.push(eq(activityLog.targetId, filter.targetId));
  if (filter.projectId != null) conds.push(eq(activityLog.projectId, filter.projectId));
  if (filter.verb) conds.push(eq(activityLog.verb, filter.verb));
  if (filter.beforeId != null) conds.push(lt(activityLog.id, filter.beforeId));

  const rows = await db
    .select({
      id: activityLog.id,
      actorType: activityLog.actorType,
      actorRef: activityLog.actorRef,
      actorName: activityLog.actorName,
      engagementId: activityLog.engagementId,
      verb: activityLog.verb,
      targetType: activityLog.targetType,
      targetId: activityLog.targetId,
      targetLabel: activityLog.targetLabel,
      summary: activityLog.summary,
      projectId: activityLog.projectId,
      occurredAt: activityLog.occurredAt,
      metadata: activityLog.metadata,
    })
    .from(activityLog)
    .where(and(...conds))
    .orderBy(desc(activityLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const events: ActivityLogRow[] = rows.slice(0, limit).map((r) => ({
    id: Number(r.id),
    actorType: r.actorType,
    actorRef: r.actorRef,
    actorName: r.actorName,
    engagementId: r.engagementId,
    verb: r.verb,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    summary: r.summary,
    projectId: r.projectId,
    occurredAt: (r.occurredAt as Date).toISOString(),
    metadata: r.metadata,
  }));
  const last = events[events.length - 1];
  return { events, nextCursor: hasMore && last ? last.id : null };
}

/**
 * Read the tenant's activity/audit timeline — version-token cached (the day/filter
 * keyspace is unbounded) with a 120s KV backstop; the version bumps on every
 * `recordActivity` write so a new event shows on the next read.
 */
export async function getActivityLog(env: Env, db: Db, tenantId: number, filter: ActivityLogFilter): Promise<ActivityLogPage> {
  const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
  const version = await getCacheVersion(env, activityLogVersionKey(tenantId));
  const key = `activity-log:list:tenant:${tenantId}:v:${version}:${JSON.stringify({ ...filter, limit })}`;
  const activityDb = env.NEON_TRANSACTIONAL_DATABASE_URL ? buildTransactionalDatabase(env) : db;
  return getOrSetCached(env, key, () => queryActivityLog(activityDb, tenantId, filter, limit), { kvTtlSeconds: 120 });
}
