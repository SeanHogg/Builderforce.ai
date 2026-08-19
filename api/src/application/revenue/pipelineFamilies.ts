/**
 * WHICH pipeline a deal is on — the one place the answer is written.
 *
 * ── WHY A REGISTRY AND NOT A SECOND ENGINE ───────────────────────────────────
 * PRD 20 §3.3 adjudicated this exactly once: "a sales deal, a recruiter placement
 * fee and an investor allocation are one shape with three kinds". `deals` already
 * carries the `kind` column that decision produced. What did NOT exist was a name
 * for the GROUPS those kinds fall into, so the projection hard-coded the four
 * sales kinds in a private constant and a fundraise board had nowhere to be read
 * from — which is why `fundingRound.investors` was a hand-typed rows table sitting
 * beside a CRM that already knew how to hold a pipeline.
 *
 * A family is therefore DATA: its kinds, its fallback ladder, the two terminal
 * stages, what a lane means and which `party_roles` role its counterparty holds.
 * Adding "the recruiter's placement board" is one entry here, not a second engine
 * and not a branch inside the first one (open/closed — the same rule
 * `pipeline_stages` itself is a lookup table for).
 *
 * ── WHY THE LADDERS DIFFER AND THE TERMINALS ARE DECLARED ────────────────────
 * `pipeline_stages` is the tenant's own vocabulary and always wins. A family's
 * ladder is what the board draws BEFORE the tenant has an opinion — and a raise
 * does not have a "proposal" stage, it has diligence and a wire. The two terminal
 * stages are named rather than positional because `deals.outcome` is derived from
 * them: a deal dragged into the won stage must be counted as won by every report
 * on the platform, and "the last two entries" is not a contract a renamed ladder
 * would keep.
 */

import type { PartyRole } from '@builderforce/creation-canvas-contract';

export const PIPELINE_FAMILY_KEYS = ['sales', 'raise'] as const;
export type PipelineFamilyKey = typeof PIPELINE_FAMILY_KEYS[number];

export type LaneBy = 'source' | 'owner' | 'none';

export interface PipelineFamily {
  key: PipelineFamilyKey;
  /** `deals.kind` values this family covers. Disjoint across families by
   *  construction — {@link familyForDealKind} depends on it. */
  kinds: readonly string[];
  /** What the board draws before the tenant has declared `pipeline_stages`. */
  fallbackStages: readonly string[];
  /** The stage that means `outcome = 'won'` in the fallback ladder. */
  wonStage: string;
  /** The stage that means `outcome = 'lost'`. */
  lostStage: string;
  /** What a swimlane segments by when the caller does not say. A raise is not
   *  segmented by lead source — every investor came from a person — so it opens
   *  as one board rather than one lane per empty string. */
  defaultLaneBy: LaneBy;
  /** The role this family's counterparty holds in `party_roles` (FO-A1). */
  partyRole: PartyRole;
}

/**
 * The two families that exist today.
 *
 * `placement` is deliberately in NEITHER: a recruiter placement fee rides the same
 * table (PRD 20 §3.3) and is not a sales pipeline, and projecting it onto one would
 * inflate the single number a sales board exists to show. It gets a family when the
 * placement board is built, which is one entry here.
 */
export const PIPELINE_FAMILIES: Readonly<Record<PipelineFamilyKey, PipelineFamily>> = {
  sales: {
    key: 'sales',
    kinds: ['sales', 'renewal', 'expansion', 'partner'],
    // The SAME seven the canvas's `DEFAULT_PIPELINE_STAGES` carries — held to it by
    // `pipelineProjection.test.ts`, which reads the other file off disk. A silent
    // divergence would mean a card dropped into a stage the API refuses.
    fallbackStages: ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost'],
    wonStage: 'won',
    lostStage: 'lost',
    defaultLaneBy: 'source',
    partyRole: 'customer',
  },
  raise: {
    key: 'raise',
    kinds: ['investment'],
    // A raise ladder, not a sales one. `committed` is a soft circle — the money is
    // promised and has not moved — and `closed` is the wire, which is why the two are
    // separate stages rather than one optimistic column: a founder who counts
    // commitments as cash is the failure this board exists to make visible.
    fallbackStages: ['sourced', 'contacted', 'pitched', 'diligence', 'committed', 'closed', 'passed'],
    wonStage: 'closed',
    lostStage: 'passed',
    defaultLaneBy: 'none',
    partyRole: 'investor',
  },
};

export const isPipelineFamilyKey = (value: unknown): value is PipelineFamilyKey =>
  typeof value === 'string' && (PIPELINE_FAMILY_KEYS as readonly string[]).includes(value);

/** The family a caller asked for, defaulting to sales — what `/api/pipeline` with
 *  no query parameter has always meant. */
export const pipelineFamily = (value: unknown): PipelineFamily =>
  PIPELINE_FAMILIES[isPipelineFamilyKey(value) ? value : 'sales'];

/**
 * The family a DEAL belongs to, read off its own `kind`.
 *
 * This is what lets one move endpoint serve both boards: the caller does not say
 * which pipeline it is moving a deal on, because the deal already knows — and a
 * caller that could say would be a caller that could say the wrong one.
 *
 * Null for a kind no family covers (`placement`), which callers surface as "this
 * deal is not on a board" rather than quietly projecting it onto the sales one.
 */
export function familyForDealKind(kind: string): PipelineFamily | null {
  return Object.values(PIPELINE_FAMILIES).find((family) => family.kinds.includes(kind)) ?? null;
}

/** What landing in `stage` means for `deals.outcome`, under a family's OWN fallback
 *  ladder. Used only when the tenant has declared no `pipeline_stages` — theirs
 *  carry an `outcome` column and always win. */
export function fallbackOutcome(family: PipelineFamily, stage: string): 'open' | 'won' | 'lost' {
  if (stage === family.wonStage) return 'won';
  if (stage === family.lostStage) return 'lost';
  return 'open';
}
