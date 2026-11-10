/**
 * `slow_turns` — completions at or over the slow-turn line. The evidence carries what the turn spent its time
 * producing (argument bytes, completion tokens), which separates a stall from a long tool call being streamed.
 */
import { formatBytes } from '../../runActivity';
import { finding, turnEvidence } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunView } from '../types';

export function slowTurns(view: RunView): RunFinding[] {
  const slow = view.turns.filter((t) => t.durationMs >= RUN_FINDING_POLICY.slowTurnMs);
  if (slow.length === 0) return [];
  const slowestMs = Math.max(...slow.map((t) => t.durationMs));
  return [finding('slow_turns', 'warn', { turns: slow.length, slowestMs }, slow.map((t) =>
    turnEvidence(t, 'llm.complete', `${t.durationMs} ms · ${t.completionTokens} completion tok · ${formatBytes(t.argBytes)} of arguments`)))];
}
