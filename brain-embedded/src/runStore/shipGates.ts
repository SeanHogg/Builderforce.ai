/**
 * SHIP GATES (PRD 45 §4.5) — the orchestration the preflight and the runner call.
 *
 * This is the HOST half of the deterministic run gates: it wires the PURE gates in
 * `@builderforce/run-guards` (`outgoingGate`, `reviewGate`, `shellPublishHint`) to the
 * host ports (`VerifierPort`, `GitPort`, `ReviewerPort` — defined in `runTypes.ts`,
 * bound by the VSIX under `clients/vscode/src/verify/`). Every gate is INERT unless its
 * port is bound: the web Brain and the parity harness bind none and are unchanged.
 *
 * Two faces, one module:
 *   - {@link shipGateRefusal} — what `callPreflight` calls BEFORE the human confirm gate.
 *     A base-branch `git_push`, an `open_pull_request`, and a `builtin_reviews_record`
 *     `complete` run the evidence + review gates and return `{ ok:false, error }` on
 *     refusal — WITHOUT asking the human. A refusal is ordinary tool feedback the model
 *     reads and acts on.
 *   - {@link shipGateAdvisory} — what `callRunner` attaches to the result the model
 *     reads. `run_command` gets the shell-publish hint; `git_commit` runs the full tier
 *     EARLY on the committed paths (so the push is fast) and returns failures as an
 *     advisory (commits are local and reversible; the push is the act that leaves the
 *     machine); a ticket marked `done` while the outgoing changes fail the gate is told
 *     so. Never a refusal here.
 *
 * The evidence ledger lives on the run context (`BrainRunContext.evidence`, PRD §4.2):
 * one per run, keyed by the bytes on disk, fed ONLY by the host verifier — the model's
 * prose can never write to it.
 */

import {
  DEFAULT_EVIDENCE_POLICY,
  outgoingGate,
  reviewGate,
  shellPublishHint,
  type CheckRecord,
  type EvidencePolicy,
  type GateVerdict,
  type ReviewVerdict,
} from '@builderforce/run-guards';
import type { BrainRunContext } from './brainRunContext';

/** What a refusal call returns to the model (ordinary tool result, `ok:false`). */
export interface Refusal {
  ok: false;
  error: string;
}

// ── Author models (OD-1) ────────────────────────────────────────────────────

/** Remember which model wrote this run's code — the review gate refuses a reviewer on an author model. */
export function noteAuthorModel(run: BrainRunContext, model: string | null | undefined): void {
  if (model) run.c.authorModels.add(model);
}

/** The models that authored this run's changes (deduped, insertion order). */
export function authorModelsOf(run: BrainRunContext): readonly string[] {
  return [...run.c.authorModels];
}

// ── Verifier plumbing ───────────────────────────────────────────────────────

/** The run's evidence policy — policy is data (PRD §4.3), defaulting to the VSIX policy. */
export function policyOf(run: BrainRunContext): EvidencePolicy {
  return run.req.evidencePolicy ?? DEFAULT_EVIDENCE_POLICY;
}

/**
 * Paths in the outgoing set that lack a FRESH check record of `kind` for their current
 * hash. The host runs the full tier on exactly these (verifier caches by path/hash/check).
 */
export function pathsMissingCheck(
  files: ReadonlyArray<{ absPath: string; hash: string; deleted: boolean }>,
  ledger: BrainRunContext['evidence'],
  kind: CheckRecord['kind'],
): string[] {
  const missing: string[] = [];
  for (const f of files) {
    if (f.deleted) continue;
    if (!ledger.for(f.absPath, f.hash).some((r) => r.kind === kind)) missing.push(f.absPath);
  }
  return missing;
}

/** Run `verifier.full` on `paths` and record every returned check against the file's current hash. */
async function verifyPaths(run: BrainRunContext, files: readonly { absPath: string; hash: string }[]): Promise<void> {
  const verifier = run.req.verifier;
  if (!verifier || !files.length) return;
  const byPath = new Map(files.map((f) => [f.absPath, f.hash]));
  const records = await verifier.full(files.map((f) => f.absPath));
  const now = Date.now();
  for (const [absPath, hash] of byPath) {
    for (const check of records.get(absPath) ?? []) {
      run.evidence.record(absPath, hash, { ...check, at: check.at || now });
    }
  }
}

// ── Outgoing gate (push / PR / commit) ──────────────────────────────────────

/**
 * The push / pull-request gate — the real done gate (PRD §4.5). Reads the host's real
 * commits (`GitPort.outgoing`), hashes the bytes, runs the full verifier tier on any
 * file lacking fresh evidence, then asks the PURE `outgoingGate`. Pure with respect to
 * the ports: given the same port results it always reaches the same verdict.
 *
 * When `reviewer` is bound (OD-1), an approved independent review is also required;
 * the reviewer is handed the diff and the evidence summary ONLY.
 */
export async function runOutgoingGate(
  run: BrainRunContext,
  repo: string,
): Promise<{ verdict: GateVerdict; diffHash: string | null }> {
  const git = run.req.git;
  if (!git) return { verdict: { ok: true, unavailable: [] }, diffHash: null };
  const { files, diffHash, baseBranch } = await git.outgoing(repo);
  // A push to a non-base branch is not gated — it cannot land on main without a pull
  // request, and the PR itself is gated (PRD §4.5).
  if (!baseBranch) return { verdict: { ok: true, unavailable: [] }, diffHash: diffHash } ;
  // Full tier for exactly the files whose bytes changed under it since the last check.
  await verifyPaths(run, files);
  const verdict = outgoingGate(files, run.evidence, policyOf(run));
  const reviewed = await runReviewGate(run, diffHash);
  if (!reviewed.ok) return { verdict: reviewed, diffHash };
  return { verdict, diffHash };
}

// ── Review gate (OD-1) ──────────────────────────────────────────────────────

/** The latest review-gate-approved verdict, or null while none satisfies the gate. */
export function approvedReviewFor(run: BrainRunContext, currentDiffHash: string): ReviewVerdict | null {
  for (const review of run.c.shipReviews) {
    if (reviewGate(review, authorModelsOf(run), currentDiffHash).ok) return review;
  }
  return null;
}

/**
 * Ask the reviewer port for one independent review and gate it with the PURE
 * `reviewGate` (no review / reviewer is an author model / `changes_requested` / the
 * diff moved on ⇒ refuse). An approved verdict is REMEMBERED on the run, so a later
 * `complete` review-record or push can match it to the current diff.
 */
export async function runReviewGate(run: BrainRunContext, currentDiffHash: string): Promise<GateVerdict> {
  const reviewer = run.req.reviewer;
  if (!reviewer) return { ok: true, unavailable: [] };
  const authors = authorModelsOf(run);
  const evidence = evidenceSummary(run);
  const res = await reviewer.review({ repo: '', diff: '', evidence, authorModels: authors });
  if ('refused' in res) {
    return { ok: false, reason: `git_push refused: ${res.refused}` };
  }
  const verdict = reviewGate(res, authors, currentDiffHash);
  if (verdict.ok) run.c.shipReviews.push(res);
  return verdict;
}

/** A short evidence summary handed to the reviewer (and the `complete` gate). */
export function evidenceSummary(run: BrainRunContext): string {
  const lines: string[] = [];
  for (const ev of run.evidence.snapshot()) {
    for (const check of ev.checks) {
      lines.push(`${ev.path} ${check.kind} "${check.name}": ${check.outcome}`);
    }
  }
  return lines.join('\n') || '(no evidence recorded yet)';
}

// ── Preflight entry point ───────────────────────────────────────────────────

const isBaseBranchPush = (name: string, args: unknown): boolean =>
  name === 'git_push' && (args as { allowBaseBranch?: unknown } | null)?.allowBaseBranch === true;

function isCompleteReviewRecord(name: string, args: unknown): boolean {
  if (name !== 'builtin_reviews_record') return false;
  return (args as { verdict?: unknown } | null)?.verdict === 'complete';
}

/**
 * What `callPreflight` runs before the human confirm gate. Returns a refusal the model
 * reads and acts on, or null while the call proceeds. INERT unless the host bound the
 * ports — no port, no gate.
 */
export async function shipGateRefusal(run: BrainRunContext, name: string, args: unknown): Promise<Refusal | null> {
  // git_push (base branch) and open_pull_request: the outgoing + review gates hold.
  if ((name === 'git_push' && isBaseBranchPush(name, args)) || name === 'open_pull_request') {
    const { verdict } = await runOutgoingGate(run, repoArgOf(args));
    return verdict.ok ? null : { ok: false, error: verdict.reason };
  }
  // builtin_reviews_record complete: refused unless a reviewGate-approved review exists
  // for the CURRENT diff. The approving reviewer is attached so the record names it.
  if (isCompleteReviewRecord(name, args)) {
    if (!run.req.git) return null;
    const { diffHash } = await run.req.git.outgoing(repoArgOf(args));
    const approved = diffHash ? approvedReviewFor(run, diffHash) : null;
    if (!approved) {
      return {
        ok: false,
        error:
          'builtin_reviews_record refused: no reviewGate-approved independent review exists for the current diff. ' +
          'The push gate runs one review sub-run by a model that did not author the change (PRD 45 OD-1) — ' +
          'push (or open a pull request) so the host records the review, then record complete again.',
      };
    }
    (args as Record<string, unknown>).reviewerRef = approved.reviewerModel;
    (args as Record<string, unknown>).evidence = evidenceSummary(run);
    return null;
  }
  return null;
}

/** The `repo` argument a git tool carries (empty string when unnamed). */
export function repoArgOf(args: unknown): string {
  const r = (args as { repo?: unknown } | null)?.repo;
  return typeof r === 'string' ? r : '';
}

// ── Runner advisory entry point ─────────────────────────────────────────────

/**
 * What `callRunner` attaches to the result the model reads. ADVISORY ONLY — the
 * refusals live in the preflight. Returns null while nothing applies.
 */
export async function shipGateAdvisory(run: BrainRunContext, name: string, args: unknown, out: unknown): Promise<string | null> {
  // run_command (incl. background): publishing straight from the shell is pointed at
  // the gated tools. Not a refusal — the outgoing gate catches shell commits at push
  // because it reads the real commits.
  if (name === 'run_command') {
    const command = (args as { command?: unknown } | null)?.command;
    if (typeof command === 'string') return shellPublishHint(command);
    return null;
  }
  // git_commit: NO refusal — run the full tier EARLY on the committed paths so the push
  // is fast, and return failures as an advisory. Commits are local and reversible.
  if (name === 'git_commit' && run.req.git && run.req.verifier && !isFailed(out)) {
    const repo = repoArgOf(args);
    try {
      const { files } = await run.req.git.outgoing(repo);
      await verifyPaths(run, files);
      const verdict = outgoingGate(files, run.evidence, policyOf(run));
      return verdict.ok ? null : `ADVISORY (commit not refused): ${verdict.reason}`;
    } catch {
      return null; // never break a commit on a verifier hiccup
    }
  }
  // Ticket → done: the existing completionGuard's branch/placeholder checks already ran
  // in callRunner; this adds the outgoing-gate condition (PRD §4.3) for hosts with a
  // git port. Only when the existing check PASSED — it owns the refusal otherwise.
  if (name === 'builtin_tasks_update' && run.req.git && !isFailed(out)) {
    const status = (args as { status?: unknown } | null)?.status;
    if (typeof status !== 'string' || !['done', 'completed', 'complete'].includes(status.toLowerCase())) return null;
    try {
      const { verdict } = await runOutgoingGate(run, repoArgOf(args));
      return verdict.ok ? null : `ADVISORY (ticket left done): ${verdict.reason}`;
    } catch {
      return null;
    }
  }
  return null;
}

function isFailed(out: unknown): boolean {
  const o = out as { ok?: unknown } | null;
  return o != null && typeof o === 'object' && o.ok === false;
}
