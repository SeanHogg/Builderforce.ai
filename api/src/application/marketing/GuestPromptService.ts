import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { marketingSessionPrompts, marketingSessions } from '../../infrastructure/database/schema';
import { forgetVisitorActivity } from './visitorActivity';
import {
  GUEST_PROMPT_LIMITS,
  parseGuestPrompt,
  type GuestPrompt,
} from '../../domain/marketing/GuestPrompt';
import { consumeGuestAllowance } from '../guest/guestDailyCounter';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { GUEST_SESSIONS_CACHE_KEY, visitorStandingCacheKey } from './marketingCacheKeys';

/**
 * What anonymous visitors ASKED FOR — the write side and the read side.
 *
 * The write side is the point of the whole subsystem: this platform opens a
 * session from a prompt, so a visitor's first sentence is the only statement of
 * intent we ever get from most leads, and until 0434 it was thrown away. Two
 * call sites feed it and they are deliberately different in kind:
 *
 *   • the LANDING composer posts explicitly (`POST /api/guest/prompt`), because
 *     it submits BEFORE any model call exists — the session is created in the
 *     browser and navigated to, and if we waited for the first completion we
 *     would lose every visitor who bounced on the loading state. That is the
 *     drop-off worth measuring, so it cannot be the one we are blind to.
 *   • every in-session turn is harvested from the gateway (`handleGuestChat`),
 *     off the request path via `waitUntil`, so a canvas or Brain turn costs the
 *     visitor nothing and needs no second round trip.
 *
 * Both go through `parseGuestPrompt`, so the two entry points cannot drift about
 * what a stored prompt is.
 *
 * The read side answers the console's question — "who is out there and what do
 * they want" — as ONE aggregate join. There are no rollup columns on the lead
 * row to read instead: those would be derived values (3NF), and the price of not
 * having them is paid here once, in a cached query, rather than in an update
 * anomaly on every delete.
 */

/** A lead, with their intent, for the superadmin console. */
export interface GuestSessionWithIntent {
  id: string;
  visitorId: string;
  guestChatCount: number;
  guestChatTokens: number;
  toolRuns: number;
  landingPath: string | null;
  referrer: string | null;
  converted: boolean;
  convertedUserId: string | null;
  convertedAt: string | null;
  convertedEmail: string | null;
  isPaid: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Derived here, never stored: see the class note. */
  promptCount: number;
  firstPrompt: string | null;
  lastPrompt: string | null;
  lastPromptAt: string | null;
  lastSurface: string | null;
}

/** The headline numbers above the list — the funnel in five figures. */
export interface GuestFunnelSummary {
  sessions: number;
  sessionsWithPrompt: number;
  prompts: number;
  registered: number;
  paid: number;
  /** Prompt → account, as a percentage of sessions that stated an intent. */
  conversionPct: number;
}

export interface GuestSessionsPage {
  summary: GuestFunnelSummary;
  sessions: GuestSessionWithIntent[];
}

/** One recorded prompt, for the per-visitor drill-in. */
export interface GuestPromptRecord {
  id: string;
  prompt: string;
  surface: string;
  sessionRef: string | null;
  mode: string | null;
  createdAt: string;
}

/** Outcome of a record attempt. `skipped` is the ordinary "nothing was typed" case. */
export type GuestPromptRecordResult =
  | { status: 'recorded'; prompt: GuestPrompt }
  | { status: 'skipped' }
  | { status: 'rate_limited' };

const SESSIONS_LIMIT = 500;
const PROMPTS_LIMIT = 200;


export class GuestPromptService {
  constructor(private readonly db: Db) {}

  /**
   * Record one prompt, charged against the visitor's daily allowance.
   *
   * Rate limiting lives here rather than in the route because the gateway
   * harvest path needs the identical ceiling — an unauthenticated write that two
   * callers can reach must not have its limit enforced by only one of them.
   */
  async record(env: Env, input: {
    visitorId: string;
    prompt?: unknown;
    surface?: unknown;
    sessionRef?: unknown;
    visitId?: unknown;
    mode?: unknown;
    ip?: string | null;
  }): Promise<GuestPromptRecordResult> {
    const parsed = parseGuestPrompt(input);
    if (!parsed.ok) return { status: 'skipped' };

    const allowance = await consumeGuestAllowance(
      env, 'guestprompt', input.visitorId, input.ip ?? null, GUEST_PROMPT_LIMITS,
    );
    if (!allowance.allowed) return { status: 'rate_limited' };

    await this.db.insert(marketingSessionPrompts).values({
      visitorId: parsed.value.visitorId,
      sessionRef: parsed.value.sessionRef,
      visitId: parsed.value.visitId,
      surface: parsed.value.surface,
      mode: parsed.value.mode,
      prompt: parsed.value.prompt,
    });

    // The lead row's activity clock has to move with the prompt, or a visitor who
    // types for ten minutes without triggering a model call looks dormant.
    await this.db
      .update(marketingSessions)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(marketingSessions.visitorId, parsed.value.visitorId));

    await Promise.all([
      invalidateCached(env, GUEST_SESSIONS_CACHE_KEY),
      invalidateCached(env, visitorStandingCacheKey(parsed.value.visitorId)),
    ]);

    return { status: 'recorded', prompt: parsed.value };
  }

  /**
   * The console page: leads newest-first, each with their intent, plus the
   * funnel summary above them.
   *
   * ONE query for the list and one for the summary — the prompt aggregate is a
   * grouped subquery joined once, not a correlated lookup per lead, so this
   * stays two round trips whether there are five sessions or five hundred.
   */
  async listSessionsWithIntent(env: Env): Promise<GuestSessionsPage> {
    return getOrSetCached(env, GUEST_SESSIONS_CACHE_KEY, async () => {
      const [sessions, summary] = await Promise.all([
        this.loadSessions(),
        this.loadSummary(),
      ]);
      return { summary, sessions };
    }, { kvTtlSeconds: 60 });
  }

  private async loadSessions(): Promise<GuestSessionWithIntent[]> {
    const rows = await this.db.execute(sql`
      WITH intent AS (
        SELECT
          p.visitor_id,
          COUNT(*)::int                                         AS prompt_count,
          MIN(p.created_at)                                     AS first_prompt_at,
          MAX(p.created_at)                                     AS last_prompt_at,
          (ARRAY_AGG(p.prompt ORDER BY p.created_at ASC))[1]    AS first_prompt,
          (ARRAY_AGG(p.prompt ORDER BY p.created_at DESC))[1]   AS last_prompt,
          (ARRAY_AGG(p.surface ORDER BY p.created_at DESC))[1]  AS last_surface
        FROM marketing_session_prompts p
        GROUP BY p.visitor_id
      )
      SELECT
        ms.id,
        ms.visitor_id        AS "visitorId",
        ms.guest_chat_count  AS "guestChatCount",
        ms.guest_chat_tokens AS "guestChatTokens",
        ms.tool_runs         AS "toolRuns",
        ms.landing_path      AS "landingPath",
        ms.referrer,
        ms.converted,
        ms.converted_user_id AS "convertedUserId",
        ms.converted_at      AS "convertedAt",
        ms.first_seen_at     AS "firstSeenAt",
        ms.last_seen_at      AS "lastSeenAt",
        u.email              AS "convertedEmail",
        COALESCE(BOOL_OR(t.plan = 'pro' AND t.billing_status = 'active' AND t.is_demo = false), false) AS "isPaid",
        COALESCE(i.prompt_count, 0) AS "promptCount",
        i.first_prompt       AS "firstPrompt",
        i.last_prompt        AS "lastPrompt",
        i.last_prompt_at     AS "lastPromptAt",
        i.last_surface       AS "lastSurface"
      FROM marketing_sessions ms
      LEFT JOIN intent i ON i.visitor_id = ms.visitor_id
      LEFT JOIN users u ON u.id = ms.converted_user_id
      LEFT JOIN tenant_members tm ON tm.user_id = u.id AND tm.is_active = true
      LEFT JOIN tenants t ON t.id = tm.tenant_id
      GROUP BY ms.id, u.email, i.prompt_count, i.first_prompt, i.last_prompt, i.last_prompt_at, i.last_surface
      ORDER BY ms.last_seen_at DESC
      LIMIT ${SESSIONS_LIMIT}
    `);
    return rows.rows as unknown as GuestSessionWithIntent[];
  }

  private async loadSummary(): Promise<GuestFunnelSummary> {
    const rows = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM marketing_sessions)                              AS sessions,
        (SELECT COUNT(DISTINCT visitor_id)::int FROM marketing_session_prompts)     AS "sessionsWithPrompt",
        (SELECT COUNT(*)::int FROM marketing_session_prompts)                       AS prompts,
        (SELECT COUNT(*)::int FROM marketing_sessions WHERE converted = true)       AS registered,
        (SELECT COUNT(DISTINCT ms.id)::int
           FROM marketing_sessions ms
           JOIN users u ON u.id = ms.converted_user_id
           JOIN tenant_members tm ON tm.user_id = u.id AND tm.is_active = true
           JOIN tenants t ON t.id = tm.tenant_id
          WHERE t.plan = 'pro' AND t.billing_status = 'active' AND t.is_demo = false) AS paid
    `);
    const row = (rows.rows[0] ?? {}) as Record<string, number>;
    const sessions = Number(row.sessions ?? 0);
    const withPrompt = Number(row.sessionsWithPrompt ?? 0);
    const registered = Number(row.registered ?? 0);
    return {
      sessions,
      sessionsWithPrompt: withPrompt,
      prompts: Number(row.prompts ?? 0),
      registered,
      paid: Number(row.paid ?? 0),
      // Against sessions that STATED an intent, not against every visitor: a
      // bounce with no prompt never entered the funnel this number describes.
      conversionPct: withPrompt > 0 ? Math.round((registered / withPrompt) * 1000) / 10 : 0,
    };
  }

  /** One visitor's prompts, newest first — the console drill-in. Uncached: it is
   *  opened for a single lead on demand and must show the turn that just landed. */
  async listPromptsForVisitor(visitorId: string): Promise<GuestPromptRecord[]> {
    const rows = await this.db
      .select({
        id: marketingSessionPrompts.id,
        prompt: marketingSessionPrompts.prompt,
        surface: marketingSessionPrompts.surface,
        sessionRef: marketingSessionPrompts.sessionRef,
        mode: marketingSessionPrompts.mode,
        createdAt: marketingSessionPrompts.createdAt,
      })
      .from(marketingSessionPrompts)
      .where(eq(marketingSessionPrompts.visitorId, visitorId))
      .orderBy(desc(marketingSessionPrompts.createdAt))
      .limit(PROMPTS_LIMIT);
    return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
  }

  /**
   * How many prompts this visitor has submitted — the engagement half of a
   * broadcast's audience rule. Cached beside their standing because the pair is
   * read together on every delivery.
   */
  async promptCount(visitorId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(marketingSessionPrompts)
      .where(eq(marketingSessionPrompts.visitorId, visitorId));
    return Number(row?.count ?? 0);
  }

  /**
   * Erase everything an anonymous visitor left behind.
   *
   * A prompt is free text a person wrote, and their journey is where they went
   * and what broke — both are personal data, and both tables deliberately hang
   * off no cascade, because they are keyed by an opaque visitor id rather than a
   * user row, so nothing would ever remove them on its own. The superadmin
   * console's per-visitor drawer is what calls this
   * (`DELETE /api/admin/guest-sessions/:visitorId/prompts`), which is how a
   * privacy request that names a visitor id gets actioned rather than only
   * tracked.
   *
   * BOTH streams, in one call, deliberately. When the journey stream arrived
   * (migration 1109) an erasure that cleared only the prompts would have left the
   * visitor's full navigation and error history in place while REPORTING the
   * request as actioned — a privacy failure that looks like a success. The
   * counts are returned separately so the audit record says what actually went.
   *
   * The journey now lives in `activity_log` (migration 1111), so the delete is
   * `forgetVisitorActivity` rather than a table this file names — which is what
   * keeps the erasure correct if that mapping ever moves again.
   */
  async forgetVisitor(env: Env, visitorId: string): Promise<{ prompts: number; events: number }> {
    const [prompts, events] = await Promise.all([
      this.db
        .delete(marketingSessionPrompts)
        .where(eq(marketingSessionPrompts.visitorId, visitorId))
        .returning({ id: marketingSessionPrompts.id }),
      forgetVisitorActivity(this.db, visitorId),
    ]);
    await Promise.all([
      invalidateCached(env, GUEST_SESSIONS_CACHE_KEY),
      invalidateCached(env, visitorStandingCacheKey(visitorId)),
    ]);
    return { prompts: prompts.length, events };
  }
}
