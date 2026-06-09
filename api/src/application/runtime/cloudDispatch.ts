/**
 * Where a cloud run executes — its "runtime surface" (the two types of V2 cloud
 * agent the user picks at creation):
 *   • 'durable' — a Durable Object (on-demand serverless), one LLM step per alarm
 *     tick. No infra to run; survives the Workers waitUntil ~30s limit.
 *   • 'node'    — a long-lived agent-runtime (Node service) the tenant keeps
 *     connected; runs the full Claude Agent SDK V2 loop with no time limit.
 *
 * Single source of truth for the routing decision so dispatch (runtime) and any
 * test agree on which surface a run targets.
 */
export type CloudSurface = 'durable' | 'node';

/**
 * Resolve the surface a run targets. An explicitly-pinned self-hosted host is a
 * long-lived node by definition; otherwise honor the agent's chosen surface,
 * defaulting to 'durable' (runs with no infra).
 */
export function resolveCloudSurface(agentSurface: string | undefined | null, hasExplicitHost: boolean): CloudSurface {
  if (hasExplicitHost) return 'node';
  return agentSurface === 'node' ? 'node' : 'durable';
}
