/**
 * The chat-history idle age — how many FULL days have passed since a chat was last
 * touched or last executed (`updatedAt`). The shared history row renders this as a
 * short chip (`5D`), and the editor's archive sweep uses the same number against the
 * `builderforce.history.autoArchiveAfterDays` threshold to decide what to archive.
 *
 * Pure and host-agnostic so the webview, the host sweep and the tests share one clock
 * rule: `nowMs` is injectable, and an invalid/absent `updatedAt` yields `null` (the
 * row renders no chip, the sweep skips the chat) rather than a bogus `0D`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Full days elapsed since `updatedAt` — `0` for anything touched today, `5` for a
 * chat last touched five days ago. `null` when `updatedAt` is absent or not a real
 * timestamp, so "unknown" never masquerades as "fresh".
 */
export function daysIdleOf(chat: { updatedAt?: string | null }, nowMs: number = Date.now()): number | null {
  const at = Date.parse(chat.updatedAt ?? '');
  if (!Number.isFinite(at)) return null;
  return Math.floor((nowMs - at) / DAY_MS);
}
