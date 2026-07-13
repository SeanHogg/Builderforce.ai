/**
 * Resolve-builderforce-engine (resolve-engine-by-id)
 *
 * Determines a stable, attempted upstream engine from a given agent-type metadata.
 */

import { getBuilderForceEngineFromEngineType } from '../agent-registry/builderforce-registry.js';

/**
 * v2EnvHealthCheck: ensure the executor’s environment is ready for builderforce-v2.
 *
 * @param {boolean} enforce_online — if false, skip health checks and allow a provisioned config only.
 * @returns {{
 *   available: boolean;
 *   engine: "builderforce-v2" | "builderforce-v1";
 *   error?: string;
 *   healthMs?: number;
 * }}
 */
export async function v2EnvHealthCheck(enforce_online = true) {
  const engine = getBuilderForceEngineFromEngineType(2); // V2
  const base_url = process.env.BUILDERFORCE_BASE_URL || '';
  const agent_host_id = process.env.BUILDERFORCE_AGENT_HOST_ID || 'expected-builderforce-agent-host';
  const api_key = process.env.BUILDERFORCE_API_KEY || '';
  const tunnel_status = (tunnelUrl: string) =>
    tunnelUrl && tunnelUrl !== 'none' ? 'connected' : 'not_provisioned';

  // Basic validation for builderforce-v2: presence of base_url and matching engine.
  if (!base_url) {
    return {
      available: false,
      engine,
      error: `[v2] BUILDERFORCE_BASE_URL is not configured. Aborting builderforce-v2 feasibility run for now.`,
    };
  }
  if (!api_key) {
    return {
      available: false,
      engine,
      error: `[v2] BUILDERFORCE_API_KEY is required but missing. Aborting builderforce-v2 feasibility run for now.`,
    };
  }

  // If an upstream is configured, verify connectivity via HTTP instead of polling.
  const upstream_url = `${base_url}/api/agent-hosts/${agent_host_id}/upstream`;
  let health_ms: number | undefined;
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeout_ms = enforce_online ? 5000 : 0;

    if (timeout_ms > 0) {
      const timeout_id = setTimeout(() => controller.abort(), timeout_ms);
      try {
        await fetch(upstream_url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${api_key}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout_id);
      }
    }
    health_ms = performance.now() - start;
  } catch (offline_err) {
    if (enforce_online) {
      const err_msg = String(offline_err);
      return {
        available: false,
        engine,
        error: `[v2] Failed upstream check (${upstream_url}): ${err_msg}.`,
      };
    }
    // If not enfore_online, allow startup based on default config even if upstream is down.
  }

  return {
    available: true,
    engine,
    healthMs: health_ms,
  };
}