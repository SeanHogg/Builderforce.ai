/**
 * PersonaExportSync — push local custom agent role definitions to Builderforce.
 * Enables the portal to display the agentNode's available personas.
 */

import { logDebug } from "../logger.js";

export type PersonaSyncOptions = {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
};

export type PersonaDefinition = {
  id: string;
  name: string;
  description?: string;
  voice?: string;
  perspective?: string;
  outputPrefix?: string;
  capabilities?: string[];
};

/**
 * Push local persona definitions to Builderforce so the portal knows what
 * agent roles this agentNode has available.
 */
export async function syncPersonasToBuilderforce(
  opts: PersonaSyncOptions,
  personas: PersonaDefinition[],
): Promise<boolean> {
  if (personas.length === 0) {
    return true;
  }
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/agent-hosts/${opts.agentNodeId}/personas`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({ personas }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logDebug(`[persona-sync] push failed: HTTP ${res.status}`);
      return false;
    }
    logDebug(`[persona-sync] pushed ${personas.length} personas`);
    return true;
  } catch (err) {
    logDebug(`[persona-sync] push error: ${String(err)}`);
    return false;
  }
}
