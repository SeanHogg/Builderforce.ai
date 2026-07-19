/**
 * HiredAgentsSync — fetch the tenant's hired/purchased agents from Builderforce
 * and expose them so they can be registered as callable orchestrate roles.
 *
 * Mirrors {@link ./platform-persona-sync.ts}: a thin read-through fetch against
 * an authenticated endpoint, defensive about absent/older APIs (returns `[]` on
 * any failure so the runtime degrades to built-in roles only).
 *
 * API contract (added by the API team):
 *   GET /api/runtime/hired-agents   (Bearer agentHost/tenant key)
 *   → { agents: Array<{ id, name, roleKey, systemPrompt, skills: string[], model? }> }
 */

import { logDebug } from "../logger.js";

/** One hired agent as returned by GET /api/runtime/hired-agents. */
export type HiredAgent = {
  /** Stable agent id (also resolvable as an orchestrate role key). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Preferred role key used to address this agent in an orchestrate step. */
  roleKey: string;
  /** System prompt that defines this agent's behaviour. */
  systemPrompt: string;
  /** Skill identifiers this agent carries (surfaced as role capabilities/tools). */
  skills: string[];
  /** Optional model override (provider/model). */
  model?: string;
};

export type HiredAgentsSyncOptions = {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
};

/**
 * Fetch the tenant's hired agents. Returns `[]` when the endpoint is absent,
 * unreachable, returns non-2xx, or yields a malformed body — callers must treat
 * an empty result as "built-ins only", never as an error.
 */
export async function fetchHiredAgents(opts: HiredAgentsSyncOptions): Promise<HiredAgent[]> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/runtime/hired-agents`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "X-AgentHost-Id": opts.agentNodeId,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // 404 = older API without this endpoint; any non-2xx → degrade gracefully.
      logDebug(`[hired-agents-sync] fetch failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { agents?: unknown };
    if (!data || !Array.isArray(data.agents)) {
      return [];
    }
    return data.agents.filter(isHiredAgent);
  } catch (err) {
    logDebug(`[hired-agents-sync] fetch error: ${String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Read-through TTL cache + role registration
// ---------------------------------------------------------------------------

import { registerHiredAgentsAsRoles } from "../builderforce/agent-roles.js";

/** How long a hired-agents snapshot is trusted before a re-fetch (5 min). */
const HIRED_AGENTS_TTL_MS = 5 * 60_000;

let cache: { agents: HiredAgent[]; fetchedAt: number } | null = null;
let inFlight: Promise<HiredAgent[]> | null = null;

/**
 * Read-through cached fetch of hired agents, registering each as an orchestrate
 * role on every refresh. Within the TTL the cached snapshot is returned without a
 * network call; concurrent callers during a refresh share one in-flight request.
 *
 * Safe to call at orchestration start on the hot path — it is cheap when warm and
 * degrades to built-ins only (empty array, no throw) when the endpoint is absent.
 */
export async function loadHiredAgentsCached(
  opts: HiredAgentsSyncOptions,
  now: number = Date.now(),
): Promise<HiredAgent[]> {
  if (cache && now - cache.fetchedAt < HIRED_AGENTS_TTL_MS) {
    return cache.agents;
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      const agents = await fetchHiredAgents(opts);
      cache = { agents, fetchedAt: Date.now() };
      if (agents.length > 0) {
        registerHiredAgentsAsRoles(agents);
      }
      return agents;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test-only: drop the cache so the next load re-fetches. */
export function resetHiredAgentsCacheForTest(): void {
  cache = null;
  inFlight = null;
}

/**
 * Current cached hired-agents snapshot (no network). Empty when never fetched or
 * when the host runs built-ins only. A pure read of the read-through cache above.
 */
export function getCachedHiredAgents(): HiredAgent[] {
  return cache?.agents ?? [];
}

/**
 * Resolve the durable `ide_agents.id` a run is executing as from its LOCAL agent
 * partition id (`params.agentId`). A hired agent is registered as a role under
 * both its `roleKey` and its `id`, so a Builderforce-addressed session runs under
 * one of those as its local `agentId`. Returns the canonical `id` (== the
 * ide_agents.id the api validates) when the local id matches a cached hired agent,
 * else `null` — a plain local / persona-less agent (e.g. "main", a user-defined
 * local agent) has no ide_agents row, so the caller skips durable reporting.
 *
 * Case-insensitive: local agent ids are lowercased at session parse, and hired
 * agent ids / roleKeys are lowercase slugs/cuids.
 */
export function resolveHiredAgentRef(localAgentId: string | undefined): string | null {
  const id = (localAgentId ?? "").trim().toLowerCase();
  if (!id || id === "main") return null;
  for (const a of getCachedHiredAgents()) {
    if (a.id.trim().toLowerCase() === id || a.roleKey.trim().toLowerCase() === id) {
      return a.id;
    }
  }
  return null;
}

/** Validate one entry against the contract, tolerating extra fields. */
function isHiredAgent(value: unknown): value is HiredAgent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  const hasIdentity =
    typeof v.id === "string" &&
    v.id.trim().length > 0 &&
    typeof v.roleKey === "string" &&
    v.roleKey.trim().length > 0;
  if (!hasIdentity) {
    return false;
  }
  if (typeof v.name !== "string") {
    return false;
  }
  if (typeof v.systemPrompt !== "string") {
    return false;
  }
  if (!Array.isArray(v.skills) || !v.skills.every((s) => typeof s === "string")) {
    return false;
  }
  if (v.model !== undefined && typeof v.model !== "string") {
    return false;
  }
  return true;
}
