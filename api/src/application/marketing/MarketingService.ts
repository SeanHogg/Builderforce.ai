import { and, eq, desc, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { marketingSessions, marketingToolRuns } from '../../infrastructure/database/schema';
import { diagnosticName } from '../tools/ToolService';
import type { ToolResult } from '../tools/toolTypes';

/**
 * Anonymous marketing sessions for the free Diagnostics & Tools suite.
 *
 * Every logged-out visitor who runs a free tool is a lead. We track the session
 * by a client-generated stable `visitorId`, keep run volume + first-touch
 * attribution, and STORE the latest result per (visitor, tool) so a returning
 * visitor can re-see their diagnostics — and so we can target them with a
 * sign-up. When they create an account the session is stamped converted.
 *
 * No tenant scoping (these are pre-signup leads); `visitorId` is the whole key.
 */

/** First-touch attribution captured once, on the first tracked event. */
export interface MarketingTouch {
  landingPath?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  utm?: Record<string, string> | null;
}

export interface MarketingSessionDto {
  visitorId: string;
  toolRuns: number;
  lastToolId: string | null;
  converted: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface MarketingRunDto {
  toolId: string;
  name: string;
  result: ToolResult;
  updatedAt: string;
}

export interface MarketingSessionView {
  session: MarketingSessionDto | null;
  runs: MarketingRunDto[];
}

const VISITOR_RE = /^[A-Za-z0-9_-]{8,64}$/;
const sessionKey = (visitorId: string) => `marketing:session:${visitorId}`;

/** Validate a client-supplied visitor id (opaque token, bounded charset/length). */
export function isValidVisitorId(id: unknown): id is string {
  return typeof id === 'string' && VISITOR_RE.test(id);
}

export class MarketingService {
  constructor(private readonly db: Db) {}

  /**
   * Record one anonymous tool run: upsert the session (bump run count + last-seen,
   * capture first-touch on insert) and upsert the latest result for (visitor,
   * tool). Recompute-free — the client sends the already-computed public result.
   */
  async trackToolRun(
    env: Env,
    args: { visitorId: string; toolId: string; input: Record<string, number>; result: ToolResult; touch?: MarketingTouch },
  ): Promise<void> {
    const { visitorId, toolId } = args;
    const utm = args.touch?.utm && Object.keys(args.touch.utm).length ? args.touch.utm : {};

    await this.db
      .insert(marketingSessions)
      .values({
        visitorId,
        toolRuns: 1,
        lastToolId: toolId,
        landingPath: args.touch?.landingPath ?? null,
        referrer: args.touch?.referrer ?? null,
        userAgent: args.touch?.userAgent ?? null,
        utm: utm as object,
      })
      .onConflictDoUpdate({
        target: marketingSessions.visitorId,
        set: {
          toolRuns: sql`${marketingSessions.toolRuns} + 1`,
          lastToolId: toolId,
          lastSeenAt: sql`now()`,
        },
      });

    await this.db
      .insert(marketingToolRuns)
      .values({ visitorId, toolId, input: args.input as object, result: args.result as object })
      .onConflictDoUpdate({
        target: [marketingToolRuns.visitorId, marketingToolRuns.toolId],
        set: { input: args.input as object, result: args.result as object, updatedAt: sql`now()` },
      });

    await invalidateCached(env, sessionKey(visitorId));
  }

  /**
   * A returning visitor's session + their stored diagnostics (latest per tool),
   * cached and invalidated on track/convert. Drives the "welcome back — here are
   * your results" experience and the targeted sign-up nudge.
   */
  async getSession(env: Env, visitorId: string): Promise<MarketingSessionView> {
    return getOrSetCached(env, sessionKey(visitorId), async () => {
      const [session] = await this.db
        .select()
        .from(marketingSessions)
        .where(eq(marketingSessions.visitorId, visitorId))
        .limit(1);

      if (!session) return { session: null, runs: [] };

      const runs = await this.db
        .select()
        .from(marketingToolRuns)
        .where(eq(marketingToolRuns.visitorId, visitorId))
        .orderBy(desc(marketingToolRuns.updatedAt))
        .limit(50);

      return {
        session: {
          visitorId: session.visitorId,
          toolRuns: session.toolRuns,
          lastToolId: session.lastToolId ?? null,
          converted: session.converted,
          firstSeenAt: session.firstSeenAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
        },
        runs: runs.map((r) => ({
          toolId: r.toolId,
          name: diagnosticName(r.toolId),
          result: r.result as ToolResult,
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    }, { kvTtlSeconds: 120 });
  }

  /**
   * Close the funnel: stamp the session converted with the now-authenticated user.
   * No-op if the visitor id is unknown or already converted. Idempotent.
   */
  async markConverted(env: Env, visitorId: string, userId: string): Promise<void> {
    await this.db
      .update(marketingSessions)
      .set({ converted: true, convertedUserId: userId, convertedAt: sql`now()` })
      .where(and(eq(marketingSessions.visitorId, visitorId), eq(marketingSessions.converted, false)));
    await invalidateCached(env, sessionKey(visitorId));
  }
}
