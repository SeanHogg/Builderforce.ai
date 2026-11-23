/** Brain storage, summary transport and trace ports for the shared history compaction strategy. */
import type { CompactionHookOptions } from '@builderforce/agent-run';
import { summarizeTranscript } from '@seanhogg/builderforce-memory/working';
import { streamSummaryCompletion } from '../transcriptSummarizer';
import { recordFold } from '../runStore/runFoldMarker';
import { nowIso, pushTrace, setActivity } from '../runStore/runCells';
import { contextFoldActivity } from '../runActivity';
import type { BrainRunContext } from '../runStore/brainRunContext';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { toRunMessage } from './runMessages';

export { foldLimits } from '@builderforce/agent-run';

export function brainCompaction(run: BrainRunContext): { options: CompactionHookOptions; savedTokens(): number } {
  const { c, systemPrompt, req } = run;
  let saved = 0;
  return {
    savedTokens: () => saved,
    options: { history: {
      state: c, systemPrompt, signal: c.abort?.signal,
      summarize: (messages, signal) => summarizeTranscript(streamSummaryCompletion(req.stream, run.policy.model, req.onDeviceTasks), messages, signal),
      // The state above is Brain-owned. Memory preserves its native rows and creates only plain text summary rows.
      toRunMessage: (row) => toRunMessage(row as ChatCompletionMessage),
      recordFold: (fold) => recordFold(run, fold),
      savedTokens: (tokens) => { saved = tokens; },
      activity: (step) => setActivity(c, contextFoldActivity(step, Date.now())),
      timeout: (step, waitedMs, messages) => pushTrace(c, {
        ts: nowIso(), category: 'message', label: 'context.fold_timeout', args: { step, waitedMs, messages },
        result: 'The context summary did not finish in time; this run goes on with the most recent history instead.',
      }),
      error: (step, messages, reason) => pushTrace(c, {
        ts: nowIso(), category: 'message', label: 'context.fold_error', args: { step, messages },
        result: `The context summary failed: ${reason instanceof Error ? reason.message : String(reason)}. This run goes on with the most recent history instead.`,
      }),
    } },
  };
}
