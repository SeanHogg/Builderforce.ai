/* Independent ship review with bounded retries across the run and account models. */
import { MAX_BLOCKING_REVIEW_ROUNDS, type ReviewVerdict } from "@builderforce/run-guards";
import { pricedId } from "@builderforce/local-inference";
import type { ReviewerPort } from "./types";
import { messageOf } from "../messageOf";

/** The shape the reviewer sub-run reports back (the model's own structured verdict). */
export interface ReviewSubRunResult {
  verdict: "approved" | "changes_requested";
  /** Blocking findings only. An empty list is an approval, whatever a `verdict` field said. */
  findings: readonly string[];
  /** Style, speculative, hardening and documentation notes. Never blocking. */
  advisories?: readonly string[];
  /**
   * The reviewer's resolution answer: 1-based indices into the prior blocking list it was
   * shown, naming which of those findings are STILL unresolved this round. Propagated onto
   * the recorded {@link ReviewVerdict.unresolvedPrior} so {@link applyReviewRoundCap} can
   * trust the reviewer's own resolution list instead of falling back to text matching.
   */
  unresolvedPrior?: readonly number[];
}

/**
 * The outcome of ONE review sub-run: a real verdict, or a note that the reviewer model
 * FAILED to produce a verdict (parse failure / timeout / sub-run error) — a transient
 * malfunction, distinct from a genuine "changes requested". A failure must NOT become a
 * blocking `changes_requested` (that was the reviewer-glitch wedge); the caller retries
 * on another model or reports unavailability instead.
 */
export type ReviewAttempt = (ReviewSubRunResult & { reviewerModel?: string }) | { failed: string };

export interface ReviewerDeps {
  /** The `builderforce.models.review` stage pin (undefined when unset). */
  verifyStagePin?: string;
  /** The run's available models, in preference order (stage/role pins, then BYO). */
  availableModels?: readonly string[];
  /** Account models in preference order, loaded only when the run's pins are exhausted. */
  getCatalogModels?: () => Promise<readonly string[] | undefined>;
  canReviewModel?: (model: string) => boolean;
  runReviewSubRun: (input: { model: string; prompt: string; signal: AbortSignal }) => Promise<ReviewAttempt>;
  hashDiff: (diff: string) => string;
  reviewTimeoutMs?: number;
}

const MAX_REVIEWER_ATTEMPTS = 3;
const DEFAULT_REVIEW_TIMEOUT_MS = 40_000;
const CATALOG_TIMEOUT_MS = 10_000;

const ADD_A_MODEL_TEXT =
  "Choose a non-author review model in builderforce.models.review or enable another eligible model in your pool (including BYO).";

/**
 * The review prompt's diff budget: beyond this the reviewer is shown only WHOLE per-file
 * chunks (split on `diff --git`) that fit the budget, then the remaining files by name and
 * a note that the view is partial — a wall-sized change cannot overflow the review
 * sub-run's context, and no single file is ever half-shown. The verdict's `diffHash` is
 * still computed over the FULL diff (`hashDiff(input.diff)`), so the gate's stale-diff
 * check is unaffected — only what the reviewer reads is capped.
 */
export const REVIEW_DIFF_BUDGET_CHARS = 60_000;

/**
 * Budget the diff for the reviewer's prompt: include whole per-file chunks (split on
 * `diff --git`, separators kept) until the budget runs out, then list the remaining
 * files by name and state the view is partial. Returns the full diff when it fits.
 */
export function budgetReviewDiff(diff: string, budget = REVIEW_DIFF_BUDGET_CHARS): string {
  if (diff.length <= budget) return diff;
  const chunks = diff.split(/(?=^diff --git )/m);
  const kept: string[] = [];
  let used = 0;
  let i = 0;
  for (; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (used + chunk.length > budget && kept.length > 0) break;
    if (used + chunk.length > budget && kept.length === 0) {
      // A single chunk bigger than the whole budget: keep it truncated rather than nothing.
      kept.push(chunk.slice(0, budget));
      used = budget;
      i++;
      break;
    }
    kept.push(chunk);
    used += chunk.length;
  }
  const rest = chunks.slice(i);
  const names = rest.map((c) => /^diff --git a\/(.+?) b\//.exec(c)?.[1] ?? c.split("\n", 1)[0]).filter(Boolean);
  const omitted =
    names.length > 0
      ? `\n… [partial view: ${used} of ${diff.length} chars shown — ${names.length} file(s) omitted entirely: ${names.join(", ")}]`
      : `\n… [partial view: ${used} of ${diff.length} chars shown]`;
  return kept.join("") + omitted;
}

/**
 * The review sub-run's prompt. Blocking and advisory are separate lists so a speculative
 * nit cannot refuse the push. A re-review is handed the previous round's blocking findings
 * and asked to resolve those, not to start blank; at and past the cap it is additionally
 * asked for a structured resolution answer (`unresolved` indices) so the code-side cap can
 * trust which prior blockers it says remain, instead of guessing by text similarity.
 */
function reviewPrompt(input: {
  diff: string;
  evidence: string;
  priorBlocking?: readonly string[];
  round?: number;
}): string {
  const prior = (input.priorBlocking ?? []).filter((f) => f.trim());
  const diff = budgetReviewDiff(input.diff);
  const lines = [
    "You are reviewing a change before it ships. Review ONLY the diff and the check evidence below — do not trust any narration of what was done.",
    "",
    "## Diff",
    diff,
    "",
    "## Evidence",
    input.evidence,
    "",
    'Reply with a JSON object: {"blocking": string[], "advisory": string[]' + (prior.length ? ', "unresolved": number[]' : "") + "}.",
    "Blocking: a defect that would ship broken behaviour, data loss, a security hole, a failing build or test, or a stated requirement left unmet. Each one names file:line and the failure scenario.",
    'Advisory: style, speculative "may not", hardening and documentation gaps.',
    "Report EVERY blocking defect you can see in this ONE pass — the author fixes them together; there is no later round for defects visible now.",
    "Be EXHAUSTIVE across the WHOLE diff, not just the most severe spot: a single push is the ONLY chance to surface a defect, so stopping after the first one leaves the rest to a later round the author will not get. Sweep every changed file, every hunk, every edge (CRLF, empty input, missing files, flag forms) before you reply.",
  ];
  if (prior.length) {
    lines.push(
      "",
      "These blocking findings were raised last round:",
      ...prior.map((f, i) => `${i + 1}. ${f}`),
      "For each, say whether the current diff resolves it. Raise a NEW blocking finding only if the change since then introduced it, or it is severe (data loss / security / broken build).",
      'In "unresolved" list the 1-based numbers of the findings above that are STILL unresolved in this diff (empty array if all are resolved).',
    );
  }
  if ((input.round ?? 1) >= MAX_BLOCKING_REVIEW_ROUNDS) {
    lines.push(
      "",
      "This review is resolution-only: only an unresolved prior blocking finding may block. Anything new is advisory.",
    );
  }
  return lines.join("\n");
}

export function createReviewerPort(deps: ReviewerDeps): ReviewerPort {
  const timeoutMs = deps.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
  return {
    async review(input: {
      repo: string;
      diff: string;
      evidence: string;
      authorModels: readonly string[];
      priorBlocking?: readonly string[];
      round?: number;
    }) {
      const authors = input.authorModels;
      const authorIds = new Set(authors.map(pricedId));
      const candidates = reviewerCandidates(deps, authorIds);
      const diffHash = deps.hashDiff(input.diff);
      const prompt = reviewPrompt(input);

      const failures: string[] = [];
      let attempts = 0;
      for await (const candidate of candidates) {
        attempts++;
        let attempt: ReviewAttempt;
        try {
          attempt = await withTimeout(
            (signal) => deps.runReviewSubRun({ model: candidate.model, prompt, signal }),
            timeoutMs,
          );
        } catch (error) {
          attempt = { failed: messageOf(error) };
        }
        const reviewerModel = "failed" in attempt ? undefined : attempt.reviewerModel ?? candidate.model;
        if ("failed" in attempt || !reviewerModel || authorIds.has(pricedId(reviewerModel))) {
          const reason = "failed" in attempt ? attempt.failed : `the serving model (${reviewerModel}) authored the change`;
          failures.push(`${candidate.model}: ${reason}`);
          if (attempts >= MAX_REVIEWER_ATTEMPTS) break;
          continue;
        }

        const verdict: ReviewVerdict = {
          reviewerModel,
          verdict: attempt.verdict,
          diffHash,
          findings: attempt.findings,
          ...(attempt.advisories?.length ? { advisories: [...attempt.advisories] } : {}),
          ...(attempt.unresolvedPrior ? { unresolvedPrior: [...attempt.unresolvedPrior] } : {}),
        };
        // Auto-switch and retry notes are advisories. In findings they would block the push.
        const notes: string[] = [];
        if (candidate.switched) {
          notes.push(`(reviewer selected from your model catalog: ${reviewerModel})`);
        }
        if (failures.length) {
          notes.push(`(earlier reviewer attempt(s) failed transiently and were retried: ${failures.join("; ")})`);
        }
        if (notes.length) verdict.advisories = [...notes, ...(verdict.advisories ?? [])];
        return verdict;
      }

      if (!attempts) {
        return { refused: `No independent reviewer is available for the author model(s) ${authors.join(", ") || "(unknown)"}. ${ADD_A_MODEL_TEXT}` };
      }
      return { refused: `No reviewer produced a verdict. Review attempts failed: ${failures.join("; ")}. Retry the review or set builderforce.models.review to another non-author model.` };
    },
  };
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("review timeout"));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function* reviewerCandidates(deps: ReviewerDeps, authors: ReadonlySet<string>) {
  const seen = new Set(authors);
  const eligible = (model: string | undefined): model is string => {
    if (!model || deps.canReviewModel?.(model) === false) return false;
    const id = pricedId(model);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  for (const model of [deps.verifyStagePin, ...(deps.availableModels ?? [])]) {
    if (eligible(model)) yield { model, switched: false };
  }
  if (!deps.getCatalogModels) return;
  const getCatalog = deps.getCatalogModels;
  const catalog = await withTimeout(getCatalog, CATALOG_TIMEOUT_MS).catch(() => undefined);
  for (const model of catalog ?? []) {
    if (eligible(model)) yield { model, switched: true };
  }
}
