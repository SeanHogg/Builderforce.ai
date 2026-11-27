import type { Skill, SkillStep } from "@seanhogg/builderforce-memory-engine";
import type { SkillSecrets } from "./skillSecrets";

/** A short, unlocalized label for what a step does (it travels in the approval's metadata). */
export function actionLabel(step: SkillStep | undefined): string {
  const a = step?.action;
  if (!a) return "step";
  if (a.kind === "keys") return `keys ${a.keys}`;
  return `${a.kind} ${a.target.name || a.target.automationId}`.trim();
}

/**
 * The values a run is started with, in this order: what the person gave, then the
 * routine's stored values, then the keychain's secrets for the secret parameters still
 * unset. A parameter nobody supplied is left out (the helper fails the run on a missing
 * secret before anything moves; a plain parameter falls back to its recorded default).
 */
export async function resolveRunValues(
  skill: Skill,
  given: Record<string, string>,
  secrets: SkillSecrets,
): Promise<Record<string, string>> {
  const values: Record<string, string> = { ...(skill.routine?.values ?? {}), ...given };
  for (const p of skill.params) {
    if (p.secret && !values[p.name]) {
      const kept = await secrets.get(skill.id, p.name);
      if (kept) values[p.name] = kept;
    }
  }
  return values;
}
