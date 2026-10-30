'use client';

/**
 * Auto-reply when a chat loads with a trailing unanswered user message (e.g. a chat seeded
 * elsewhere and deep-linked into the Brain). Lifted out of `useBrainConversation`, which
 * owns the transcript and the run doors; this owns only the decision to answer on load.
 *
 * Skipped when a run for this chat is already in flight (the store is single-flight, so
 * this only guards against starting redundant work / a self re-answer).
 */

import { useEffect, type MutableRefObject } from 'react';
import { isMidTurnMetadata } from '@builderforce/agent-loop';
import { isLive } from './brainRunStore';
import { isDirectedToParticipant } from './directedMessage';
import type { BrainMessage } from './types';
import { startsRun } from './userTurnRuns';

export function useAutoReplyTrailingTurn({ chatId, loadingMessages, localSending, messages, repliedRef, reply }: {
  chatId: number | null;
  loadingMessages: boolean;
  localSending: boolean;
  messages: BrainMessage[];
  /** The chat last answered (or claimed by a user-driven send) — never answered twice. */
  repliedRef: MutableRefObject<number | null>;
  /** Start the run on the trailing turn `last`. */
  reply: (chatId: number, last: BrainMessage) => void;
}): void {
  useEffect(() => {
    if (chatId == null || loadingMessages || localSending || messages.length === 0) return;
    if (isLive(chatId)) return;
    const last = messages[messages.length - 1]!;
    if (last.role !== 'user') return;
    // A trailing message addressed to a participant is NOT a directive for the
    // BRAIN — leave it unanswered (the participant owns the reply).
    if (isDirectedToParticipant(last)) return;
    // A MID-TURN user row was already delivered — steered into the run that was live
    // when it was sent (`run.steer`), which hears it before its next turn. It is not
    // an unanswered request, and replaying it would start a second run on it.
    if (isMidTurnMetadata(last.metadata)) return;
    // A stop is answered by stopping: reopening the chat must not start the work again.
    if (!startsRun(last.content)) return;
    if (repliedRef.current === chatId) return;
    repliedRef.current = chatId;
    reply(chatId, last);
  }, [chatId, loadingMessages, localSending, messages, repliedRef, reply]);
}
