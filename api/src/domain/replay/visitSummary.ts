/**
 * Incremental visit fold.
 *
 * Each ingested chunk updates the recording's counters, paths, active time
 * and end marker. The Worker never re-reads earlier chunks to recompute
 * these — `foldVisit(prev, chunk, now)` is the whole state machine, so a
 * crash between chunks leaves a row that the next chunk can resume.
 */

import type { ReplayChunk, ReplayChunkEvent, ReplayMark } from '@builderforce/interaction-contract';
import { SECOND_MS } from '../shared/time';

/** Gaps longer than this are idle, not active time. */
export const IDLE_GAP_MS = 30 * SECOND_MS;

const ACTIVITY_KINDS = new Set(['click', 'input', 'scroll', 'change', 'submit', 'rage', 'dead']);
const PAGE_KINDS = new Set(['pageview', 'nav', 'page']);
const PATH_MAX = 512;

export interface VisitRow {
  visitId: string;
  startedAt: Date;
  lastEventAt: Date;
  endedAt: Date | null;
  durationMs: number;
  entryPath: string;
  exitPath: string;
  pageCount: number;
  clickCount: number;
  rageCount: number;
  deadCount: number;
  errorCount: number;
  quickbackCount: number;
  excessiveScrollCount: number;
  activeMs: number;
  converted: boolean;
  chunkCount: number;
}

function capPath(value: string): string {
  return value.length <= PATH_MAX ? value : value.slice(0, PATH_MAX);
}

function eventPath(event: ReplayChunkEvent): string | null {
  const path = event.path;
  return typeof path === 'string' && path.length > 0 ? capPath(path) : null;
}

function isEndMarker(event: ReplayChunkEvent): boolean {
  if (event.kind === 'end' || event.kind === 'pagehide') return true;
  if (event.kind !== 'visibility') return false;
  return event.hidden === true || event.state === 'hidden';
}

function isConverted(event: ReplayChunkEvent): boolean {
  return event.kind === 'goal' || event.converted === true;
}

function countKind(chunk: ReplayChunk, kind: string): number {
  const marks = chunk.marks ?? [];
  const fromMarks = marks.filter((mark) => mark.kind === kind).length;
  if (fromMarks > 0) return fromMarks;
  return chunk.events.filter((event) => event.kind === kind).length;
}

function pageEvents(chunk: ReplayChunk): Array<{ path: string }> {
  const fromEvents = chunk.events
    .filter((event) => PAGE_KINDS.has(event.kind))
    .map((event) => {
      const path = eventPath(event);
      return path ? { path } : null;
    })
    .filter((row): row is { path: string } => row !== null);
  if (fromEvents.length > 0) return fromEvents;
  return (chunk.marks ?? [])
    .filter((mark) => mark.kind === 'page' && mark.key.length > 0)
    .map((mark) => ({ path: capPath(mark.key) }));
}

function activityOffsets(chunk: ReplayChunk): number[] {
  const fromEvents = chunk.events
    .filter((event) => ACTIVITY_KINDS.has(event.kind))
    .map((event) => event.t);
  const fromMarks = (chunk.marks ?? [])
    .filter((mark: ReplayMark) => ACTIVITY_KINDS.has(mark.kind))
    .map((mark) => mark.atMs);
  return [...fromEvents, ...fromMarks].filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
}

function activeMsDelta(prevLastActivityOffset: number | null, chunk: ReplayChunk): { add: number; lastOffset: number | null } {
  const offsets = activityOffsets(chunk);
  if (offsets.length === 0) return { add: 0, lastOffset: prevLastActivityOffset };
  let add = 0;
  let last = prevLastActivityOffset;
  for (const t of offsets) {
    if (last !== null) {
      const gap = t - last;
      if (gap > 0 && gap <= IDLE_GAP_MS) add += gap;
    }
    last = t;
  }
  return { add, lastOffset: last };
}

function lastEventOffset(chunk: ReplayChunk): number {
  let max = 0;
  for (const event of chunk.events) {
    if (event.t > max) max = event.t;
  }
  for (const mark of chunk.marks ?? []) {
    if (mark.atMs > max) max = mark.atMs;
  }
  return max;
}

/**
 * Fold one ingested chunk into the visit row. `now` is ingest time of this
 * chunk: the first fold back-dates `startedAt` by the last event offset so
 * `lastEventAt` lands on `now` rather than in the future.
 */
export function foldVisit(prev: VisitRow | null, chunk: ReplayChunk, now: Date): VisitRow {
  const offset = lastEventOffset(chunk);
  const startedAt = prev?.startedAt ?? new Date(now.getTime() - offset);
  const fromOffset = new Date(startedAt.getTime() + offset);
  const lastEventAt =
    prev && prev.lastEventAt.getTime() > fromOffset.getTime() ? prev.lastEventAt : fromOffset;
  const pages = pageEvents(chunk);
  const firstPath = pages[0]?.path ?? '';
  const lastPath = pages[pages.length - 1]?.path ?? firstPath;
  const prevActivityOffset = prev
    ? Math.max(0, prev.lastEventAt.getTime() - prev.startedAt.getTime())
    : null;
  const activity = activeMsDelta(prevActivityOffset, chunk);
  const ended = chunk.events.some(isEndMarker);

  return {
    visitId: prev?.visitId ?? chunk.visitId,
    startedAt,
    lastEventAt,
    endedAt: prev?.endedAt ?? (ended ? lastEventAt : null),
    durationMs: Math.max(0, lastEventAt.getTime() - startedAt.getTime()),
    entryPath: prev?.entryPath || firstPath,
    exitPath: lastPath || prev?.exitPath || firstPath,
    pageCount: (prev?.pageCount ?? 0) + pages.length,
    clickCount: (prev?.clickCount ?? 0) + countKind(chunk, 'click'),
    rageCount: (prev?.rageCount ?? 0) + countKind(chunk, 'rage'),
    deadCount: (prev?.deadCount ?? 0) + countKind(chunk, 'dead'),
    errorCount: (prev?.errorCount ?? 0) + countKind(chunk, 'error'),
    quickbackCount: (prev?.quickbackCount ?? 0) + countKind(chunk, 'quickback'),
    excessiveScrollCount: (prev?.excessiveScrollCount ?? 0) + countKind(chunk, 'excessive_scroll'),
    activeMs: (prev?.activeMs ?? 0) + activity.add,
    converted: (prev?.converted ?? false) || chunk.events.some(isConverted) || (chunk.marks ?? []).some((m) => m.kind === 'goal'),
    chunkCount: (prev?.chunkCount ?? 0) + 1,
  };
}
