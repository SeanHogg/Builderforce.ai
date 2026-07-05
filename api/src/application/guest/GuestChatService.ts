import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { marketingSessions } from '../../infrastructure/database/schema';
import { GUEST_CHAT_LIMITS } from '../../domain/tenant/PlanLimits';
import type { MarketingTouch } from '../marketing/MarketingService';

/**
 * Guest Brain/Ideas chat — usage metering for LOGGED-OUT visitors.
 *
 * A logged-out visitor who opens the Brain is a lead (same marketing_sessions
 * row as the free Diagnostics suite). They get a TINY daily allowance so they
 * can feel the product before signing up (which unlocks the real FREE tier).
 * Metered on two axes so the anonymous-LLM-cost blast radius stays bounded:
 *   • per visitorId — durable, on the lead row (also powers guest-engagement
 *     analytics + the "converted" funnel close-out).
 *   • per source IP — ephemeral KV counter, the spoof backstop: an abuser
 *     rotating visitorIds in the browser still collides on their IP.
 *
 * Neither axis is authoritative alone (visitorId is client-owned, IPs are shared
 * behind NAT), which is exactly why the allowance is deliberately tiny.
 */

export interface GuestCapResult {
  allowed: boolean;
  /** Remaining visitor messages today (0 when blocked on the visitor axis). */
  remaining: number;
  /** The per-visitor daily limit (for display). */
  limit: number;
  /** Why it was blocked, when `allowed` is false. */
  reason?: 'visitor' | 'ip';
}

/** UTC day key `YYYYMMDD` for the per-IP KV counter. */
function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/** Seconds until the next UTC midnight — the per-IP KV counter's TTL. */
function secondsUntilUtcMidnight(): number {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((next.getTime() - Date.now()) / 1000));
}

const ipCounterKey = (ip: string): string => `guestchat:ip:${utcDayKey()}:${ip}`;

export class GuestChatService {
  constructor(private readonly db: Db) {}

  /**
   * Ensure a lead row exists for this guest (insert-if-absent; no counter bump).
   * Called when a guest session token is minted, so a guest chatter is tracked as
   * a lead the instant they engage — and `MarketingService.markConverted` has a
   * row to stamp when they sign up. Idempotent.
   */
  async ensureLead(visitorId: string, touch?: MarketingTouch): Promise<void> {
    const utm = touch?.utm && Object.keys(touch.utm).length ? touch.utm : {};
    await this.db
      .insert(marketingSessions)
      .values({
        visitorId,
        landingPath: touch?.landingPath ?? null,
        referrer: touch?.referrer ?? null,
        userAgent: touch?.userAgent ?? null,
        utm: utm as object,
      })
      .onConflictDoUpdate({
        target: marketingSessions.visitorId,
        set: { lastSeenAt: sql`now()` },
      });
  }

  /** Today's per-visitor guest message count (0 when the stored day isn't today). */
  private async visitorCountToday(visitorId: string): Promise<number> {
    const [row] = await this.db
      .select({ day: marketingSessions.guestChatDay, count: marketingSessions.guestChatCount })
      .from(marketingSessions)
      .where(eq(marketingSessions.visitorId, visitorId))
      .limit(1);
    if (!row || !row.day) return 0;
    const today = new Date().toISOString().slice(0, 10);
    // guestChatDay is a `date` column — Drizzle returns it as a `YYYY-MM-DD` string.
    const stored = typeof row.day === 'string' ? row.day : new Date(row.day).toISOString().slice(0, 10);
    return stored === today ? row.count : 0;
  }

  /** Current per-IP guest message count today (0 when KV unbound or unset). */
  private async ipCountToday(env: Env, ip: string | null): Promise<number> {
    const kv = env.AUTH_CACHE_KV;
    if (!kv || !ip) return 0;
    const raw = await kv.get(ipCounterKey(ip)).catch(() => null);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Check whether this guest may send another message right now — WITHOUT
   * consuming the allowance. Enforces the per-visitor cap first, then the per-IP
   * backstop. Read-only.
   */
  async checkCap(env: Env, visitorId: string, ip: string | null): Promise<GuestCapResult> {
    const limit = GUEST_CHAT_LIMITS.messagesDailyLimit;
    const used = await this.visitorCountToday(visitorId);
    if (used >= limit) return { allowed: false, remaining: 0, limit, reason: 'visitor' };

    const ipUsed = await this.ipCountToday(env, ip);
    if (ipUsed >= GUEST_CHAT_LIMITS.ipMessagesDailyLimit) {
      return { allowed: false, remaining: Math.max(limit - used, 0), limit, reason: 'ip' };
    }
    return { allowed: true, remaining: Math.max(limit - used, 0), limit };
  }

  /**
   * Consume ONE message from the guest's allowance — bump the per-visitor counter
   * (resetting on a new UTC day) and the per-IP KV counter. Called up-front,
   * before dispatch, so an aborted/streamed request still counts (an abuser can't
   * dodge the cap by killing the stream). Returns the remaining visitor budget.
   */
  async consumeMessage(env: Env, visitorId: string, ip: string | null): Promise<number> {
    // Single statement: reset the day + counters when the stored day isn't today,
    // else increment. `guest_chat_tokens` is topped up separately once the stream
    // reports usage (see addTokens).
    await this.db
      .update(marketingSessions)
      .set({
        guestChatDay: sql`CURRENT_DATE`,
        guestChatCount: sql`CASE WHEN ${marketingSessions.guestChatDay} = CURRENT_DATE THEN ${marketingSessions.guestChatCount} + 1 ELSE 1 END`,
        guestChatTokens: sql`CASE WHEN ${marketingSessions.guestChatDay} = CURRENT_DATE THEN ${marketingSessions.guestChatTokens} ELSE 0 END`,
        lastSeenAt: sql`now()`,
      })
      .where(eq(marketingSessions.visitorId, visitorId));

    const kv = env.AUTH_CACHE_KV;
    if (kv && ip) {
      const current = await this.ipCountToday(env, ip);
      await kv
        .put(ipCounterKey(ip), String(current + 1), { expirationTtl: secondsUntilUtcMidnight() })
        .catch(() => { /* best-effort backstop — never fail the request */ });
    }

    const used = await this.visitorCountToday(visitorId);
    return Math.max(GUEST_CHAT_LIMITS.messagesDailyLimit - used, 0);
  }

  /**
   * Add the streamed token total to the guest's daily tally (analytics only — the
   * enforced cap is message-count, not tokens, since max_tokens is already
   * clamped per request). Fire-and-forget from the stream's usage callback.
   */
  async addTokens(visitorId: string, totalTokens: number): Promise<void> {
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) return;
    await this.db
      .update(marketingSessions)
      .set({ guestChatTokens: sql`${marketingSessions.guestChatTokens} + ${Math.round(totalTokens)}` })
      .where(eq(marketingSessions.visitorId, visitorId))
      .catch(() => { /* usage accounting is best-effort */ });
  }
}
