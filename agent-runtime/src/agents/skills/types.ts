import type { Skill } from "./native-loader.js";

export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

export type BuilderForceAgentsSkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  /** Original author / publisher name */
  author?: string;
  /** Author homepage or profile URL */
  authorUrl?: string;
  /** SPDX license identifier, e.g. "MIT" or "Apache-2.0" */
  license?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillInvocationPolicy = {
  userInvocable: boolean;
  disableModelInvocation: boolean;
};

export type SkillCommandDispatchSpec = {
  kind: "tool";
  /** Name of the tool to invoke (AnyAgentTool.name). */
  toolName: string;
  /**
   * How to forward user-provided args to the tool.
   * - raw: forward the raw args string (no core parsing).
   */
  argMode?: "raw";
};

export type SkillCommandSpec = {
  name: string;
  skillName: string;
  description: string;
  /** Optional deterministic dispatch behavior for this command. */
  dispatch?: SkillCommandDispatchSpec;
};

export type SkillsInstallPreferences = {
  preferBrew: boolean;
  nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};

export type ParsedSkillFrontmatter = Record<string, string>;

export type SkillEntry = {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  metadata?: BuilderForceAgentsSkillMetadata;
  invocation?: SkillInvocationPolicy;
};

export type SkillEligibilityContext = {
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    hasAnyBin: (bins: string[]) => boolean;
    note?: string;
  };
};

export type SkillSnapshot = {
  prompt: string;
  skills: Array<{ name: string; primaryEnv?: string }>;
  /** Normalized agent-level filter used to build this snapshot; undefined means unrestricted. */
  skillFilter?: string[];
  resolvedSkills?: Skill[];
  version?: number;
};
