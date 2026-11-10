/**
 * `oversized_args` — a non-write call carrying kilobytes of arguments, or several calls of one tool repeating the
 * same block of text (chat #70776: four `ticket-create` calls each carrying the plan's whole summary). Every byte
 * is streamed by the model and re-sent in every later prompt. One finding per tool.
 *
 * A call the loop answered itself (the explicit `hand_off`) leaves no tool step; its size is the turn's own
 * `argBytes`, attributed through the `llm.role_handoff` the turn recorded.
 */
import { utf8ByteLength } from '../../composingActivity';
import { isCodeChangeTool } from '../../localWorkspaceTools';
import { callEvidence, finding, turnEvidence } from '../findingParts';
import { RUN_FINDING_POLICY } from '../policy';
import type { RunFinding, RunFindingEvidence, RunView, ViewCall } from '../types';

/** Every paragraph of every string the arguments carry. */
function blocksOf(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === 'string') {
    for (const p of v.split(/\n\s*\n/)) {
      const block = p.trim();
      if (utf8ByteLength(block) >= RUN_FINDING_POLICY.sharedArgBytes) out.add(block);
    }
  } else if (Array.isArray(v)) {
    for (const x of v) blocksOf(x, out);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) blocksOf(x, out);
  }
  return out;
}

/** The calls that share a large block with another call of the same tool. */
function sharingCalls(calls: readonly ViewCall[]): Set<ViewCall> {
  const holders = new Map<string, ViewCall[]>();
  for (const c of calls) for (const b of blocksOf(c.args)) holders.set(b, [...(holders.get(b) ?? []), c]);
  const out = new Set<ViewCall>();
  for (const list of holders.values()) if (list.length >= 2) for (const c of list) out.add(c);
  return out;
}

export function oversizedArgs(view: RunView): RunFinding[] {
  const byTool = new Map<string, ViewCall[]>();
  for (const c of view.calls) {
    if (isCodeChangeTool(c.name)) continue;
    byTool.set(c.name, [...(byTool.get(c.name) ?? []), c]);
  }
  const out: RunFinding[] = [];
  for (const [tool, calls] of byTool) {
    const shared = sharingCalls(calls);
    const flagged = calls.filter((c) => c.argBytes >= RUN_FINDING_POLICY.oversizedArgBytes || shared.has(c));
    if (flagged.length === 0) continue;
    const evidence: RunFindingEvidence[] = flagged.map((c) => callEvidence(c, undefined, `${c.argBytes} B of arguments${shared.has(c) ? ' · repeats a block another call carries' : ''}`));
    out.push(finding('oversized_args', 'warn', { tool, bytes: Math.max(...flagged.map((c) => c.argBytes)), calls: flagged.length }, evidence));
  }
  for (const t of view.turns) {
    if (!t.handOffVia || t.argBytes < RUN_FINDING_POLICY.oversizedArgBytes || byTool.has(t.handOffVia)) continue;
    out.push(finding('oversized_args', 'warn', { tool: t.handOffVia, bytes: t.argBytes, calls: 1 },
      [turnEvidence(t, t.handOffVia, `${t.argBytes} B of arguments`)]));
  }
  return out;
}
