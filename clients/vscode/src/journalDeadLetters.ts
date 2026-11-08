/**
 * The local-first JOURNAL's dead letters, as a branch of `builderforce.exportDeadLetters`.
 *
 * `deadLetterCommand.ts` handles the write-outbox queues. The journal (the chat/ticket/project
 * events `@builderforce/local-first` syncs) dead-letters separately: `dependency_unresolvable`
 * (waited past the server's event retention), `gave_up:*`, or a permanent refusal. This lists
 * them and offers Retry for the ones that can be retried, through `requeueJournalDeadLetter` on the
 * host's own store. It never sends, flushes, or calls the platform: a retried write is queued and
 * goes out on the next sync like any other.
 *
 * Pure of `vscode`: the host supplies the UI, so every string is localized where it is shown.
 */

import {
  isRequeueableReason,
  listJournalDeadLetters,
  requeueJournalDeadLetter,
  type JournalEvent,
  type LocalFirstStore,
} from "@builderforce/local-first";

export interface JournalDeadLetterChoice {
  eventId: string;
  entityType: string;
  clientEntityId: string;
  operation: string;
  reason: string;
  at: string;
}

export interface JournalDeadLetterUi {
  /** Return the event id to retry, or undefined to leave them all. */
  offerRetry(choices: readonly JournalDeadLetterChoice[]): Promise<string | undefined>;
  showNone(): void | Promise<void>;
  /** Some dead letters exist but none can be retried (permanent refusals). */
  showNotRetryable(count: number): void | Promise<void>;
  showRequeued(choice: JournalDeadLetterChoice): void | Promise<void>;
  showFailed(choice: JournalDeadLetterChoice, detail: string): void | Promise<void>;
}

export interface JournalDeadLettersResult {
  letters: readonly JournalDeadLetterChoice[];
  requeuedEventId?: string;
}

const toChoice = (event: JournalEvent): JournalDeadLetterChoice => ({
  eventId: event.eventId,
  entityType: event.entityType,
  clientEntityId: event.clientEntityId,
  operation: event.operation,
  reason: event.deadLetter?.reason ?? "",
  at: event.deadLetter?.at ?? "",
});

/** List the journal's dead letters and, if the person picks a retryable one, queue it again. */
export async function runJournalDeadLetters(
  store: LocalFirstStore,
  ui: JournalDeadLetterUi,
): Promise<JournalDeadLettersResult> {
  const letters = (await listJournalDeadLetters(store)).map(toChoice);
  if (letters.length === 0) {
    await ui.showNone();
    return { letters };
  }
  const retryable = letters.filter((letter) => isRequeueableReason(letter.reason));
  if (retryable.length === 0) {
    await ui.showNotRetryable(letters.length);
    return { letters };
  }
  const picked = await ui.offerRetry(retryable);
  const choice = retryable.find((letter) => letter.eventId === picked);
  if (!choice) return { letters };
  try {
    const requeued = await requeueJournalDeadLetter(store, choice.eventId);
    if (!requeued) {
      await ui.showFailed(choice, "not_dead_lettered");
      return { letters };
    }
    await ui.showRequeued(choice);
    return { letters, requeuedEventId: requeued.eventId };
  } catch (error) {
    await ui.showFailed(choice, (error as Error).message);
    return { letters };
  }
}
