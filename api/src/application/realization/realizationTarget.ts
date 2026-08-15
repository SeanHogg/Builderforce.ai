/**
 * RealizationTarget — the port for "what does REAL mean this time?".
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * The challenge pipeline could take a brief and produce ONE thing: a working
 * webhook system with a live ingress. That is the most expensive proof there is,
 * and for most of the questions a business actually has to answer it is the
 * wrong one. "Can you show me?" does not need a running system. "Does anyone
 * want this?" is answered by a landing page and a number, and answering it with
 * a built system is how six weeks get spent on something nobody asked for.
 *
 * So there is not one answer to "make it real" — there are several, they differ
 * in FIDELITY and in COST, and choosing between them is the single most
 * consequential decision in the first month of any idea. Each is declared here
 * as data plus one function, so adding a ninth is an entry in a registry rather
 * than a branch in a builder.
 *
 * ── WHY A TARGET PRODUCES A PLAN FRAGMENT AND NOT A PROJECT ─────────────────
 * A target returns files, handlers, tickets, connectors, secrets and acceptance
 * criteria — exactly the shape a {@link ChallengePlan} already carries — and
 * `materializeChallenge` writes it. That is deliberate: the canvas write path,
 * the idempotent ticket seeding, the auto-run gate and the readiness list are
 * all hard-won and already correct, and a second materialiser would be a second
 * set of rules about when the platform may spend a customer's run budget.
 *
 * ── WHY EVERY TARGET CARRIES A KILL CONDITION ───────────────────────────────
 * `successCriteria` on a proof is not decoration. A smoke test with no number
 * that would stop the project is not a test, it is a landing page; a pilot with
 * no exit criteria never ends. Each target states what would have to be true,
 * and states it before the thing is built rather than after the result is in.
 */

import type { BackendStrategyKey } from '../backend/hostingStrategy';
import type { Capability, BlueprintTask, RequiredConnector, RequiredSecret } from '../challenge/blueprint';
import type { ChallengeSpec } from '../challenge/parseBrief';

/**
 * The ways an idea can be made real.
 *
 * Ordered by fidelity, because that is the order a sensible team walks them: you
 * do not build the system to find out whether anyone wants it.
 */
export const REALIZATION_KEYS = [
  'demo-video',
  'clickable-prototype',
  'smoke-test',
  'wizard-of-oz',
  'poc',
  'pilot',
  'phone-line',
  'live-system',
] as const;
export type RealizationKey = (typeof REALIZATION_KEYS)[number];

export function isRealizationKey(v: unknown): v is RealizationKey {
  return typeof v === 'string' && (REALIZATION_KEYS as readonly string[]).includes(v);
}

/** Everything a target is given about the idea it is making real. */
export interface RealizeContext {
  spec: ChallengeSpec;
  /**
   * The public base this project's handlers answer on. Substituted into
   * generated pages at materialise time, so a console knows its own backend.
   */
  ingressUrl: string;
}

/**
 * What a target produces. Every field is a {@link ChallengePlan} field, so the
 * result overlays a plan rather than needing a parallel materialiser.
 */
export interface RealizationOutput {
  /** One sentence: what will exist when this is built. */
  summary: string;
  /** Non-handler canvas files — pages, scripts, charters. */
  files: Record<string, string>;
  /** `handlers/<name>.json` documents, as objects. */
  handlers: Record<string, unknown>;
  tasks: BlueprintTask[];
  requiredConnectors: RequiredConnector[];
  requiredSecrets: RequiredSecret[];
  /**
   * Site collections this proof's forms write to.
   *
   * Declared rather than created by the target, because creating one needs a
   * published site and a target is a pure function. The service creates them
   * after publishing — a landing page whose form 404s because nobody clicked
   * "add collection" is a smoke test that measures zero demand for a working
   * idea, which is the worst failure this whole feature could have.
   */
  requiredCollections: string[];
  /** What must be demonstrably true for this proof to have paid for itself. */
  successCriteria: string[];
}

export interface RealizationTarget {
  key: RealizationKey;
  /** Short name, e.g. "Demo video". */
  name: string;
  /** One line on what it is. */
  summary: string;
  /**
   * The question a stakeholder is really asking when they ask for this. The
   * single most useful thing on the card: picking a proof is choosing which
   * question you are willing to spend money answering.
   */
  answers: string;
  /** 1 = a sketch of the idea, 5 = the thing itself, in production. */
  fidelity: 1 | 2 | 3 | 4 | 5;
  /** 1 = an afternoon, 5 = weeks of real engineering. */
  effort: 1 | 2 | 3 | 4 | 5;
  /**
   * Capabilities that make this target especially worth offering for a brief.
   * Empty means "always applicable" — a demo video is never wrong to make.
   */
  suits: readonly Capability[];
  /**
   * Where the server-side half runs. `null` means this proof has no backend at
   * all, which is a feature: a clickable prototype that needs a deploy is not a
   * prototype.
   */
  strategy: BackendStrategyKey | null;
  /**
   * True when this target is the whole system rather than a stand-in, and should
   * therefore build ON TOP of whatever the brief's blueprint already planned
   * instead of replacing it.
   */
  extendsBriefPlan?: boolean;
  /**
   * True when the caller may choose WHERE the backend runs.
   *
   * Only the full system offers this. A smoke test that asked which cloud to
   * deploy the landing page into would have missed the point of a smoke test —
   * and the whole reason the platform-hosted default exists is that a proof
   * should never wait on a procurement decision.
   */
  allowsStrategyChoice?: boolean;
  build(ctx: RealizeContext): RealizationOutput;
}

/**
 * How well a target fits a brief, and why.
 *
 * Recommendation is explained rather than ranked silently for the same reason
 * blueprint matching is: "we suggest a smoke test" is advice a founder should be
 * able to argue with, and a score with no reasons is not advice, it is a verdict.
 */
export interface RealizationRecommendation {
  key: RealizationKey;
  /** 0–1. Fit for THIS brief, not a quality judgement on the target. */
  score: number;
  reasons: string[];
  /** True for the single target this brief should start with. */
  recommended: boolean;
}
