/**
 * Gate decisions (PRD 45 §4.3) — the pure half of the deterministic run gates.
 *
 * Every gate takes facts and returns a {@link GateVerdict}; none does I/O. The gates
 * trust only what is in the {@link EvidenceLedger}, and the ledger is keyed by the
 * bytes on disk — so evidence the model *claims* in its output can never satisfy a
 * gate. A line in a model's transcript such as
 *
 *     npx tsc | grep error | head -20; echo DONE
 *
 * never reaches this module: no host code parses model output into CheckRecords.
 * Even a forged record is useless, because the gate looks evidence up by the hash of
 * the file's real bytes at gate time (`OutgoingFile.hash`, computed by the host from
 * the file itself), and the model does not control that hash. A `tsc | grep | head`
 * pipe also hides the real exit code behind `head`'s — which is exactly why the host
 * captures process exit codes itself and why a record without a host-captured hash
 * match counts for nothing here.
 *
 * A required check passes when its `outcome` is "pass". "unavailable" passes AND is
 * reported in the verdict's `unavailable` list (OD-3: shown in the approval prompt,
 * never reported as verified). "fail" refuses. A diagnostics record additionally
 * fails on any `error`-severity finding for the file, even when its outcome says
 * pass — the LSP is the source of truth there, not the exit code.
 *
 * `outgoingGate` is THE ship gate: it fires at `git_commit` (advisory), `git_push`
 * and `open_pull_request` (refusal), and ticket completion (via the host). A file
 * changed by `run_command`, a sub-agent, or the human in the editor is handled
 * identically — the host re-hashes the bytes and the gate asks for evidence against
 * the new hash. Deleted paths need no checks of their own; the owning package's
 * typecheck covers what imported them (PRD §4.2).
 */

import { gitCommandPattern } from "./gitCommandPattern.js";
import {
  normalizeEvidencePath,
  type CheckKind,
  type CheckRecord,
  type EvidenceLedger,
} from "./ledger.js";

export type { CheckKind };

/** PRD §4.3. `unavailable` lists every check that passed only because it could not run. */
export type GateVerdict = { ok: true; unavailable: readonly string[] } | { ok: false; reason: string };

export interface EvidencePolicy {
  /** By extension, e.g. ".ts": ["diagnostics","typecheck","test"]. */
  required: Readonly<Record<string, readonly CheckKind[]>>;
  /** A NEW source file must ship with a test in the same push. */
  newSourceNeedsTest: boolean;
  /** Per check; a timeout records "unavailable", never "pass" (OD-3). */
  checkTimeoutMs: number;
}

/** The default VSIX policy: .ts/.tsx need diagnostics + typecheck + test evidence. */
export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy = {
  required: {
    ".ts": ["diagnostics", "typecheck", "test"],
    ".tsx": ["diagnostics", "typecheck", "test"],
    ".mts": ["diagnostics", "typecheck", "test"],
    ".cts": ["diagnostics", "typecheck", "test"],
    ".js": ["typecheck", "test"],
    ".jsx": ["typecheck", "test"],
    ".mjs": ["typecheck", "test"],
    ".cjs": ["typecheck", "test"],
  },
  newSourceNeedsTest: true,
  checkTimeoutMs: 120_000,
};

export interface OutgoingFile {
  /** Key the ledger was recorded under (repo-relative with forward slashes, or absolute). */
  absPath: string;
  /** Hash of the file's CURRENT bytes, computed by the host at gate time. */
  hash: string;
  isNew: boolean;
  deleted: boolean;
}

function basenameOf(path: string): string {
  const normalized = normalizeEvidencePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function extOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function stemOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extOf(path));
}

/** Co-located test naming: x.test.ts(x), x.foo.test.ts(x). */
function isTestPath(path: string): boolean {
  return /\.test\.tsx?$/.test(basenameOf(path));
}

/** Findings are "path:line:col severity message (code)" — severity is the 2nd token. */
function isErrorFinding(finding: string): boolean {
  const tokens = finding.trim().split(/\s+/);
  return (tokens[1] ?? "").toLowerCase() === "error";
}

function pass(): GateVerdict {
  return { ok: true, unavailable: [] };
}

function refuse(reason: string): GateVerdict {
  return { ok: false, reason };
}

/** First findings of a failing check, capped for the refusal text. */
function firstFindings(check: CheckRecord, max = 3): string {
  const shown = check.findings.slice(0, max);
  const more = check.findings.length > max ? ` (+${check.findings.length - max} more)` : "";
  return shown.length ? shown.join("; ") + more : "(no findings recorded)";
}

function checkFailureReason(path: string, check: CheckRecord, detail: string): string {
  return (
    `git_push refused: ${path} failed ${check.kind} "${check.name}"${detail}. ` +
    `First findings: ${firstFindings(check)}. Fix the failure and push again — the host runs the checks.`
  );
}

/**
 * The push / pull-request gate — the real done gate (tickets close after a
 * verified push). One refusal shape for every failure, naming the file, the
 * failing check and its first findings, and what to do (PRD §4.3).
 */
export function outgoingGate(
  files: readonly OutgoingFile[],
  ledger: EvidenceLedger,
  policy: EvidencePolicy,
): GateVerdict {
  const unavailable: string[] = [];
  for (const file of files) {
    if (file.deleted) continue;
    const checks = ledger.for(file.absPath, file.hash);
    const required = policy.required[extOf(file.absPath)] ?? [];

    for (const kind of required) {
      const records = checks.filter((c) => c.kind === kind);
      if (records.length === 0) {
        // No record at all: the verifier never covered this file for this hash.
        // OD-3 — pass but report, exactly like an "unavailable" outcome.
        unavailable.push(`${file.absPath}: ${kind} (no record — verifier unavailable)`);
        continue;
      }
      for (const record of records) {
        if (record.outcome === "fail") {
          const detail = record.exitCode != null ? ` (exit ${record.exitCode})` : "";
          return refuse(checkFailureReason(file.absPath, record, detail));
        }
        if (record.outcome === "unavailable") {
          unavailable.push(`${file.absPath}: ${record.name} (${kind}) unavailable`);
        }
      }
      if (kind === "diagnostics") {
        // The LSP outranks the exit code: any error-severity finding on this file
        // fails the check even when the record's outcome says pass.
        const failing = records.find((r) => r.findings.some(isErrorFinding));
        if (failing) return refuse(checkFailureReason(file.absPath, failing, " (LSP error)"));
      }
    }

    // A new test file IS its own test — it does not need a test named after it.
    if (policy.newSourceNeedsTest && file.isNew && isSourceFile(file.absPath) && !isTestPath(file.absPath)) {
      const stem = stemOf(file.absPath);
      const hasTest = files.some(
        (t) =>
          t !== file &&
          !t.deleted &&
          isTestPath(t.absPath) &&
          basenameOf(t.absPath).startsWith(stem + "."),
      );
      if (!hasTest) {
        return refuse(
          `git_push refused: ${file.absPath} is new and has no test in this push. ` +
            `Add ${stem}.test.ts covering it, commit, and push again — the host runs the checks.`,
        );
      }
    }
  }
  return unavailable.length ? { ok: true, unavailable } : pass();
}

/** OD-1: an independent review verdict, produced by a different model over the diff. */
export interface ReviewVerdict {
  reviewerModel: string;
  verdict: "approved" | "changes_requested";
  diffHash: string;
  findings: readonly string[];
}

/**
 * OD-1. Refuses when there is no review, the reviewer is one of the author models,
 * the verdict is changes_requested (findings become the reason), or the diff changed
 * after the review was recorded.
 */
export function reviewGate(
  review: ReviewVerdict | undefined,
  authorModels: readonly string[],
  currentDiffHash: string,
): GateVerdict {
  if (!review) {
    return refuse(
      "git_push refused: no independent review. The push gate requires one review sub-run " +
        "by a model that did not author the change (PRD 45 OD-1); record it with the reviewer port, then push again.",
    );
  }
  if (authorModels.includes(review.reviewerModel)) {
    return refuse(
      `git_push refused: reviewer ${review.reviewerModel} is one of the author models ` +
        `(${authorModels.join(", ")}). Run the review on a different model and push again.`,
    );
  }
  if (review.diffHash !== currentDiffHash) {
    return refuse(
      "git_push refused: the diff changed after the review was recorded. Re-run the review " +
        "on the current diff and push again.",
    );
  }
  if (review.verdict === "changes_requested") {
    return refuse(
      `git_push refused: reviewer ${review.reviewerModel} requested changes. Findings: ` +
        `${review.findings.slice(0, 5).join("; ") || "(none recorded)"}. Address them and push again.`,
    );
  }
  return pass();
}

/**
 * §4.5: an advisory (never a refusal) for `run_command` that publishes straight from
 * the shell. Returns null for anything that is not a git commit/push — the outgoing
 * gate is what actually catches shell commits, because it reads the real commits.
 */
export function shellPublishHint(command: string): string | null {
  if (!gitCommandPattern("commit|push").test(command)) return null;
  return (
    "That shell command publishes. Use the git_commit / git_push tools instead: git_push runs " +
    "the evidence gates and the independent review before the push leaves the machine."
  );
}

// ── Name note ────────────────────────────────────────────────────────────────
// The PRD file (docs/specs/45-prd-deterministic-run-gates.md, the contract) names
// these `outgoingGate` / `reviewGate` / `shellPublishHint`. The run brief that
// scheduled this work used the older draft names; where the two do not collide the
// draft names are kept as thin aliases so either vocabulary compiles.

/** `outgoingGate` — one gate serves commit (advisory), push and PR (refusal). */
export const commitGate = outgoingGate;

/** `shellPublishHint`. */
export const shellBypass = shellPublishHint;
