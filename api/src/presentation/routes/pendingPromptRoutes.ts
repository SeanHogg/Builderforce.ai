/**
 * Anonymous pending-prompt routes — /api/pending-prompts
 *
 * Durable, cross-device handoff of a prompt a visitor typed on the landing page
 * before they had an account. The browser also keeps a localStorage copy for the
 * same-browser fast path; this server record adds cross-device continuity and
 * abandoned-prompt analytics (the localStorage-only gap [1517]).
 *
 *   POST /api/pending-prompts        Public. Record { anonId, prompt, path? }.
 *   POST /api/pending-prompts/claim  Web-auth. The Brain claims the latest
 *       unclaimed, unexpired prompt for { anonId } on first authenticated load,
 *       stamping user_id + claimed_at, and replays it as the first message.
 *
 * Write-only by design — no read-through cache (every claim mutates a row).
 */
import { Hono } from 'hono';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { pendingPrompts } from '../../infrastructure/database/schema';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const MAX_PROMPT_LEN = 4000;
const MAX_ANON_LEN = 64;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createPendingPromptRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── POST /api/pending-prompts ────────────────────────────────────────────
  // Public — runs before the visitor has any auth. Records the prompt for later
  // claim. Bounded input; one row per save (claim reads the most recent).
  router.post('/', async (c) => {
    const body = await c.req.json<{ anonId?: string; prompt?: string; path?: string }>()
      .catch(() => ({}) as { anonId?: string; prompt?: string; path?: string });
    const anonId = (body.anonId ?? '').trim();
    const prompt = (body.prompt ?? '').trim();
    if (!anonId || anonId.length > MAX_ANON_LEN) return c.json({ error: 'anonId required' }, 400);
    if (!prompt) return c.json({ error: 'prompt required' }, 400);

    await db.insert(pendingPrompts).values({
      anonId,
      prompt: prompt.slice(0, MAX_PROMPT_LEN),
      path: body.path ? body.path.slice(0, 512) : null,
      expiresAt: new Date(Date.now() + TTL_MS),
    });

    return c.json({ ok: true }, 201);
  });

  // ── POST /api/pending-prompts/claim ──────────────────────────────────────
  // Web-auth: the Brain mounts only when authenticated, so claiming here both
  // returns the prompt and associates the row to the now-known user. Single-use:
  // claimed rows are skipped on subsequent claims (kept for funnel analytics).
  router.post('/claim', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ anonId?: string }>().catch(() => ({}) as { anonId?: string });
    const anonId = (body.anonId ?? '').trim();
    if (!anonId) return c.json({ prompt: null });

    const [row] = await db
      .select({ id: pendingPrompts.id, prompt: pendingPrompts.prompt })
      .from(pendingPrompts)
      .where(and(
        eq(pendingPrompts.anonId, anonId),
        isNull(pendingPrompts.claimedAt),
        gt(pendingPrompts.expiresAt, new Date()),
      ))
      .orderBy(desc(pendingPrompts.createdAt))
      .limit(1);

    if (!row) return c.json({ prompt: null });

    await db
      .update(pendingPrompts)
      .set({ claimedAt: new Date(), userId })
      .where(eq(pendingPrompts.id, row.id));

    return c.json({ prompt: row.prompt });
  });

  return router;
}
