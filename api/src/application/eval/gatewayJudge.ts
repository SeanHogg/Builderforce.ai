/**
 * The ONE place an LLM-as-judge is wired to the metered gateway. Both the on-demand
 * eval surface (/api/eval) and the Gig-Marketplace proposal evaluator import this so
 * a judge call is billed/capped exactly like any other completion — no out-of-band
 * model access, no duplicated wiring.
 */
import { llmProxyForPlan, readProxyChoice } from '../llm/LlmProxyService';
import type { EvalJudge } from './semanticEval';
import type { Env } from '../../env';

/** Build an LLM-as-judge bound to the tenant's plan + metered gateway. A judge
 *  failure returns '' so {@link evaluateResponse} degrades to the lexical backend. */
export function gatewayJudge(
  env: Env,
  effectivePlan: 'free' | 'pro' | 'teams',
  premiumOverride: boolean,
): EvalJudge {
  return async (prompt: string): Promise<string> => {
    const service = llmProxyForPlan(env, effectivePlan, premiumOverride);
    const result = await service.complete({
      // temperature 0 → deterministic, repeatable verdicts.
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 200,
    } as never);
    return (await readProxyChoice(result)).content;
  };
}
