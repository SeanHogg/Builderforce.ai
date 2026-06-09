/**
 * Where a V2 cloud agent executes — its "runtime surface". BOTH run the full task
 * in the cloud (everything is Cloudflare — no local/hybrid agent):
 *   • 'durable'   — a Durable Object (CloudRunnerDO), one LLM step per alarm tick.
 *     On-demand serverless; no always-on compute. The default.
 *   • 'container' — a long-lived Cloudflare Container runtime, for very long /
 *     continuous tasks that want a persistent process + shell. (Container infra is
 *     a future build; until then a 'container' run falls back to the durable DO so
 *     it still executes in the cloud.)
 *
 * Single source of truth for the routing decision so dispatch (runtime) and the
 * test agree on which surface a run targets.
 */
export type CloudSurface = 'durable' | 'container';

/**
 * Resolve the surface a run targets. An explicitly-pinned host is a long-lived
 * runtime (reached via the relay), so it maps to 'container'; otherwise honor the
 * agent's chosen surface, defaulting to 'durable' (on-demand, no always-on infra).
 */
export function resolveCloudSurface(agentSurface: string | undefined | null, hasExplicitHost: boolean): CloudSurface {
  if (hasExplicitHost) return 'container';
  return agentSurface === 'container' ? 'container' : 'durable';
}
