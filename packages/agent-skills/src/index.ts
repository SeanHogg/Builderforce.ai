/**
 * `@builderforce/agent-skills` — THE Agent Skills implementation (agentskills.io).
 *
 * One package so a skill is the same thing on every surface: the agent-runtime loading
 * a folder off disk, the Worker serving one to a cloud run, the web importing one from
 * a .zip, the marketplace publishing one, and the Brain reading one mid-chat. See
 * `spec.ts` for the rules and `skillPackage.ts` for the folder contract.
 */

export {
  SKILL_FILE,
  SKILL_NAME_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_COMPATIBILITY_MAX,
  SPEC_FIELDS,
  SKILL_READ_TOOL_NAME,
  SKILL_BINARY_FILE_MAX_BYTES,
  SKILL_PACKAGE_MAX_BYTES,
  SKILL_BINARY_EXTENSIONS,
  isBinarySkillPath,
  isValidSkillName,
  toSkillName,
} from "./spec.js";
export { splitSkillMarkdown, parseFrontmatter, type YamlParse, type SplitSkillMarkdown } from "./frontmatter.js";
export {
  validateSkillFrontmatter,
  splitAllowedTools,
  type SkillManifest,
  type SkillIssue,
  type SkillIssueSeverity,
  type SkillValidation,
  type ValidateOptions,
} from "./validate.js";
export { serializeSkillMarkdown } from "./serialize.js";
export {
  readSkillPackage,
  readSkillMarkdown,
  writeSkillPackage,
  normalizeSkillPath,
  base64ByteLength,
  skillFileByteLength,
  DEFAULT_SKILL_PACKAGE_LIMITS,
  type SkillFile,
  type SkillFileEncoding,
  type SkillPackage,
  type SkillPackageLimits,
  type ReadSkillPackageOptions,
  type ReadSkillPackageResult,
} from "./skillPackage.js";
export {
  formatSkillCatalog,
  FILE_HOST_INSTRUCTIONS,
  TOOL_HOST_INSTRUCTIONS,
  type SkillCatalogEntry,
} from "./catalog.js";
