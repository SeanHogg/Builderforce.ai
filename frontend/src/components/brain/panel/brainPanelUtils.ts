import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { Formatter } from '@/i18n/format';
import type { BrainChatTraceRow } from '@/lib/builderforceApi';

/**
 * Clock time for a message sent today, calendar date for anything older.
 *
 * Takes the formatter rather than reaching for one: this is module scope, where a
 * hook cannot run, and the alternative — `toLocaleTimeString()` with no locale —
 * is the browser's language rather than the reader's.
 */
export function formatTime(fmt: Formatter, ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmt.time(d);
  return fmt.dateWith(d, { month: 'short', day: 'numeric' });
}

/** localStorage key for the per-chat "use project memory" toggle. */
export const MEMORY_KEY = (chatId: number) => `bf_brain_memory:${chatId}`;

function safeJsonParse(s: string | null): unknown {
  if (s == null) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

/** A persisted trace row → a timeline BrainTraceEvent, so tool/LLM turns survive reload. */
export function traceRowToEvent(r: BrainChatTraceRow): BrainTraceEvent {
  return {
    // `occurredAt` is when it HAPPENED; `createdAt` is when the batch was written, and
    // is the fallback only for rows that predate migration 1128.
    ts: r.occurredAt ?? r.createdAt ?? new Date().toISOString(),
    category: r.kind as BrainTraceEvent['category'],
    label: r.label ?? '',
    durationMs: r.durationMs ?? undefined,
    ttftMs: r.ttftMs ?? undefined,
    args: safeJsonParse(r.argsJson),
    result: safeJsonParse(r.resultJson),
    isError: r.isError || undefined,
  };
}
