/**
 * What a plan buys an architecture analysis.
 *
 * This used to live private inside AnalysisRunnerDO, which made "which artifact
 * kinds is this tenant entitled to?" a question only the Durable Object could
 * answer. The retry path has to ask exactly the same question — a `skipped`
 * artifact is retryable precisely when the tenant's CURRENT plan now covers its
 * kind — so the rule moved down here rather than being written a second time.
 *
 * Pure: no env, no database. The caller resolves the effective plan (see
 * `resolveAnalysisPlan` in `repos/architectRunner`) and passes the string in.
 */
import { ARTIFACT_KINDS, FREE_ARTIFACT_KINDS, type ArtifactKind } from './types';

export interface AnalysisPlanConfig {
  /** Ceiling on total LLM tokens the whole run may spend. */
  tokenBudget: number;
  /** The artifact kinds this plan generates; everything else is recorded `skipped`. */
  artifactKinds: ArtifactKind[];
  /** How many files per repo may be sampled as evidence. */
  maxFilesPerRepo: number;
  /** Token ceiling on the evidence sampled from one repo. */
  evidenceTokensPerRepo: number;
}

/** Plans that get the full six-artifact report. */
const PAID_PLANS = new Set(['pro', 'teams']);

/** The entitlement config for an effective plan string. PURE. */
export function analysisPlanConfig(plan: string): AnalysisPlanConfig {
  const paid = PAID_PLANS.has(plan);
  return {
    tokenBudget: paid ? 120_000 : 9_000,
    artifactKinds: paid ? [...ARTIFACT_KINDS] : [...FREE_ARTIFACT_KINDS],
    maxFilesPerRepo: paid ? 25 : 8,
    evidenceTokensPerRepo: paid ? 6_000 : 2_500,
  };
}

/** True when `plan` entitles the tenant to generate `kind`. PURE. */
export function planAllowsArtifact(plan: string, kind: ArtifactKind): boolean {
  return analysisPlanConfig(plan).artifactKinds.includes(kind);
}
