import { describe, it, expect } from "vitest";
import { resolveSkillDependencies, skillDependencyNames } from "./dependencies.js";
import type { SkillEntry } from "./types.js";

function entry(name: string, requiresSkills?: string[]): SkillEntry {
  return {
    skill: {
      name,
      description: name,
      filePath: `/skills/${name}/SKILL.md`,
      baseDir: `/skills/${name}`,
      source: "builderforce-bundled",
    } as SkillEntry["skill"],
    frontmatter: {},
    metadata: requiresSkills ? { requires: { skills: requiresSkills } } : undefined,
  };
}

describe("skillDependencyNames", () => {
  it("returns declared dependency names, or empty when none", () => {
    expect(skillDependencyNames(entry("a", ["b"]))).toEqual(["b"]);
    expect(skillDependencyNames(entry("a"))).toEqual([]);
  });
});

describe("resolveSkillDependencies", () => {
  it("is a no-op when no skill declares dependencies", () => {
    const all = [entry("a"), entry("b")];
    const { included, unmet } = resolveSkillDependencies({
      all,
      eligible: all,
      selected: all,
    });
    expect(included.map((e) => e.skill.name)).toEqual(["a", "b"]);
    expect(unmet).toEqual([]);
  });

  it("auto-includes an eligible dependency the filter excluded", () => {
    const coding = entry("coding-agent", ["github"]);
    const github = entry("github");
    const all = [coding, github];
    const { included } = resolveSkillDependencies({
      all,
      eligible: all,
      selected: [coding], // github filtered out
    });
    expect(included.map((e) => e.skill.name).sort()).toEqual(["coding-agent", "github"]);
  });

  it("drops a selected skill whose dependency is not eligible, and records it", () => {
    const coding = entry("coding-agent", ["github"]);
    const all = [coding]; // github not loaded/eligible
    const { included, unmet } = resolveSkillDependencies({
      all,
      eligible: [coding], // coding self-eligible, github absent
      selected: [coding],
    });
    expect(included).toEqual([]);
    expect(unmet).toEqual([{ skill: "coding-agent", missing: ["github"] }]);
  });

  it("resolves transitive dependencies", () => {
    const a = entry("a", ["b"]);
    const b = entry("b", ["c"]);
    const c = entry("c");
    const all = [a, b, c];
    const { included, unmet } = resolveSkillDependencies({
      all,
      eligible: all,
      selected: [a],
    });
    expect(included.map((e) => e.skill.name)).toEqual(["a", "b", "c"]);
    expect(unmet).toEqual([]);
  });

  it("drops a skill when a transitive dependency is missing", () => {
    const a = entry("a", ["b"]);
    const b = entry("b", ["c"]); // c missing
    const all = [a, b];
    const { included, unmet } = resolveSkillDependencies({
      all,
      eligible: [a, b],
      selected: [a, b],
    });
    expect(included).toEqual([]);
    expect(unmet.map((u) => u.skill).sort()).toEqual(["a", "b"]);
  });

  it("tolerates dependency cycles without infinite recursion", () => {
    const a = entry("a", ["b"]);
    const b = entry("b", ["a"]);
    const all = [a, b];
    const { included } = resolveSkillDependencies({
      all,
      eligible: all,
      selected: [a],
    });
    expect(included.map((e) => e.skill.name).sort()).toEqual(["a", "b"]);
  });

  it("preserves the original `all` ordering in the output", () => {
    const github = entry("github");
    const coding = entry("coding-agent", ["github"]);
    const all = [github, coding]; // github first in load order
    const { included } = resolveSkillDependencies({
      all,
      eligible: all,
      selected: [coding],
    });
    expect(included.map((e) => e.skill.name)).toEqual(["github", "coding-agent"]);
  });
});
