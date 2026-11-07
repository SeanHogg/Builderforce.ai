/**
 * Workers AI translation adapter — Meta M2M100 1.2B, on the account's free Workers AI
 * quota. Reaches the AI the same way the Cloudflare embeddings vendor does: the native
 * REST endpoint with CLOUDFLARE_AI_API_TOKEN + CLOUDFLARE_ACCOUNT_ID. Never a paid model.
 *
 *   POST .../ai/run/@cf/meta/m2m100-1.2b
 *   { text, source_lang?, target_lang }  ->  { result: { translated_text }, success }
 *
 * The model cannot detect a language, so the request always names `from`.
 */
import type { Env } from '../../env';
import {
  workersAiCredentials,
  workersAiRunEndpoint,
} from '../workersAi/workersAiEndpoint';
import { TranslationUnavailableError, type TranslationModel } from '../../application/translate/translateText';

export const TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b';

export function createWorkersAiTranslator(
  env: Pick<Env, 'CLOUDFLARE_AI_API_TOKEN' | 'CLOUDFLARE_ACCOUNT_ID'>,
  fetchImpl: typeof fetch = fetch,
): TranslationModel {
  return {
    async translate(text, { from, to }) {
      const creds = workersAiCredentials(env);
      if (!creds) throw new TranslationUnavailableError('Workers AI is not configured');
      let res: Response;
      try {
        res = await fetchImpl(workersAiRunEndpoint(creds.accountId, TRANSLATION_MODEL), {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, target_lang: to, source_lang: from }),
        });
      } catch (e) {
        throw new TranslationUnavailableError(e instanceof Error ? e.message : 'Translation request failed');
      }
      if (!res.ok) throw new TranslationUnavailableError(`Translation model returned ${res.status}`);
      let body: { result?: { translated_text?: unknown } } | null;
      try {
        body = (await res.json()) as { result?: { translated_text?: unknown } } | null;
      } catch (e) {
        throw new TranslationUnavailableError(`Translation model returned an unreadable body (${e instanceof Error ? e.message : 'invalid JSON'})`);
      }
      const out = body?.result?.translated_text;
      if (typeof out !== 'string') throw new TranslationUnavailableError('Translation model returned no text');
      return out;
    },
  };
}
