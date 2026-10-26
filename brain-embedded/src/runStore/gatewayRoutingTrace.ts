/**
 * The gateway's routing of one turn, as the `llm.complete` step records it.
 *
 * Kept as plain strings in the step's args: a copied chat report is read by people and
 * by triage, and both read `failovers: "xai/grok-4.7:403 capacity"` without a schema.
 */

import type { GatewayRouting } from '../streamChatCompletion';

/** Between two failovers in the recorded string — `routingByRole.ts` splits on it. */
export const FAILOVER_SEPARATOR = ', ';

/** `model:status kind` for each model the gateway tried and left. */
export function formatFailovers(routing: GatewayRouting | undefined): string | undefined {
  const failovers = routing?.failovers ?? [];
  if (failovers.length === 0) return undefined;
  return failovers.map((f) => `${f.model}:${f.code}${f.kind ? ` ${f.kind}` : ''}`).join(FAILOVER_SEPARATOR);
}

/** The `llm.complete` args that carry the routing — empty when the gateway sent none. */
export function gatewayRoutingArgs(routing: GatewayRouting | undefined): Record<string, string> {
  if (!routing) return {};
  const failovers = formatFailovers(routing);
  return {
    ...(failovers ? { failovers } : {}),
    ...(routing.candidates?.length ? { candidates: routing.candidates.join(' > ') } : {}),
    ...(routing.traceId ? { traceId: routing.traceId } : {}),
  };
}
