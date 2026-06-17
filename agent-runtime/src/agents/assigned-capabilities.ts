/**
 * Assigned-capability injection for self-hosted runs.
 *
 * Capabilities assigned to an agent via Builderforce arrive through the gateway
 * `artifacts.sync` handler, which (a) activates the matching personas in the
 * process-wide {@link globalPersonaRegistry} and (b) writes the assigned
 * skill/persona/content *slugs* to `.builderforce/assigned-artifacts.json`.
 *
 * This module turns that state into prompt text so the running agent actually
 * adopts what was assigned — the single source shared by both engines:
 *   • V1 (embedded) injects {@link buildAssignedPersonaPrompt} as a system-prompt
 *     section (skills + workspace content are already injected by the run path).
 *   • V2 (Claude Agent SDK) prepends {@link buildAssignedCapabilityAppend} as a
 *     guidance preamble to the SDK prompt (its run path injects nothing otherwise).
 */
import { buildPersonaSystemBlock, globalPersonaRegistry } from "../builderforce/personas.js";
import {
  getRoleProfile,
  mergeExecParams,
  type PsychometricExecParams,
} from "../builderforce/psychometrics.js";
import { logDebug } from "../logger.js";

export type AssignedArtifactSlugs = {
  skills: string[];
  personas: string[];
  content: string[];
};

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Read the assigned-artifact slugs written by `artifacts.sync`. Defaults to the
 * gateway project root (`process.cwd()`) — where the sidecar is written —
 * independent of any per-ticket workspace the engine runs in.
 */
export async function readAssignedArtifactSlugs(root?: string): Promise<AssignedArtifactSlugs> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(root ?? process.cwd(), ".builderforce", "assigned-artifacts.json");
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    return {
      skills: toStringArray(j.skills),
      personas: toStringArray(j.personas),
      content: toStringArray(j.content),
    };
  } catch {
    return { skills: [], personas: [], content: [] };
  }
}

/**
 * Build a system-prompt block from the personas currently active (assigned via
 * Builderforce) on this agent. Returns '' when none are active. Process-wide
 * registry state, so it is independent of the run's working directory.
 */
export function buildAssignedPersonaPrompt(): string {
  const active = globalPersonaRegistry.listActive();
  if (active.length === 0) return "";
  const blocks = active.map((p) => buildPersonaSystemBlock(p)).filter(Boolean);
  const block = blocks.join("\n\n");
  if (block) logDebug(`[capabilities] injecting ${active.length} active persona(s) into system prompt`);
  return block;
}

/**
 * Resolve the execution-param overrides contributed by the psychometric profiles
 * of the personas currently active on this agent. Empty object when none carry a
 * profile. These are *defaults* — an explicit per-request thinkLevel/temperature
 * always wins. This is the second half of "execute under the persona": it lets a
 * trait vector change how the agent reasons (think depth, sampling), not just its
 * prompt text.
 */
export function resolveActivePsychometricParams(): PsychometricExecParams {
  const active = globalPersonaRegistry.listActive();
  const profiles = active.map(getRoleProfile).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (profiles.length === 0) return {};
  const params = mergeExecParams(profiles);
  if (params.thinkLevel || params.reasoningLevel || params.temperature !== undefined) {
    logDebug(
      `[capabilities] psychometric exec params: think=${params.thinkLevel ?? "-"} reasoning=${params.reasoningLevel ?? "-"} temp=${params.temperature ?? "-"}`,
    );
  }
  return params;
}

/**
 * Build the combined capability block appended to the V2 SDK system prompt:
 * the full persona definition plus assigned skill/content references (the SDK
 * agent reads the referenced SKILL.md via its Read tool). '' when nothing assigned.
 */
export async function buildAssignedCapabilityAppend(root?: string): Promise<string> {
  const sections: string[] = [];

  const persona = buildAssignedPersonaPrompt();
  if (persona) sections.push("## Persona (mandatory)\n" + persona);

  const { skills, content } = await readAssignedArtifactSlugs(root);
  if (skills.length > 0) {
    sections.push(
      "## Skills (mandatory)\n" +
        `You have been assigned these skills: ${skills.join(", ")}. ` +
        "If a matching SKILL.md is present in the workspace, read it and follow it before acting.",
    );
  }
  if (content.length > 0) {
    sections.push(
      "## Content\n" +
        `Assigned content references: ${content.join(", ")}. Treat these as authoritative source material.`,
    );
  }

  return sections.join("\n\n");
}
