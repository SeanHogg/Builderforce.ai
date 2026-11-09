/**
 * The agent's COMPACTION, made the Brain's (PRD 35 §4 WS4, parity ruling T2). The Brain's fold is the one it has always run:
 * `buildWorkingTranscript` (`@seanhogg/builderforce-memory/working`) over the CELL'S transcript - the 64,000-token history
 * allowance, the 40,000-token tail, the stable cut, the memo reused across turns and runs (`c.compactMemo`), drop-oldest when
 * the summary fails - summarised by the silent `transcriptSummarizer` (reasoning off, never a visible model turn) and recorded
 * by `recordFold` (the `context.compacted` step and the durable marker, the ONE function that announces a fold).
 *
 * The agent's own compaction is replaced WHOLE (`modules.compaction`), not adapted to imitate this: the module builds the working
 * set from the cell, hands the agent's transcript that set when it differs, and keeps what compaction saved this turn for the
 * call's memory effect (`brainTurn.ts`). The cell's rows are never rewritten, so every index the memo and the read cache's anchors
 * hold stays valid.
 */

import type { CompactionHook, RunMessage } from '@builderforce/agent-run';
import { buildWorkingTranscript, foldWorkingTranscript } from '@seanhogg/builderforce-memory/working';
import { summarizeMiddle } from '../transcriptSummarizer';
import { compactionSavedTokens } from '../runStore/compactionSaved';
import { recordFold } from '../runStore/runFoldMarker';
import { nowIso, pushTrace, setActivity } from '../runStore/runCells';
import { contextFoldActivity } from '../runActivity';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { toRunMessage } from './runMessages';

export interface BrainCompaction {
  hook: CompactionHook;
  /** The prompt tokens compaction kept out of the turn the hook last prepared. */
  savedTokens(): number;
}

/**
 * The most the fold's summary may hold a turn, ms. The summary is chunked (48k tokens a call, sequential, each tried on the
 * device first), so over a long chat's history it scaled with that history and had no deadline at all: chat #56654 (server
 * #216) sat in "starting up" for 5+ minutes on every run after a 323-step run grew the cell's transcript, and a Stop left no
 * memo, so the next run started the same fold over. Past this the fold is abandoned - the summary call is aborted and the turn
 * goes ahead on the drop-oldest window, which the fold falls back to whenever the summary fails. Mutable so tests can shorten it.
 */
export const foldLimits = { summaryMs: 15_000 };

/** A child of the run's Stop: aborting it ends only the fold's own summary call. */
function linkedAbort(parent: AbortSignal | undefined): { signal: AbortSignal; abort: () => void; release: () => void } {
  const own = new AbortController();
  const onParent = (): void => own.abort();
  if (parent?.aborted) own.abort();
  else parent?.addEventListener('abort', onParent, { once: true });
  return { signal: own.signal, abort: () => own.abort(), release: () => parent?.removeEventListener('abort', onParent) };
}

/**
 * The summary, or null once `ms` have passed (the call is aborted, `onLate` says so). Null is the summarizer's own "failed"
 * answer, so the caller falls back exactly as it does for any failed summary. The timer is always cleared.
 */
async function summaryWithin(ms: number, summarize: (signal: AbortSignal) => Promise<string | null>, parent: AbortSignal | undefined, onLate: () => void): Promise<string | null> {
  const link = linkedAbort(parent);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), ms); });
  try {
    const out = await Promise.race([summarize(link.signal).catch(() => null), late]);
    if (out !== 'late') return out;
    link.abort();
    onLate();
    return null;
  } finally {
    clearTimeout(timer);
    link.release();
  }
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

export function brainCompaction(run: BrainRunContext): BrainCompaction {
  const { c, systemPrompt, req } = run;
  let saved = 0;
  // A fold that ran out of time once in this run is not asked again in it: every later turn would wait the full deadline for
  // the same summary. The turns go on with the drop-oldest window; the next run tries the fold again.
  let foldTimedOut = false;
  return {
    savedTokens: () => saved,
    hook: {
      async compact(ctx) {
        // Auto-compact BEFORE the turn: summarise the older middle into a memory note when the transcript exceeds the token budget,
        // or fall back to the drop-oldest window when no summarizer is reachable.
        // `recordFold` is told only of a fold made NOW; a turn that merely reuses the memo of an earlier fold is told nothing.
        let folded = false;
        const working = await buildWorkingTranscript(
          c,
          systemPrompt,
          (msgs) => {
            if (foldTimedOut) return Promise.resolve(null);
            // The fold's summary is a model call of its own: the live step says so, never the tool that ran before it.
            setActivity(c, contextFoldActivity(ctx.step, Date.now()));
            const limit = foldLimits.summaryMs;
            return summaryWithin(
              limit,
              (signal) => summarizeMiddle(req.stream, run.policy.model, msgs, signal, req.onDeviceTasks),
              c.abort?.signal,
              () => {
                foldTimedOut = true;
                pushTrace(c, {
                  ts: nowIso(),
                  category: 'message',
                  label: 'context.fold_timeout',
                  args: { step: ctx.step, waitedMs: limit, messages: msgs.length },
                  result: 'The context summary did not finish in time; this run goes on with the most recent history instead.',
                });
              },
            );
          },
          (fold) => { folded = true; recordFold(run, fold); },
        );
        // What compaction kept out of THIS call's prompt, measured against what it would have been without it.
        saved = c.compactMemo ? compactionSavedTokens([{ role: 'system', content: systemPrompt }, ...c.transcript], working) : 0;
        // PRD 45 §4.7 B6/B7: only what the MODEL sees is folded (superseded reads, repeated narration); the cell's transcript and
        // trace keep every row at full fidelity.
        const rows = foldWorkingTranscript(working).map(toRunMessage);
        if (sameRows(ctx.messages, rows)) return undefined;
        // The run counts a compaction only for a fold made this turn: the working set differs from the cell on every later turn too.
        return { messages: rows, dropped: Math.max(0, ctx.messages.length - rows.length), ...(folded ? {} : { reused: true as const }) };
      },
    },
  };
}
