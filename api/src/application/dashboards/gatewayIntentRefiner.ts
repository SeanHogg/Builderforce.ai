/**
 * The ONE place the metered gateway is wired to the AI-query intent mapper.
 *
 * Mirrors `application/eval/gatewayJudge.ts` deliberately: an LLM call that
 * assists a feature rather than being the feature gets a small, named adapter
 * that goes through `LlmProxyService`, so it is billed, capped and observable
 * exactly like every other completion — no out-of-band model access.
 *
 * WHAT THIS CAN AND CANNOT DO. It is handed the question and the CURRENT list of
 * whitelisted metric keys, and its answer is a candidate string that
 * `refineIntent` validates against the registry before anything uses it. So the
 * worst case for a prompt-injected question, a hallucinated key or a model that
 * answers in prose is identical: the candidate fails validation and the
 * deterministic keyword answer stands. The question never becomes a query.
 *
 * It runs ONLY for a question the keyword rules did not match, which on a tenant
 * asking ordinary questions is rare — the keyword path stays free.
 */
import { llmProxyForPlan, readProxyChoice } from '../llm/LlmProxyService';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { IntentRefiner } from './nlQuery';
import type { Env } from '../../env';

/** Small budget: the reply is one key. A model that needs more is not answering. */
const MAX_TOKENS = 24;

export function gatewayIntentRefiner(
  env: Env,
  effectivePlan: 'free' | 'pro' | 'teams',
  premiumOverride = false,
): IntentRefiner {
  return async (question: string, allowedKeys: string[]): Promise<string | null> => {
    try {
      const service = llmProxyForPlan(env, effectivePlan, premiumOverride);
      const result = await service.complete({
        // temperature 0 → the same question maps to the same metric every time,
        // which is the minimum a number on a dashboard has to promise.
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [{
          role: 'user',
          content: [
            'Pick the ONE metric key that best answers the question below.',
            'Reply with the key alone — no prose, no punctuation, no explanation.',
            'If none of them fits, reply with the single word NONE.',
            '',
            'Allowed keys:',
            allowedKeys.join('\n'),
            '',
            // The question is quoted as DATA. It is also never trusted on the way
            // back out: the reply is validated against the key list regardless of
            // what the question tried to talk the model into.
            `Question: ${JSON.stringify(question.slice(0, 500))}`,
          ].join('\n'),
        }],
      } as never);
      const reply = (await readProxyChoice(result)).content.trim();
      return reply && reply.toUpperCase() !== 'NONE' ? reply : null;
    } catch (error) {
      // Never fatal: the caller keeps the deterministic intent. Reported rather
      // than swallowed so a gateway that is failing every refinement is visible.
      reportCaughtError(error, {
        source: 'application/dashboards/gatewayIntentRefiner.ts',
        operation: 'gatewayIntentRefiner',
        context: { logMessage: '[nl-query] intent refinement failed; keeping the keyword parse' },
      });
      return null;
    }
  };
}
