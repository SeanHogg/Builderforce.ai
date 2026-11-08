/**
 * governance_audit tool (PRD 08 §4.2).
 *
 * AgentTool shape follows `memory-tool.ts`: a thin pi (`AnyAgentTool`) wrapper
 * whose implementation lives in the pi-free `runGovernanceAudit` below, so the
 * native `ToolDefinition` path can delegate to the SAME body (DRY).
 *
 * Pipeline (PRD 08 §4.2):
 *   1. Resolve the effective ruleset — `GET /api/governance/rules/resolve?projectId&repoRef`
 *      (DB policy packs + `.builderforce/policies/*.yaml` in-repo overrides, hashed — §3).
 *   2. Deterministic pre-filters over the working tree (regex/secret/path/dependency/glob
 *      matchers) → candidate hits with `source: "prefilter"`.
 *   3. LLM triage + LLM-only rules — the caller injects the `governance-auditor` role
 *      assessment under `useCase: "gov.policy_audit"` via the `assess` seam (the
 *      orchestrator owns the model call; this tool is model-free by design).
 *   4. POST findings + summary to `/api/governance/audits/:id/findings` and finalize
 *      the run. Returns `{ runId, summary, gateResult }`.
 *
 * API reachability/auth follows the sibling sync modules (`infra/hired-agents-sync.ts`):
 * `BUILDERFORCE_API_KEY` (Bearer) + `BUILDERFORCE_AGENT_NODE_ID` (`X-AgentHost-Id`) against
 * `BUILDERFORCE_URL` (default `https://api.builderforce.ai`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { readSharedEnvVar } from "../../infra/env-file.js";
import { logWarn } from "../../logger.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringArrayParam, readStringParam } from "./common.js";

// ── Domain shapes (mirror PRD 08 §2; tolerant of extra/older API fields) ─────────

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
  /** Regex source (regex/secret) or dependency name (dependency) or glob (glob/path_*). */
  pattern?: string;
  /** Optional path scope — only files under these prefixes/globs are scanned. */
  paths?: string[];
  /** Matcher options (e.g. `{ maxBytes }`, dependency manifest globs). */
  options?: Record<string, unknown>;
}

export interface GovernanceRule {
  id?: string;
  ruleRef: string;
  category?: string;
  title: string;
  description?: string;
  severity: string; // blocker|critical|high|medium|low|info
  check?: GovernanceRuleCheck | null;
  guidance?: string | null;
  enabled?: boolean;
}

export interface ResolvedRuleset {
  rulesetHash?: string;
  packsApplied?: Array<{ packId?: string; name?: string; source?: string }>;
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
}

export interface GovernanceAssessContext {
  /** The AI use case this assessment runs under (PRD 08 §5: `gov.policy_audit`). */
  useCase: "gov.policy_audit";
  repoRef?: string;
  ref?: string;
  ruleset: ResolvedRuleset;
  /** Deterministic pre-filter candidates for the auditor to triage. */
  prefilterHits: GovernancePrefilterHit[];
  /** Changed-files tree (relative paths) the auditor reasons over. */
  files: string[];
}

/**
 * The LLM assessment seam (step 3). The orchestrator injects a call to the
 * `governance-auditor` role here; the default confirms every pre-filter hit and
 * raises no LLM-only findings (deterministic-only mode — useful for dry runs).
 */
export type GovernanceAssessor = (
  ctx: GovernanceAssessContext,
) => Promise<GovernanceFinding[]>;

export interface GovernanceAuditOptions {
  repoRef?: string;
  ref?: string;
  projectId?: string;
  packIds?: string[];
  dryRun?: boolean;
}

export interface GovernanceAuditDeps {
  baseUrl?: string;
  apiKey?: string;
  agentNodeId?: string;
  /** Working tree to pre-filter. Defaults to `process.cwd()`. */
  workspaceDir?: string;
  /** The LLM triage seam (step 3). See {@link GovernanceAssessor}. */
  assess?: GovernanceAssessor;
  fetchImpl?: typeof fetch;
  /** Test/embedded override: skip the working-tree walk and use these rel paths. */
  filesOverride?: string[];
}

export interface GovernanceAuditResult {
  runId?: string;
  summary: GovernanceAuditSummary;
  gateResult: "pass" | "blocked" | null;
  dryRun?: boolean;
  rulesetHash?: string;
  packsApplied?: ResolvedRuleset["packsApplied"];
  findings: GovernanceFinding[];
}

// ── Severity rollup + gate ───────────────────────────────────────────────────────

const SEVERITY_ORDER = ["blocker", "critical", "high", "medium", "low", "info"] as const;

export function emptySummary(): GovernanceAuditSummary {
  return { blocker: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, passed: 0 };
}

/** Roll findings up into the run summary + gate verdict (PRD 08 §2 `summary`/`gateResult`). */
export function summarizeFindings(
  ruleset: ResolvedRuleset,
  findings: GovernanceFinding[],
): { summary: GovernanceAuditSummary; gateResult: "pass" | "blocked" } {
  const summary = emptySummary();
  const violated = new Set(findings.map((f) => f.ruleRef));
  for (const rule of ruleset.rules) {
    if (rule.enabled === false) continue;
    if (!violated.has(rule.ruleRef)) {
      summary.passed += 1;
    }
  }
  for (const f of findings) {
    const sev = (f.severity ?? "").toLowerCase();
    if ((SEVERITY_ORDER as readonly string[]).includes(sev)) {
      summary[sev as (typeof SEVERITY_ORDER)[number]] += 1;
    } else {
      summary.medium += 1;
    }
  }
  return { summary, gateResult: summary.blocker > 0 ? "blocked" : "pass" };
}

// ── Deterministic pre-filters (step 2) ───────────────────────────────────────────

/** Directories never worth scanning. */
const WALK_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "vendor",
  "target",
  "__pycache__",
]);

/** Extensions that are never text-scanned (binary by nature). */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".jar",
  ".class",
]);

const MAX_WALK_FILES = 10_000;
const MAX_SCAN_BYTES = 512 * 1024;

/** Built-in secret patterns applied when a rule's check kind is "secret". */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
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

/** Convert a glob (`**`, `*`, `?`) into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      out += ".*";
      i += 2;
      if (glob[i] === "/") i += 1; // `**/` matches zero or more path segments
    } else if (ch === "*") {
      out += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

function isProbablyBinaryPath(relPath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

/** Walk the working tree (bounded) returning repo-relative file paths. */
export async function walkWorkingTree(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && files.length < MAX_WALK_FILES) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip
    }
    for (const entry of entries) {
      if (files.length >= MAX_WALK_FILES) break;
      if (entry.name.startsWith(".") && entry.name !== ".builderforce") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        files.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  return files.sort();
}

interface RuleRunContext {
  root: string;
  files: string[];
  /** Lazily-read, size-capped file cache. */
  readFile: (relPath: string) => Promise<string | null>;
}

function compileMatcher(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "m");
  } catch {
    return null; // invalid rule regex — never crash the audit; the rule degrades to LLM-only
  }
}

function scopedFiles(ctx: RuleRunContext, check: GovernanceRuleCheck): string[] {
  if (!check.paths || check.paths.length === 0) return ctx.files;
  const matchers = check.paths.map((p) => globToRegExp(p));
  return ctx.files.filter((f) => matchers.some((m) => m.test(f)));
}

async function scanRegexRule(
  rule: GovernanceRule,
  check: GovernanceRuleCheck,
  ctx: RuleRunContext,
  hits: GovernancePrefilterHit[],
  patterns: Array<{ name: string; re: RegExp }>,
): Promise<void> {
  for (const relPath of scopedFiles(ctx, check)) {
    if (isProbablyBinaryPath(relPath)) continue;
    const text = await ctx.readFile(relPath);
    if (text === null) continue;
    const lines = text.split("\n");
    for (const { name, re } of patterns) {
      const reWithLine = new RegExp(re.source, re.flags.includes("m") ? re.flags : `${re.flags}m`);
      for (let i = 0; i < lines.length; i += 1) {
        const match = reWithLine.exec(lines[i]);
        if (!match) continue;
        hits.push({
          ruleId: rule.id,
          ruleRef: rule.ruleRef,
          severity: rule.severity,
          title: rule.title,
          detail: `Pre-filter "${name}" matched ${relPath}:${i + 1} — candidate violation of ${rule.ruleRef}.`,
          filePath: relPath,
          line: i + 1,
          evidence: lines[i].trim().slice(0, 500),
          remediation: rule.guidance ?? undefined,
          source: "prefilter",
          confidence: "high",
        });
        break; // one hit per pattern per file is enough for triage
      }
    }
  }
}

async function runDependencyRule(
  rule: GovernanceRule,
  check: GovernanceRuleCheck,
  ctx: RuleRunContext,
  hits: GovernancePrefilterHit[],
): Promise<void> {
  const depName = (check.pattern ?? "").trim();
  if (!depName) return;
  const manifests = scopedFiles(ctx, check).filter(
    (f) => f.endsWith("package.json") && !f.includes("node_modules"),
  );
  for (const relPath of manifests) {
    const text = await ctx.readFile(relPath);
    if (text === null) continue;
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      continue;
    }
    const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
    if (Object.prototype.hasOwnProperty.call(allDeps, depName)) {
      hits.push({
        ruleId: rule.id,
        ruleRef: rule.ruleRef,
        severity: rule.severity,
        title: rule.title,
        detail: `Forbidden dependency "${depName}"@${allDeps[depName]} declared in ${relPath} — candidate violation of ${rule.ruleRef}.`,
        filePath: relPath,
        remediation: rule.guidance ?? undefined,
        source: "prefilter",
        confidence: "high",
      });
    }
  }
}

/**
 * Run every enabled rule's deterministic check over the working tree.
 * Rules without a usable check are LLM-only — they produce no pre-filter hits
 * and are left for the assessment seam (step 3). Never throws on a bad rule.
 */
export async function runPrefilters(root: string, ruleset: ResolvedRuleset): Promise<GovernancePrefilterHit[]> {
  const files = await walkWorkingTree(root);
  const contentCache = new Map<string, Promise<string | null>>();
  const ctx: RuleRunContext = {
    root,
    files,
    readFile: (relPath) => {
      let cached = contentCache.get(relPath);
      if (!cached) {
        cached = (async () => {
          try {
            const buf = await fs.readFile(path.join(root, ...relPath.split("/")));
            if (buf.includes(0)) return null; // binary
            if (buf.length > MAX_SCAN_BYTES) return null; // too large to scan cheaply
            return buf.toString("utf8");
          } catch {
            return null;
          }
        })();
        contentCache.set(relPath, cached);
      }
      return cached;
    },
  };

  const hits: GovernancePrefilterHit[] = [];
  for (const rule of ruleset.rules) {
    if (rule.enabled === false) continue;
    const check = rule.check;
    if (!check || typeof check !== "object") continue; // LLM-only rule
    try {
      switch (check.kind) {
        case "regex": {
          const re = compileMatcher(check.pattern);
          if (!re || !check.pattern) break;
          await scanRegexRule(rule, check, ctx, hits, [{ name: check.pattern, re }]);
          break;
        }
        case "secret": {
          const patterns = check.pattern
            ? [{ name: check.pattern, re: compileMatcher(check.pattern) ?? /$^/ }]
            : SECRET_PATTERNS;
          await scanRegexRule(rule, check, ctx, hits, patterns);
          break;
        }
        case "glob": {
          const re = compileMatcher(check.pattern);
          if (!re || !check.pattern) break;
          await scanRegexRule(rule, check, ctx, hits, [{ name: check.pattern, re }]);
          break;
        }
        case "path_required": {
          const matcher = globToRegExp(check.pattern ?? "");
          if (ctx.files.some((f) => matcher.test(f))) break; // satisfied
          hits.push({
            ruleId: rule.id,
            ruleRef: rule.ruleRef,
            severity: rule.severity,
            title: rule.title,
            detail: `Required path matching "${check.pattern ?? ""}" is missing from the working tree — candidate violation of ${rule.ruleRef}.`,
            remediation: rule.guidance ?? undefined,
            source: "prefilter",
            confidence: "high",
          });
          break;
        }
        case "path_forbidden": {
          const matcher = globToRegExp(check.pattern ?? "");
          for (const relPath of scopedFiles(ctx, check)) {
            if (!matcher.test(relPath)) continue;
            hits.push({
              ruleId: rule.id,
              ruleRef: rule.ruleRef,
              severity: rule.severity,
              title: rule.title,
              detail: `Forbidden path "${relPath}" matches "${check.pattern ?? ""}" — candidate violation of ${rule.ruleRef}.`,
              filePath: relPath,
              remediation: rule.guidance ?? undefined,
              source: "prefilter",
              confidence: "high",
            });
          }
          break;
        }
        case "dependency":
          await runDependencyRule(rule, check, ctx, hits);
          break;
        default:
          break; // unknown kind — treat as LLM-only
      }
    } catch (error) {
      // A single rule's matcher must never abort the whole pre-filter pass — but its failure is recorded.
      logWarn(`[governance_audit] pre-filter for ${rule.ruleRef} failed: ${String(error)}`);
    }
  }
  return hits;
}

// ── API plumbing (step 1 + 4) ────────────────────────────────────────────────────

function resolveApiBase(deps: GovernanceAuditDeps): { baseUrl: string; apiKey?: string; agentNodeId?: string } {
  return {
    baseUrl: (deps.baseUrl ?? readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai").replace(/\/+$/, ""),
    apiKey: deps.apiKey ?? readSharedEnvVar("BUILDERFORCE_API_KEY") ?? undefined,
    agentNodeId: deps.agentNodeId ?? readSharedEnvVar("BUILDERFORCE_AGENT_NODE_ID") ?? undefined,
  };
}

function authHeaders(apiKey: string | undefined, agentNodeId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (agentNodeId) headers["X-AgentHost-Id"] = agentNodeId;
  return headers;
}

async function resolveRuleset(
  api: { baseUrl: string; apiKey?: string; agentNodeId?: string },
  opts: GovernanceAuditOptions,
  fetchImpl: typeof fetch,
): Promise<ResolvedRuleset> {
  const url = new URL(`${api.baseUrl}/api/governance/rules/resolve`);
  if (opts.projectId) url.searchParams.set("projectId", opts.projectId);
  if (opts.repoRef) url.searchParams.set("repoRef", opts.repoRef);
  const res = await fetchImpl(url, { headers: authHeaders(api.apiKey, api.agentNodeId) });
  if (!res.ok) {
    throw new Error(`rules/resolve failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Partial<ResolvedRuleset> & { rules?: unknown };
  const rules = Array.isArray(data.rules) ? (data.rules as GovernanceRule[]) : [];
  return { rulesetHash: data.rulesetHash, packsApplied: data.packsApplied, rules };
}

/** Confirm-all assessor: deterministic-only mode (dry runs / tests / no LLM wired). */
const confirmPrefilterAssessor: GovernanceAssessor = async (ctx) =>
  ctx.prefilterHits.map((hit) => ({ ...hit }));

// ── The pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run a governance audit (PRD 08 §4.2). Model-free: step 3 (LLM triage + LLM-only
 * rules) runs through the injected `assess` seam — the orchestrator supplies a
 * `governance-auditor` role call under `useCase: "gov.policy_audit"`.
 */
export async function runGovernanceAudit(
  deps: GovernanceAuditDeps,
  opts: GovernanceAuditOptions,
): Promise<GovernanceAuditResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const assess = deps.assess ?? confirmPrefilterAssessor;

  // 1. Resolve the effective ruleset (§3).
  const api = resolveApiBase(deps);
  const ruleset = await resolveRuleset(api, opts, fetchImpl);
  if (opts.packIds && opts.packIds.length > 0) {
    const allowed = new Set(opts.packIds);
    ruleset.rules = ruleset.rules.filter((r) => {
      const packId = (r as { packId?: string }).packId;
      return packId === undefined || allowed.has(packId);
    });
  }

  // 2. Deterministic pre-filters over the working tree.
  const workspaceDir = deps.workspaceDir ?? process.cwd();
  const prefilterHits = await runPrefilters(workspaceDir, ruleset);
  const files = deps.filesOverride ?? (await walkWorkingTree(workspaceDir));

  // 3. LLM triage + LLM-only rules (injected; default confirms pre-filter hits).
  const findings = await assess({
    useCase: "gov.policy_audit",
    repoRef: opts.repoRef,
    ref: opts.ref,
    ruleset,
    prefilterHits,
    files,
  });

  // Roll up + gate.
  const { summary, gateResult } = summarizeFindings(ruleset, findings);

  if (opts.dryRun) {
    return {
      summary,
      gateResult,
      dryRun: true,
      rulesetHash: ruleset.rulesetHash,
      packsApplied: ruleset.packsApplied,
      findings,
    };
  }

  // 4. Start the run, bulk-write findings, finalize.
  const startRes = await fetchImpl(`${api.baseUrl}/api/governance/audits`, {
    method: "POST",
    headers: authHeaders(api.apiKey, api.agentNodeId),
    body: JSON.stringify({
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.repoRef ? { repoRef: opts.repoRef } : {}),
      ...(opts.ref ? { ref: opts.ref } : {}),
      trigger: "manual",
    }),
  });
  if (!startRes.ok) {
    throw new Error(`audits start failed: HTTP ${startRes.status}`);
  }
  const started = (await startRes.json()) as { runId?: string };
  const runId = started.runId;
  if (!runId) {
    throw new Error("audits start returned no runId");
  }

  const postRes = await fetchImpl(`${api.baseUrl}/api/governance/audits/${runId}/findings`, {
    method: "POST",
    headers: authHeaders(api.apiKey, api.agentNodeId),
    body: JSON.stringify({ findings, summary, gateResult, rulesetHash: ruleset.rulesetHash }),
  });
  if (!postRes.ok) {
    throw new Error(`findings post failed: HTTP ${postRes.status}`);
  }

  return {
    runId,
    summary,
    gateResult,
    rulesetHash: ruleset.rulesetHash,
    packsApplied: ruleset.packsApplied,
    findings,
  };
}

// ── pi (`AnyAgentTool`) wrapper — shape follows memory-tool.ts ───────────────────

const GovernanceAuditSchema = Type.Object({
  repoRef: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  projectId: Type.Optional(Type.String()),
  packIds: Type.Optional(Type.Array(Type.String())),
  dryRun: Type.Optional(Type.Boolean()),
});

export function createGovernanceAuditTool(options: {
  workspaceDir?: string;
  assess?: GovernanceAssessor;
}): AnyAgentTool | null {
  // No API key → the ruleset cannot be resolved; omit the tool (mirrors
  // memory-tool's null-when-unavailable pattern).
  if (!readSharedEnvVar("BUILDERFORCE_API_KEY")) {
    return null;
  }
  return {
    label: "Governance Audit",
    name: "governance_audit",
    description:
      "Audit the working tree against the resolved governance policy ruleset (PRD 08): resolves DB policy packs + in-repo .builderforce/policies overrides, runs deterministic regex/secret/path/dependency/glob pre-filters, triages candidates (LLM) and returns { runId, summary, gateResult }. A BLOCKER finding gates auto-merge.",
    parameters: GovernanceAuditSchema,
    execute: async (_toolCallId, params) => {
      const repoRef = readStringParam(params, "repoRef");
      const ref = readStringParam(params, "ref");
      const projectId = readStringParam(params, "projectId");
      const packIds = readStringArrayParam(params, "packIds");
      const dryRunParam = params["dryRun"];
      const dryRun =
        typeof dryRunParam === "boolean"
          ? dryRunParam
          : typeof dryRunParam === "string" && dryRunParam.trim().toLowerCase() === "true"
            ? true
            : undefined;
      return jsonResult(
        await runGovernanceAudit(
          { workspaceDir: options.workspaceDir, assess: options.assess },
          {
            ...(repoRef ? { repoRef } : {}),
            ...(ref ? { ref } : {}),
            ...(projectId ? { projectId } : {}),
            ...(packIds ? { packIds } : {}),
            ...(dryRun !== undefined ? { dryRun } : {}),
          },
        ),
      );
    },
  };
}
