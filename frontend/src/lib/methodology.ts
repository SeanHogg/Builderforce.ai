/**
 * THE methodology registry — "Idea to Real", declared once.
 *
 * The product already had the methodology; nothing said it out loud. The arc
 * (`STAGES` in `navGroups.ts`) decides how the left panel groups, the Product ▾
 * menu and the `/features` table. The loop (`api/src/application/realization/`)
 * decides what actually happens when somebody presses the button. But a visitor
 * reading `/features`, `/pricing`, `/about` or `/sell-builderforce` met four
 * different descriptions of the same company, none of which named the method.
 *
 * So the method is declared HERE, as spec data, and the four marketing surfaces
 * render it through one component (`components/marketing/MethodologySection`).
 * The alternative — four hand-written retellings — is exactly the failure
 * `check-destinations` exists to stop one layer down: the same thing existing
 * four times under four names, drifting the moment one of them is edited.
 *
 * ── THE TWO HALVES ──────────────────────────────────────────────────────────
 *
 *   THE ARC   Idea → Make → Run → Measure (→ Market → Expand)
 *             Where you are. Owned by `STAGES`; this file does not restate it,
 *             it points at it, so a seventh stage cannot appear in one place and
 *             not the other.
 *
 *   THE LOOP  Read → Prove → Build
 *             What you DO to cross from Idea into Make. Three acts, and the
 *             middle one is the whole opinion: reading an idea is cheap,
 *             building is not, and choosing which proof is worth running is the
 *             most consequential decision in the first month of anything.
 *
 * The loop does not end at Build. Every proof carries a KILL CONDITION — the
 * number that would stop the project — and that number is graded in MEASURE,
 * which is what closes the loop back to Idea. A proof with no condition that
 * could fail is not a proof, it is a launch with extra steps.
 *
 * ── WHY THE PROOF CATALOG IS MIRRORED AND NOT IMPORTED ──────────────────────
 * The eight targets are declared in the API (`realization/targets/*`), which a
 * static, signed-out marketing page cannot import and must not have to call.
 * `RealizationKey` is already mirrored in `lib/builderforceApi.ts`, so the KEYS
 * are type-checked against that union here; the two numbers each row carries are
 * asserted equal to the API's own by `scripts/check-methodology.mjs`, wired into
 * `npm test`. A mirror with a ratchet is a mirror; a mirror without one is a
 * second source of truth.
 */

import type { RealizationKey } from './builderforceApi';
import type { Stage } from './navGroups';

/**
 * The inner loop, in order. These are the same three words the Learn ▾ menu
 * columns already use (`--stage-read` / `--stage-prove` / `--stage-buildWith`
 * in globals.css) — deliberately, because they name the same three postures.
 */
export const METHOD_STEPS = ['read', 'prove', 'build'] as const;
export type MethodStep = (typeof METHOD_STEPS)[number];

export interface MethodStepSpec {
  id: MethodStep;
  /** Rendered through `<Icon>`; one glyph, no icon set. */
  icon: string;
  /** The custom property carrying this step's hue. Declared in globals.css. */
  hueVar: string;
  /** Where in the arc this act happens, so the loop and the arc line up. */
  stage: Stage;
  /**
   * Whether this act can spend anything — run budget, an agent, a deploy.
   * Read and Prove cannot, and saying so is the point: the two acts that decide
   * whether the expensive one is worth doing are both free.
   */
  spends: boolean;
}

export const METHOD_STEP_SPECS: readonly MethodStepSpec[] = [
  { id: 'read', icon: '📖', hueVar: '--stage-read', stage: 'idea', spends: false },
  { id: 'prove', icon: '🎯', hueVar: '--stage-prove', stage: 'idea', spends: false },
  { id: 'build', icon: '🔨', hueVar: '--stage-buildWith', stage: 'make', spends: true },
];

/**
 * Where the loop closes. A proof's success criteria is a number, and a number
 * belongs to Measure — which then hands the answer back to Idea.
 */
export const LOOP_CLOSES_IN: Stage = 'measure';

/**
 * The four stages the method is normally SOLD as.
 *
 * A subset of `STAGES`, and a subset with a reason rather than an omission:
 * Market and Expand are what a business does once it has something that works,
 * and Admin is settings. Somebody deciding whether to start is choosing between
 * these four. `/features` still renders the whole arc from `STAGES` — this list
 * is for the surfaces that have one paragraph, not a table.
 */
export const METHOD_STAGES: readonly Stage[] = ['idea', 'make', 'run', 'measure'];

/**
 * One way to make an idea real.
 *
 * `fidelity` and `effort` are the two axes the choice actually turns on, and
 * they are here rather than in copy because a marketing page that ranked these
 * differently from the product's own recommender would be advertising different
 * advice than the product gives.
 */
export interface ProofForm {
  key: RealizationKey;
  /** 1 = a sketch of the idea, 5 = the thing itself, in production. */
  fidelity: 1 | 2 | 3 | 4 | 5;
  /** 1 = an afternoon, 5 = weeks of real engineering. */
  effort: 1 | 2 | 3 | 4 | 5;
  /** True when this proof publishes something at an address you can open. */
  live: boolean;
}

/**
 * The eight, in the order a sensible team walks them — cheapest first. That
 * ordering IS the advice: you do not build the system to find out whether
 * anyone wants it.
 */
export const PROOF_FORMS: readonly ProofForm[] = [
  { key: 'demo-video', fidelity: 1, effort: 1, live: false },
  { key: 'clickable-prototype', fidelity: 2, effort: 2, live: false },
  { key: 'smoke-test', fidelity: 2, effort: 2, live: true },
  { key: 'wizard-of-oz', fidelity: 3, effort: 2, live: true },
  { key: 'poc', fidelity: 3, effort: 3, live: true },
  { key: 'pilot', fidelity: 4, effort: 4, live: true },
  { key: 'phone-line', fidelity: 4, effort: 3, live: true },
  { key: 'live-system', fidelity: 5, effort: 5, live: true },
];

/** i18n key for a step's copy field, under the `methodology` namespace. */
export function methodStepKey(step: MethodStep, field: 'title' | 'question' | 'body'): string {
  return `step.${step}.${field}`;
}

/** i18n key for a proof form's copy field, under the `methodology` namespace. */
export function proofFormKey(key: RealizationKey, field: 'name' | 'question' | 'summary'): string {
  return `proof.${key}.${field}`;
}

/**
 * The proofs ordered the way the product's recommender orders them: cheap
 * before expensive, and fidelity only as a tie-break. Mirrors the intent of
 * `recommendRealizations` without pretending to know a brief — the marketing
 * surfaces have no spec to rank against, so they show the standing order.
 */
export function proofsByCost(): readonly ProofForm[] {
  return [...PROOF_FORMS].sort((a, b) => a.effort - b.effort || a.fidelity - b.fidelity);
}
