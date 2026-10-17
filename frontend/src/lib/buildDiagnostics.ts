/**
 * Build diagnostics — the ONE place a build's failures are collected so that the
 * agent that caused them can read them.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * Every failure the Builder workspace could produce ended in the terminal and
 * stopped there: `npm install` exiting non-zero, `Build failed (exit N)`, an
 * unparseable `package.json`, a build that emitted no `dist/`. They were written
 * with `terminalWriter(…)` — pixels for a human — and nothing collected them, so
 * the model that had just written the broken file had no way to learn it was
 * broken. The human was the repair loop.
 *
 * Runtime failures were worse: an app that COMPILES and then throws on render
 * produced a blank preview frame and no signal anywhere at all, because nothing
 * listened to the preview document's `error` / `unhandledrejection` events.
 *
 * This module is the collection point for both, so there is one shape, one
 * bound, and one reader. Runtime errors arrive through the runtime's own channel
 * (`runtime.onError`, routed by `lib/browserRuntime/previewSignals.ts`), which
 * covers every page the preview serves.
 *
 * ── WHY A MODULE-LEVEL STORE AND NOT A CACHE ────────────────────────────────
 * This is deliberately NOT `getOrSetCached`: nothing here is a copy of server
 * state. A failure is produced in this browser tab by a dev server running in
 * this browser tab, it is never fetched, and it must not outlive the tab — a
 * stale build error re-read on another device would be a lie about a workspace
 * that has since been fixed. The store is the authority for the lifetime of the
 * session and has no server behind it to invalidate against.
 *
 * ── WHY IT IS BOUNDED ───────────────────────────────────────────────────────
 * A crashing render loop can emit thousands of identical errors in a second. The
 * buffer keeps the most recent {@link MAX_FAILURES_PER_BUILD} per build and
 * collapses consecutive repeats into a count, so a repair turn is handed "this
 * happened 400 times" rather than 400 copies of one message — which is both the
 * more useful fact and the difference between a prompt that fits and one that
 * does not.
 */

import { isWorkspaceId, type WorkspaceId } from '@/lib/workspace/workspaceId';
import { subscribeWorkspaceFiles } from '@/lib/workspaceFileEvents';

/** Where a failure came from. The two have genuinely different fixes. */
export type BuildFailureSource = 'build' | 'runtime';

export interface BuildFailure {
  source: BuildFailureSource;
  /** The command that failed, when one did (`npm install`, `npm run build`). */
  command?: string;
  /** Process exit code, when the failure was a process. */
  exitCode?: number;
  /** One line: what went wrong. Always present. */
  message: string;
  /** Output tail / stack. Clipped by {@link MAX_DETAIL_CHARS}. */
  detail?: string;
  /** Source location for a runtime error, when the browser gave one. */
  at?: string;
  /** Epoch ms of the FIRST occurrence in this run of repeats. */
  firstSeen: number;
  /** Epoch ms of the most recent occurrence. */
  lastSeen: number;
  /** How many consecutive identical failures collapsed into this entry. */
  count: number;
}

/** Most recent failures kept per build. Older ones are dropped. */
export const MAX_FAILURES_PER_BUILD = 20;

/** Output/stack characters kept per failure. A repair turn needs the tail, not the log. */
export const MAX_DETAIL_CHARS = 4_000;

/** What a caller reports. The store owns the timestamps and the collapsing. */
export type BuildFailureInput = Omit<BuildFailure, 'firstSeen' | 'lastSeen' | 'count'>;

type Listener = (workspaceId: WorkspaceId) => void;

const failures = new Map<WorkspaceId, BuildFailure[]>();
const listeners = new Set<Listener>();

function notify(storageProjectId: WorkspaceId): void {
  for (const listener of listeners) {
    try {
      listener(storageProjectId);
    } catch {
      /* a bad subscriber must never break the producer of a build error */
    }
  }
}

/** Keep the tail: the end of a build log is where the cause is. */
function clipDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const text = detail.trimEnd();
  if (text.length <= MAX_DETAIL_CHARS) return text || undefined;
  return `…\n${text.slice(text.length - MAX_DETAIL_CHARS)}`;
}

/** Two failures are "the same" when a repair turn would say the same thing about them. */
function sameFailure(a: BuildFailure, b: BuildFailureInput): boolean {
  return a.source === b.source
    && a.message === b.message
    && a.command === b.command
    && a.at === b.at;
}

/**
 * Record a failure against a build. Consecutive identical failures increment the
 * newest entry's count rather than appending, so a render loop cannot flood the
 * buffer out of usefulness.
 */
export function recordBuildFailure(storageProjectId: WorkspaceId, input: BuildFailureInput): void {
  if (!isWorkspaceId(storageProjectId)) return;
  const message = input.message?.trim();
  if (!message) return;

  const entry: BuildFailureInput = {
    ...input,
    message,
    detail: clipDetail(input.detail),
  };
  const now = Date.now();
  const list = failures.get(storageProjectId) ?? [];
  const newest = list[list.length - 1];

  if (newest && sameFailure(newest, entry)) {
    newest.count += 1;
    newest.lastSeen = now;
    // A later occurrence usually carries the more complete stack.
    if (entry.detail && !newest.detail) newest.detail = entry.detail;
  } else {
    list.push({ ...entry, firstSeen: now, lastSeen: now, count: 1 });
    if (list.length > MAX_FAILURES_PER_BUILD) list.splice(0, list.length - MAX_FAILURES_PER_BUILD);
  }

  failures.set(storageProjectId, list);
  notify(storageProjectId);
}

/** Every failure recorded against a build, oldest first. */
export function readBuildFailures(storageProjectId: WorkspaceId): BuildFailure[] {
  return (failures.get(storageProjectId) ?? []).map((failure) => ({ ...failure }));
}

/**
 * Drop a build's failures.
 *
 * Called when a run STARTS, not when it succeeds: a run that gets further than
 * the last one should not be judged against the previous attempt's errors, and a
 * run that fails the same way immediately re-records.
 */
export function clearBuildFailures(storageProjectId: WorkspaceId): void {
  if (!failures.has(storageProjectId)) return;
  failures.delete(storageProjectId);
  notify(storageProjectId);
}

/**
 * When each build's source last changed, by epoch ms.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Failures are only cleared when a RUN starts, but an edit into a live preview
 * (an agent's `canvas_write_build_file`, a save in the editor) is not a run. So
 * a repair turn that rewrote `src/App.jsx` and re-read diagnostics was handed
 * the SAME errors it had just fixed, with no way to tell "still broken" from
 * "not re-run yet" — and rewrote the file again, identically. Marking the
 * moment the source moved lets the report separate failures seen SINCE the
 * edit (still happening) from ones last seen BEFORE it (unconfirmed).
 */
const sourceChangedAt = new Map<WorkspaceId, number>();

/** Record that a build's source just changed. */
export function markBuildSourceChanged(storageProjectId: WorkspaceId): void {
  if (!isWorkspaceId(storageProjectId)) return;
  sourceChangedAt.set(storageProjectId, Date.now());
}

// Every write that is not the editor's own (canvas build tools, version restores)
// announces itself here — the one place it needs hearing.
subscribeWorkspaceFiles((workspaceId) => markBuildSourceChanged(workspaceId));

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribeBuildFailures(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Split a process's output stream in two: on to the terminal for the human, and
 * into a buffer for the agent.
 *
 * The run pipeline passed `(data) => terminalWriter(data)` straight into every
 * command, so when one failed, the only thing that survived was its exit code —
 * the CAUSE stayed in the terminal as pixels. This keeps the tail (the end of a
 * build log is where the error is) bounded by {@link MAX_DETAIL_CHARS}, so a long
 * install cannot grow the buffer without limit.
 */
export function teeOutput(onData: (data: string) => void): { write: (data: string) => void; text: () => string } {
  let buffer = '';
  return {
    write: (data: string) => {
      onData(data);
      buffer += data;
      // Keep roughly twice the clip so `clipDetail` still has a full tail to trim,
      // without holding a whole npm install log in memory.
      if (buffer.length > MAX_DETAIL_CHARS * 2) buffer = buffer.slice(buffer.length - MAX_DETAIL_CHARS * 2);
    },
    text: () => buffer,
  };
}

/**
 * Render a build's failures as the block a repair turn reads.
 *
 * Kept here rather than at either call site because BOTH the automatic repair
 * turn in the workspace and the `canvas_read_build_diagnostics` tool hand the
 * same text to the same model, and two formatters would eventually disagree
 * about what a failure looks like.
 *
 * Failures are split by {@link markBuildSourceChanged}: `current` were seen at or
 * after the latest source change (still happening), `stale` were last seen
 * before it (the edit may have fixed them; the preview has not re-confirmed).
 * Each report is null when its half is empty — callers use `current` to decide
 * whether there is anything to repair at all.
 */
export interface BuildFailureReport {
  current: { count: number; report: string | null };
  stale: { count: number; report: string | null };
}

/** One failure as the agent reads it: what ran, the message, where, and its output. */
export function formatBuildFailure(failure: BuildFailure): string {
  const head = [
    failure.source === 'build' ? 'BUILD' : 'RUNTIME',
    failure.command ? `\`${failure.command}\`` : null,
    failure.exitCode != null ? `exit ${failure.exitCode}` : null,
    failure.count > 1 ? `×${failure.count}` : null,
  ].filter(Boolean).join(' · ');
  const location = failure.at ? `\n  at ${failure.at}` : '';
  const detail = failure.detail ? `\n\n${failure.detail}` : '';
  return `[${head}] ${failure.message}${location}${detail}`;
}

function formatList(list: BuildFailure[]): { count: number; report: string | null } {
  return { count: list.length, report: list.length ? list.map(formatBuildFailure).join('\n\n---\n\n') : null };
}

export function formatBuildFailures(storageProjectId: WorkspaceId): BuildFailureReport {
  const changedAt = sourceChangedAt.get(storageProjectId) ?? 0;
  const list = readBuildFailures(storageProjectId);
  return {
    current: formatList(list.filter((failure) => failure.lastSeen >= changedAt)),
    stale: formatList(list.filter((failure) => failure.lastSeen < changedAt)),
  };
}
