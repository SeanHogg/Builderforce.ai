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
  scoreBlueprint,
  type Blueprint,
  type BlueprintMatch,
  type Capability,
} from '../blueprint';
import { genericBlueprint } from './generic';
import { twilioOmnichannelBlueprint } from './twilioOmnichannel';

/** Blueprints eligible for matching. `generic` is excluded — it is the fallback. */
const SPECIFIC: readonly Blueprint[] = [twilioOmnichannelBlueprint];

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
  const best = considered[0];
  if (best && best.score >= MATCH_THRESHOLD) return { chosen: best, considered };

  return {
    chosen: {
      blueprint: genericBlueprint,
      score: best?.score ?? 0,
      reasons: [
        best
          ? `No blueprint scored above ${MATCH_THRESHOLD} (best was ${best.blueprint.name} at ${best.score.toFixed(2)}); designing from the brief instead.`
          : 'No specific blueprint matched; designing from the brief instead.',
      ],
      matchedCapabilities: [],
      missingCapabilities: [...capabilities],
    },
    considered,
  };
}

export { genericBlueprint, twilioOmnichannelBlueprint };
