/**
 * The ReviewerPort the VSIX binds (PRD 45 §4.4 reviewerPort, §6 OD-1): ONE review
 * sub-run on a DIFFERENT model, given the diff and the evidence summary only.
 *
 * The reviewer model, in preference order (OD-1 — never one of the author models):
 *   1. the `builderforce.models.review` stage pin (the `verify` stage), when it is not
 *      an author model;
 *   2. the first model from the run's own available models (stage/role pins) that is
 *      not an author model;
 *   3. the AUTO-SWITCH case — the first non-author model from `catalogModels`, the full
 *      set of models the user's account can reach (BYO pool + plan pool + premium). The
 *      review sub-run runs on that model and the verdict's findings note the switch, so
 *      the user sees the reviewer was changed;
 *   4. otherwise the account has only the author model(s) and we refuse with an
 *      ACTIONABLE message: name the author model, state the review must be by a
 *      non-author, and tell the user to pick/enable a pool or BYO model or add one —
 *      the gate will then auto-switch (case 3).
 *
 * The reviewer's verdict is checked with the SAME `reviewGate` the push gate uses — a
 * reviewer on an author model is refused there too, never recorded.
 *
 * A review that TIMES OUT counts as unavailable and refuses with the add-a-model
 * guidance (never a pass — OD-3).
 */

import { reviewGate, type ReviewVerdict } from "@builderforce/run-guards";
import type { ReviewerPort } from "./types";

/** The shape the reviewer sub-run reports back (the model's own structured verdict). */
export interface ReviewSubRunResult {
  verdict: "approved" | "changes_requested";
  findings: readonly string[];
}

/**
 * The outcome of ONE review sub-run: a real verdict, or a note that the reviewer model
 * FAILED to produce a verdict (parse failure / timeout / sub-run error) — a transient
 * malfunction, distinct from a genuine "changes requested". A failure must NOT become a
 * blocking `changes_requested` (that was the reviewer-glitch wedge); the caller retries
 * on another model or reports unavailability instead.
 */
export type ReviewAttempt = ReviewSubRunResult | { failed: string };

export interface ReviewerDeps {
  /** The `builderforce.models.review` stage pin (undefined when unset). */
  verifyStagePin?: string;
  /** The run's available models, in preference order (stage/role pins, then BYO). */
  availableModels?: readonly string[];
  /**
   * The full set of models the user's account can reach: BYO pool + plan pool +
   * premium + any configured models. Used ONLY for the auto-switch recovery when the
   * run's own stage pins hold no non-author model. OPTIONAL (default `undefined`):
   * every other host stays unchanged and behaves as before. Ordering expectation:
   * callers list BYO/pool models BEFORE other catalog models, so the auto-switch
   * prefers a BYO non-author model over a gateway-pool one.
   */
  catalogModels?: readonly string[];
  /** Read the account's model catalog (async, per run). May reject or return undefined — a
   *  failure just means no auto-switch (fall back to the refusal). */
  getCatalogModels?: () => Promise<readonly string[] | undefined>;
  /** Run ONE review sub-run on the chosen model with the given prompt. */
  runReviewSubRun: (input: { model: string; prompt: string }) => Promise<ReviewSubRunResult | { failed: string }>;
  /** Compute the diffHash the verdict is recorded against. */
  hashDiff: (diff: string) => string;
  /** Wall-clock budget for the review sub-run; over it the review is unavailable. */
  reviewTimeoutMs?: number;
}

const DEFAULT_REVIEW_TIMEOUT_MS = 120_000;

/** How to add a second model, stated in the refusal when no reviewer is available. */
export const ADD_A_MODEL_TEXT =
  "No independent reviewer is available. Add one: connect a BYO account " +
  "(the gateway adds its models to the run's catalog) or set the builderforce.models.review " +
  "stage pin to a model that did not author the change, then push again.";

/** One pick outcome: the model, where it came from, and (for the refusal) the full catalog. */
interface ReviewerPick {
  model: string;
  /** True when the model came from the account catalog (auto-switch), not a run pin. */
  autoSwitched: boolean;
  /** The catalog actually consulted (a non-author model may exist here even on a refusal). */
  catalog: readonly string[];
}

/**
 * Pick the reviewer model per §6 OD-1: verify-stage pin, else first non-author available
 * model, else first non-author catalog model (auto-switch), else null. `catalogModels` is
 * the caller-ordered account catalog (BYO/pool before other catalog models); when it is
 * not supplied here, `getCatalog()` is awaited instead (a per-run read).
 */
export async function pickReviewerModelWithFallback(
  verifyStagePin: string | undefined,
  availableModels: readonly string[],
  catalogModels: readonly string[] | undefined,
  authorModels: readonly string[],
  getCatalog?: () => Promise<readonly string[] | undefined>,
): Promise<{ model: string; switched: boolean } | null> {
  if (verifyStagePin && !authorModels.includes(verifyStagePin)) return { model: verifyStagePin, switched: false };
  for (const m of availableModels) if (!authorModels.includes(m)) return { model: m, switched: false };
  const catalog = catalogModels ?? (await getCatalog?.()) ?? [];
  for (const m of catalog) if (!authorModels.includes(m)) return { model: m, switched: true };
  return null;
}

/** Back-compat sync picker (the pre-catalog behaviour): pin, else first non-author available model. */
export function pickReviewerModel(
  verifyStagePin: string | undefined,
  availableModels: readonly string[],
  authorModels: readonly string[],
): string | null {
  if (verifyStagePin && !authorModels.includes(verifyStagePin)) return verifyStagePin;
  for (const m of availableModels) if (!authorModels.includes(m)) return m;
  return null;
}

/**
 * An ACTIONABLE refusal for the single-model case: name the author model, state the
 * review must be by a non-author, and tell the user the exact step that unlocks the
 * gate (pick/enable a pool or BYO model or add one) — the gate will then auto-switch.
 */
function refusalFor(authorModels: readonly string[]): string {
  const authors = authorModels.length ? authorModels.join(", ") : "(none recorded)";
  return (
    `git_push refused: the review must be by a model that did not author the change, but the ` +
    `only model(s) on your account authored it (${authors}). Add or enable a second model to ` +
    `unlock the gate: connect a BYO account (its models join your catalog), pick a pool or BYO ` +
    `model in the model picker, or set the builderforce.models.review stage pin to a non-author ` +
    `model. The gate then reviews on that model automatically — no other step.`
  );
}

/**
 * Compose the ReviewerPort. The sub-run is given the diff and the evidence summary
 * ONLY — never the model's own narration of what it did.
 */
export function createReviewerPort(deps: ReviewerDeps): ReviewerPort {
  const timeoutMs = deps.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
  return {
    async review(input: { repo: string; diff: string; evidence: string; authorModels: readonly string[] }) {
      const authors = input.authorModels;
      // Every non-author model the account can reach, in preference order (the review pin
      // first, then run-available models, then the catalog auto-switch). A reviewer that
      // FAILS to produce a parseable verdict is retried on the next one, so a transient
      // glitch on a single model can never wedge the gate into a fabricated blocking
      // "changes requested" (the reviewer-glitch bug).
      const pick = await pickReviewerModelWithFallback(
        deps.verifyStagePin,
        deps.availableModels ?? [],
        deps.catalogModels,
        authors,
        deps.getCatalogModels,
      );
      // No non-author model anywhere: the account has only the author model(s).
      if (!pick) return { refused: refusalFor(authors) };
      // The review is capped at ONE candidate (the best pick). The earlier multi-model
      // fallback retried every non-author catalog model on any transient failure, each
      // with a 2-minute budget — a slow reviewer chained minutes into a 5+ minute push.
      // One bounded attempt keeps the OD-1 independent review while making a slow
      // reviewer fail fast (recorded "unavailable" → the actionable add-a-model refusal)
      // instead of serially retrying the whole catalog.
      const candidates = (await reviewerCandidates(deps, pick, authors)).slice(0, 1);

      const diffHash = deps.hashDiff(input.diff);
      const prompt =
        `You are reviewing a change before it ships. Review ONLY the diff and the ` +
        `check evidence below — do not trust any narration of what was done.\n\n` +
        `## Diff\n${input.diff}\n\n## Evidence\n${input.evidence}\n\n` +
        `Reply with a JSON object: {"verdict": "approved" | "changes_requested", "findings": string[]}. ` +
        `List concrete defects as findings; an empty findings list means approved.`;

      const failures: string[] = [];
      for (const candidate of candidates) {
        let attempt: ReviewSubRunResult | { failed: string };
        try {
          attempt = await withTimeout(deps.runReviewSubRun({ model: candidate.model, prompt }), timeoutMs);
        } catch (e) {
          // The review could not complete (timeout, sub-run error): a transient failure —
          // try the next candidate before giving up.
          failures.push(`${candidate.model}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        if ("failed" in attempt) {
          failures.push(`${candidate.model}: ${attempt.failed}`);
          continue;
        }

        const verdict: ReviewVerdict = {
          reviewerModel: candidate.model,
          verdict: attempt.verdict,
          diffHash,
          findings: attempt.findings,
        };
        // The SAME gate the push uses: an author model or a stale diffHash is refused here too.
        const gate = reviewGate(verdict, authors, diffHash);
        if (!gate.ok) return { refused: gate.reason };

        // Auto-switch: the findings are the one verdict field that reaches the model/user
        // through runReviewGate (a changes_requested reason, or the pass path), so name the
        // switched-to reviewer there.
        if (candidate.switched) {
          verdict.findings = [
            `(auto-switched reviewer: the review stage pin and this run's models are all author ` +
              `models, so the gate reviewed on ${candidate.model} from your model catalog instead.)`,
            ...verdict.findings,
          ];
        }
        if (failures.length) {
          verdict.findings = [
            `(earlier reviewer attempt(s) failed transiently and were retried: ${failures.join("; ")})`,
            ...verdict.findings,
          ];
        }
        return verdict;
      }

      // Every candidate failed to produce a verdict: the review is unavailable (OD-3).
      return {
        refused:
          `No reviewer produced a verdict (each attempt failed: ${failures.join("; ") || "unknown"}). ` +
          ADD_A_MODEL_TEXT,
      };
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("review timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/**
 * The full ordered list of non-author models to try as reviewer, starting with the chosen
 * pick. This lets a parse/timeout failure on one model fall through to the next instead of
 * becoming a fabricated blocking verdict. De-duplicated, author models excluded.
 */
async function reviewerCandidates(
  deps: ReviewerDeps,
  pick: { model: string; switched: boolean },
  authors: readonly string[],
): Promise<readonly { model: string; switched: boolean }[]> {
  const out: { model: string; switched: boolean }[] = [];
  const seen = new Set<string>();
  const push = (m: string | undefined, switched: boolean) => {
    if (m && !authors.includes(m) && !seen.has(m)) { seen.add(m); out.push({ model: m, switched }); }
  };
  push(pick.model, pick.switched);
  const catalog = deps.catalogModels ?? (await deps.getCatalogModels?.()) ?? [];
  for (const m of deps.availableModels ?? []) push(m, false);
  for (const m of catalog) push(m, true);
  return out;
}
