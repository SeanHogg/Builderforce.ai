/**
 * The blueprint catalog and the matcher.
 *
 * Shipped as CODE for the same reason the connector defaults are: a blueprint is
 * a set of facts that gets CORRECTED (an API changes a required field, a verb
 * gets deprecated), and a seeded copy per tenant would strand every tenant
 * created before the fix on the broken version.
 */

import {
  MATCH_THRESHOLD,
  requiresSignal,
  scoreBlueprint,
  type Blueprint,
  type BlueprintMatch,
  type Capability,
} from '../blueprint';
import { genericBlueprint } from './generic';
import { shopifyOrdersBlueprint } from './shopifyOrders';
import { stripeDunningBlueprint } from './stripeDunning';
import { supportTriageBlueprint } from './supportTriage';
import { twilioOmnichannelBlueprint } from './twilioOmnichannel';

/** Blueprints eligible for matching. `generic` is excluded — it is the fallback. */
const SPECIFIC: readonly Blueprint[] = [
  twilioOmnichannelBlueprint,
  stripeDunningBlueprint,
  supportTriageBlueprint,
  shopifyOrdersBlueprint,
];

/** Every blueprint, including the fallback, for the catalog UI. */
export const BLUEPRINTS: readonly Blueprint[] = [...SPECIFIC, genericBlueprint];

export const BLUEPRINTS_BY_KEY: ReadonlyMap<string, Blueprint> = new Map(BLUEPRINTS.map((b) => [b.key, b]));

export function blueprintByKey(key: string | null | undefined): Blueprint | null {
  return (key && BLUEPRINTS_BY_KEY.get(key)) || null;
}

/**
 * Pick the blueprint for a brief.
 *
 * Returns the best SPECIFIC match when it clears {@link MATCH_THRESHOLD}, else
 * generic. The runners-up come back too: the challenge page shows them, because
 * "we considered the Twilio blueprint and scored it 0.4" is the answer to "why
 * did it build that?" — and the alternative, a silent choice, is the thing that
 * makes a generated plan impossible to trust.
 */
export function matchBlueprint(
  capabilities: readonly Capability[],
  briefText: string,
): { chosen: BlueprintMatch; considered: BlueprintMatch[] } {
  const considered = SPECIFIC.map((b) => scoreBlueprint(b, capabilities, briefText)).sort((a, b) => b.score - a.score);
  // Both bars, in this order: the brief must NAME the thing, and the shape must
  // fit. Score alone would let a "payments and email" brief land on Stripe.
  const eligible = considered.filter((m) => !requiresSignal(m));
  const best = eligible[0];
  if (best && best.score >= MATCH_THRESHOLD) return { chosen: best, considered };

  const topScorer = considered[0];
  const reason = best
    ? `No blueprint scored above ${MATCH_THRESHOLD} (best was ${best.blueprint.name} at ${best.score.toFixed(2)}); designing from the brief instead.`
    : topScorer
      ? `${topScorer.blueprint.name} fits the shape of this brief but the brief never names it, so it was not assumed; designing from the brief instead.`
      : 'No specific blueprint matched; designing from the brief instead.';

  return {
    chosen: {
      blueprint: genericBlueprint,
      score: best?.score ?? 0,
      reasons: [reason],
      matchedCapabilities: [],
      missingCapabilities: [...capabilities],
      signalHits: [],
    },
    considered,
  };
}

export {
  genericBlueprint,
  shopifyOrdersBlueprint,
  stripeDunningBlueprint,
  supportTriageBlueprint,
  twilioOmnichannelBlueprint,
};
