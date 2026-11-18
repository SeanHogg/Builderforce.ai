/**
 * Evidence ranks the models it MEASURED. It cannot demote a stronger model it never did.
 *
 * Learned ranking puts every model with enough evidence ahead of every model without it
 * (`rankModelsForAction`: eligible, then the rest). On its own that is self-sealing: the
 * model that served most turns gathers the evidence, so it keeps leading, so it keeps
 * gathering it. A tenant whose STANDARD-tier MiniMax had served hundreds of coding turns
 * would never see a connected ULTRA coder lead a coding turn, because the coder had never
 * been tried and so had nothing to be ranked by (VS Code chat #6: a whole night of `code`
 * turns on MiniMax Flash with Grok connected).
 *
 * So, for a role that pulls toward the STRONGEST model, an untried model whose tier is
 * stronger than every measured one keeps its place ahead of the measured ones. Once it has
 * run enough to be measured, the evidence decides like any other model's. Models the
 * evidence measured keep exactly the order it gave them, across tiers: a PREMIUM model
 * that delivered still beats an ULTRA one that did not. A chronically rate-limited model
 * counts as measured, so a stronger account the provider keeps refusing is not lifted.
 *
 * "Stronger" is the ROLE's own measure: for a role with a model ladder (plan, review,
 * code — {@link ladderKey}) it is the ladder rung, then the tier within a rung; otherwise
 * the tier alone. So on a code turn an untried Opus is NOT lifted over a measured Sonnet —
 * the code ladder ranks Sonnet the better coder per cost — while an untried Sonnet is lifted
 * over a measured MiniMax.
 *
 * Cost-first and balanced roles are returned untouched. Pure; never adds or drops a model.
 */

import {
  DEFAULT_MIN_SAMPLES,
  isChronicallyRateLimited,
  qualityEvidence,
  type ActionModelRankStat,
} from '@builderforce/learned-routing';
import { tierRank, type CatalogView } from '@builderforce/model-catalog';
import { BALANCED_OBJECTIVE_THRESHOLD } from './objective.js';
import { ladderKey } from './orderForRole.js';

export function liftUntriedStronger(
  learned: readonly string[],
  stats: ReadonlyArray<ActionModelRankStat> | undefined,
  objective: number,
  view: CatalogView,
  minSamples: number = DEFAULT_MIN_SAMPLES,
  role?: string,
): string[] {
  if (objective < BALANCED_OBJECTIVE_THRESHOLD || !stats?.length) return [...learned];
  const statOf = new Map(stats.map((s) => [s.model, s]));
  const measured = (m: string): boolean => {
    const s = statOf.get(m);
    return !!s && (qualityEvidence(s) >= minSamples || isChronicallyRateLimited(s));
  };
  const rung = ladderKey(view, role);
  // Lower is stronger: [ladder rung (0 when the role has none), tier rank].
  const strength = (m: string): [number, number] => [rung ? rung(m) : 0, tierRank(view.tierOf(m))];
  const stronger = (a: [number, number], b: [number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const measuredStrengths = learned.filter(measured).map(strength);
  if (measuredStrengths.length === 0) return [...learned];
  const strongestMeasured = measuredStrengths.reduce((best, s) => (stronger(s, best) ? s : best));
  const lifted = learned.filter((m) => !measured(m) && stronger(strength(m), strongestMeasured));
  if (lifted.length === 0) return [...learned];
  return [...lifted, ...learned.filter((m) => !lifted.includes(m))];
}
