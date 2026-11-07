/**
 * WHO is in the open chat and who the next message goes to — the invited agents and
 * people, the live sub-agents (addressable with `@`), the roster the RUN is told about,
 * and the composer's effective recipient. Lifted out of the chat surface.
 */

import { useEffect, useMemo } from 'react';
import { chatRosterFromParticipants, type BrainMessage, type ChatRosterAgent, type ComposerDraftStore } from '@seanhogg/builderforce-brain-embedded';
import { useChatActivitySignal, useChatParticipants, useRecipientChoice } from '@seanhogg/builderforce-brain-ui';
import type { createChatTicketsAdapter } from '../chatTicketsAdapter';
import { useWebviewOffline } from '../platformPolicy';
import { childParticipants, useChatChildren, useChatSubagentRoster } from './chatChildren';

export function useChatAudience({ ticketAdapter, chatId, serverChatId, messages, ticketRefresh, draftStore, personaAgents, onRoster }: {
  ticketAdapter: ReturnType<typeof createChatTicketsAdapter>;
  /** The chat's local view key — what its live sub-agents run under on this machine. */
  chatId: number | null;
  /** The chat's bound SERVER id (PRD 36) — who is invited lives on the platform. Null when unbound. */
  serverChatId: number | null;
  messages: BrainMessage[];
  ticketRefresh: number;
  /** The composer's text: only WHO a leading @mention names is read from it, so a keystroke re-renders nothing here. */
  draftStore: ComposerDraftStore;
  /** The persona agents the Brain can answer as — the `@` picker's offline candidates. */
  personaAgents: ReadonlyArray<{ ref: string; name: string }>;
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
  // OFFLINE `@`: with the platform denied there are no invited participants to read;
  // the addressable set is who is actually HERE — the live local sub-agents and the
  // persona agents the Brain can answer as — so `@` still routes a turn offline.
  // Reactive: a `platform.policy` frame that arrives after mount must re-render the
  // picker roster, or the `@` typeahead stays starved on the wrong (offline) source.
  const offline = useWebviewOffline();
  const localMentionable = useMemo<typeof participants>(
    () => (offline ? [...childParticipants(liveChildren), ...personaAgents.map((a) => ({ kind: 'agent' as const, ref: a.ref, name: a.name }))] : []),
    [offline, liveChildren, personaAgents],
  );
  const mentionable = useMemo(
    () => (offline ? localMentionable : [...participants, ...childParticipants(liveChildren)]),
    [offline, localMentionable, participants, liveChildren],
  );

  useEffect(() => { onRoster(chatRosterFromParticipants(offline ? localMentionable : participants)); }, [offline, localMentionable, participants, onRoster]);

  // The effective target (shared with the web composer): an explicit BRAIN pick wins;
  // else an explicit participant; else a leading @mention; else the BRAIN (null). The
  // pick resets on a chat switch and drops a participant who has since left.
  const { recipient, choose: chooseRecipient } = useRecipientChoice({ participants: mentionable, draftStore, resetKey: chatId });

  return { railRefresh, participants, liveChildren, subagentRoster, mentionable, recipient, chooseRecipient, personaAgents, offline };
}
