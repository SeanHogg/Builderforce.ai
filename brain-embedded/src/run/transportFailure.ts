/**
 * A provider failure the agent's model policy may route around, as the Brain's transport hands it over (PRD 35 §6.8): the error the
 * stream threw, classified once (`providerFailureEvent`) as the run policy's own `transport_failed` event. The agent (`recoverFailure`,
 * `policy/model/failure.ts`) decides whether another model takes over, the gateway's pool is asked again without the broken one, or the
 * turn is lost; the Brain only records what it decided (`brainTurn.ts`). The original error stays on the turn's record
 * (`LastTurn.failing` → `LastTurn.error`), so a lost turn fails the run with the very object the stream threw.
 */

import type { ModelTransportFailure, TransportFailure } from '@builderforce/agent-run';

/** The error the transport throws for a classified provider failure. Its message is the original's. */
export class BrainTransportFailure extends Error implements ModelTransportFailure {
  readonly failure: TransportFailure;
  readonly original: unknown;

  constructor(original: unknown, failure: TransportFailure) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'BrainTransportFailure';
    this.failure = failure;
    this.original = original;
  }
}
