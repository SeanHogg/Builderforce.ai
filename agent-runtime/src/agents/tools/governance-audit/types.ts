/**
 * governance_audit domain shapes (PRD 08 §2) + the severity rollup and gate verdict.
 * Tolerant of extra/older API fields. Pure — no I/O.
 */

export type GovernanceCheckKind =
  | "regex"
  | "secret"
  | "path_required"
  | "path_forbidden"
  | "dependency"
  | "glob"
  | string;

export interface GovernanceRuleCheck {
  kind: GovernanceCheckKind;
  /** Regex source (regex/secret), dependency name (dependency) or glob (glob/path_*). */
  pattern?: string;
  /** Optional scope — only files under these directory prefixes / matching these globs are scanned. */
  paths?: string[];
  /** Matcher options (e.g. `{ maxBytes }`, dependency manifest globs). */
  options?: Record<string, unknown>;
}

export interface GovernanceRule {
  id?: string;
  /** The policy pack the rule came from (used by the `packIds` filter). */
  packId?: string;
  ruleRef: string;
  category?: string;
  title: string;
  description?: string;
  severity: string; // blocker|critical|high|medium|low|info
  check?: GovernanceRuleCheck | null;
  guidance?: string | null;
  enabled?: boolean;
}

export interface GovernancePackApplied {
  packId?: string;
  name?: string;
  source?: string;
}

export interface ResolvedRuleset {
  rulesetHash?: string;
  packsApplied?: GovernancePackApplied[];
  rules: GovernanceRule[];
}

export interface GovernancePrefilterHit {
  ruleId?: string;
  ruleRef: string;
  severity: string;
  title: string;
  detail: string;
  filePath?: string;
  line?: number;
  evidence?: string;
  remediation?: string;
  source: "prefilter";
  confidence: "high";
}

/**
 * A rule whose deterministic check could not run (it failed to compile, or its matcher threw).
 * Such a rule is NEVER counted as passed: it is reported, counted in `summary.errored`, and —
 * at blocker severity — blocks the gate, because an unchecked blocker must not let a merge through.
 */
export interface GovernanceRuleError {
  ruleId?: string;
  ruleRef: string;
  title: string;
  severity: string;
  kind: string;
  error: string;
}

export interface GovernancePrefilterResult {
  hits: GovernancePrefilterHit[];
  ruleErrors: GovernanceRuleError[];
}

export interface GovernanceFinding {
  ruleId?: string;
  ruleRef: string;
  severity: string;
  title: string;
  detail: string;
  filePath?: string;
  line?: number;
  evidence?: string;
  remediation?: string;
  source: "prefilter" | "agent";
  confidence: "high" | "medium" | "low";
}

export interface GovernanceAuditSummary {
  blocker: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  passed: number;
  /** Enabled rules whose deterministic check failed to compile or run. */
  errored: number;
  /** Files a content matcher needed but could not scan (over the size cap) — a coverage gap. */
  skipped: number;
}

export type GovernanceGateResult = "pass" | "blocked";

export interface GovernanceAssessContext {
  /** The AI use case this assessment runs under (PRD 08 §5: `gov.policy_audit`). */
  useCase: "gov.policy_audit";
  repoRef?: string;
  ref?: string;
  ruleset: ResolvedRuleset;
  /** Deterministic pre-filter candidates for the auditor to triage. */
  prefilterHits: GovernancePrefilterHit[];
  /** Rules whose deterministic check could not run — the auditor may assess them by reading. */
  ruleErrors: GovernanceRuleError[];
  /** Changed-files tree (relative paths) the auditor reasons over. */
  files: string[];
}

/**
 * The LLM assessment seam (step 3). The orchestrator injects a call to the
 * `governance-auditor` role here; the default confirms every pre-filter hit and
 * raises no LLM-only findings (deterministic-only mode — useful for dry runs).
 */
export type GovernanceAssessor = (ctx: GovernanceAssessContext) => Promise<GovernanceFinding[]>;

export interface GovernanceAuditOptions {
  repoRef?: string;
  ref?: string;
  projectId?: string;
  packIds?: string[];
  dryRun?: boolean;
}

export interface GovernanceAuditResult {
  runId?: string;
  summary: GovernanceAuditSummary;
  gateResult: GovernanceGateResult | null;
  dryRun?: boolean;
  rulesetHash?: string;
  packsApplied?: GovernancePackApplied[];
  findings: GovernanceFinding[];
  ruleErrors: GovernanceRuleError[];
  /** Repo-relative paths skipped as too large to scan (counted in `summary.skipped`). */
  skippedFiles: string[];
}

// ── Severity rollup + gate ───────────────────────────────────────────────────────

const SEVERITY_ORDER = ["blocker", "critical", "high", "medium", "low", "info"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

function isSeverity(value: string): value is Severity {
  return (SEVERITY_ORDER as readonly string[]).includes(value);
}

export function emptySummary(): GovernanceAuditSummary {
  return { blocker: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, passed: 0, errored: 0, skipped: 0 };
}

/**
 * Roll findings up into the run summary + gate verdict (PRD 08 §2 `summary`/`gateResult`).
 * A rule passes only when it is enabled, has no finding, and its check did not error.
 * The gate blocks on a BLOCKER finding or on a blocker-severity rule that could not be checked.
 */
export function summarizeFindings(
  ruleset: ResolvedRuleset,
  findings: GovernanceFinding[],
  ruleErrors: GovernanceRuleError[] = [],
): { summary: GovernanceAuditSummary; gateResult: GovernanceGateResult } {
  const summary = emptySummary();
  const violated = new Set(findings.map((f) => f.ruleRef));
  const errored = new Set(ruleErrors.map((e) => e.ruleRef));
  for (const rule of ruleset.rules) {
    if (rule.enabled === false) continue;
    if (errored.has(rule.ruleRef)) {
      summary.errored += 1;
    } else if (!violated.has(rule.ruleRef)) {
      summary.passed += 1;
    }
  }
  for (const f of findings) {
    const sev = (f.severity ?? "").toLowerCase();
    summary[isSeverity(sev) ? sev : "medium"] += 1;
  }
  const uncheckedBlocker = ruleErrors.some((e) => (e.severity ?? "").toLowerCase() === "blocker");
  return { summary, gateResult: summary.blocker > 0 || uncheckedBlocker ? "blocked" : "pass" };
}
