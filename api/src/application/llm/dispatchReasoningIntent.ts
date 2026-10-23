/**
 * The vendor-neutral REASONING INTENT one gateway dispatch carries — resolved once per
 * dispatch and turned into a vendor param PER CANDIDATE by `reasoningParamsForModel`
 * (see `vendors/registry.ts`).
 *
 * Sources, first match wins:
 *   1. the client's explicit `reasoning: { level }` (the VS Code "Thinking" toggle);
 *   2. the call's ROLE default (`roleReasoning.ts`) — only while cost lever
 *      `d4_role_reasoning` is on for the tenant.
 * While the lever is on the intent also carries the OpenRouter catalog's
 * reasoning-capable slugs, so an OpenRouter hop gets `reasoning: { effort }`.
 * Lever off → exactly the pre-D4 intent: the explicit client level or nothing.
 */

import { isCostLeverOn } from '@builderforce/cost-levers';
import type { AgentExecParams } from '@builderforce/agent-tools';
import type { CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { peekOpenRouterReasoningSlugs } from './modelCatalog';
import { parseClientReasoningIntent, type ReasoningParamOpts } from './reasoningCapability';
import { effectiveReasoningExecParams } from './roleReasoning';

export type DispatchReasoningIntent = { execParams: AgentExecParams } & ReasoningParamOpts;

export interface DispatchReasoningInput {
  /** The request body's raw `reasoning` field (untrusted). */
  reasoning: unknown;
  /** The request body's raw `role` field (untrusted; validated here). */
  role: unknown;
  /** True when the request carries no assistant turn yet (a planning turn). */
  isFirstTurn: boolean;
  /** The tenant the call is billed to — buckets the lever rollout. */
  tenantId: string | number | null | undefined;
  /** Raise one level (the D1 verifier cascade's retry). */
  escalate?: boolean;
}

export async function resolveDispatchReasoningIntent(
  env: CacheEnv,
  input: DispatchReasoningInput,
  // Injectable for tests; production reads the cached catalog.
  peekSlugs: (env: CacheEnv) => Promise<ReadonlySet<string> | undefined> = peekOpenRouterReasoningSlugs,
): Promise<DispatchReasoningIntent | undefined> {
  const explicit = parseClientReasoningIntent(input.reasoning);
  const leverOn = isCostLeverOn(env, 'd4_role_reasoning', input.tenantId);
  const execParams = effectiveReasoningExecParams(explicit, input.role, leverOn);
  if (!execParams) return undefined;
  const openRouterReasoning = leverOn ? await peekSlugs(env) : undefined;
  return {
    execParams,
    isFirstTurn: input.isFirstTurn,
    ...(input.escalate ? { escalate: true } : {}),
    ...(openRouterReasoning ? { openRouterReasoning } : {}),
  };
}
