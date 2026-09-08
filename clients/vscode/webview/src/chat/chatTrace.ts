/**
 * Reading a chat's PERSISTED trace back into the events the timeline renders.
 *
 * A reopened panel has no in-memory trace — the run that produced it may have
 * finished while the tab was closed (runs live in the extension host, see
 * `hostRunDriver.ts`). These map `GET /api/brain/chats/:id/trace` rows back onto
 * `BrainTraceEvent`, which is what makes a reopened conversation show its tool calls
 * rather than a bare transcript.
 */

import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';

/** A persisted Brain trace row as returned by GET /api/brain/chats/:id/trace. */
export interface PersistedTraceRow {
  turnSeq: number | null;
  kind: string;
  label: string | null;
  argsJson: string | null;
  resultJson: string | null;
  isError: boolean;
  durationMs: number | null;
  ttftMs: number | null;
  /** When the event HAPPENED. Null on rows written before migration 1128 — fall back
   *  to `createdAt` there. Prefer this for ordering: `createdAt` is the batch write. */
  occurredAt: string | null;
  createdAt: string;
}

/** Best-effort JSON parse of a persisted arg/result blob (falls back to the raw string). */
export function parseTraceJson(s: string | null): unknown {
  if (s == null) return undefined;
  try { return JSON.parse(s); } catch { return s; }
}

/** Map a persisted trace row back into the in-memory BrainTraceEvent the timeline renders. */
export function persistedToTraceEvent(row: PersistedTraceRow): BrainTraceEvent {
  return {
    // `occurredAt` is when it HAPPENED; `createdAt` is when the batch was written — a
    // run persists its whole trace in ONE insert, so `createdAt` is identical across
    // every event of that run and cannot order them. Fallback is for rows that predate
    // migration 1128, whose real instants were never recorded.
    ts: row.occurredAt ?? row.createdAt,
    category: row.kind as BrainTraceEvent['category'],
    label: row.label ?? '',
    durationMs: row.durationMs ?? undefined,
    ttftMs: row.ttftMs ?? undefined,
    isError: row.isError,
    args: parseTraceJson(row.argsJson),
    result: parseTraceJson(row.resultJson),
  };
}
