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
 *   - {@link shipGatePreflight} — what `callPreflight` calls BEFORE the human confirm gate.
 *     A base-branch `git_push`, an `open_pull_request`, and a `builtin_reviews_record`
 *     `complete` run the evidence + review gates and return `{ ok:false, error }` on
 *     refusal — WITHOUT asking the human. A refusal is ordinary tool feedback the model
 *     reads and acts on; a pass hands the approval prompt its evidence line. A ticket
 *     marked done is refused here too (bounded, this run's own outgoing files only), so the
 *     ticket is never already done when the model reads why.
 *   - {@link shipGateAdvisory} — what `callRunner` attaches to the result the model
 *     reads. `run_command` gets the shell-publish hint; `git_commit` runs the full tier
 *     EARLY on the committed paths (so the push is fast) and returns failures as an
 *     advisory (commits are local and reversible; the push is the act that leaves the
 *     machine). Never a refusal here.
 *   - {@link outgoingEvidenceVerdict} — the evidence half of the outgoing gate, which a
 *     commit's advisory reads.
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
import { completionBlockedAdvisory, isTicketCompletion } from '../completionGuard';
import type { BrainRunContext } from './brainRunContext';
import { nowIso, pushTrace } from './runCells';
import { parseSyncId } from '@builderforce/local-first';
import { settleView } from './runBackstops';
import { verificationOf } from '../run/brainCloseOut';
import { finishConditionMet } from './deterministicFinish';

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

/** The file's extension as the policy keys it (`.ts`), lower-cased; '' when none. */
function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Does this outgoing file lack FRESH evidence — a check kind its policy requires with no
 * record for its current hash? A deleted file has no bytes to check and never lacks any.
 */
function lacksEvidence(
  file: { absPath: string; hash: string; deleted?: boolean },
  ledger: BrainRunContext['evidence'],
  policy: EvidencePolicy,
): boolean {
  if (file.deleted) return false;
  const required: readonly CheckRecord['kind'][] = policy.required[extensionOf(file.absPath)] ?? [];
  const checks = ledger.for(file.absPath, file.hash);
  return required.some((kind) => {
    const records = checks.filter((r) => r.kind === kind);
    if (records.length === 0) return true;
    // A check whose LATEST record failed is re-run, not treated as evidenced: a
    // transient failure must be re-verifiable on retry, never a permanent refusal
    // the gate can never clear (verifyPaths only re-runs checks that lack records).
    return records.reduce((a, b) => (b.at >= a.at ? b : a)).outcome === "fail";
  });
}

/**
 * Run `verifier.full` on exactly the outgoing files that EXIST and lack fresh evidence
 * (deleted files and files already checked at their current hash are skipped), and record
 * every returned check against the file's current hash.
 */
async function verifyPaths(
  run: BrainRunContext,
  files: readonly { absPath: string; hash: string; deleted?: boolean; unavailable?: string }[],
  opts?: { budgetMs?: number },
): Promise<void> {
  const verifier = run.req.verifier;
  if (!verifier) return;
  const policy = policyOf(run);
  // A file the host marked `unavailable` (its working-tree bytes are not the pushed bytes) is never checked on disk.
  const pending = files.filter((f) => !f.unavailable && lacksEvidence(f, run.evidence, policy));
  if (!pending.length) return;
  const byPath = new Map(pending.map((f) => [f.absPath, f.hash]));
  const records = await verifier.full(pending.map((f) => f.absPath), opts);
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
 *
 * A pull request is compared against the merge-base with ITS base branch (`args.base`,
 * else origin's default) — after the branch was pushed, `@{u}` is the branch itself and
 * the set would be empty. When the host cannot compute the outgoing change at all (no
 * upstream, no PR base, no outgoing commits), the gate REFUSES naming why — the port's
 * contract (`runTypes` `GitPort.outgoing.unavailable`) is "never a pass", and a publish
 * with nothing verifiable has nothing to publish. No review is spent on an empty diff.
 * (A single CHECK that could not run is different: OD-3 passes it and reports it.)
 */
export async function runOutgoingGate(
  run: BrainRunContext,
  repo: string,
  tool = 'git_push',
  args?: unknown,
): Promise<{ verdict: GateVerdict; diffHash: string | null; gated: boolean }> {
  const git = run.req.git;
  if (!git) return { verdict: { ok: true, unavailable: [] }, diffHash: null, gated: false };
  const pullRequest = tool === 'open_pull_request';
  const base = (args as { base?: unknown } | null | undefined)?.base;
  const out = await git.outgoing(repo, pullRequest ? { pullRequest: typeof base === 'string' && base.trim() ? { base: base.trim() } : {} } : undefined);
  const { files, diffHash, baseBranch, diff } = out;
  // A push to a non-base branch is not gated — it cannot land on main without a pull
  // request, and the PR itself is gated (PRD §4.5).
  if (!baseBranch && !pullRequest) return { verdict: { ok: true, unavailable: [] }, diffHash, gated: false };
  // Nothing to check (no upstream / no PR base / no outgoing commits): "unavailable", never a pass, never reviewed.
  const unchecked = out.unavailable ?? (files.length === 0 || (diff !== undefined && !diff.trim()) ? 'no outgoing change to check' : undefined);
  if (unchecked) {
    return { verdict: { ok: false, reason: `${tool} refused: not verified — ${unchecked}. Commit the change on a branch with an upstream (or name the pull request base) and retry.` }, diffHash, gated: true };
  }
  // Full tier for exactly the files whose bytes changed under it since the last check.
  await verifyPaths(run, files);
  const verdict = outgoingGate(files, run.evidence, policyOf(run));
  // Failing evidence refuses on its own — no reviewer sub-run is spent on a change that cannot ship.
  if (!verdict.ok) return { verdict, diffHash, gated: true };
  const reviewed = await runReviewGate(run, diffHash, { repo, diff: diff ?? '', tool });
  if (!reviewed.ok) return { verdict: reviewed, diffHash, gated: true };
  return { verdict, diffHash, gated: true };
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
export async function runReviewGate(
  run: BrainRunContext,
  currentDiffHash: string,
  change: { repo: string; diff: string; tool: string } = { repo: '', diff: '', tool: 'git_push' },
): Promise<GateVerdict> {
  const reviewer = run.req.reviewer;
  if (!reviewer) return { ok: true, unavailable: [] };
  // An approved review of THIS diff already stands — the same bytes need no second sub-run.
  if (approvedReviewFor(run, currentDiffHash)) return { ok: true, unavailable: [] };
  const authors = authorModelsOf(run);
  const evidence = evidenceSummary(run);
  const res = await reviewer.review({ repo: change.repo, diff: change.diff, evidence, authorModels: authors });
  if ('refused' in res) {
    return { ok: false, reason: `${change.tool} refused: ${res.refused}` };
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

/** What the preflight does with a call: refuse it, or let it through (with what the approval prompt shows). */
export type ShipPreflight = { refusal: Refusal } | { evidence?: string };

/**
 * THE call `callPreflight` makes, after routing and BEFORE the human confirm gate.
 * Returns a refusal the model reads and acts on (no human prompt), or the evidence
 * line the confirm prompt carries (PRD §4.5 "Approval prompt"). INERT unless the host
 * bound a git port — no port, no gate, `{}`: the call proceeds exactly as before.
 */
export async function shipGatePreflight(run: BrainRunContext, name: string, args: unknown): Promise<ShipPreflight> {
  if (!run.req.git) return {};
  // Ticket → done: refused BEFORE the update runs, so "CANNOT MARK DONE" is true when the model reads it.
  if (isTicketCompletion(name, args)) {
    const deltaRefusal = await deltaTicketCompletionRefusal(run, args);
    if (deltaRefusal) return { refusal: deltaRefusal };
    const refusal = await completionGateRefusal(run);
    return refusal ? { refusal } : {};
  }
  const publish = isBaseBranchPush(name, args) || name === 'open_pull_request';
  if (!publish && !isCompleteReviewRecord(name, args)) return {};
  try {
    if (publish) {
      // git_push (base branch) and open_pull_request: the outgoing + review gates hold.
      const { verdict, diffHash, gated } = await runOutgoingGate(run, repoArgOf(args), name, args);
      if (!verdict.ok) return { refusal: { ok: false, error: verdict.reason } };
      return gated ? { evidence: approvalEvidence(run, verdict.unavailable, diffHash) } : {};
    }
    // builtin_reviews_record complete: refused unless a reviewGate-approved review exists
    // for the CURRENT diff. The approving reviewer is attached so the record names it.
    const { diffHash } = await run.req.git.outgoing(repoArgOf(args));
    const approved = diffHash ? approvedReviewFor(run, diffHash) : null;
    if (!approved) {
      const authors = authorModelsOf(run);
      // No model other than the author is available — the review sub-run can never be
      // independent. Naming the single model is the truth; telling the agent to "push so
      // the host runs the review" is a lie when pushing cannot help.
      if (authors.length <= 1) {
        const only = authors[0] ?? '(unknown)';
        return {
          refusal: {
            ok: false,
            error:
              'builtin_reviews_record refused: no reviewGate-approved independent review exists for the current diff, and ' +
              `only ONE model (${only}) has served this run — the review sub-run must be by a model that did not author the ` +
              'change (PRD 45 OD-1), so pushing cannot create it. Open a pull request for a human/other-model review, or ' +
              'finish the task and leave the ticket in review.',
          },
        };
      }
      return {
        refusal: {
          ok: false,
          error:
            'builtin_reviews_record refused: no reviewGate-approved independent review exists for the current diff. ' +
            'The push gate runs one review sub-run by a model that did not author the change (PRD 45 OD-1) — ' +
            'push (or open a pull request) so the host records the review, then record complete again.',
        },
      };
    }
    (args as Record<string, unknown>).reviewerRef = approved.reviewerModel;
    (args as Record<string, unknown>).evidence = evidenceSummary(run);
    return {};
  } catch (e) {
    // The gate could not read the change (git / verifier / reviewer threw). A gated act
    // never proceeds unverified — and never breaks the run: the model reads why.
    const why = e instanceof Error ? e.message : String(e);
    return { refusal: { ok: false, error: `${name} refused: the ship gate could not read the outgoing change (${why}). Fix the repository state and retry.` } };
  }
}

/** The completion check's whole budget: it answers within this or records "unavailable" (never minutes). */
export const COMPLETION_GATE_BUDGET_MS = 20_000;

/** Does an outgoing file's path name one of the paths this run wrote (workspace-relative or absolute)? */
function wroteThisRun(absPath: string, touched: readonly string[]): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const target = norm(absPath);
  return touched.some((t) => {
    const p = norm(t);
    return !!p && (target === p || target.endsWith(`/${p}`));
  });
}

/**
 * The ticket-completion half of the outgoing gate (PRD §4.3), run in the PREFLIGHT so the
 * ticket is not yet done when the model reads the refusal. Applies only when this run
 * changed code, and only to the outgoing files THIS run wrote — a shared working tree's
 * other commits never block it. The evidence ledger is read first; any check still missing
 * runs under {@link COMPLETION_GATE_BUDGET_MS} total, never waited on beyond it.
 *
 * FAILS CLOSED, like {@link shipGatePreflight}: a git / verifier error, the budget running
 * out, or an outgoing change the host could not compute each REFUSE the update, naming
 * why. The one exception is an uncomputable change on the BASE branch: the port tracks an
 * upstream there, so the only thing it cannot compute is an empty set — the run's work has
 * already landed, which is exactly what done means. Every non-pass outcome is traced
 * (`tools.completion_gate`). Null ⇒ the update proceeds.
 */
async function completionGateRefusal(run: BrainRunContext): Promise<Refusal | null> {
  const git = run.req.git;
  if (!git || !run.c.codeChanged || !run.c.touchedFiles?.length) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), COMPLETION_GATE_BUDGET_MS);
  });
  type Outcome = { kind: 'verdict'; verdict: GateVerdict } | { kind: 'clear'; why: string } | { kind: 'unavailable'; why: string } | { kind: 'error'; why: string };
  const check = async (): Promise<Outcome> => {
    try {
      const out = await git.outgoing('');
      if (out.unavailable) return out.baseBranch ? { kind: 'clear', why: out.unavailable } : { kind: 'unavailable', why: out.unavailable };
      const mine = out.files.filter((f) => wroteThisRun(f.absPath, run.c.touchedFiles));
      if (!mine.length) return { kind: 'clear', why: 'none of the outgoing files were written by this run' };
      await verifyPaths(run, mine, { budgetMs: COMPLETION_GATE_BUDGET_MS - 2_000 });
      return { kind: 'verdict', verdict: outgoingGate(mine, run.evidence, policyOf(run)) };
    } catch (e) {
      return { kind: 'error', why: e instanceof Error ? e.message : String(e) };
    }
  };
  let outcome: Outcome | { kind: 'timeout' };
  try {
    outcome = await Promise.race([check(), budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (outcome.kind === 'verdict' && outcome.verdict.ok) return null;
  const refusal: Refusal | null =
    outcome.kind === 'verdict' ? { ok: false, error: completionBlockedAdvisory(outcome.verdict) }
    : outcome.kind === 'clear' ? null
    : { ok: false, error: completionBlockedAdvisory({ ok: false, reason: completionUncheckedReason(outcome) }) };
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'tools.completion_gate',
    args: { outcome: outcome.kind, ...('why' in outcome ? { why: outcome.why } : {}) },
    result: refusal ? refusal.error : 'allowed',
  });
  return refusal;
}

/** Why the completion check could not verify the run's outgoing change. */
function completionUncheckedReason(outcome: { kind: 'timeout' } | { kind: 'unavailable' | 'error'; why: string }): string {
  if (outcome.kind === 'timeout') return `the check did not finish within ${COMPLETION_GATE_BUDGET_MS / 1000}s, so the change is not verified.`;
  if (outcome.kind === 'unavailable') return `the outgoing change could not be computed (${outcome.why}), so it is not verified.`;
  return `the ship gate could not read or verify the outgoing change (${outcome.why}). Fix the repository state and retry.`;
}

/**
 * The line the approval prompt shows for a gated publish that passed (PRD §4.5, OD-3):
 * what the checks proved, what could not run (never reported as verified), and who reviewed.
 * (A change nothing could be checked on never reaches here: {@link runOutgoingGate} refuses it.)
 */
function approvalEvidence(run: BrainRunContext, unavailable: readonly string[], diffHash: string | null): string {
  const checks = unavailable.length
    ? `checks passed · ${unavailable.length} check${unavailable.length === 1 ? '' : 's'} could not run here (not verified)`
    : 'checks passed';
  const reviewer = diffHash ? approvedReviewFor(run, diffHash)?.reviewerModel : undefined;
  return reviewer ? `${checks} · reviewed by ${reviewer}` : checks;
}

/** The `repo` argument a git tool carries (empty string when unnamed). */
export function repoArgOf(args: unknown): string {
  const r = (args as { repo?: unknown } | null)?.repo;
  return typeof r === 'string' ? r : '';
}

/**
 * W5 — a model-initiated `done` on the RUN'S OWN DELTA TICKET holds the SAME evidence
 * rule the host close-out uses: the change must be verified ({@link verificationOf}) and
 * carry no outstanding placeholder ({@link finishConditionMet} reads both). Non-delta
 * tickets keep current behaviour (the {@link completionGateRefusal} path). A non-local id
 * can never be the run's own delta, so it is not gated here.
 */
async function deltaTicketCompletionRefusal(run: BrainRunContext, args: unknown): Promise<Refusal | null> {
  const id = parseSyncId((args as { id?: unknown } | null | undefined)?.id);
  const deltaId = run.c.deltaTicketId;
  if (id == null || deltaId == null || id !== deltaId) return null;
  const view = settleView(run.c, run.c.runId);
  const verification = verificationOf(run.evidence, view.touchedFiles);
  const open = run.placeholderLedger.outstanding().length;
  // The host close-out also requires an approved review of the CURRENT diff (reviewGate): a
  // verified-but-unreviewed change is not done. Same rule here — the model cannot skip the
  // review by marking its own ticket done.
  const outgoing = await run.req.git?.outgoing(repoArgOf(args));
  const diffHash = outgoing && !('unavailable' in outgoing && outgoing.unavailable) ? outgoing.diffHash : null;
  const reviewed = diffHash ? !!approvedReviewFor(run, diffHash) : false;
  if (finishConditionMet({ shipped: true, verified: verification.verified && reviewed, openPlaceholders: open, hasTicket: true })) return null;
  const reason = !verification.verified
    ? `the run holds no passing verification for its change (${verification.reason})`
    : !reviewed
      ? 'no reviewGate-approved review of the current diff'
      : open > 0
        ? `${open} placeholder(s) are still outstanding`
        : 'the run is not verified to have shipped';
  return { ok: false, error: `CANNOT MARK DONE — this is the run's own delta ticket (#${deltaId}): ${reason}. Finish the work and let the host close it out, or leave it in review.` };
}

// ── Runner advisory entry point ─────────────────────────────────────────────

/**
 * What `callRunner` attaches to the result the model reads. ADVISORY ONLY — the
 * refusals live in the preflight. Returns null while nothing applies.
 */
export async function shipGateAdvisory(run: BrainRunContext, name: string, args: unknown, out: unknown): Promise<string | null> {
  // INERT without the host's git port: a host that binds no ports reads exactly what it did before.
  if (!run.req.git) return null;
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
  if (name === 'git_commit' && run.req.verifier && !isFailed(out)) {
    const verdict = await outgoingEvidenceVerdict(run, repoArgOf(args));
    return verdict && !verdict.ok ? `ADVISORY (commit not refused): ${verdict.reason}` : null;
  }
  // Ticket → done is NOT gated here: the outgoing-gate condition (PRD §4.3) is refused in
  // the PREFLIGHT ({@link shipGatePreflight}), before the ticket update runs.
  return null;
}

/**
 * The outgoing changes against their evidence (PRD §4.3) — the host's real commits
 * (`GitPort.outgoing`), the full verifier tier on any file lacking fresh evidence, then the
 * PURE `outgoingGate`. No review and no base-branch exemption: this is the evidence half,
 * what a commit's advisory and ticket completion read. Undefined ONLY when no git port is
 * bound (the caller behaves exactly as a host without one). A bound port that throws FAILS
 * CLOSED — a refusing verdict naming the error — because a gated act never proceeds
 * unverified (the same rule {@link shipGatePreflight} keeps). It never throws: the run reads why.
 */
export async function outgoingEvidenceVerdict(run: BrainRunContext, repo: string): Promise<GateVerdict | undefined> {
  const git = run.req.git;
  if (!git) return undefined;
  try {
    const { files } = await git.outgoing(repo);
    await verifyPaths(run, files);
    return outgoingGate(files, run.evidence, policyOf(run));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `the ship gate could not read or verify the outgoing change (${why}). Fix the repository state and retry.` };
  }
}

function isFailed(out: unknown): boolean {
  const o = out as { ok?: unknown } | null;
  return o != null && typeof o === 'object' && o.ok === false;
}
