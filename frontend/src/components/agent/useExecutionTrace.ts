/**
 * One execution's trace, kept current while it runs.
 *
 * The drawer re-reads a live run every few seconds so tool calls and usage appear
 * as they happen. It used to re-read the WHOLE trace each tick — up to 500 tool
 * events with their full args/results, the same rows every time. Now the first
 * read is whole and each tick asks only for the telemetry rows past the newest
 * ids it holds (`afterEventId` / `afterUsageId`), folding them in on top.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimeApi, type ExecutionTrace } from '@/lib/builderforceApi';

/** The full read's row cap, kept for the folded lists so a long run shows what a reload would. */
const TRACE_ROW_LIMIT = 500;

function maxId(rows: readonly { id: number }[]): number {
  let max = 0;
  for (const row of rows) if (row.id > max) max = row.id;
  return max;
}

/** New rows first (both lists are newest-first), skipping any already held. */
function foldNewest<T extends { id: number }>(held: readonly T[], tail: readonly T[]): T[] {
  if (!tail.length) return held as T[];
  const seen = new Set(held.map((row) => row.id));
  return [...tail.filter((row) => !seen.has(row.id)), ...held].slice(0, TRACE_ROW_LIMIT);
}

/** Fold an incremental read into the held trace. A whole read (no cursor was sent) simply replaces it. */
export function mergeTraceTail(held: ExecutionTrace, tail: ExecutionTrace): ExecutionTrace {
  if (!tail.trace.incremental) return tail;
  return {
    execution: tail.execution,
    trace: {
      ...tail.trace,
      incremental: false,
      toolEvents: foldNewest(held.trace.toolEvents, tail.trace.toolEvents),
      usageSnapshots: foldNewest(held.trace.usageSnapshots, tail.trace.usageSnapshots),
    },
  };
}

export function useExecutionTrace(executionId: number | null): { trace: ExecutionTrace | null; readTail: (signal: AbortSignal) => Promise<void> } {
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  // The poll reads the held trace for its cursor without re-creating itself per tick.
  const heldRef = useRef<ExecutionTrace | null>(null);
  const commit = useCallback((next: ExecutionTrace | null) => { heldRef.current = next; setTrace(next); }, []);

  useEffect(() => {
    // No run: nothing to read. The held trace is hidden below, not cleared here.
    if (executionId == null) return;
    let cancelled = false;
    runtimeApi.trace(executionId).then((t) => { if (!cancelled) commit(t); }).catch(() => { if (!cancelled) commit(null); });
    return () => { cancelled = true; };
  }, [executionId, commit]);

  const readTail = useCallback(async (signal: AbortSignal) => {
    if (executionId == null) return;
    const held = heldRef.current;
    const cursor = held && held.execution.id === executionId
      ? { afterEventId: maxId(held.trace.toolEvents), afterUsageId: maxId(held.trace.usageSnapshots) }
      : {};
    const next = await runtimeApi.trace(executionId, cursor);
    // A switch of run, or the initial read landing mid-tick, makes this tail stale.
    if (signal.aborted || heldRef.current !== held) return;
    commit(held && held.execution.id === executionId ? mergeTraceTail(held, next) : next);
  }, [executionId, commit]);

  // Only the selected run's trace is shown: a deselect, or a switch before the new
  // read lands, never shows the previous run's rows.
  return { trace: trace && trace.execution.id === executionId ? trace : null, readTail };
}
