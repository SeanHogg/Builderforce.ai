import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog, announcementBanners } from '../../infrastructure/database/schema';
import {
  BROADCAST_MAX_VISITOR_IDS,
  BROADCAST_SCOPES,
  audienceMatches,
  parseBroadcastAudience,
  type BroadcastAudience,
  type VisitorStanding,
} from '../../domain/marketing/BroadcastAudience';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { broadcastRoom } from '../../infrastructure/relay/broadcastRoom';
import {
  BROADCAST_CONSOLE_CACHE_KEY,
  BROADCAST_LIVE_CACHE_KEY,
  visitorStandingCacheKey,
} from './marketingCacheKeys';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * Platform broadcasts — the superadmin's channel to visitors who have no
 * workspace to reach them through.
 *
 * Every session on this platform starts as an anonymous prompt, which makes
 * every session a conversion opportunity and the anonymous visitor the one
 * audience marketing could not previously address: they have no account, no
 * email, and no tenant, so nothing in the campaign engine (audiences of
 * addresses, verified senders, suppression) applies to them. What they do have
 * is an open tab. This is that channel.
 *
 * THREE DELIBERATE CHOICES
 *
 * 1. It reuses `announcement_banners` rather than adding a table. A superadmin
 *    message to visitors and a tenant banner are the same thing — text, tone,
 *    CTA, window, audience — differing only in who wrote it and who sees it,
 *    which is exactly what the nullable `tenantId` says. `tenantId IS NULL` is
 *    the platform broadcast.
 *
 * 2. Targeting is decided SERVER-SIDE from the visitor's lead row. The client
 *    sends an opaque `visitorId` and nothing else that matters; "I am a paying
 *    customer" is not a claim a browser gets to make, and a targeting rule that
 *    trusted the request body would make a message aimed at one visitor readable
 *    by every visitor.
 *
 * 3. Realtime is one room and one word. `broadcast:platform` carries the
 *    existing `{type:'changed'}` frame to every connected client, and each
 *    client re-fetches ITS OWN targeted list. No message text crosses the relay,
 *    so the fan-out channel can be public without leaking a targeted broadcast —
 *    the same "no domain data through the DO" posture the poker, retro and
 *    ceremony rooms already run on.
 */

/** The realtime room every client watches for "a broadcast changed". */
export const BROADCAST_ROOM = 'broadcast:platform';

/** Kinds of engagement, and the `activity_log` verb each becomes. */
export const BROADCAST_EVENTS = ['impression', 'click', 'dismiss'] as const;
export type BroadcastEvent = (typeof BROADCAST_EVENTS)[number];

export const BROADCAST_STATUSES = ['draft', 'live', 'archived'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const BROADCAST_TONES = ['info', 'success', 'warning', 'critical'] as const;
export type BroadcastTone = (typeof BROADCAST_TONES)[number];

/** What a visitor receives. Deliberately the smallest possible shape — no
 *  audience, no counts, nothing that would tell one visitor about another. */
export interface DeliveredBroadcast {
  id: number;
  message: string;
  tone: BroadcastTone;
  ctaLabel: string | null;
  ctaHref: string | null;
  dismissible: boolean;
}

/** What the console sees: the row, its audience, and how it performed. */
export interface BroadcastWithEngagement {
  id: number;
  key: string;
  message: string;
  tone: BroadcastTone;
  ctaLabel: string | null;
  ctaHref: string | null;
  dismissible: boolean;
  status: BroadcastStatus;
  audience: BroadcastAudience;
  startsAt: string | null;
  endsAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived from `activity_log`, never stored — see the class note on 3NF. */
  impressions: number;
  clicks: number;
  dismissals: number;
  /** Distinct visitors reached, and click-through against them. */
  reach: number;
  clickThroughPct: number;
}

export interface BroadcastInput {
  message: string;
  tone?: string;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  dismissible?: boolean;
  status?: string;
  audience?: unknown;
  startsAt?: string | null;
  endsAt?: string | null;
}

const DELIVERY_CACHE_TTL_SECONDS = 60;

/** A live row as the delivery path needs it: the visitor-facing fields plus the
 *  rule to test. The rule never leaves this service. */
interface LiveBroadcast extends DeliveredBroadcast {
  audience: BroadcastAudience;
}

function toTone(value: unknown): BroadcastTone {
  return BROADCAST_TONES.includes(value as BroadcastTone) ? (value as BroadcastTone) : 'info';
}

function toStatus(value: unknown): BroadcastStatus {
  return BROADCAST_STATUSES.includes(value as BroadcastStatus) ? (value as BroadcastStatus) : 'draft';
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Serialise an audience for storage, through the domain parser so a rule can
 *  never be stored in a shape the delivery path would reject. */
function normalizeAudience(value: unknown): BroadcastAudience {
  return parseBroadcastAudience(value);
}

export class PlatformBroadcastService {
  constructor(private readonly db: Db) {}

  // ── Delivery ──────────────────────────────────────────────────────────────

  /**
   * The broadcasts this visitor should see, right now.
   *
   * Two cached reads and no per-request fan-out: the live SET is shared by every
   * visitor (one cache entry for the whole platform), and the visitor's STANDING
   * is one small entry of their own. The audience predicate then runs in memory.
   * A page load therefore costs zero database round trips in the steady state,
   * which matters because this runs on every page of the marketing site.
   */
  async deliverTo(env: Env, visitorId: string): Promise<DeliveredBroadcast[]> {
    const [live, standing] = await Promise.all([
      this.liveBroadcasts(env),
      this.standingOf(env, visitorId),
    ]);
    return live
      .filter((b) => audienceMatches(b.audience, standing))
      .map(({ audience: _audience, ...visible }) => visible);
  }

  /**
   * Every live, in-window platform broadcast. Shared across all visitors, so the
   * cache entry is one for the platform rather than one per visitor.
   *
   * The window is evaluated in SQL rather than in the cached value, and then the
   * result is cached for a minute — a banner therefore goes live within a minute
   * of its `startsAt`, which is the resolution a scheduled banner needs and the
   * staleness a page load can afford.
   */
  private async liveBroadcasts(env: Env): Promise<LiveBroadcast[]> {
    return getOrSetCached(env, BROADCAST_LIVE_CACHE_KEY, async () => {
      const rows = await this.db
        .select({
          id: announcementBanners.id,
          message: announcementBanners.message,
          tone: announcementBanners.tone,
          ctaLabel: announcementBanners.ctaLabel,
          ctaHref: announcementBanners.ctaHref,
          dismissible: announcementBanners.dismissible,
          audience: announcementBanners.audience,
        })
        .from(announcementBanners)
        .where(and(
          isNull(announcementBanners.tenantId),
          eq(announcementBanners.status, 'live'),
          or(isNull(announcementBanners.startsAt), sql`${announcementBanners.startsAt} <= now()`),
          or(isNull(announcementBanners.endsAt), sql`${announcementBanners.endsAt} > now()`),
        ))
        .orderBy(asc(announcementBanners.id));

      return rows.map((row) => ({
        id: row.id,
        message: row.message,
        tone: toTone(row.tone),
        ctaLabel: row.ctaLabel,
        ctaHref: row.ctaHref,
        dismissible: row.dismissible,
        audience: parseBroadcastAudience(row.audience),
      }));
    }, { kvTtlSeconds: DELIVERY_CACHE_TTL_SECONDS });
  }

  /**
   * Where this visitor stands in the funnel — read from their lead row and their
   * prompt count, never from the request.
   *
   * A visitor with no lead row yet (they have loaded a page but not typed) is a
   * guest with zero prompts, which is the truth rather than a fallback.
   */
  private async standingOf(env: Env, visitorId: string): Promise<VisitorStanding> {
    return getOrSetCached(env, visitorStandingCacheKey(visitorId), async () => {
      const rows = await this.db.execute(sql`
        SELECT
          ms.converted AS registered,
          COALESCE(BOOL_OR(t.plan = 'pro' AND t.billing_status = 'active' AND t.is_demo = false), false) AS paid,
          (SELECT COUNT(*)::int FROM marketing_session_prompts p WHERE p.visitor_id = ms.visitor_id) AS "promptCount"
        FROM marketing_sessions ms
        LEFT JOIN tenant_members tm ON tm.user_id = ms.converted_user_id AND tm.is_active = true
        LEFT JOIN tenants t ON t.id = tm.tenant_id
        WHERE ms.visitor_id = ${visitorId}
        GROUP BY ms.visitor_id, ms.converted
        LIMIT 1
      `);
      const row = rows.rows[0] as Record<string, unknown> | undefined;
      return {
        visitorId,
        registered: !!row?.registered,
        paid: !!row?.paid,
        promptCount: Number(row?.promptCount ?? 0),
      };
    }, { kvTtlSeconds: DELIVERY_CACHE_TTL_SECONDS });
  }

  /**
   * Record that a visitor saw, clicked, or dismissed a broadcast.
   *
   * Written to `activity_log` — the kernel's append-only event primitive, whose
   * `tenantId` is nullable precisely for platform-global events. Not counter
   * columns on the banner: a stored count is a derived value, it could not
   * answer "which visitor clicked", and it would double-count every re-render.
   *
   * `eventKey` makes each (broadcast, visitor, kind) pair land exactly once —
   * the column exists for idempotent producers, and an impression fired by a
   * component that remounts is precisely that.
   */
  async recordEvent(
    env: Env,
    input: { broadcastId: number; visitorId: string; kind: BroadcastEvent },
  ): Promise<void> {
    await this.db
      .insert(activityLog)
      .values({
        eventKey: `broadcast:${input.broadcastId}:${input.visitorId}:${input.kind}`,
        actorType: 'human',
        actorRef: input.visitorId,
        verb: `broadcast.${input.kind}`,
        targetType: 'announcement_banner',
        targetId: String(input.broadcastId),
      })
      .onConflictDoNothing({ target: activityLog.eventKey });

    await invalidateCached(env, BROADCAST_CONSOLE_CACHE_KEY);
  }

  // ── Console ───────────────────────────────────────────────────────────────

  /** Every platform broadcast with its measured engagement, newest first. */
  async listForConsole(env: Env): Promise<BroadcastWithEngagement[]> {
    return getOrSetCached(env, BROADCAST_CONSOLE_CACHE_KEY, async () => {
      const rows = await this.db.execute(sql`
        WITH engagement AS (
          SELECT
            target_id,
            COUNT(*) FILTER (WHERE verb = 'broadcast.impression')::int AS impressions,
            COUNT(*) FILTER (WHERE verb = 'broadcast.click')::int      AS clicks,
            COUNT(*) FILTER (WHERE verb = 'broadcast.dismiss')::int    AS dismissals,
            COUNT(DISTINCT actor_ref)::int                             AS reach
          FROM activity_log
          WHERE target_type = 'announcement_banner'
          GROUP BY target_id
        )
        SELECT
          b.id, b.key, b.message, b.tone,
          b.cta_label   AS "ctaLabel",
          b.cta_href    AS "ctaHref",
          b.dismissible,
          b.status,
          b.audience,
          b.starts_at   AS "startsAt",
          b.ends_at     AS "endsAt",
          b.created_by  AS "createdBy",
          b.created_at  AS "createdAt",
          b.updated_at  AS "updatedAt",
          COALESCE(e.impressions, 0) AS impressions,
          COALESCE(e.clicks, 0)      AS clicks,
          COALESCE(e.dismissals, 0)  AS dismissals,
          COALESCE(e.reach, 0)       AS reach
        FROM announcement_banners b
        LEFT JOIN engagement e ON e.target_id = b.id::text
        WHERE b.tenant_id IS NULL
        ORDER BY b.created_at DESC
        LIMIT 200
      `);

      return (rows.rows as Array<Record<string, unknown>>).map((row) => {
        const reach = Number(row.reach ?? 0);
        const clicks = Number(row.clicks ?? 0);
        return {
          id: Number(row.id),
          key: String(row.key),
          message: String(row.message),
          tone: toTone(row.tone),
          ctaLabel: (row.ctaLabel as string | null) ?? null,
          ctaHref: (row.ctaHref as string | null) ?? null,
          dismissible: !!row.dismissible,
          status: toStatus(row.status),
          audience: parseBroadcastAudience(row.audience),
          startsAt: (row.startsAt as string | null) ?? null,
          endsAt: (row.endsAt as string | null) ?? null,
          createdBy: (row.createdBy as string | null) ?? null,
          createdAt: String(row.createdAt),
          updatedAt: String(row.updatedAt),
          impressions: Number(row.impressions ?? 0),
          clicks,
          dismissals: Number(row.dismissals ?? 0),
          reach,
          clickThroughPct: reach > 0 ? Math.round((clicks / reach) * 1000) / 10 : 0,
        };
      });
    }, { kvTtlSeconds: 30 });
  }

  /** Author a broadcast. Returns null when the message is empty — the one input
   *  with no sensible default, since a banner with nothing to say is not a draft. */
  async create(env: Env, input: BroadcastInput, authorUserId: string): Promise<BroadcastWithEngagement | null> {
    const message = (input.message ?? '').trim();
    if (!message) return null;

    const [row] = await this.db
      .insert(announcementBanners)
      .values({
        tenantId: null,
        // Unique per (tenant, key); a platform row's tenant is NULL, so the key
        // only has to be distinct enough to be a human handle in the console.
        key: `platform-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        message: message.slice(0, 500),
        tone: toTone(input.tone),
        ctaLabel: input.ctaLabel?.trim().slice(0, 96) || null,
        ctaHref: input.ctaHref?.trim().slice(0, 500) || null,
        dismissible: input.dismissible ?? true,
        status: toStatus(input.status),
        audience: normalizeAudience(input.audience),
        startsAt: toDate(input.startsAt),
        endsAt: toDate(input.endsAt),
        createdBy: authorUserId,
      })
      .returning({ id: announcementBanners.id });

    await this.publish(env);
    const all = await this.listForConsole(env);
    return all.find((b) => b.id === row?.id) ?? null;
  }

  /** Edit a broadcast. Only the fields present are touched, so the console can
   *  send a status flip without resending the whole row. */
  async update(env: Env, id: number, patch: BroadcastInput): Promise<boolean> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof patch.message === 'string' && patch.message.trim()) set.message = patch.message.trim().slice(0, 500);
    if (patch.tone !== undefined) set.tone = toTone(patch.tone);
    if (patch.ctaLabel !== undefined) set.ctaLabel = patch.ctaLabel?.trim().slice(0, 96) || null;
    if (patch.ctaHref !== undefined) set.ctaHref = patch.ctaHref?.trim().slice(0, 500) || null;
    if (patch.dismissible !== undefined) set.dismissible = !!patch.dismissible;
    if (patch.status !== undefined) set.status = toStatus(patch.status);
    if (patch.audience !== undefined) set.audience = normalizeAudience(patch.audience);
    if (patch.startsAt !== undefined) set.startsAt = toDate(patch.startsAt);
    if (patch.endsAt !== undefined) set.endsAt = toDate(patch.endsAt);

    const updated = await this.db
      .update(announcementBanners)
      .set(set)
      .where(and(eq(announcementBanners.id, id), isNull(announcementBanners.tenantId)))
      .returning({ id: announcementBanners.id });

    if (!updated.length) return false;
    await this.publish(env);
    return true;
  }

  /**
   * Remove a broadcast.
   *
   * A hard delete, and that is the right call for this row: it carries no
   * history worth keeping (the engagement lives in `activity_log` and survives
   * independently), and an operator who deletes a message that is currently on
   * screen means "stop showing this", which a soft-deleted row still on the live
   * query would not do. `archived` is the reversible option and it is one field
   * away.
   */
  async remove(env: Env, id: number): Promise<boolean> {
    const deleted = await this.db
      .delete(announcementBanners)
      .where(and(eq(announcementBanners.id, id), isNull(announcementBanners.tenantId)))
      .returning({ id: announcementBanners.id });
    if (!deleted.length) return false;
    await this.publish(env);
    return true;
  }

  /**
   * Drop the delivery caches and tell every open tab to re-fetch.
   *
   * Both halves matter: without the invalidation a "live" flip would take a
   * minute to be visible, and without the relay frame a visitor who is already
   * on the page would never see it at all until they navigated. The relay frame
   * is the literal string `{"type":"changed"}` — no message text, no audience,
   * nothing a public channel should not carry.
   */
  private async publish(env: Env): Promise<void> {
    await Promise.all([
      invalidateCached(env, BROADCAST_LIVE_CACHE_KEY),
      invalidateCached(env, BROADCAST_CONSOLE_CACHE_KEY),
    ]);
    await broadcastRoom(env.SESSION_ROOM, BROADCAST_ROOM).catch((error) => {
      // Best-effort: a missed frame costs a visitor one stale minute, never a send.
      reportCaughtError(error, {
        source: 'application/marketing/PlatformBroadcastService.ts',
        operation: 'publish',
      });
    });
  }
}

/** The vocabulary the console offers, exported so the route can advertise it
 *  rather than the client hard-coding a second copy. */
export const broadcastVocabulary = {
  tones: BROADCAST_TONES,
  statuses: BROADCAST_STATUSES,
  scopes: BROADCAST_SCOPES,
  maxVisitorIds: BROADCAST_MAX_VISITOR_IDS,
};

