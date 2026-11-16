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

import { isTestPath } from "../noProgress.js";
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
  /**
   * New source files the test rule does not apply to — regex sources matched against the
   * normalised path (barrels, type-only modules, declarations, config, scripts, label
   * catalogs, fixtures). Absent ⇒ none exempt.
   */
  newSourceTestExempt?: readonly string[];
  /**
   * What counts as a new file's test in the same push. `stem`: `x.test.ts` / `x.foo.test.ts`
   * named after the file; `directory`: any test in the file's directory, or a test named
   * after the directory beside it (`detectors.write.test.ts` next to `detectors/`);
   * `import`: a test whose host-read imports resolve to the file. Absent ⇒ `["stem"]`.
   */
  newSourceTestCoverage?: readonly NewSourceTestCoverage[];
  /** Per check; a timeout records "unavailable", never "pass" (OD-3). */
  checkTimeoutMs: number;
}

export type NewSourceTestCoverage = "stem" | "directory" | "import";

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
  newSourceTestExempt: [
    // Barrels / re-export entry points.
    "(^|/)index\\.[cm]?[jt]sx?$",
    // Type-only modules and declarations.
    "(^|/)types\\.[cm]?tsx?$",
    "\\.d\\.[cm]?ts$",
    // Tool / build configuration.
    "\\.config\\.[cm]?[jt]s$",
    // Node scripts.
    "\\.[cm]js$",
    // Label / copy catalogs.
    "(^|/)labels?/",
    "(^|/)[^/]*(labels?|catalog)(\\.[^/]*)?\\.[cm]?[jt]sx?$",
    // Fixtures and test helpers.
    "(^|/)(__fixtures__|fixtures?|__mocks__|test-?utils|test-?helpers|testing)/",
    "\\.(fixtures?|mocks?|helpers?)\\.[cm]?[jt]sx?$",
    "(^|/)(test|spec)[-_.]?(helpers?|utils?|setup)\\.[cm]?[jt]sx?$",
    "(^|/)(setupTests|vitest\\.setup|jest\\.setup)\\.[cm]?[jt]sx?$",
  ],
  newSourceTestCoverage: ["stem", "directory", "import"],
  checkTimeoutMs: 120_000,
};

export interface OutgoingFile {
  /** Key the ledger was recorded under (repo-relative with forward slashes, or absolute). */
  absPath: string;
  /** Hash of the file's bytes AT HEAD (what is pushed), computed by the host at gate time. */
  hash: string;
  isNew: boolean;
  deleted: boolean;
  /**
   * Set when the host could not verify the pushed bytes (e.g. the file is also modified
   * in the working tree, so on-disk checks would test other bytes). The gate reports it
   * "unavailable" with this reason and never passes it on working-tree evidence (OD-3).
   */
  unavailable?: string;
  /**
   * For a test file: the paths its relative imports resolve to (same key space as
   * `absPath`, extension optional). Read by the host from the pushed bytes.
   */
  imports?: readonly string[];
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

function dirOf(path: string): string {
  const normalized = normalizeEvidencePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

/** A path without its JS/TS extension — imports name modules without one (or with `.js`). */
function moduleKey(path: string): string {
  return normalizeEvidencePath(path).replace(/\.[cm]?[jt]sx?$/i, "");
}

function isExemptFromTestRule(path: string, policy: EvidencePolicy): boolean {
  const normalized = normalizeEvidencePath(path);
  return (policy.newSourceTestExempt ?? []).some((source) => new RegExp(source, "i").test(normalized));
}

/** Does the policy's new-source rule demand a test for this file? (A new test file IS its own test.) */
function needsTest(file: Pick<OutgoingFile, "absPath" | "isNew">, policy: EvidencePolicy): boolean {
  return (
    !!policy.newSourceNeedsTest &&
    file.isNew &&
    isSourceFile(file.absPath) &&
    !isTestPath(file.absPath) &&
    !isExemptFromTestRule(file.absPath, policy)
  );
}

/** Does `test` (a test file in the push) count as `file`'s test under the policy? */
function covers(test: OutgoingFile, file: OutgoingFile, policy: EvidencePolicy): boolean {
  const coverage = policy.newSourceTestCoverage ?? ["stem"];
  if (coverage.includes("stem") && basenameOf(test.absPath).startsWith(stemOf(file.absPath) + ".")) return true;
  if (coverage.includes("directory")) {
    const dir = dirOf(file.absPath);
    if (dirOf(test.absPath) === dir) return true;
    // A test named after the directory, beside it: `detectors.write.test.ts` next to `detectors/`.
    const dirName = dir.slice(dir.lastIndexOf("/") + 1);
    if (dirName && dirOf(test.absPath) === dirOf(dir) && basenameOf(test.absPath).startsWith(dirName + ".")) return true;
  }
  if (coverage.includes("import") && test.imports?.length) {
    const target = moduleKey(file.absPath);
    if (test.imports.some((i) => moduleKey(i) === target)) return true;
  }
  return false;
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

/**
 * A file NO policy check could ever fail: its extension maps to no required check and it is
 * not a new source file needing a test — docs, copy, images, and any deleted path. The host
 * asks this when the outgoing set cannot be computed: a change made only of such files is
 * CLEAR rather than unverifiable, because the identical files pass this same rule with zero
 * checks once an upstream exists (a docs-only ticket can close on a branchless checkout).
 */
export function fileIsUnchecked(file: Pick<OutgoingFile, "absPath" | "isNew"> & { deleted?: boolean }, policy: EvidencePolicy): boolean {
  if (file.deleted) return true;
  if ((policy.required[extOf(file.absPath)] ?? []).length > 0) return false;
  return !needsTest(file, policy);
}

/** First findings of a failing check, capped for the refusal text. */
function firstFindings(check: CheckRecord, max = 3): string {
  const shown = check.findings.slice(0, max);
  const more = check.findings.length > max ? ` (+${check.findings.length - max} more)` : "";
  return shown.length ? shown.join("; ") + more : "(no findings recorded)";
}

function checkFailureReason(path: string, check: CheckRecord, detail: string): string {
  const tail = check.outputTail?.trim();
  return (
    `git_push refused: ${path} failed ${check.kind} "${check.name}"${detail}. ` +
    `First findings: ${firstFindings(check)}.` +
    (tail ? ` Output (tail): ${tail.replace(/\s+/g, ' ').trim().slice(0, 400)}.` : "") +
    ` Fix the failure and push again — the host runs the checks.`
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
    // The host could not check the pushed bytes: reported, never passed on other bytes' evidence.
    const required = file.unavailable ? [] : policy.required[extOf(file.absPath)] ?? [];
    if (file.unavailable) unavailable.push(`${file.absPath}: ${file.unavailable}`);

    for (const kind of required) {
      const records = checks.filter((c) => c.kind === kind);
      if (records.length === 0) {
        // No record at all: the verifier never covered this file for this hash.
        // OD-3 — pass but report, exactly like an "unavailable" outcome.
        unavailable.push(`${file.absPath}: ${kind} (no record — verifier unavailable)`);
        continue;
      }
      // The LATEST record of a kind is the evidence for these bytes: a transient
      // failure (a check that raced a rebuild or an unsettled environment) which a
      // fresh passing run already superseded must not refuse the push forever.
      const record = records.reduce((a, b) => (b.at >= a.at ? b : a));
      if (record.outcome === "fail") {
        const detail = record.exitCode != null ? ` (exit ${record.exitCode})` : "";
        return refuse(checkFailureReason(file.absPath, record, detail));
      }
      if (record.outcome === "unavailable") {
        unavailable.push(`${file.absPath}: ${record.name} (${kind}) unavailable`);
      }
      if (kind === "diagnostics") {
        // The LSP outranks the exit code: an error-severity finding on this file
        // fails the check even when the record's outcome says pass.
        if (record.findings.some(isErrorFinding)) return refuse(checkFailureReason(file.absPath, record, " (LSP error)"));
      }
    }

    // A new test file IS its own test — it does not need a test named after it.
    if (needsTest(file, policy)) {
      const stem = stemOf(file.absPath);
      const hasTest = files.some((t) => t !== file && !t.deleted && isTestPath(t.absPath) && covers(t, file, policy));
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

/**
 * How many review rounds may raise NEW blocking findings. From this round on the review is
 * resolution-only: a finding that does not match a prior blocking finding cannot block
 * (it becomes an advisory). 1-based — round 3 is the first capped round.
 */
export const MAX_BLOCKING_REVIEW_ROUNDS = 3;

/** OD-1: an independent review verdict, produced by a different model over the diff. */
export interface ReviewVerdict {
  reviewerModel: string;
  verdict: "approved" | "changes_requested";
  diffHash: string;
  /**
   * BLOCKING findings only: a defect that would ship broken behaviour, data loss, a security
   * hole, a failing build or test, or a stated requirement left unmet. An advisory never
   * belongs here — an advisory-only review is a pass.
   */
  findings: readonly string[];
  /** Style, speculative, hardening and documentation notes. Never a reason to refuse. */
  advisories?: readonly string[];
  /**
   * 1-based indices into the prior blocking list the reviewer was shown, naming which of
   * those findings are STILL unresolved. Present (even empty) means the reviewer answered
   * the resolution question; absent means it did not, and the cap falls back to text match.
   */
  unresolvedPrior?: readonly number[];
}

/** A finding reduced to the words that decide whether two rounds raised the same defect. */
function findingKey(finding: string): string {
  return finding.toLowerCase().replace(/\s+/g, " ").trim();
}

/** `file:line` when the finding names one (`src/a.ts:12`), else null. The only location token two wordings of one defect share. */
function findingLocation(finding: string): string | null {
  const m = /([\w./\\-]+\.\w+):(\d+)/.exec(finding);
  return m ? `${m[1]!.replace(/\\/g, "/").toLowerCase()}:${m[2]}` : null;
}

/**
 * Did this round raise the SAME defect as an earlier one? Equality or containment of the
 * normalised text, or the same `file:line`. One function — the cap and the loop diagnostic
 * both read it, so neither grows a second similarity.
 */
export function findingMatchesPrior(finding: string, prior: readonly string[]): boolean {
  const key = findingKey(finding);
  if (!key) return false;
  const loc = findingLocation(finding);
  return prior.some((p) => {
    const pk = findingKey(p);
    if (!pk) return false;
    if (key === pk) return true;
    // Containment only when the shorter wording is long enough to be the same defect.
    // A short shared word ("error", "the") must not collapse two different findings.
    const shorter = Math.min(key.length, pk.length);
    if (shorter >= 24 && (key.includes(pk) || pk.includes(key))) return true;
    const pl = findingLocation(p);
    return loc !== null && pl === loc;
  });
}

/**
 * The resolution-only cap, applied in CODE (the prompt asks for it; this is what enforces it).
 * Before round {@link MAX_BLOCKING_REVIEW_ROUNDS} the verdict is unchanged. From that round on,
 * a blocking finding that does not match a prior blocking finding moves to `advisories`; when
 * none remain, the verdict is `approved`. A prior blocker that is still unresolved stays blocking.
 */
/** Prior findings named by 1-based `unresolvedPrior`, dropping out-of-range and duplicates. */
function priorsNamed(indices: readonly number[] | undefined, priorBlocking: readonly string[]): string[] {
  if (!indices) return [];
  const still: string[] = [];
  const seen = new Set<number>();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 1 || i > priorBlocking.length || seen.has(i)) continue;
    seen.add(i);
    const prior = priorBlocking[i - 1];
    if (prior) still.push(prior);
  }
  return still;
}

export function applyReviewRoundCap(
  verdict: ReviewVerdict,
  priorBlocking: readonly string[],
  round: number,
): ReviewVerdict {
  if (round < MAX_BLOCKING_REVIEW_ROUNDS || verdict.findings.length === 0) return verdict;
  // A present unresolvedPrior is the reviewer's answer: only those prior findings still block.
  // Anything else this round raised — including a new wording of a named prior — is advisory.
  // Absent, the cap keeps a new finding only when it matches a prior one.
  const named = verdict.unresolvedPrior;
  const still = named ? priorsNamed(named, priorBlocking) : verdict.findings.filter((f) => findingMatchesPrior(f, priorBlocking));
  const blockingKeys = new Set(still.map(findingKey));
  const moved = verdict.findings.filter((f) => !blockingKeys.has(findingKey(f)));
  if (moved.length === 0 && still.length === verdict.findings.length && !named) return verdict;
  return {
    ...verdict,
    verdict: still.length > 0 ? "changes_requested" : "approved",
    findings: still,
    advisories: [...(verdict.advisories ?? []), ...moved],
  };
}

/**
 * OD-1. Refuses when there is no review, the reviewer is one of the author models,
 * the verdict is changes_requested WITH blocking findings (every one is named, numbered —
 * a cap hid the rest and the author fixed them one push at a time), or the diff changed
 * after the review was recorded. Advisory-only is a pass: an advisory never blocks.
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
  if (review.verdict === "changes_requested" && review.findings.length > 0) {
    const listed = review.findings.map((f, i) => `${i + 1}. ${f}`).join("; ");
    return refuse(
      `git_push refused: reviewer ${review.reviewerModel} requested changes. Findings: ` +
        `${listed}. Address them and push again.`,
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
