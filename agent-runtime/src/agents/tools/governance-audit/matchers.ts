/**
 * The deterministic pre-filter matchers (PRD 08 §4.2 step 2) — ONE registry, one
 * matcher per check kind. A matcher either returns its candidate hits or throws a
 * {@link RuleCompileError} when the rule itself is unusable (missing pattern, invalid
 * regex). It never swallows a bad rule into "no hits": that would report the rule passed.
 *
 * Globs compile through the shared `@builderforce/agent-tools` matcher (the one
 * list_files uses), never as a regex: `**\/*.env` is a glob.
 */

import { isUnderScopeDir, matchGlob, normalizeScopeDir } from "@builderforce/agent-tools";
import type { GovernancePrefilterHit, GovernanceRule, GovernanceRuleCheck } from "./types.js";
import { isProbablyBinaryPath, type WorkingTreeReader } from "./walker.js";

/** The rule's check cannot be compiled/run — surfaced as a rule ERROR, never a pass. */
export class RuleCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleCompileError";
  }
}

export interface MatcherContext {
  /** Every repo-relative POSIX path in the working tree. */
  files: string[];
  readFile: WorkingTreeReader;
}

export type RuleMatcher = (
  rule: GovernanceRule,
  check: GovernanceRuleCheck,
  ctx: MatcherContext,
) => Promise<GovernancePrefilterHit[]>;

/** Built-in secret patterns applied when a "secret" check names no pattern of its own. */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "aws-secret-key", re: /\b[A-Za-z0-9/+=]{40}\b(?=\s*[,)\n])/ },
  {
    name: "generic-assignment",
    re: /\b(api[_-]?key|secret|password|token|private[_-]?key)\b\s*[:=]\s*["'][^"'\n]{8,}["']/i,
  },
  { name: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
];

// ── Compilation (throws RuleCompileError) ────────────────────────────────────────

function requirePattern(check: GovernanceRuleCheck): string {
  const pattern = typeof check.pattern === "string" ? check.pattern.trim() : "";
  if (!pattern) {
    throw new RuleCompileError(`"${check.kind}" check has no pattern`);
  }
  return pattern;
}

export function compileRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new RuleCompileError(
      `invalid regex ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A path predicate for a glob — a slash-free glob matches the basename at any depth. */
export function compileGlob(pattern: string): (relPath: string) => boolean {
  try {
    matchGlob("", pattern); // compile once so a bad glob fails here, not mid-scan
  } catch (error) {
    throw new RuleCompileError(
      `invalid glob ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return (relPath) => matchGlob(relPath, pattern);
}

const GLOB_META = /[*?[]/;

/** The files in the check's `paths` scope: a plain entry is a directory prefix, otherwise a glob. */
export function scopedFiles(ctx: MatcherContext, check: GovernanceRuleCheck): string[] {
  if (!check.paths || check.paths.length === 0) return ctx.files;
  const predicates = check.paths.map((entry): ((relPath: string) => boolean) => {
    if (GLOB_META.test(entry)) return compileGlob(entry);
    const dir = normalizeScopeDir(entry);
    return (relPath) => isUnderScopeDir(relPath, dir);
  });
  return ctx.files.filter((f) => predicates.some((p) => p(f)));
}

// ── Hit construction ─────────────────────────────────────────────────────────────

function hitFor(
  rule: GovernanceRule,
  detail: string,
  at: { filePath?: string; line?: number; evidence?: string } = {},
): GovernancePrefilterHit {
  return {
    ruleId: rule.id,
    ruleRef: rule.ruleRef,
    severity: rule.severity,
    title: rule.title,
    detail,
    ...(at.filePath !== undefined ? { filePath: at.filePath } : {}),
    ...(at.line !== undefined ? { line: at.line } : {}),
    ...(at.evidence !== undefined ? { evidence: at.evidence } : {}),
    remediation: rule.guidance ?? undefined,
    source: "prefilter",
    confidence: "high",
  };
}

// ── Matchers ─────────────────────────────────────────────────────────────────────

/** Line-scan every scoped text file; one hit per pattern per file is enough for triage. */
async function scanLines(
  rule: GovernanceRule,
  check: GovernanceRuleCheck,
  ctx: MatcherContext,
  patterns: ReadonlyArray<{ name: string; re: RegExp }>,
): Promise<GovernancePrefilterHit[]> {
  const hits: GovernancePrefilterHit[] = [];
  for (const relPath of scopedFiles(ctx, check)) {
    if (isProbablyBinaryPath(relPath)) continue;
    const text = await ctx.readFile(relPath);
    if (text === null) continue;
    const lines = text.split("\n");
    for (const { name, re } of patterns) {
      const index = lines.findIndex((line) => re.test(line));
      if (index < 0) continue;
      hits.push(
        hitFor(rule, `Pre-filter "${name}" matched ${relPath}:${index + 1} — candidate violation of ${rule.ruleRef}.`, {
          filePath: relPath,
          line: index + 1,
          evidence: (lines[index] ?? "").trim().slice(0, 500),
        }),
      );
    }
  }
  return hits;
}

const regexMatcher: RuleMatcher = async (rule, check, ctx) => {
  const pattern = requirePattern(check);
  return scanLines(rule, check, ctx, [{ name: pattern, re: compileRegex(pattern) }]);
};

const secretMatcher: RuleMatcher = async (rule, check, ctx) => {
  const own = typeof check.pattern === "string" ? check.pattern.trim() : "";
  const patterns = own ? [{ name: own, re: compileRegex(own) }] : SECRET_PATTERNS;
  return scanLines(rule, check, ctx, patterns);
};

/** glob / path_forbidden: every scoped file whose path matches the glob is a candidate. */
const forbiddenPathMatcher: RuleMatcher = async (rule, check, ctx) => {
  const pattern = requirePattern(check);
  const matches = compileGlob(pattern);
  return scopedFiles(ctx, check)
    .filter(matches)
    .map((relPath) =>
      hitFor(rule, `Path "${relPath}" matches "${pattern}" — candidate violation of ${rule.ruleRef}.`, {
        filePath: relPath,
      }),
    );
};

const requiredPathMatcher: RuleMatcher = async (rule, check, ctx) => {
  const pattern = requirePattern(check);
  const matches = compileGlob(pattern);
  if (scopedFiles(ctx, check).some(matches)) return [];
  return [
    hitFor(
      rule,
      `Required path matching "${pattern}" is missing from the working tree — candidate violation of ${rule.ruleRef}.`,
    ),
  ];
};

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const dependencyMatcher: RuleMatcher = async (rule, check, ctx) => {
  const depName = requirePattern(check);
  const hits: GovernancePrefilterHit[] = [];
  const manifests = scopedFiles(ctx, check).filter(
    (f) => (f === "package.json" || f.endsWith("/package.json")) && !f.includes("node_modules/"),
  );
  for (const relPath of manifests) {
    const text = await ctx.readFile(relPath);
    if (text === null) continue;
    let parsed: PackageManifest;
    try {
      parsed = JSON.parse(text) as PackageManifest;
    } catch {
      continue; // a malformed manifest is not this rule's failure
    }
    const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
    if (!Object.prototype.hasOwnProperty.call(allDeps, depName)) continue;
    hits.push(
      hitFor(
        rule,
        `Forbidden dependency "${depName}"@${allDeps[depName]} declared in ${relPath} — candidate violation of ${rule.ruleRef}.`,
        { filePath: relPath },
      ),
    );
  }
  return hits;
};

/**
 * Check kinds that are deliberately assessed by the auditor only (step 3): no
 * deterministic matcher, and no error. Any OTHER kind missing from
 * {@link RULE_MATCHERS} (a typo such as "regx") is a rule ERROR, never a pass.
 */
export const LLM_ONLY_CHECK_KINDS: ReadonlySet<string> = new Set(["llm", "semantic"]);

/**
 * THE check-kind registry. A rule with no check, or a kind in
 * {@link LLM_ONLY_CHECK_KINDS}, is LLM-only and left to the assessment seam (step 3).
 */
export const RULE_MATCHERS: Readonly<Record<string, RuleMatcher>> = {
  regex: regexMatcher,
  secret: secretMatcher,
  glob: forbiddenPathMatcher,
  path_forbidden: forbiddenPathMatcher,
  path_required: requiredPathMatcher,
  dependency: dependencyMatcher,
};
