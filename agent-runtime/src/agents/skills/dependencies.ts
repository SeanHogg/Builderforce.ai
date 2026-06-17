/**
 * Skill-to-skill dependency resolution.
 *
 * A skill may declare `metadata.requires.skills: ["other-skill"]`. Unlike
 * bin/env/config requirements — which are self-contained and evaluated per skill
 * in shared/config-eval.ts — a skill dependency can only be judged against the
 * FULL set of loaded skills, so it is resolved here as a post-pass over the
 * already self-eligible entries.
 *
 * Two effects, mirroring how `requires.bins` behaves for binaries:
 *   1. Enforcement — a selected skill whose (transitive) dependency is not
 *      itself eligible is dropped, exactly as a missing required binary would
 *      drop it. The unmet dependency is reported for diagnostics.
 *   2. Auto-include — eligible dependencies of a kept skill are pulled into the
 *      resolved set even when a skill filter would otherwise exclude them, so a
 *      coding agent that depends on `github` always ships `github` alongside it.
 *
 * Pure (no IO) so it is unit-testable without loading real skills.
 */
import type { SkillEntry } from "./types.js";

/** The other-skill names a skill depends on (empty when none declared). */
export function skillDependencyNames(entry: SkillEntry): string[] {
  return entry.metadata?.requires?.skills ?? [];
}

export interface SkillDependencyResolution {
  /** Final entries to surface, in the original `all` order, deduped by name. */
  included: SkillEntry[];
  /** Selected skills dropped because a required skill was not eligible. */
  unmet: Array<{ skill: string; missing: string[] }>;
}

/**
 * @param all      Every loaded entry — the universe used to surface auto-included deps.
 * @param eligible Entries passing self-contained requires (bins/anyBins/env/config/os).
 * @param selected Eligible entries that also pass the active skill filter (what would ship today).
 */
export function resolveSkillDependencies(params: {
  all: SkillEntry[];
  eligible: SkillEntry[];
  selected: SkillEntry[];
}): SkillDependencyResolution {
  const { all, eligible, selected } = params;

  const eligibleByName = new Map<string, SkillEntry>();
  for (const entry of eligible) {
    eligibleByName.set(entry.skill.name, entry);
  }

  // Collect the transitive dependency names of `name` that are NOT eligible.
  // `name` is assumed eligible; `stack` guards against dependency cycles.
  const collectMissing = (name: string, stack: Set<string>): string[] => {
    const entry = eligibleByName.get(name);
    if (!entry) {
      return [name];
    }
    const missing: string[] = [];
    for (const dep of skillDependencyNames(entry)) {
      if (stack.has(dep)) {
        continue; // cycle — already on the path
      }
      if (!eligibleByName.has(dep)) {
        missing.push(dep);
        continue;
      }
      missing.push(...collectMissing(dep, new Set(stack).add(dep)));
    }
    return missing;
  };

  const unmet: Array<{ skill: string; missing: string[] }> = [];
  const kept: SkillEntry[] = [];
  for (const entry of selected) {
    const missing = Array.from(
      new Set(collectMissing(entry.skill.name, new Set([entry.skill.name]))),
    );
    if (missing.length > 0) {
      unmet.push({ skill: entry.skill.name, missing });
      continue;
    }
    kept.push(entry);
  }

  // Walk each kept skill's eligible dependency closure and force-include them.
  const includedNames = new Set<string>();
  const addWithDeps = (entry: SkillEntry, stack: Set<string>): void => {
    if (includedNames.has(entry.skill.name)) {
      return;
    }
    includedNames.add(entry.skill.name);
    for (const dep of skillDependencyNames(entry)) {
      if (stack.has(dep)) {
        continue;
      }
      const depEntry = eligibleByName.get(dep);
      if (depEntry) {
        addWithDeps(depEntry, new Set(stack).add(dep));
      }
    }
  };
  for (const entry of kept) {
    addWithDeps(entry, new Set([entry.skill.name]));
  }

  // Preserve the caller's original ordering for a stable prompt/snapshot.
  const included = all.filter((entry) => includedNames.has(entry.skill.name));
  return { included, unmet };
}
