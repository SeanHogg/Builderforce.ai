/**
 * Pending-prompt service — the durable, cross-device handoff of a prompt a
 * visitor typed before they had an account.
 *
 * The browser also keeps a localStorage copy for the same-browser fast path; this
 * server record adds cross-device continuity and abandoned-prompt analytics.
 *
 * Sits in `marketing` alongside `GuestPromptService` because it is the same
 * funnel fact one step earlier: a prompt typed by somebody who is not yet anybody,
 * keyed by an opaque anonymous id rather than a tenant. Both are pre-account
 * writes, which is why neither is tenant-scoped and neither is cached — every
 * claim mutates a row.
 *
 * The queries lived inline in `pendingPromptRoutes.ts` until 2026-08-19, which
 * put `infrastructure/database/schema` in the HTTP layer for a table with two
 * operations.
 */
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { pendingPrompts } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

const MAX_PROMPT_LEN = 4000;
export const MAX_ANON_LEN = 64;
/** A prompt nobody came back for stops being a handoff and becomes analytics. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class PendingPromptService {
  constructor(private readonly db: Db) {}

  /** Record a prompt for later claim. One row per save; the claim reads the most
   *  recent. Input is bounded here rather than at the edge so every caller gets
   *  the same limits. */
  async record(anonId: string, prompt: string, path: string | null): Promise<void> {
    await this.db.insert(pendingPrompts).values({
      anonId,
      prompt: prompt.slice(0, MAX_PROMPT_LEN),
      path: path ? path.slice(0, 512) : null,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
  }

  /**
   * Claim the latest unclaimed, unexpired prompt for an anonymous id, stamping it
   * with the now-known user. Single-use: claimed rows are skipped by subsequent
   * claims but kept, because the funnel question is "how many prompts were typed
   * and never claimed", which a delete would erase.
   */
  async claim(anonId: string, userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: pendingPrompts.id, prompt: pendingPrompts.prompt })
      .from(pendingPrompts)
      .where(and(
        eq(pendingPrompts.anonId, anonId),
        isNull(pendingPrompts.claimedAt),
        gt(pendingPrompts.expiresAt, new Date()),
      ))
      .orderBy(desc(pendingPrompts.createdAt))
      .limit(1);

    if (!row) return null;

    await this.db
      .update(pendingPrompts)
      .set({ claimedAt: new Date(), userId })
      .where(eq(pendingPrompts.id, row.id));

    return row.prompt;
  }
}
