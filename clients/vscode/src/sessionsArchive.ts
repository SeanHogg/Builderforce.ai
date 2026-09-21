import type { SessionsLibraryRow } from "./sessionsLibrary";

/**
 * THE SESSIONS ARCHIVE — getting finished work out of the list without losing it.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
 * The Sessions list is recency-ordered and capped, so a run of sessions that are
 * DONE (every linked ticket closed — the `100% ·` prefix on the row) pushes live
 * work off the bottom. The list stops being "what I am working on" and becomes "what
 * I have ever worked on", which is the state the user reported.
 *
 * So a row can be ARCHIVED: kept, reachable, and out of the default view.
 *
 * ── WHY THE STATE IS LOCAL, NOT SERVER-SIDE ──────────────────────────────────
 * The server HAS an archive flag (`brain_chats.is_archived`) and it is already
 * spoken for: `DELETE /api/brain/chats/:id` sets it, and that is what the sidebar's
 * "Delete chat" calls. `BrainService.listChats` then hard-filters `is_archived =
 * false`, and there is no route that lists or clears it. On that endpoint, archiving
 * IS deleting as far as any client can tell — a chat archived server-side cannot be
 * listed, opened, or restored from the extension.
 *
 * Auto-archiving on a timer through that door would silently destroy access to a
 * week's finished sessions, and the un-archive-on-interaction half could never work
 * at all: you cannot interact with a row that no longer comes back in the list.
 *
 * So the archive is a VIEW STATE the extension owns, keyed by row, stored in
 * `globalState`. Every archived session is still listed by the server, still opens,
 * and un-archiving is a local write that cannot fail. Moving this to the server is a
 * real follow-up (it needs `is_archived` split from delete, plus list/restore
 * routes) — tracked separately; this module is deliberately shaped so that swap is a
 * change of STORE, not of behaviour.
 *
 * No `vscode` import: the decisions are pure and tested in `sessionsArchive.test.ts`.
 * The tree owns presentation, the host owns persistence.
 */

/** How long a finished session stays in the list before it is swept. */
export const ARCHIVE_AFTER_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
export const ARCHIVE_AFTER_MS = ARCHIVE_AFTER_DAYS * DAY_MS;

/**
 * One archived row: when it was archived, and whether a person did it.
 *
 * `manual` is what stops the sweep and the user disagreeing forever. A session the
 * user archived BY HAND stays archived even if it is not finished; the sweep only
 * ever adds rows it can justify (see {@link sweepArchivable}).
 */
export interface ArchivedEntry {
  archivedAt: number;
  manual: boolean;
}

/** row key → entry. The key is `SessionsLibraryRow.key` (`canvas:<id>` / `chat:<id>`). */
export type ArchiveState = Record<string, ArchivedEntry>;

/**
 * Is this row FINISHED — the `100% ·` the user sees on it?
 *
 * Deliberately reads the same fields the row label reads (`sessionsTree`'s
 * `conversationTreeLabel`), because "100% done" is a claim the UI already makes and
 * the sweep must not make it on different grounds. A row with NO tickets is not
 * finished, it is un-tracked: progress of 100% over zero tickets is vacuous, and
 * sweeping those would archive every ordinary conversation.
 */
export function isSessionComplete(row: SessionsLibraryRow): boolean {
  if (row.source.kind !== "chat") return false;
  const chat = row.source.chat;
  const count = chat.ticketCount ?? 0;
  const pct = chat.ticketProgressPct;
  if (count <= 0 || pct == null || !Number.isFinite(pct)) return false;
  return Math.round(pct) >= 100;
}

/**
 * When a finished row last saw activity, as a timestamp, or null when unknown.
 *
 * The server has no `completedAt` for a chat — progress is DERIVED from linked
 * tickets on read, so there is no moment recorded at which a session became 100%.
 * `lastActivityAt` is the honest stand-in: for a session that is finished and has
 * been sitting untouched, the last activity IS effectively when it finished, and any
 * later interaction pushes it forward (which is exactly the behaviour we want — see
 * {@link sweepArchivable}).
 *
 * A row with no usable timestamp is never swept, rather than being treated as
 * infinitely old.
 */
export function lastActivityMs(row: SessionsLibraryRow): number | null {
  if (!row.lastActivityAt) return null;
  const ms = Date.parse(row.lastActivityAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The rows the sweep should archive right now.
 *
 * A row qualifies when it is finished (100% over at least one ticket), is not
 * already archived, and has been quiet for {@link ARCHIVE_AFTER_DAYS} days. Because
 * the clock runs on LAST ACTIVITY, touching a session resets it — a finished session
 * you keep using is never swept out from under you.
 *
 * Returns the keys rather than mutating: the caller owns the store, and a pure
 * answer is what makes the 5-day boundary testable without waiting five days.
 */
export function sweepArchivable(
  rows: readonly SessionsLibraryRow[],
  state: ArchiveState,
  now: number,
): string[] {
  const due: string[] = [];
  for (const row of rows) {
    if (state[row.key]) continue;
    if (!isSessionComplete(row)) continue;
    const activity = lastActivityMs(row);
    if (activity == null) continue;
    if (now - activity < ARCHIVE_AFTER_MS) continue;
    due.push(row.key);
  }
  return due;
}

/** Archive a row (or several). `manual` marks the ones a person chose. */
export function archive(state: ArchiveState, keys: readonly string[], now: number, manual: boolean): ArchiveState {
  if (keys.length === 0) return state;
  const next = { ...state };
  for (const key of keys) next[key] = { archivedAt: now, manual };
  return next;
}

/** Un-archive a row. Returns the SAME object when nothing changed, so callers can skip a write. */
export function unarchive(state: ArchiveState, key: string): ArchiveState {
  if (!state[key]) return state;
  const next = { ...state };
  delete next[key];
  return next;
}

/**
 * Un-archive because the user INTERACTED with a session (opened it).
 *
 * This is the half that makes the sweep safe to be wrong: if the 5-day rule archives
 * something you still care about, using it puts it back, with no menu to find. A row
 * the user archived BY HAND is left alone — they said "put this away", and opening it
 * to check something is not them taking that back.
 */
export function unarchiveOnInteraction(state: ArchiveState, key: string): ArchiveState {
  const entry = state[key];
  if (!entry || entry.manual) return state;
  return unarchive(state, key);
}

/**
 * Split the list into what the tree draws and what the archive holds.
 *
 * `showArchived` is the view toggle: off (the default) the archived rows are gone
 * from every facet; on, they are drawn in place so the user can see and restore
 * them. Either way `archived` is returned so the group can show its count.
 */
export function partitionArchived(
  rows: readonly SessionsLibraryRow[],
  state: ArchiveState,
): { active: SessionsLibraryRow[]; archived: SessionsLibraryRow[] } {
  const active: SessionsLibraryRow[] = [];
  const archived: SessionsLibraryRow[] = [];
  for (const row of rows) (state[row.key] ? archived : active).push(row);
  return { active, archived };
}

/**
 * Drop entries for rows the server no longer returns.
 *
 * Without this the store grows forever and, worse, a deleted-then-reused key could
 * inherit an archive state that has nothing to do with it. Only pruned against a
 * list we actually fetched — never against an empty/failed read, which would wipe
 * the whole archive the first time the gateway blinked.
 */
export function pruneArchive(state: ArchiveState, rows: readonly SessionsLibraryRow[]): ArchiveState {
  const live = new Set(rows.map((row) => row.key));
  const kept = Object.keys(state).filter((key) => live.has(key));
  if (kept.length === Object.keys(state).length) return state;
  const next: ArchiveState = {};
  for (const key of kept) next[key] = state[key];
  return next;
}
