/**
 * `analysis_overrun` — the run read for many turns before its first write. An error when the analysis budget had to
 * force the hand-off (`loop.hand_off_due`, counted by `routingByRole`): the planner never ended planning on its own.
 */
import { finding, turnEvidence } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView } from '../types';

export function analysisOverrun(view: RunView): RunFinding[] {
  const firstWrite = view.turns.find((t) => t.kind === 'write');
  const before = firstWrite ? view.turns.filter((t) => t.index < firstWrite.index) : view.turns;
  const reads = before.filter((t) => t.kind === 'read');
  const forced = before.find((t) => t.forced);
  const forcedByBudget = !!forced && view.routing.handOffsForced > 0;
  if (reads.length < RUN_FINDING_POLICY.analysisReadTurns && !forcedByBudget) return [];
  const evidence = [
    ...(reads[0] ? [turnEvidence(reads[0])] : []),
    ...(reads.length > 1 ? [turnEvidence(reads[reads.length - 1]!)] : []),
    ...(forced ? [turnEvidence(forced, 'loop.hand_off_due')] : []),
  ];
  return [finding('analysis_overrun', forcedByBudget ? 'error' : 'warn', {
    readTurns: reads.length,
    firstWriteTurn: firstWrite?.index ?? 0,
  }, evidence)];
}
