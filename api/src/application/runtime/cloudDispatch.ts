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
 * BuilderForce V2 (long-lived) runtime surface.
 *
 * BuilderForce V2 is the primary engine and needs a always-on long-lived runtime.
 * The `container` surface is the primary target for V2; if unavailable, we fallback
 * to serverless durable (DO) and surface a clear, non‑silent degradation message.
 */
export const BUILDERFORCE_V2_SURFACE = 'container' satisfies CloudSurface;

/**
 * Resolve the surface a run targets.
 *
 * Rules:
 *   - An explicitly-pinned host is a long-lived runtime → 'container'.
 *   - If the agent is V2 and a V2 container is detected in the environment → 'container'.
 *   - Otherwise, honor the agent's chosen surface, defaulting to 'durable'.
 *
 * If V2 is selected but not-capable containers are known, we fallback to 'durable'
 * and surface a deprecation/error message, ensuring Silent Failure is prevented.
 */
export function resolveCloudSurface(
  agentSurface: string | undefined | null,
  hasExplicitHost: boolean,
  v2RuntimeAvailable: boolean = V2_RUNTIME_ENV !== undefined,
): CloudSurface {
  if (hasExplicitHost) return 'container'; // Host = true container/runtime
  if (v2RuntimeAvailable && agentSurface === BUILDERFORCE_V2_SURFACE) return 'container';
  return agentSurface === 'container' ? 'container' : 'durable';
}

/**
 * Environment flag indicating whether a V2 container runtime is provisioned and active.
 * Required for V2 to use the 'container' surface; missing → fallback aware.
 */
export const V2_RUNTIME_ENV = process.env.BUILDERFORCE_V2_RUNTIME;
