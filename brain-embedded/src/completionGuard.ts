/**
 * The COMPLETION guard — a ticket marked done while the run's own code still carries
 * placeholders it wrote.
 *
 * Measured on chat #126 (VSIX 2026.9.89): the placeholder guard caught
 * `// For now, we'll try without token for public repos` the moment it was written, and
 * the same run then set that ticket (#2747, "invoke blueprint detection on commits") to
 * `done`. The advisory arrived on the write; nothing spoke at the moment the claim was
 * MADE. So the run keeps a ledger of the placeholders it wrote and has not since removed,
 * and a ticket moved to done while any are outstanding is told so on the result it reads.
 *
 * The ledger follows the writes it can see: a `write_file` replaces a file's entries with
 * whatever the new content carries; an `edit_file` removes the placeholder lines its
 * `old_string` held and its `new_string` does not, and adds any it introduced. Pure state,
 * no I/O — it never reads the disk, so it can only under-report, never invent.
 */

import { markedLines, type PlaceholderHit } from './placeholderGuard';

/** A tool call that marks a ticket finished. */
const TICKET_UPDATE = /tasks[._]update/i;
const DONE_STATUSES = new Set(['done', 'completed', 'complete']);

export function isTicketCompletion(tool: string, args: unknown): boolean {
  if (!TICKET_UPDATE.test(tool)) return false;
  const status = (args as { status?: unknown } | null)?.status;
  return typeof status === 'string' && DONE_STATUSES.has(status.toLowerCase());
}

/**
 * Guard against marking a ticket done when code is NOT on the base branch.
 * A ticket should only be marked done when:
 * 1. The code has been shipped to main/master (not a feature branch)
 * 2. OR the user explicitly asked not to commit/push
 *
 * This prevents the issue where tickets appear done but code is still on a feature branch.
 */
export function canCompleteTicket(
  isOnBaseBranch: boolean,
  userDeclinedShipping: boolean,
): boolean {
  // Always allow if code is on base branch (main/master)
  if (isOnBaseBranch) return true;
  // Allow if user explicitly declined shipping (asked to leave uncommitted)
  if (userDeclinedShipping) return true;
  // Otherwise, prevent marking as done - code must be on base branch first
  return false;
}

/**
 * Advisory message shown when trying to mark a ticket done without shipping to base branch.
 */
export function notOnBaseBranchAdvisory(): string {
  return 'CANNOT MARK DONE — code is not on the base branch (main/master). Either ship to main/master first, or if you intentionally left the code uncommitted, say so explicitly in your reply so this guard knows to allow it.';
}

/** Placeholders this run wrote and has not removed, by file. */
export class PlaceholderLedger {
  private readonly open = new Map<string, Set<string>>();

  /** Account for ONE successful write, given the hits the guard found in it. */
  record(tool: string, args: unknown, hits: readonly PlaceholderHit[]): void {
    const a = (args ?? {}) as Record<string, unknown>;
    const path = typeof a.path === 'string' ? a.path : '';
    if (!path) return;
    if (tool === 'write_file') {
      // The whole file was replaced: what it holds now is exactly what this write carried.
      this.set(path, hits.map((h) => h.text));
      return;
    }
    if (tool === 'edit_file') {
      const current = new Set(this.open.get(path) ?? []);
      const removed = typeof a.old_string === 'string' ? markedLines(a.old_string) : [];
      const kept = new Set(typeof a.new_string === 'string' ? markedLines(a.new_string) : []);
      for (const text of removed) if (!kept.has(text)) current.delete(text);
      for (const h of hits) current.add(h.text);
      this.set(path, [...current]);
      return;
    }
    if (tool === 'delete_file') this.open.delete(path);
  }

  /** Placeholders a delegated child reported writing. The parent never saw those edits,
   *  so they stay outstanding until the parent rewrites or edits the lines itself. */
  add(hits: readonly PlaceholderHit[]): void {
    for (const h of hits) {
      const texts = this.open.get(h.path) ?? new Set<string>();
      texts.add(h.text);
      this.open.set(h.path, texts);
    }
  }

  outstanding(): PlaceholderHit[] {
    return [...this.open.entries()].flatMap(([path, texts]) => [...texts].map((text) => ({ path, text })));
  }

  private set(path: string, texts: readonly string[]): void {
    if (texts.length) this.open.set(path, new Set(texts));
    else this.open.delete(path);
  }
}

/** What the model reads when it marks a ticket done over outstanding placeholders. */
export function completionAdvisory(open: readonly PlaceholderHit[]): string | null {
  if (!open.length) return null;
  const shown = open.slice(0, 3).map((h) => `${h.path}: \`${h.text}\``).join('; ');
  return `MARKED DONE OVER A PLACEHOLDER. This run wrote ${open.length} placeholder(s) it has not removed — ${shown}${open.length > 3 ? ` (+${open.length - 3} more)` : ''}. A ticket is done when its code works in the product, not when a stub compiles. Finish the placeholder and keep the ticket done, or set it back to in_progress and name what blocks it.`;
}
