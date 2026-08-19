/**
 * The loop, in the ledger.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * Read → Prove → Build → Measure was fully BUILT and entirely UNMEASURED. The
 * realization pipeline could read an idea, rank eight proofs, build the chosen
 * one, publish it and roll up the verdict its own console recorded — and none
 * of it reached the outcome ledger. So the platform could report how many
 * things were delivered and could not report the one number the method exists
 * to produce: the share of ideas that reached a proof whose KILL CONDITION was
 * actually measured. A deliverable nobody graded is a launch with extra steps,
 * and until now that was indistinguishable from the real thing in every rollup.
 *
 * ── WHY THE SESSION IS THE SUBJECT ──────────────────────────────────────────
 * The ledger's grain is the Creation Session, because that is the grain every
 * other metric, every baseline and every rollup already uses ("session, project,
 * tenant, platform"). A proof therefore records against the session whose idea
 * it is proving — `realizations.session_id`, set when the proof is started from
 * a board. A proof with no board records nothing: it is not a hole in the
 * measurement, it is an idea that never entered the ledger's grain, and
 * inventing a synthetic session for it would put a number in a denominator that
 * no scorecard could ever explain.
 *
 * ── WHY EVERY EMIT IS BEST-EFFORT ───────────────────────────────────────────
 * Measurement must never be able to fail a build. If the ledger write throws,
 * the proof still exists and the person still gets their URL; the loss shows up
 * honestly as `correlationCoverage` below 100%, which is exactly the metric that
 * exists to make missing instrumentation visible rather than invisible.
 */

import type { Db } from '../../infrastructure/database/connection';
import { recordOutcomeEvent } from '../outcomes/outcomeLedger';
import type { OutcomePhase } from '../outcomes/outcomeMetricContract';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** What a proof event needs to know about the idea it belongs to. */
export interface ProofSubject {
  /** The board this proof is of. `null` when the proof was started outside one. */
  sessionId: string | null;
  tenantId: number;
  /** Set once BUILT; the ledger accepts it because the realization owns it. */
  projectId?: number | null;
  /** The person who pressed the button, when there was one. */
  userId?: string | null;
}

export interface ProofOutcomeInput extends ProofSubject {
  /**
   * The realization id, so `started` and its terminal share a correlation. Read
   * and Prove happen before a row exists, so those carry the request's own id.
   */
  correlationId: string;
  action: 'idea.read' | 'proof.choose' | 'proof.build' | 'proof.grade';
  phase: OutcomePhase;
  /** The realization, once there is one — what the metric is ABOUT. */
  realizationId?: string | null;
  targetKey?: string | null;
  durationMs?: number | null;
  metricKey?: string | null;
  metricValue?: number | null;
  unit?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record one step of the loop. A no-op — deliberately silent — when the proof
 * has no board: the ledger only speaks in sessions.
 */
export async function recordProofOutcome(db: Db, input: ProofOutcomeInput): Promise<boolean> {
  if (!input.sessionId) return false;
  try {
    return await recordOutcomeEvent(db, {
      correlationId: input.correlationId,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      projectId: input.projectId ?? null,
      actorType: input.userId ? 'user' : 'system',
      actorRef: input.userId ?? 'realization',
      action: input.action,
      phase: input.phase,
      artifactId: input.realizationId ?? null,
      metricKey: input.metricKey ?? null,
      metricValue: input.metricValue ?? null,
      unit: input.unit ?? null,
      durationMs: input.durationMs ?? null,
      metadata: { ...(input.targetKey ? { targetKey: input.targetKey } : {}), ...(input.metadata ?? {}) },
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/realization/proofOutcomes.ts', operation: input.action });
    return false;
  }
}

/**
 * A proof reached a real, reachable artifact when it published something at an
 * address a person can open. `metadata.reachable` is what the Build family's
 * `reachableProofRate` counts, so it is derived HERE rather than by each caller
 * deciding for itself what "real" meant that day.
 */
export function proofReachable(liveUrl: string | null | undefined): boolean {
  return typeof liveUrl === 'string' && /^https?:\/\/\S+$/i.test(liveUrl.trim());
}
