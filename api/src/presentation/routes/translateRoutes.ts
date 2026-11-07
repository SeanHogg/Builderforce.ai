/**
 * POST /api/translate — cloud fallback for on-device translation (PRD 42 E4).
 *
 *   { texts: string[1..20], to, from }  ->  { translations: string[] }
 *
 * 400 invalid input · 401 no session (anonymous users run Local only) · 429 rate-limited or
 * over the daily character budget (tenant or global) ·
 * 503 translation model unavailable. Thin HTTP mapping: batching and caching live in the
 * `TranslateText` use case, the model behind the Workers AI adapter.
 */
import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { z, parseBody } from './requestBody';
import { checkSlidingWindow } from '../../application/ratelimit/slidingWindow';
import { spendTranslateBudget } from '../../application/translate/translateBudget';
import { createDefaultTranslateText } from '../../application/translate/defaultTranslateText';
import {
  MAX_TRANSLATE_TEXTS,
  MAX_TRANSLATE_TEXT_CHARS,
  isSameLanguage,
  TranslationUnavailableError,
  type TranslateText,
} from '../../application/translate/translateText';

/** Requests per user per minute — each request fans out to up to 20 model calls. */
export const TRANSLATE_RPM = 30;

const lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i).max(16);
const Body = z.object({
  texts: z.array(z.string().min(1).max(MAX_TRANSLATE_TEXT_CHARS)).min(1).max(MAX_TRANSLATE_TEXTS),
  to: lang,
  from: lang,
});

export type TranslateFactory = (env: Env) => TranslateText;

export function createTranslateRoutes(makeTranslate: TranslateFactory = createDefaultTranslateText) {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.post('/', async (c) => {
    const body = await parseBody(c, Body);

    const env = c.env as Env;
    const verdict = await checkSlidingWindow(env, `translate:${c.get('tenantId')}:${c.get('userId')}`, TRANSLATE_RPM);
    if (verdict && !verdict.allowed) {
      c.header('Retry-After', String(verdict.retryAfterSeconds));
      return c.json({ error: 'Rate limit exceeded. Please slow down.', resetAt: verdict.resetAt }, 429);
    }

    // Nothing to translate: echo the texts, spend no budget, make no model call.
    if (isSameLanguage(body.from, body.to)) return c.json({ translations: body.texts });

    const chars = body.texts.reduce((n, t) => n + t.length, 0);
    const budget = await spendTranslateBudget(env, c.get('tenantId') as number, chars);
    if (budget) {
      c.header('Retry-After', String(budget.retryAfterSeconds));
      return c.json({ error: 'Daily translation budget exceeded.', resetAt: budget.resetAt }, 429);
    }

    try {
      const translations = await makeTranslate(env)(body);
      return c.json({ translations });
    } catch (e) {
      if (e instanceof TranslationUnavailableError) return c.json({ error: 'Translation is unavailable' }, 503);
      throw e;
    }
  });

  return router;
}
