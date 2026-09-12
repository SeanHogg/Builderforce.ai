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
import { PendingPromptService, MAX_ANON_LEN } from '../../application/marketing/PendingPromptService';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseOptionalBody, z } from './requestBody';

/** `anonId` / `prompt` stay optional so "anonId required" / "prompt required" answer. */
const RecordPromptBody = z.object({
  anonId: z.string().nullish(),
  prompt: z.string().nullish(),
  path: z.string().nullish(),
});

/** No `anonId` is a normal "nothing to claim" (`{ prompt: null }`), not an error. */
const ClaimPromptBody = z.object({ anonId: z.string().nullish() });

export function createPendingPromptRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const service = new PendingPromptService(db);

  // ── POST /api/pending-prompts ────────────────────────────────────────────
  // Public — runs before the visitor has any auth. Records the prompt for later
  // claim. Bounded input; one row per save (claim reads the most recent).
  router.post('/', async (c) => {
    const body = await parseOptionalBody(c, RecordPromptBody);
    const anonId = (body.anonId ?? '').trim();
    const prompt = (body.prompt ?? '').trim();
    if (!anonId || anonId.length > MAX_ANON_LEN) return c.json({ error: 'anonId required' }, 400);
    if (!prompt) return c.json({ error: 'prompt required' }, 400);

    await service.record(anonId, prompt, body.path ?? null);
    return c.json({ ok: true }, 201);
  });

  // ── POST /api/pending-prompts/claim ──────────────────────────────────────
  // Web-auth: the Brain mounts only when authenticated, so claiming here both
  // returns the prompt and associates the row to the now-known user. Single-use:
  // claimed rows are skipped on subsequent claims (kept for funnel analytics).
  router.post('/claim', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await parseOptionalBody(c, ClaimPromptBody);
    const anonId = (body.anonId ?? '').trim();
    if (!anonId) return c.json({ prompt: null });

    return c.json({ prompt: await service.claim(anonId, userId) });
  });

  return router;
}
