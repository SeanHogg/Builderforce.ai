/**
 * The per-REQUEST cost levers a cloud run reads outside the per-tick session
 * (`costLoopSession.ts`): the model pick's exploration (D3), the role reasoning default
 * (D4) and the tool-row budget (C7). Each is one lever decision turned into the exact
 * option the seam already takes, so every cloud executor (the durable loop, the image
 * surfaces' `llm` op) asks the same question the same way, and `cloudAgentEngine.ts`
 * wires them without growing.
 *
 * Lever off ⇒ `undefined` / the caller's own value: the pre-lever behaviour, byte for byte.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { AgentExecParams } from '@builderforce/agent-tools';
import type { RoutingExploration } from '@builderforce/learned-routing';
import type { OpenAiChatCodecOptions } from '@builderforce/agent-loop';
import { cappedMaxTokens } from '@builderforce/run-policy';
import { modelToolResultPolicy } from '@builderforce/tool-output-policy';
import { effectiveReasoningExecParams } from '../../llm/roleReasoning';

type TenantId = string | number | null | undefined;

/**
 * D3: Thompson exploration for a SOFT seed, or `undefined` (deterministic ranking).
 * `pickCloudModel` applies it only on the soft-seed branches — a strict pin returns
 * before any ranking, and a premium override never explores.
 */
export function cloudRoutingExploration(env: unknown, tenantId: TenantId): RoutingExploration | undefined {
  return isCostLeverOn(env, 'd3_routing_exploration', tenantId) ? { rng: Math.random, nowMs: Date.now() } : undefined;
}

/** D4: the persona's explicit reasoning levers, else the call role's default while the
 *  lever is on — the same precedence the gateway applies (`dispatchReasoningIntent.ts`). */
export function cloudReasoningExecParams(
  env: unknown,
  tenantId: TenantId,
  execParams: AgentExecParams | undefined,
  role: unknown,
): AgentExecParams | undefined {
  return effectiveReasoningExecParams(execParams, role, isCostLeverOn(env, 'd4_role_reasoning', tenantId));
}

/** D5: the per-role reply cap under the caller's, while the lever is on. */
export function cloudOutputCap(env: unknown, tenantId: TenantId, role: string | null | undefined, callerMaxTokens?: number): number | undefined {
  return isCostLeverOn(env, 'd5_output_caps', tenantId) ? cappedMaxTokens(role, callerMaxTokens) : callerMaxTokens;
}

/** C7: the codec options that bound every tool row by the shared tool-output policy, or
 *  `undefined` (plain JSON rows) with the lever off. */
export function toolRowCodecOptions(env: unknown, tenantId: TenantId): OpenAiChatCodecOptions | undefined {
  return isCostLeverOn(env, 'c7_tool_output_policy', tenantId) ? { toolResultPolicy: modelToolResultPolicy({ summarize: true }) } : undefined;
}

/**
 * The cost-lever flags the image reads off its `/run` body (`container/server.mjs`). The
 * Worker owns the tenant and the env, so it decides; the image only obeys, and an absent
 * flag is off there — an older Worker never turns on a behaviour it did not choose.
 */
export function containerRunLevers(env: unknown, tenantId: TenantId): {
  repoMap: boolean; postEditChecks: boolean; postEditSteer: boolean; parallelReads: boolean;
} {
  const on = (id: Parameters<typeof isCostLeverOn>[1]) => isCostLeverOn(env, id, tenantId);
  const steer = on('d7_deterministic_handlers');
  return {
    repoMap: on('c5_cloud_repo_map'),
    // The checks run when either consumer is on: D7 (the model reads the failures) or
    // D1 (the cascade reads the verdict, which the image reports on its next `llm` op).
    postEditChecks: steer || on('d1_verifier_cascade'),
    postEditSteer: steer,
    parallelReads: on('d8_parallel_tool_calls'),
  };
}
