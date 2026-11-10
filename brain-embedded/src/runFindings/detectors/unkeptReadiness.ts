/**
 * `unkept_readiness` — the model said it was ready ("Now I have the full picture") and went on reading. The claim
 * is `claimsReady` from `@builderforce/run-guards`, the same judgement the live B1 advisory makes.
 */
import { claimsReady } from '@builderforce/run-guards';
import { finding, turnEvidence } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView, ViewTurn } from '../types';

/** Read-only turns after turn `from`, up to the first turn that acted. */
function readTurnsAfter(turns: readonly ViewTurn[], from: number): number {
  let n = 0;
  for (const t of turns) {
    if (t.index <= from) continue;
    if (t.kind !== 'read') break;
    n += 1;
  }
  return n;
}

export function unkeptReadiness(view: RunView): RunFinding[] {
  // A claim is kept by the turn that makes it acting; an unkept claim is one made on a read-only turn.
  const claims = view.turns.filter((t) => t.kind === 'read' && claimsReady(t.text));
  const first = claims[0];
  if (!first) return [];
  const after = readTurnsAfter(view.turns, first.index);
  if (after < RUN_FINDING_POLICY.unkeptReadTurns) return [];
  return [finding('unkept_readiness', 'warn', { claims: claims.length, readTurnsAfter: after },
    claims.map((t) => turnEvidence(t, 'agent.message', t.text)))];
}
