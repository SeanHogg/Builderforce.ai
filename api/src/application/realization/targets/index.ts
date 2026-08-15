/**
 * The realization catalog and the recommender.
 *
 * Shipped as CODE, like the blueprint catalog and the connector defaults, for
 * the same reason: a target is a set of facts about how a kind of proof is run,
 * and those facts get CORRECTED. A per-tenant seeded copy would strand every
 * workspace created before the fix on the version with the wrong advice.
 *
 * ── WHY THE RECOMMENDATION IS DELIBERATELY CONSERVATIVE ─────────────────────
 * The default recommendation is the CHEAPEST proof that fits, not the most
 * impressive one. That is the whole opinion of this feature: the expensive
 * failure in product development is not building the wrong thing slowly, it is
 * building the right-looking thing before finding out whether anyone wanted it.
 * A recommender that reached for `live-system` because a brief mentioned three
 * integrations would be a recommender that agrees with whatever the customer was
 * already going to do.
 */

import type { Capability } from '../../challenge/blueprint';
import type { ChallengeSpec } from '../../challenge/parseBrief';
import {
  REALIZATION_KEYS,
  type RealizationKey,
  type RealizationRecommendation,
  type RealizationTarget,
} from '../realizationTarget';
import { clickablePrototypeTarget } from './clickablePrototype';
import { demoVideoTarget } from './demoVideo';
import { liveSystemTarget } from './liveSystem';
import { phoneLineTarget } from './phoneLine';
import { pilotTarget } from './pilot';
import { pocTarget } from './poc';
import { smokeTestTarget } from './smokeTest';
import { wizardOfOzTarget } from './wizardOfOz';

/** Every target, in the order a sensible team walks them. */
export const REALIZATION_TARGETS: readonly RealizationTarget[] = [
  demoVideoTarget,
  clickablePrototypeTarget,
  smokeTestTarget,
  wizardOfOzTarget,
  pocTarget,
  pilotTarget,
  phoneLineTarget,
  liveSystemTarget,
];

const BY_KEY: ReadonlyMap<RealizationKey, RealizationTarget> = new Map(
  REALIZATION_TARGETS.map((t) => [t.key, t]),
);

export function realizationTargetByKey(key: string | null | undefined): RealizationTarget | null {
  if (!key) return null;
  return BY_KEY.get(key as RealizationKey) ?? null;
}

/**
 * Capability overlap is worth this much of the score; the rest is the standing
 * preference for a cheap proof over an expensive one.
 *
 * Weighted this way round on purpose. A brief that names `voice` genuinely does
 * point at the phone line — but a brief that names five capabilities points at
 * five targets, and without a cost term the recommendation would land on
 * whichever one happens to list the most of them, which is always the biggest.
 */
const FIT_WEIGHT = 0.6;

/**
 * A target with no `suits` list is not "a poor fit for everything" — it is
 * applicable everywhere. Scoring it as zero overlap would bury the demo video,
 * which is the correct first answer for most briefs.
 */
const UNIVERSAL_FIT = 0.5;

function fitFor(target: RealizationTarget, wanted: ReadonlySet<Capability>): { fit: number; matched: Capability[] } {
  if (target.suits.length === 0) return { fit: UNIVERSAL_FIT, matched: [] };
  const matched = target.suits.filter((c) => wanted.has(c));
  if (wanted.size === 0) return { fit: UNIVERSAL_FIT, matched: [] };
  return { fit: matched.length / target.suits.length, matched: [...matched] };
}

/**
 * Rank the targets for one brief.
 *
 * Every target comes back, always. This is advice about which proof to run
 * FIRST, not a filter — a founder who has already smoke-tested should be able to
 * pick the pilot without the platform hiding it, and hiding options is how a
 * recommender stops being advice and starts being a decision.
 */
export function recommendRealizations(spec: ChallengeSpec): RealizationRecommendation[] {
  const wanted = new Set(spec.capabilities);

  const scored = REALIZATION_TARGETS.map((target) => {
    const { fit, matched } = fitFor(target, wanted);
    // Cheap and low-fidelity scores HIGHER: this is a "what should you do next"
    // ranking, and next is almost never "build the whole thing".
    const cost = 1 - (target.effort - 1) / 4;
    const score = fit * FIT_WEIGHT + cost * (1 - FIT_WEIGHT);

    const reasons: string[] = [];
    if (matched.length) {
      reasons.push(`Fits ${matched.join(', ')} in this brief`);
    } else if (target.suits.length === 0) {
      reasons.push('Works for any brief');
    } else {
      reasons.push(`This brief does not name ${target.suits.slice(0, 3).join(', ')}`);
    }
    reasons.push(`Answers: ${target.answers}`);
    if (target.effort >= 4) reasons.push('Expensive — worth it only once something cheaper has said yes');

    const recommendation: RealizationRecommendation = {
      key: target.key,
      score: Number(score.toFixed(3)),
      reasons,
      recommended: false,
    };
    return recommendation;
  });

  scored.sort((a, b) => b.score - a.score || REALIZATION_KEYS.indexOf(a.key) - REALIZATION_KEYS.indexOf(b.key));
  if (scored[0]) scored[0].recommended = true;
  return scored;
}

export {
  clickablePrototypeTarget,
  demoVideoTarget,
  liveSystemTarget,
  phoneLineTarget,
  pilotTarget,
  pocTarget,
  smokeTestTarget,
  wizardOfOzTarget,
};
