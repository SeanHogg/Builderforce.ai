/**
 * Default wiring of the `TranslateText` use case: Workers AI model + read-through cache.
 * Lives in the application layer so the route imports no infrastructure.
 */
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { createWorkersAiTranslator } from '../../infrastructure/translate/workersAiTranslator';
import { createTranslateText, type TranslateText } from './translateText';

export function createDefaultTranslateText(env: Env): TranslateText {
  return createTranslateText({
    model: createWorkersAiTranslator(env),
    cache: (key, loader, ttl) => getOrSetCached(env, key, loader, { kvTtlSeconds: ttl }),
  });
}
