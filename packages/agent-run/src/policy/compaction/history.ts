/** Cell-history compaction strategy. Hosts own storage, transport and trace delivery; this factory owns folding policy. */
import {
  buildWorkingTranscript, foldWorkingTranscript, HISTORY_TOKEN_BUDGET, transcriptTokens,
  type TranscriptMessage, type TranscriptFold, type WorkingTranscriptState,
} from "@seanhogg/builderforce-memory/working";
import type { RunMessage } from "../../contract.js";
import type { CompactionHook } from "../hooks.js";

export const foldLimits = { summaryMs: 15_000 };

export interface HistoryCompactionPorts {
  state: WorkingTranscriptState;
  systemPrompt: string;
  signal?: AbortSignal;
  summarize(messages: TranscriptMessage[], signal: AbortSignal): Promise<string | null>;
  toRunMessage(message: TranscriptMessage): RunMessage;
  recordFold(fold: TranscriptFold): void;
  activity(step: number): void;
  timeout(step: number, waitedMs: number, messages: number): void;
  error(step: number, messages: number, reason: unknown): void;
  savedTokens(tokens: number): void;
}

/** Savings against the history window that would otherwise have been sent. */
export function compactionSavedTokens(full: readonly TranscriptMessage[], working: readonly TranscriptMessage[], historyBudgetTokens = HISTORY_TOKEN_BUDGET): number {
  return Math.max(0, Math.min(transcriptTokens(full), historyBudgetTokens) - transcriptTokens(working));
}

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
 * answer, so the caller falls back exactly as it does for any failed summary. The timer is always cleared. A failed summary
 * is reported through `onError` so a persistently failing summarizer is diagnosable, never silently swallowed.
 */
async function summaryWithin(ms: number, summarize: (signal: AbortSignal) => Promise<string | null>, parent: AbortSignal | undefined, onLate: () => void, onError?: (reason: unknown) => void): Promise<string | null> {
  const link = linkedAbort(parent);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), ms); });
  try {
    // A failed summary is answered exactly as the caller falls back for any failed summary; the reason is named and
    // reported (not a bare `() => null` swallow) so it reads as a deliberate refusal, not a silent drop.
    const out = await Promise.race([
      summarize(link.signal).catch((reason: unknown): null => {
        onError?.(reason);
        return null;
      }),
      late,
    ]);
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

/** Never rewrites source history; the memory helper updates only its reusable memo. */
export function createHistoryCompactionHook(ports: HistoryCompactionPorts): CompactionHook {
  let timedOut = false;
  return {
    async compact(ctx) {
      let folded = false;
      const working = await buildWorkingTranscript(
        ports.state,
        ports.systemPrompt,
        (messages) => {
          if (timedOut) return Promise.resolve(null);
          ports.activity(ctx.step);
          const limit = foldLimits.summaryMs;
          return summaryWithin(limit, (signal) => ports.summarize(messages, signal), ports.signal ?? ctx.signal,
            () => { timedOut = true; ports.timeout(ctx.step, limit, messages.length); },
            (reason) => ports.error(ctx.step, messages.length, reason));
        },
        (fold) => { folded = true; ports.recordFold(fold); },
      );
      ports.savedTokens(ports.state.compactMemo
        ? compactionSavedTokens([{ role: "system", content: ports.systemPrompt }, ...ports.state.transcript], working) : 0);
      const rows = foldWorkingTranscript(working).map((row) => ports.toRunMessage(row));
      if (sameRows(ctx.messages, rows)) return undefined;
      return { messages: rows, dropped: Math.max(0, ctx.messages.length - rows.length), ...(folded ? {} : { reused: true as const }) };
    },
  };
}
