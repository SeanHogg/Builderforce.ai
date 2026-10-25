/**
 * WHO is in the open chat and who the next message goes to — the invited agents and
 * people, the live sub-agents (addressable with `@`), the roster the RUN is told about,
 * and the composer's effective recipient. Lifted out of the chat surface.
 */

import { useEffect, useMemo } from 'react';
import { chatRosterFromParticipants, type BrainMessage, type ChatRosterAgent } from '@seanhogg/builderforce-brain-embedded';
import { useChatActivitySignal, useChatParticipants, useRecipientChoice } from '@seanhogg/builderforce-brain-ui';
import type { createChatTicketsAdapter } from '../chatTicketsAdapter';
import { childParticipants, useChatChildren, useChatSubagentRoster } from './chatChildren';

export function useChatAudience({ ticketAdapter, chatId, serverChatId, messages, ticketRefresh, input, onRoster }: {
  ticketAdapter: ReturnType<typeof createChatTicketsAdapter>;
  /** The chat's local view key — what its live sub-agents run under on this machine. */
  chatId: number | null;
  /** The chat's bound SERVER id (PRD 36) — who is invited lives on the platform. Null when unbound. */
  serverChatId: number | null;
  messages: BrainMessage[];
  ticketRefresh: number;
  input: string;
  /**
   * Mirror of the roster for `useBrainConversation`. The conversation cannot read
   * `participants` directly: the activity signal below makes them depend on its
   * messages. The one render of lag costs nothing — the roster is only read when a run
   * STARTS — and `participants` is memoised on its own inputs, so the cycle settles.
   */
  onRoster: (roster: ChatRosterAgent[]) => void;
}) {
  // A run milestone joins its agent to the chat server-side; the activity line arriving
  // over the live subscription is the signal to re-read the Agents list.
  const activitySignal = useChatActivitySignal(messages);
  const railRefresh = ticketRefresh + activitySignal;
  const participants = useChatParticipants(ticketAdapter, serverChatId, railRefresh);
  // The chat's live sub-agents are addressable too: `@Ada …` (or a `#ticket` one of them
  // is working) steers that child's run instead of starting a turn of the chat's own.
  const liveChildren = useChatChildren(chatId);
  const subagentRoster = useChatSubagentRoster(chatId);
  const mentionable = useMemo(() => [...participants, ...childParticipants(liveChildren)], [participants, liveChildren]);

  useEffect(() => { onRoster(chatRosterFromParticipants(participants)); }, [participants, onRoster]);

  // The effective target (shared with the web composer): an explicit BRAIN pick wins;
  // else an explicit participant; else a leading @mention; else the BRAIN (null). The
  // pick resets on a chat switch and drops a participant who has since left.
  const { recipient, choose: chooseRecipient } = useRecipientChoice({ participants: mentionable, input, resetKey: chatId });

  return { railRefresh, participants, liveChildren, subagentRoster, mentionable, recipient, chooseRecipient };
}
