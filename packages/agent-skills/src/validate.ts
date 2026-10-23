/**
 * Validate parsed SKILL.md frontmatter against the Agent Skills spec and normalise it
 * into a {@link SkillManifest}.
 *
 * Errors are what the spec forbids — a skill with one would be rejected by a strict
 * loader, so nothing here accepts it. Warnings are what the spec tolerates or what we
 * repaired (a non-string `metadata` value coerced, `allowed-tools` written as a YAML
 * list). Every issue names its field, so an import screen can point at the line.
 */

import {
  isValidSkillName,
  SKILL_COMPATIBILITY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  SPEC_FIELDS,
} from "./spec.js";

export interface SkillManifest {
  /** The skill's id: kebab-case, ≤ 64, equal to its folder name. */
  name: string;
  /** What it does AND when to use it — the only text an agent sees before loading it. */
  description: string;
  license?: string;
  /** Environment requirements (product, system packages, network), ≤ 500 chars. */
  compatibility?: string;
  /** Arbitrary string → string properties (author, version, title, …). */
  metadata?: Record<string, string>;
  /** Pre-approved tools (spec: experimental), kept in declaration order. */
  allowedTools?: string[];
  /**
   * Every non-spec key, verbatim (`disable-model-invocation`, `user-invocable`, a
   * runtime's own extensions). Preserved so an import → export round trip is lossless
   * and a host that understands one of them can still read it.
   */
  extensions: Record<string, unknown>;
}

export type SkillIssueSeverity = "error" | "warning";

export interface SkillIssue {
  severity: SkillIssueSeverity;
  /** The frontmatter key (or `SKILL.md` / a file path for package-level issues). */
  field: string;
  /** Stable machine code, for UI copy and tests. */
  code: string;
  /** A sentence a skill author can act on. */
  message: string;
}

export interface SkillValidation {
  /** Present iff there are no errors. */
  manifest: SkillManifest | null;
  issues: SkillIssue[];
}

export interface ValidateOptions {
  /**
   * The folder the SKILL.md sits in. The spec requires `name` to equal it; omit when
   * there is no folder (a skill authored in a form, or proposed by an agent).
   */
  directoryName?: string;
}

const SPEC_FIELD_SET: ReadonlySet<string> = new Set(SPEC_FIELDS);

const issue = (severity: SkillIssueSeverity, field: string, code: string, message: string): SkillIssue => ({ severity, field, code, message });

/** Validate one skill's frontmatter. */
export function validateSkillFrontmatter(frontmatter: Record<string, unknown>, options: ValidateOptions = {}): SkillValidation {
  const issues: SkillIssue[] = [];

  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  if (!name) {
    issues.push(issue("error", "name", "name_missing", "`name` is required."));
  } else if (name.length > SKILL_NAME_MAX) {
    issues.push(issue("error", "name", "name_too_long", `\`name\` is ${name.length} characters; the limit is ${SKILL_NAME_MAX}.`));
  } else if (!isValidSkillName(name)) {
    issues.push(issue("error", "name", "name_format", "`name` may contain only lowercase letters, digits and single hyphens, and may not start or end with a hyphen."));
  }
  if (name && options.directoryName !== undefined && options.directoryName !== name) {
    issues.push(issue("error", "name", "name_directory_mismatch", `\`name\` is "${name}" but the folder is "${options.directoryName}"; they must match.`));
  }

  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (!description) {
    issues.push(issue("error", "description", "description_missing", "`description` is required — say what the skill does and when to use it."));
  } else if (description.length > SKILL_DESCRIPTION_MAX) {
    issues.push(issue("error", "description", "description_too_long", `\`description\` is ${description.length} characters; the limit is ${SKILL_DESCRIPTION_MAX}.`));
  }

  const license = optionalString(frontmatter, "license", issues);
  const compatibility = optionalString(frontmatter, "compatibility", issues);
  if (compatibility && compatibility.length > SKILL_COMPATIBILITY_MAX) {
    issues.push(issue("error", "compatibility", "compatibility_too_long", `\`compatibility\` is ${compatibility.length} characters; the limit is ${SKILL_COMPATIBILITY_MAX}.`));
  }

  const metadata = readMetadata(frontmatter.metadata, issues);
  const allowedTools = readAllowedTools(frontmatter["allowed-tools"], issues);

  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!SPEC_FIELD_SET.has(key)) extensions[key] = value;
  }

  if (issues.some((i) => i.severity === "error")) return { manifest: null, issues };
  return {
    manifest: {
      name,
      description,
      ...(license ? { license } : {}),
      ...(compatibility ? { compatibility } : {}),
      ...(metadata ? { metadata } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      extensions,
    },
    issues,
  };
}

function optionalString(fm: Record<string, unknown>, key: string, issues: SkillIssue[]): string | undefined {
  const v = fm[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") {
    issues.push(issue("warning", key, `${key}_coerced`, `\`${key}\` should be a string; read it as "${String(v)}".`));
    return String(v);
  }
  issues.push(issue("error", key, `${key}_type`, `\`${key}\` must be a string.`));
  return undefined;
}

/**
 * `metadata` is a string → string map. A host that serialised it as a JSON string (the
 * agent-runtime's own frontmatter reader flattens objects that way) is read through.
 */
function readMetadata(raw: unknown, issues: SkillIssue[]): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      issues.push(issue("error", "metadata", "metadata_type", "`metadata` must be a mapping of keys to string values."));
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(issue("error", "metadata", "metadata_type", "`metadata` must be a mapping of keys to string values."));
    return undefined;
  }
  const out: Record<string, string> = {};
  let coerced = false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else {
      coerced = true;
      out[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
    }
  }
  if (coerced) {
    issues.push(issue("warning", "metadata", "metadata_values_coerced", "`metadata` values should be strings; non-string values were stored as text."));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `allowed-tools` is space-delimited; a YAML list is accepted and flattened. */
function readAllowedTools(raw: unknown, issues: SkillIssue[]): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") {
    const tools = splitAllowedTools(raw);
    return tools.length > 0 ? tools : undefined;
  }
  if (Array.isArray(raw) && raw.every((t) => typeof t === "string")) {
    issues.push(issue("warning", "allowed-tools", "allowed_tools_list", "`allowed-tools` should be a space-delimited string; the list was read as one."));
    const tools = (raw as string[]).map((t) => t.trim()).filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  issues.push(issue("error", "allowed-tools", "allowed_tools_type", "`allowed-tools` must be a space-delimited string of tool names."));
  return undefined;
}

/**
 * Split on whitespace OUTSIDE parentheses, so a scoped entry such as `Bash(git add:*)`
 * stays one tool.
 */
export function splitAllowedTools(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}
