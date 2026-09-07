/**
 * PersonaExportSync — push local custom agent role definitions to Builderforce.
 * Enables the portal to display the agentNode's available personas.
 *
 * Outbound twin of {@link ../infra/platform-persona-sync.ts} (which PULLS
 * admin-managed personas down). Wired at gateway start in
 * `server-startup.ts#startBuilderforceServices`, right after the platform
 * personas are fetched, using the same baseUrl/agentNodeId/apiKey resolution.
 * Only custom (user-global / project-local) personas are pushed — built-ins and
 * platform-sourced personas are already known to the portal.
 */

import type { PersonaPlugin } from "../builderforce/types.js";
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

/** Persona sources that originate on THIS host and are therefore worth exporting. */
const EXPORTABLE_SOURCES: ReadonlySet<PersonaPlugin["source"]> = new Set([
  "user-global",
  "project-local",
]);

/**
 * Project the registry's custom personas onto the portal's wire shape.
 * Built-in, marketplace and builderforce-assigned personas are skipped.
 */
export function toPersonaDefinitions(plugins: PersonaPlugin[]): PersonaDefinition[] {
  return plugins
    .filter((p) => EXPORTABLE_SOURCES.has(p.source))
    .map((p) => {
      const def: PersonaDefinition = { id: p.name, name: p.name };
      if (p.description) def.description = p.description;
      if (p.persona?.voice) def.voice = p.persona.voice;
      if (p.persona?.perspective) def.perspective = p.persona.perspective;
      if (p.outputFormat?.outputPrefix) def.outputPrefix = p.outputFormat.outputPrefix;
      if (p.capabilities?.length) def.capabilities = [...p.capabilities];
      return def;
    });
}

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
