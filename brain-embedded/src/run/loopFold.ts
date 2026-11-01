/**
 * The agent's COMPACTION, made the Brain's (PRD 35 §4 WS4, parity ruling T2). The Brain's fold is the one it has always run:
 * `buildWorkingTranscript` (`@seanhogg/builderforce-memory/working`) over the CELL'S transcript - the 64,000-token history
 * allowance, the 40,000-token tail, the stable cut, the memo reused across turns and runs (`c.compactMemo`), drop-oldest when
 * the summary fails - summarised by the silent `transcriptSummarizer` (reasoning off, never a visible model turn) and recorded
 * by `recordFold` (the `context.compacted` step and the durable marker, the SAME function the loop's model port calls).
 *
 * The agent's own compaction is replaced WHOLE (`modules.compaction`), not adapted to imitate this: the module builds the working
 * set from the cell, hands the agent's transcript that set when it differs, and keeps what compaction saved this turn for the
 * call's memory effect (`loopTurn.ts`). The cell's rows are never rewritten, so every index the memo and the read cache's anchors
 * hold stays valid.
 */

import type { CompactionHook, RunMessage } from '@builderforce/agent-run';
import { buildWorkingTranscript } from '@seanhogg/builderforce-memory/working';
import { summarizeMiddle } from '../transcriptSummarizer';
import { compactionSavedTokens } from '../runStore/compactionSaved';
import { recordFold } from '../runStore/runFoldMarker';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { toRunMessage } from './runMessages';

export interface BrainCompaction {
  hook: CompactionHook;
  /** The prompt tokens compaction kept out of the turn the hook last prepared. */
  savedTokens(): number;
}

/** Do these hold the same conversation? The fields the model reads; a row's native extras never decide it. */
function sameRows(a: readonly RunMessage[], b: readonly RunMessage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i]!;
    return row.role === other.role
      && row.content === other.content
      && row.toolCallId === other.toolCallId
      && (row.toolCalls ?? []).map((call) => call.id).join() === (other.toolCalls ?? []).map((call) => call.id).join();
  });
}

export function brainCompaction(run: RunLoopContext): BrainCompaction {
  const { c, systemPrompt, req } = run;
  let saved = 0;
  return {
    savedTokens: () => saved,
    hook: {
      async compact(ctx) {
        // Auto-compact BEFORE the turn: summarise the older middle into a memory note when the transcript exceeds the token budget,
        // or fall back to the drop-oldest window when no summarizer is reachable.
        const working = await buildWorkingTranscript(
          c,
          systemPrompt,
          (msgs) => summarizeMiddle(req.stream, run.policy.model, msgs, c.abort?.signal),
          (fold) => recordFold(run, fold),
        );
        // What compaction kept out of THIS call's prompt, measured against what it would have been without it.
        saved = c.compactMemo ? compactionSavedTokens([{ role: 'system', content: systemPrompt }, ...c.transcript], working) : 0;
        const rows = working.map(toRunMessage);
        if (sameRows(ctx.messages, rows)) return undefined;
        return { messages: rows, dropped: Math.max(0, ctx.messages.length - rows.length) };
      },
    },
  };
}
