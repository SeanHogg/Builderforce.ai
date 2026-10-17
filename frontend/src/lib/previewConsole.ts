/**
 * The preview's console, per workspace — what the running app printed with
 * `console.log/info/warn/error/debug`, for the person (the bottom panel's Console
 * tab) and for the agent (`canvas_read_preview_console`) alike.
 *
 * The runtime reports every served page's console output itself
 * (`runtime.onPreviewConsole`); `previewSignals.ts` routes it here for the workspace
 * whose run is showing. Like `buildDiagnostics.ts` this is a module store, not a
 * cache: the output is produced in this tab, is never fetched, and must not outlive
 * the tab.
 *
 * Bounded, for the reason the failure store is: a render loop can log thousands of
 * identical lines a second. The newest {@link MAX_CONSOLE_ENTRIES} are kept and a
 * line identical to the one before it bumps that entry's count instead of appending.
 */
import type { ConsoleLevel } from '@seanhogg/builderforce-webcontainers';
import { isWorkspaceId, type WorkspaceId } from '@/lib/workspace/workspaceId';

export type { ConsoleLevel };

export interface ConsoleEntry {
  /** Stable within the tab, for React keys. */
  id: number;
  level: ConsoleLevel;
  text: string;
  /** Epoch ms of the first occurrence in this run of repeats. */
  at: number;
  /** Epoch ms of the most recent occurrence. */
  lastAt: number;
  /** Consecutive identical messages collapsed into this entry. */
  count: number;
}

/** Entries kept per workspace; older ones are dropped. */
export const MAX_CONSOLE_ENTRIES = 500;

/** What the Console tab and the agent tool filter by. `info` covers log, info and debug. */
export type ConsoleFilter = 'all' | 'errors' | 'warnings' | 'info';

const FILTER_LEVELS: Record<Exclude<ConsoleFilter, 'all'>, ReadonlySet<ConsoleLevel>> = {
  errors: new Set(['error']),
  warnings: new Set(['warn']),
  info: new Set(['log', 'info', 'debug']),
};

export function matchesConsoleFilter(level: ConsoleLevel, filter: ConsoleFilter): boolean {
  return filter === 'all' || FILTER_LEVELS[filter].has(level);
}

type Listener = (workspaceId: WorkspaceId) => void;

const entries = new Map<WorkspaceId, ConsoleEntry[]>();
const listeners = new Set<Listener>();
let nextId = 1;

function notify(workspaceId: WorkspaceId): void {
  for (const listener of listeners) {
    try {
      listener(workspaceId);
    } catch (error) {
      // A bad subscriber must never break the preview's producer — rethrown on its own
      // task, so it still reaches the page's error reporting.
      queueMicrotask(() => { throw error; });
    }
  }
}

/** Record one console message against a workspace. */
export function recordConsoleMessage(workspaceId: WorkspaceId, message: { level: ConsoleLevel; text: string }): void {
  if (!isWorkspaceId(workspaceId)) return;
  const text = message.text.trimEnd();
  if (!text) return;
  const now = Date.now();
  const list = entries.get(workspaceId) ?? [];
  const newest = list[list.length - 1];
  if (newest && newest.level === message.level && newest.text === text) {
    newest.count += 1;
    newest.lastAt = now;
  } else {
    list.push({ id: nextId++, level: message.level, text, at: now, lastAt: now, count: 1 });
    if (list.length > MAX_CONSOLE_ENTRIES) list.splice(0, list.length - MAX_CONSOLE_ENTRIES);
  }
  entries.set(workspaceId, list);
  notify(workspaceId);
}

/** A workspace's console, oldest first (copies — the store's entries stay its own). */
export function readConsoleEntries(workspaceId: WorkspaceId): ConsoleEntry[] {
  return (entries.get(workspaceId) ?? []).map((entry) => ({ ...entry }));
}

/** Drop a workspace's console. Called when a run starts, as `clearBuildFailures` is. */
export function clearConsoleEntries(workspaceId: WorkspaceId): void {
  if (!entries.has(workspaceId)) return;
  entries.delete(workspaceId);
  notify(workspaceId);
}

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribeConsoleEntries(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One entry as the agent reads it: `[warn ×3] text`. */
export function formatConsoleEntry(entry: ConsoleEntry): string {
  return `[${entry.level}${entry.count > 1 ? ` ×${entry.count}` : ''}] ${entry.text}`;
}
