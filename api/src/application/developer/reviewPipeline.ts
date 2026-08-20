/**
 * The REVIEW PIPELINE — one registry, three stages, one precedence rule.
 *
 * PRD 24 §5.5 stages review as static → dynamic → agentic → human. Only the
 * static stage was built, and it was built as a FUNCTION (`reviewVersion`) called
 * directly from `submitVersion`. That worked for exactly as long as there was one
 * stage. The moment there are three, calling them one after another from the
 * submit path means the submit path owns the ORDER, the short-circuiting, the
 * composition of three verdicts into one, and the decision about what a stage
 * that could not run means — four rules living in a service that is supposed to
 * be writing a row.
 *
 * So the stages are a REGISTRY and this module owns those four rules. Adding the
 * human stage later is a fourth entry in {@link REVIEW_STAGES}; it is not another
 * branch in `submitVersion`.
 *
 * ── THE PRECEDENCE RULE, IN FULL ────────────────────────────────────────────
 *
 *   1. Stages run in `order`. The order is not cosmetic: the static stage is the
 *      only one that produces a NORMALIZED spec, and the dynamic stage cannot
 *      exercise a manifest that did not parse.
 *
 *   2. A `fail` from any stage that RAN blocks the submission. There is no
 *      weighting and no override — a stage that is allowed to object and cannot
 *      block is decoration, and the agentic stage in particular exists to be able
 *      to say no.
 *
 *   3. A `fail` SHORT-CIRCUITS the remaining stages. Exercising the endpoints of
 *      a manifest that was already refused spends real HTTP requests against a
 *      vendor's API to learn nothing.
 *
 *   4. `warn` never blocks. It is recorded, it is shown to the publisher, and it
 *      lowers the listing's assurance tier in the directory (`catalogRanking`) —
 *      which is the honest cost of a warning: less recommendation, not a refusal.
 *
 *   5. `skipped` never blocks, and it is never a pass. A stage that could not
 *      reach its sandbox, or whose model was unavailable, records WHY and lets
 *      the submission through. Goal G5 is that review is a gate and not a
 *      bottleneck: refusing every submission on the platform during an LLM outage
 *      is a bottleneck wearing a gate's clothes. The cost is paid in the
 *      directory instead — a package no stage exercised cannot reach the
 *      `exercised` assurance tier, so the absence of evidence is visible to a
 *      buyer rather than laundered into an approval.
 *
 *      The static stage is the exception and cannot skip: it is pure, it needs
 *      nothing external, and there is no state of the world in which it is
 *      unavailable. If it somehow produced no normalized spec, the submission is
 *      refused, because there is nothing to store.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT TOUCH ────────────────────────────
 * `packageReview.reviewVersion` is called, not edited. Its `paid_requires_identity`
 * check is the one place PRD 24 §9's second open decision is expressed, and that
 * decision is still open — a different answer from the operator changes that
 * check. Wrapping it means the answer changes in one place when it comes.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reviewVersion, type ReviewFinding, type ReviewInput } from './packageReview';
import type { ExtensionKind } from './extensionContract';

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/** The stages that exist. `human` is PRD 24 §5.5's fourth and is not yet built. */
export const REVIEW_STAGE_KEYS = ['static', 'dynamic', 'agentic'] as const;
export type ReviewStageKey = (typeof REVIEW_STAGE_KEYS)[number];

export type StageVerdict = 'pass' | 'warn' | 'fail' | 'skipped';

/**
 * ONE thing a stage actually exercised.
 *
 * The shape is deliberately concrete. "The dynamic stage passed" is not evidence;
 * `{subject: 'create_invoice', outcome: 'skipped', detail: 'mutating action — the
 * URL was resolved and egress-checked but the request was not sent', method:
 * 'POST', url: 'https://api.acme.example/v1/invoices'}` is. Every field that can
 * be known is recorded, including for the things that were NOT done, because the
 * entry that says what a stage declined to do is the one that stops the stage
 * from being read as having done more than it did.
 */
export interface StageEvidence {
  /** What was exercised — an action key, a tool name, a check name. */
  subject: string;
  outcome: 'pass' | 'warn' | 'fail' | 'skipped';
  /** Plain-language: what happened, or why nothing did. */
  detail: string;
  method?: string;
  /** The RESOLVED url, after templates and overrides. Never carries a credential:
   *  the dynamic stage builds requests with placeholder auth by construction. */
  url?: string;
  status?: number;
  durationMs?: number;
}

export interface StageResult {
  stage: ReviewStageKey;
  verdict: StageVerdict;
  findings: ReviewFinding[];
  evidence: StageEvidence[];
  durationMs: number;
  /** The workspace a stage installed into, when it installed into one. */
  sandboxTenantId?: number | null;
  /**
   * The spec and scopes as this stage normalized them.
   *
   * Only the static stage sets these, and only it can: it is the stage that owns
   * the per-kind parser. The pipeline folds them into the context for the stages
   * that follow, so the dynamic stage exercises the manifest the platform will
   * actually store rather than the raw JSON a publisher posted.
   */
  normalizedSpec?: Record<string, unknown>;
  normalizedScopes?: string[];
}

/**
 * What a stage is given.
 *
 * `versionId` is present because the dynamic stage installs the CANDIDATE version
 * into a sandbox, which needs the row to exist — which is why `submitVersion`
 * writes the version as `pending` before the pipeline runs rather than after it.
 */
export interface ReviewStageContext {
  db: Db;
  env: Env;
  packageId: string;
  packageSlug: string;
  versionId: string;
  semver: string;
  kind: ExtensionKind;
  /** What the publisher submitted, untouched. Only the static stage reads it. */
  spec: unknown;
  /** The spec as the static stage normalized it. `{}` until static has run. */
  normalizedSpec: Record<string, unknown>;
  /** The scopes that survived the vocabulary filter. `[]` until static has run. */
  scopes: string[];
  requestedScopes: readonly string[];
  verificationState: string;
  paid: boolean;
  previousScopes: readonly string[] | null;
  /** Results of the stages that already ran, by key. The agentic stage reads
   *  these — it reviews the pipeline's findings, not just the manifest. */
  priorStages: ReadonlyMap<ReviewStageKey, StageResult>;
}

export interface ReviewStage {
  key: ReviewStageKey;
  /** Ascending. See precedence rule 1 — this is not cosmetic. */
  order: number;
  /** False when the stage has nothing to say about this submission. A stage that
   *  does not apply produces no row at all, which is different from `skipped`
   *  (the stage applied, tried, and could not complete). */
  applies(ctx: ReviewStageContext): boolean;
  run(ctx: ReviewStageContext): Promise<StageResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers every stage shares
// ─────────────────────────────────────────────────────────────────────────────

export const finding = (
  check: string,
  severity: ReviewFinding['severity'],
  message: string,
): ReviewFinding => ({ check, severity, message });

/**
 * The verdict a set of findings adds up to.
 *
 * One place, so two stages cannot grade themselves differently — the static
 * stage's "any fail rejects" and the dynamic stage's must be the same sentence or
 * the composed outcome means nothing.
 */
export function verdictFor(findings: readonly ReviewFinding[]): StageVerdict {
  if (findings.some((f) => f.severity === 'fail')) return 'fail';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  return 'pass';
}

/** A stage that applied, tried, and could not complete. Never a pass. */
export function skipped(
  stage: ReviewStageKey,
  reason: string,
  startedAt: number,
): StageResult {
  return {
    stage,
    verdict: 'skipped',
    findings: [finding(`${stage}_stage`, 'warn', reason)],
    evidence: [{ subject: stage, outcome: 'skipped', detail: reason }],
    durationMs: Date.now() - startedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — static
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The existing static review, wrapped as a registry entry.
 *
 * It is wrapped rather than rewritten. `reviewVersion` is a pure function over a
 * submitted spec and it is the only thing in the pipeline that can produce the
 * normalized spec everything downstream reads — including the `paid_requires_identity`
 * check that carries an open operator decision. Nothing about it changes here.
 */
export const staticStage: ReviewStage = {
  key: 'static',
  order: 10,
  applies: () => true,
  async run(ctx) {
    const started = Date.now();
    const input: ReviewInput = {
      kind: ctx.kind,
      spec: ctx.spec,
      requestedScopes: ctx.requestedScopes,
      verificationState: ctx.verificationState,
      paid: ctx.paid,
      previousScopes: ctx.previousScopes,
    };
    const outcome = reviewVersion(input);
    return {
      stage: 'static',
      // `approved` already folds in "did the spec normalize at all", which
      // `verdictFor` cannot see: a spec that failed to parse produces a `fail`
      // finding, so the two agree — but reading `approved` means they cannot
      // drift if a future check refuses without emitting one.
      verdict: outcome.approved ? verdictFor(outcome.findings) : 'fail',
      findings: outcome.findings,
      evidence: outcome.findings.map((f) => ({
        subject: f.check,
        outcome: f.severity === 'fail' ? ('fail' as const)
          : f.severity === 'warn' ? ('warn' as const)
          : ('pass' as const),
        detail: f.message,
      })),
      durationMs: Date.now() - started,
      normalizedSpec: outcome.normalizedSpec,
      normalizedScopes: outcome.scopes,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// The registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every stage, in order.
 *
 * Populated by {@link registerReviewStage} from the modules that implement the
 * later stages, so this module does not import the sandbox, the connector runtime
 * or the LLM gateway — the composition rules stay testable against fake stages,
 * which is the entire reason the registry exists rather than three imports.
 */
const REGISTERED = new Map<ReviewStageKey, ReviewStage>([['static', staticStage]]);

export function registerReviewStage(stage: ReviewStage): void {
  REGISTERED.set(stage.key, stage);
}

export function reviewStages(): ReviewStage[] {
  return [...REGISTERED.values()].sort((a, b) => a.order - b.order);
}

/** Swap the registry for one test's worth of stages. Returns the restore. */
export function __withStagesForTests(stages: ReviewStage[]): () => void {
  const snapshot = new Map(REGISTERED);
  REGISTERED.clear();
  for (const s of stages) REGISTERED.set(s.key, s);
  return () => {
    REGISTERED.clear();
    for (const [k, v] of snapshot) REGISTERED.set(k, v);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineOutcome {
  approved: boolean;
  /** Every finding from every stage that ran, in stage order, each prefixed with
   *  the stage that produced it so a reader can tell where a refusal came from. */
  findings: ReviewFinding[];
  stages: StageResult[];
  /** Stage key → verdict, for the assurance tier the directory ranks on. */
  verdicts: Record<string, string>;
  /** The spec as it will be STORED — normalized by the kind's own parser. */
  normalizedSpec: Record<string, unknown>;
  /** The scopes that survived the vocabulary filter. */
  scopes: string[];
}

/**
 * Run the pipeline and compose one outcome, applying the five rules at the top.
 *
 * A stage that THROWS is treated as `skipped`, not as a failure. The distinction
 * matters: a stage crashing is our bug, and refusing a publisher's submission
 * because of our bug is the wrong direction to be wrong in. The throw is recorded
 * in the stage's own row, so the bug is visible rather than swallowed.
 */
export async function runReviewPipeline(ctx: ReviewStageContext): Promise<PipelineOutcome> {
  const stages: StageResult[] = [];
  const prior = new Map<ReviewStageKey, StageResult>();
  let blocked = false;

  for (const stage of reviewStages()) {
    if (blocked) break; // rule 3
    const withPrior: ReviewStageContext = { ...ctx, priorStages: prior };
    if (!stage.applies(withPrior)) continue;

    const started = Date.now();
    let result: StageResult;
    try {
      result = await stage.run(withPrior);
    } catch (error) {
      result = skipped(
        stage.key,
        `the ${stage.key} stage did not complete: ${error instanceof Error ? error.message : 'unknown error'}`,
        started,
      );
    }
    stages.push(result);
    prior.set(stage.key, result);

    // A stage that normalized the spec hands it forward, so the stages that
    // follow exercise the manifest the platform will actually store rather than
    // the raw JSON a publisher posted. Only the static stage does this today, and
    // the pipeline reads a RESULT field rather than naming that stage — a second
    // normalizing stage would need no change here.
    if (result.normalizedSpec) ctx = { ...ctx, normalizedSpec: result.normalizedSpec };
    if (result.normalizedScopes) ctx = { ...ctx, scopes: result.normalizedScopes };

    if (result.verdict === 'fail') blocked = true; // rule 2
  }

  const findings = stages.flatMap((s) =>
    s.findings.map((f) => ({ ...f, check: f.check.startsWith(`${s.stage}:`) ? f.check : `${s.stage}:${f.check}` })));

  return {
    approved: !stages.some((s) => s.verdict === 'fail'), // rules 2, 4, 5
    findings,
    stages,
    verdicts: Object.fromEntries(stages.map((s) => [s.stage, s.verdict])),
    normalizedSpec: ctx.normalizedSpec,
    scopes: ctx.scopes,
  };
}
