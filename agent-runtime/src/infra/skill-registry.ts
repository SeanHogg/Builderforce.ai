/**
 * Skill Registry — fetches and caches the Marketplace skills assigned to this agentNode.
 *
 * Called once at startup when a Builderforce connection is configured.
 * The registry is read-only after load; skills are re-fetched on reconnect.
 * Agent tools and prompt builders can call `getLoadedSkills()` to discover
 * what capabilities the operator has enabled for this agentNode.
 */

import { logDebug, logWarn } from "../logger.js";

export type LoadedSkill = {
  skillSlug: string;
  name: string;
  description: string | null;
  source: "tenant" | "agentNode";
};

let loadedSkills: LoadedSkill[] = [];

/** Return the skills that were fetched at startup (or after the last refresh). */
export function getLoadedSkills(): LoadedSkill[] {
  return loadedSkills;
}

/**
 * Fetch assigned skills from Builderforce and populate the local registry.
 * Safe to call multiple times; replaces the previous list on each call.
 */
export async function fetchAndLoadSkills(opts: {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
}): Promise<void> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/agent-hosts/${opts.agentNodeId}/skills`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logWarn(`[skill-registry] fetch failed: ${res.status}`);
      return;
    }
    const data = (await res.json()) as {
      skills: Array<{
        skill_id: string;
        name: string;
        description: string | null;
        metadata?: { source?: string };
      }>;
    };
    loadedSkills = (data.skills ?? []).map((s) => ({
      skillSlug: s.skill_id,
      name: s.name,
      description: s.description,
      source: s.metadata?.source === "agentNode" ? "agentNode" : "tenant",
    }));
    if (loadedSkills.length > 0) {
      logDebug(
        `[skill-registry] loaded ${loadedSkills.length} skill(s): ${loadedSkills.map((s) => s.skillSlug).join(", ")}`,
      );
    } else {
      logDebug("[skill-registry] no skills assigned to this agentNode");
    }
  } catch (err) {
    logWarn(`[skill-registry] fetch error: ${String(err)}`);
  }
}
