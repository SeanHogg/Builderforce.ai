/**
 * PlatformPersonaSync — fetch admin-managed platform personas from Builderforce
 * and register them as available agent roles.
 */

import { logDebug } from "../logger.js";

export type PlatformPersona = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  voice: string | null;
  perspective: string | null;
  decisionStyle: string | null;
  outputPrefix: string | null;
  capabilities: string | null; // JSON array
  tags: string | null; // JSON array
  source: string;
};

export type PlatformPersonaSyncOptions = {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
};

/**
 * Fetch active platform personas from Builderforce.
 * Returns empty array if unavailable.
 */
export async function fetchPlatformPersonas(
  opts: PlatformPersonaSyncOptions,
): Promise<PlatformPersona[]> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/agentNodes/${opts.agentNodeId}/platform-personas`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logDebug(`[platform-persona-sync] fetch failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { personas: PlatformPersona[] };
    return Array.isArray(data.personas) ? data.personas : [];
  } catch (err) {
    logDebug(`[platform-persona-sync] fetch error: ${String(err)}`);
    return [];
  }
}
