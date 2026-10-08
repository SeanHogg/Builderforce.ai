import { apiRequest } from './apiClient';

/** Mirrors `PlatformProof` in `api/src/application/marketing/platformProof.ts`. */
export interface PlatformProof {
  builders: number;
  buildersThisWeek: number;
  projects: number;
  agentRunsCompleted: number;
  asOf: string;
}

let request: Promise<PlatformProof> | null = null;

/** One in-browser request shared by every proof surface on the page. The API
 *  serves it from a one-hour cache and HTTP caching covers later page loads. */
export function fetchPlatformProof(): Promise<PlatformProof> {
  if (!request) {
    request = apiRequest<PlatformProof>('/api/public/proof', { auth: 'none' })
      .catch((error) => { request = null; throw error; });
  }
  return request;
}

/**
 * Display floors. A count below its floor is not shown at all — a small number
 * is weak social proof, and the honest alternative to inflating it is silence.
 * The floors decide WHICH real numbers appear, never what they say.
 */
export const PROOF_FLOORS = {
  builders: 100,
  buildersThisWeek: 10,
  projects: 100,
  agentRunsCompleted: 500,
} as const satisfies Record<Exclude<keyof PlatformProof, 'asOf'>, number>;

export type ProofMetric = keyof typeof PROOF_FLOORS;

/** The metrics clearing their floor, in display order. */
export function visibleProofMetrics(proof: PlatformProof): ProofMetric[] {
  return (Object.keys(PROOF_FLOORS) as ProofMetric[]).filter((metric) => proof[metric] >= PROOF_FLOORS[metric]);
}
