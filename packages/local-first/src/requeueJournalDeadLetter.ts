/**
 * List and re-queue dead-lettered events of the local-first JOURNAL (not the write-outbox).
 *
 * A dead letter stays in the journal for audit and sync status, and `selectPending` never sends it.
 * Recovery is a NEW event: the same logical write appended again under its idempotency key (a
 * dead-lettered event is not "live", so `append` does not dedupe against it) with a fresh wire id,
 * sequence and hold clock. The dead letter is left as the audit record. A dependent that was
 * BLOCKED by it is unblocked by the new live creating write; nothing is rewritten.
 *
 * Only NON-PERMANENT reasons are recoverable: `dependency_unresolvable` (held past the server's
 * event retention) and `gave_up:*` (held past the give-up age). A permanent refusal (the server said
 * no and a resend cannot change that) is refused with an error: re-sending it would only be refused
 * again. The VS Code command that offers this is `clients/vscode/src/journalDeadLetters.ts`.
 */

import { DEPENDENCY_UNRESOLVABLE } from './holdLimits.js';
import type { JournalEvent } from './records.js';
import type { LocalFirstStore } from './store.js';

/** Whether a dead-letter reason can be retried (see the module comment). */
export function isRequeueableReason(reason: string): boolean {
  return reason === DEPENDENCY_UNRESOLVABLE || reason.startsWith('gave_up:');
}

/** Every dead-lettered journal event, oldest first. */
export async function listJournalDeadLetters(store: LocalFirstStore): Promise<JournalEvent[]> {
  return store.read(async (tx) => {
    const found: JournalEvent[] = [];
    await tx.scanPending((event) => {
      if (event.deadLetter) found.push(event as JournalEvent);
    });
    return found.map((event) => structuredClone(event)).sort((a, b) => a.localSequence - b.localSequence);
  });
}

/**
 * The re-queued event; undefined when `eventId` is unknown or not dead-lettered. Throws
 * `dead_letter_not_requeueable:<reason>` for a permanent refusal.
 */
export async function requeueJournalDeadLetter(store: LocalFirstStore, eventId: string): Promise<JournalEvent | undefined> {
  return store.transact(async (tx) => {
    const found: JournalEvent[] = [];
    await tx.scanPending((event) => {
      if (event.eventId === eventId && event.deadLetter) found.push(event as JournalEvent);
    });
    const dead = found[0];
    if (!dead?.deadLetter) return undefined;
    if (!isRequeueableReason(dead.deadLetter.reason)) {
      throw new Error(`dead_letter_not_requeueable:${dead.deadLetter.reason}`);
    }
    const {
      eventId: _id, localSequence: _sequence, payloadHash: _hash, deadLetter: _dead,
      holdAttempts: _attempts, holdKind: _kind, heldSince: _since, nextAttemptAt: _next,
      ...fresh
    } = dead;
    return tx.append(fresh);
  });
}
