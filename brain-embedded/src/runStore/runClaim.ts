/**
 * The claim on a chat's NEXT run - the one primitive that closes every window between "a run
 * ended" (or "a turn was handed to an idle chat") and "the next run is going".
 *
 * A continuation (`continueChat.ts`) has to save words, wait for the host's run-time parts, and only
 * then start - three awaits. Without a claim the chat looks idle across them: a person's message
 * launches a second run, a Stop is outrun, two continuations start two runs, and `startRun`'s
 * single-flight guard silently drops whichever lost. With the claim, taken SYNCHRONOUSLY before the
 * first await:
 *
 *  - the cell counts as LIVE (`isLive`), so every composer steers a person's message into the
 *    claimed run's inbox (it is read by the continuation run) instead of launching or holding it;
 *  - no other launch can take the chat (`startRun` refuses a start that does not hold the claim);
 *  - a Stop - on an idle cell too (`RunCell.stopEpoch`) - is seen at each await boundary
 *    (`claimStopped`): the saved rows stay, nothing starts, the claim is released;
 *  - a run started UNDER the claim consumes it (`beginRun`); every other exit releases it.
 */

import type { RunCell } from './runCell';
import { emit, getCell } from './runCells';
import type { RunKey } from './runTypes';

export interface RunClaim {
  /** The chat's Stop count when the claim was taken. */
  readonly epoch: number;
}

/** Hold the claim on a cell that is not running. Silent: the caller's next emit publishes it. */
export function holdClaim(c: RunCell): RunClaim {
  const claim: RunClaim = { epoch: c.stopEpoch };
  c.claim = claim;
  return claim;
}

/** Claim an idle chat's next run now (synchronously). Null when a run or another claim holds it. */
export function claimRun(runKey: RunKey): RunClaim | null {
  const c = getCell(runKey);
  if (c.running || c.claim) return null;
  const claim = holdClaim(c);
  emit(c);
  return claim;
}

/** Has the chat been told to Stop since the claim was taken? */
export function claimStopped(c: RunCell, claim: RunClaim): boolean {
  return c.stopEpoch !== claim.epoch;
}

/** Give the chat back. A no-op once a run has consumed the claim (or another claim replaced it). */
export function releaseClaim(c: RunCell, claim: RunClaim): void {
  if (c.claim !== claim) return;
  c.claim = null;
  emit(c);
}
