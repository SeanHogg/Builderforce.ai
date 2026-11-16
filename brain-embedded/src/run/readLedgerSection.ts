/**
 * The files already in the model's context this run — one section of the turn tail (`brainTurnTail.ts` `runBrief`).
 *
 * Chat #133542: a review message arrived mid-run and the run re-read `gates.ts`, `shipGates.ts`, `reviewerPort.ts`,
 * `runCell.ts` and `gates.test.ts` across a dozen turns to re-orient, making two edits; the next run read twenty windows of
 * the same files and changed nothing. Nothing in front of the turn said which files were still above it, unchanged.
 *
 * This section says so, on EVERY tool-offering turn once the run has read a file (it is cheap, and it is exactly what a
 * steer makes the model forget): each file this run read, newest first, the lines it was served, and whether a re-read
 * could show anything new — `unchanged`, `changed since (by this run)` after an edit of it, or `may have changed (a shell
 * command ran since)` after an unscoped mutation.
 *
 * A pure function of the run's own trace — the one record that keeps a read AFTER it stops being valid (the read guard,
 * `ReadCoverage`, forgets an invalidated read, so it cannot say "changed since"). What counts as a change is the read
 * guard's own vocabulary (`isCodeChangeTool`, `isUnscopedMutation`), so the two never disagree about staleness.
 */

import { perFileResults, singleReadsOf } from '@builderforce/run-guards';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { isUnscopedMutation } from '../readCoverage';
import type { ProgressTraceEvent } from './progressLine';

/** The trace-event slice this module reads — structural; `BrainTraceEvent` satisfies it. `truncated`: the host trimmed the
 *  result it served (`trimToolResult`), so the window's last line is not the last line the tool returned. */
export interface ReadLedgerTraceEvent extends ProgressTraceEvent {
  truncated?: boolean;
}

/** Most files listed — the newest reads are the ones the model is most likely to circle back to. */
export const READ_LEDGER_MAX_FILES = 40;

export const READ_LEDGER_HEADER =
  'Files already in your context this run — a file marked unchanged is still above you: do not read it again, act on it.';

type ReadState = 'unchanged' | 'changed' | 'unknown';

const STATE_TEXT: Record<ReadState, string> = {
  unchanged: 'unchanged',
  changed: 'changed since (by this run)',
  unknown: 'may have changed (a shell command ran since)',
};

/** A served window: inclusive 1-based lines; `end` null when the host trimmed the window and its last line is not recorded. */
interface Span {
  start: number;
  end: number | null;
}

interface FileEntry {
  path: string;
  spans: Span[];
  state: ReadState;
  /** Trace index of the newest successful read — the ordering key. */
  at: number;
  /** The newest read of the file failed: it is not in context. */
  failed: boolean;
}

function normalizePath(value: string): string {
  return value.trim().split('\\').join('/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** Every file a write / edit / delete names. */
function changedPaths(args: unknown): string[] {
  const a = objectOf(args);
  if (!a) return [];
  const out: string[] = [];
  for (const key of ['path', 'file', 'filePath'] as const) {
    if (typeof a[key] === 'string' && (a[key] as string).trim()) out.push(normalizePath(a[key] as string));
  }
  for (const list of [a.edits, a.paths]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const p = typeof item === 'string' ? item : (item as { path?: unknown } | null)?.path;
      if (typeof p === 'string' && p.trim()) out.push(normalizePath(p));
    }
  }
  return out;
}

/**
 * Is this recorded result a read the host actually RAN? The read guard's own answers — an exact-repeat stub, a covered
 * window, a replay from cache, a derived search — are recorded on the same label but put nothing new in context.
 */
function isRanRead(data: Record<string, unknown> | null): data is Record<string, unknown> {
  if (!data) return false;
  if (data.covered === true || data.replayed === true || data.skipped === true || data.derived === true) return false;
  return data.ok === true || typeof data.content === 'string' || Array.isArray(data.files);
}

/** The window a successful single-file result served. Null when it carries no lines (an empty file, an `ok` with no body). */
function servedSpan(entry: Record<string, unknown>, args: Record<string, unknown>, trimmed: boolean): Span | null {
  const content = typeof entry.content === 'string' ? entry.content : '';
  if (!content) return null;
  const start = positiveInt(entry.offset) ?? positiveInt(args.offset) ?? 1;
  // The host cut the window to its budget: the first line is known, the last one the model saw is not.
  if (trimmed) return { start, end: null };
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  let end = start + Math.max(1, body.split('\n').length) - 1;
  // A window the tool did not truncate reached the end of the file.
  const total = positiveInt(entry.totalLines);
  if (entry.truncated !== true && total !== null && total >= start) end = total;
  return { start, end };
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const known = spans.filter((s): s is { start: number; end: number } => s.end !== null).sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of known) {
    const last = merged.at(-1);
    if (last && span.start <= last.end + 1) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  // A trimmed window adds only what no known span already holds.
  const open = spans.filter((s) => s.end === null && !merged.some((m) => s.start >= m.start && s.start <= m.end));
  const firstOpen = new Map<number, Span>();
  for (const s of open) firstOpen.set(s.start, s);
  return [...merged, ...firstOpen.values()].sort((a, b) => a.start - b.start);
}

/** `lines 1–530, 600–700` plus any trimmed window as `from line 900 (window trimmed)`; '' when no lines are recorded. */
function rangesText(spans: readonly Span[]): string {
  const merged = mergeSpans(spans);
  const known = merged.filter((s) => s.end !== null).map((s) => (s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`));
  const open = merged.filter((s) => s.end === null).map((s) => `from line ${s.start} (window trimmed)`);
  return [known.length > 0 ? `lines ${known.join(', ')}` : '', ...open].filter(Boolean).join(', ');
}

/** The files this run's trace has read, with what a re-read of each could show. */
function ledgerOf(trace: readonly ReadLedgerTraceEvent[]): FileEntry[] {
  const files = new Map<string, FileEntry>();
  const noteRead = (path: string, at: number, span: Span | null) => {
    const prior = files.get(path);
    // A read after a change (or a shell command) is the file as it is NOW: the earlier windows described older bytes.
    const fresh = !prior || prior.state !== 'unchanged';
    const entry: FileEntry = fresh ? { path, spans: [], state: 'unchanged', at, failed: false } : prior;
    entry.at = at;
    entry.failed = false;
    if (span) entry.spans.push(span);
    files.set(path, entry);
  };
  const noteFailure = (path: string, at: number) => {
    const prior = files.get(path);
    files.set(path, { path, spans: prior?.spans ?? [], state: prior?.state ?? 'unchanged', at, failed: true });
  };

  trace.forEach((ev, at) => {
    if (ev.category !== 'tool') return;
    if (ev.label === 'read_file') {
      const args = objectOf(ev.args) ?? {};
      const data = objectOf(ev.result);
      const trimmed = ev.truncated === true;
      const singles = singleReadsOf('read_file', args);
      if (singles) {
        if (ev.isError || data?.ok === false) {
          for (const s of singles) if (typeof s.path === 'string') noteFailure(normalizePath(s.path), at);
          return;
        }
        if (!isRanRead(data)) return;
        const entries = perFileResults(data) ?? [];
        singles.forEach((single, i) => {
          if (typeof single.path !== 'string') return;
          const path = normalizePath(single.path);
          const entry = objectOf(entries[i]);
          if (!entry || entry.ok === false) noteFailure(path, at);
          else noteRead(path, at, servedSpan(entry, single, trimmed));
        });
        return;
      }
      const raw = typeof args.path === 'string' ? args.path : '';
      if (!raw.trim()) return;
      const path = normalizePath(raw);
      if (ev.isError || data?.ok === false) {
        noteFailure(path, at);
        return;
      }
      // A JSON `key` read served one value, not a line window: the file is in context, its lines are not.
      if (!isRanRead(data)) return;
      noteRead(path, at, typeof args.key === 'string' ? null : servedSpan(data, args, trimmed));
      return;
    }
    if (isUnscopedMutation(ev.label, ev.args)) {
      for (const entry of files.values()) if (entry.state === 'unchanged') entry.state = 'unknown';
      return;
    }
    if (isCodeChangeTool(ev.label) && !ev.isError) {
      for (const path of changedPaths(ev.args)) {
        const entry = files.get(path);
        if (entry) entry.state = 'changed';
      }
    }
  });

  return [...files.values()]
    .filter((f) => !f.failed)
    .sort((a, b) => b.at - a.at)
    .slice(0, READ_LEDGER_MAX_FILES);
}

/** The section, or '' when this run has not read a file yet. */
export function readLedgerSection(trace: readonly ReadLedgerTraceEvent[]): string {
  const files = ledgerOf(trace);
  if (files.length === 0) return '';
  const lines = files.map((f) => {
    const ranges = rangesText(f.spans);
    return `- ${[f.path, ranges, STATE_TEXT[f.state]].filter(Boolean).join(' · ')}`;
  });
  return [READ_LEDGER_HEADER, ...lines].join('\n');
}
