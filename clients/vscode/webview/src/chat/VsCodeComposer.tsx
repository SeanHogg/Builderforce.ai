/**
 * The editor chat's prompt area — THE shared `BrainComposer` (the same component the
 * web Brain, the canvas and Rovr mount), filled with this surface's state and ports.
 *
 * The chat surface used to carry its own inline composer: a `PromptPanel`, a textarea
 * with hand-wired @-mention and #-ticket pickers, its own `+` popover, its own trailing
 * button and its own account readout under the `/` menu. Every one of those had a twin
 * on the web that drifted from it. Now this container only adapts: it turns the
 * conversation, the run-shaping switches and the host's label bundle into the shared
 * composer's props, and owns the two behaviours that are the editor's own — attaching a
 * workspace file as context, and linking a `#`-tagged ticket to the chat.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PERSONA,
  type BrainPersonaAgent,
  type BrainPersonaChoice,
  type ChatMode,
  type DirectedRecipient,
  type UseBrainConversation,
} from '@seanhogg/builderforce-brain-embedded';
import {
  BrainComposer,
  PersonaPicker,
  RecipientPicker,
  type ComposerOptions,
  type RecipientPickerProps,
} from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from '../authedFetch';
import { openUpgrade } from '../accountPlan';
import type { createChatTicketsAdapter } from '../chatTicketsAdapter';
import { webviewLocalModelStore } from '../pageEngines';
import { post, request, type InitData } from '../vscodeBridge';
import { makeT, personaModalityOptions, personaPickerLabels, recipientPickerLabels } from './chatLabels';
import { brainComposerLabels } from './composerLabels';
import { QueuedMessages, type QueuedMessage } from './QueuedMessages';
import type { useComposerModels } from './useComposerModels';
import type { useRunShaping } from './useRunShaping';

type ChatTicket = { id: number; title: string; status?: string; key?: string };

export interface VsCodeComposerProps {
  init: InitData;
  apiReq: AuthedFetch;
  conv: UseBrainConversation;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  focusToken?: number;
  chatId: number | null;
  /** The chat's project (chat-first, else the sidebar's) — the Status tab's Evermind and the Memory row. */
  projectId: number | null;
  ensureChatId: () => Promise<number>;
  ticketAdapter: ReturnType<typeof createChatTicketsAdapter>;
  ticketRefresh: number;
  onTicketLinked: () => void;
  /** The chat's participants (the "To" picker) and everyone addressable with `@` (incl. live sub-agents). */
  participants: DirectedRecipient[];
  mentionable: DirectedRecipient[];
  /** Live sub-agents keep the pickers open mid-run: they are who a message may be for. */
  hasLiveChildren: boolean;
  recipient: DirectedRecipient | null;
  chooseRecipient: RecipientPickerProps['onChoose'];
  persona: BrainPersonaChoice;
  onPersona: (p: BrainPersonaChoice) => void;
  personaAgents: BrainPersonaAgent[];
  queue: readonly QueuedMessage[];
  onRemoveQueued: (id: number) => void;
  mode: { value: ChatMode; onChange: (mode: ChatMode) => void };
  memory: { enabled: boolean; onChange: (on: boolean) => void };
  shaping: ReturnType<typeof useRunShaping>;
  models: ReturnType<typeof useComposerModels>;
  /** What actually answered last (under auto, `init.model` is only the plan default). */
  servedModel: string | null | undefined;
  autoMode: { enabled: boolean; onChange: (on: boolean) => void };
  session?: ComposerOptions['session'];
}

export function VsCodeComposer(props: VsCodeComposerProps) {
  const {
    init, apiReq, conv, value, onChange, onSubmit, focusToken, chatId, projectId, ensureChatId,
    ticketAdapter, ticketRefresh, onTicketLinked, participants, mentionable, hasLiveChildren,
    recipient, chooseRecipient, persona, onPersona, personaAgents, queue, onRemoveQueued,
    mode, memory, shaping, models, servedModel, autoMode, session,
  } = props;
  const t = makeT(init.labels);
  const labels = useMemo(
    () => brainComposerLabels(init.labels, init.modelLabels, init.locale),
    [init.labels, init.modelLabels, init.locale],
  );
  const personaLabels = useMemo(() => personaPickerLabels(init.labels), [init.labels]);
  const personaModalities = useMemo(() => personaModalityOptions(init.labels), [init.labels]);
  const recipientLabels = useMemo(() => recipientPickerLabels(init.labels), [init.labels]);

  // #-ticket typeahead: the chat's linked tickets. A chat that does not exist yet has
  // none — asking for `/chats/null/tickets` was a failing request on every new chat.
  const [chatTickets, setChatTickets] = useState<ChatTicket[]>([]);
  useEffect(() => {
    if (chatId == null) { setChatTickets([]); return; }
    let live = true;
    ticketAdapter.listTickets(chatId).then((tickets) => {
      if (!live) return;
      setChatTickets(tickets.map((tk) => ({
        id: parseInt(tk.ref) || tk.linkId,
        title: tk.label || tk.ref,
        status: tk.status,
        key: tk.ref,
      })));
    }).catch(() => { if (live) setChatTickets([]); });
    return () => { live = false; };
  }, [chatId, ticketAdapter, ticketRefresh]);

  // A ticket tagged in the box is linked to the chat — creating the chat first, the
  // same guard every other write on this surface goes through.
  const tagTicket = useCallback(async (ticket: ChatTicket) => {
    try {
      const id = await ensureChatId();
      await ticketAdapter.linkTicket(id, { kind: 'task', ref: ticket.key ?? String(ticket.id), linkType: 'linked' });
      onTicketLinked();
    } catch { /* linking is best-effort — a failed link never blocks the chat */ }
  }, [ensureChatId, ticketAdapter, onTicketLinked]);

  const attachFiles = useCallback((files: File[]) => {
    for (const f of files) void conv.attach(f);
  }, [conv]);

  // "Add context": the host picks a workspace file (or the active selection) and the
  // text goes through the SAME upload pipeline as a dropped file.
  const addContext = useCallback(() => {
    void (async () => {
      try {
        const ctx = await request<{ path: string; text: string } | null>('context.pick');
        if (!ctx || !ctx.text) return;
        await conv.attach(new File([ctx.text], ctx.path || 'context.txt', { type: 'text/plain' }));
      } catch { /* host cancelled / no workspace — nothing to attach */ }
    })();
  }, [conv]);

  const { composerModels, modelSelection, chooseModel, catalogLoaded } = models;
  const options: ComposerOptions = {
    mode,
    // No project memory behind this chat ⇒ the switch gates nothing; it shows, and says so.
    memory: { enabled: memory.enabled, onChange: memory.onChange, available: projectId != null },
    effort: { value: shaping.effort, onChange: shaping.setEffort },
    thinking: { value: shaping.thinking, onChange: shaping.setThinking },
    model: {
      selection: modelSelection,
      options: composerModels.options,
      onChange: chooseModel,
      effective: servedModel ?? init.model,
      identity: composerModels.identity,
      // The webview's own page engines — a pin crosses the bridge like any `model.set`.
      localStore: webviewLocalModelStore,
      // No gateway catalog yet: entitlement is unknown, so the menu must not say the
      // plan forbids choosing a model.
      identityPending: !catalogLoaded,
    },
    autoMode,
    session,
  };

  return (
    <BrainComposer
      className="bf-composer"
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      running={conv.sending}
      onStop={conv.stop}
      focusToken={focusToken}
      placeholder={recipient
        ? t('app.messageParticipant', 'Message {name}…').replace('{name}', recipient.name)
        : undefined}
      options={options}
      account={{ request: apiReq, projectId, locale: init.locale, onUpgrade: openUpgrade }}
      onAccountSettings={() => post('settings')}
      attachments={{
        items: conv.pendingAttachments,
        onAdd: attachFiles,
        onRemove: conv.removeAttachment,
        uploading: conv.uploading,
      }}
      onAddContext={addContext}
      webBrowsing={{ on: shaping.webBrowsing, onChange: shaping.setWebBrowsing }}
      mentions={{ participants: mentionable, onPick: chooseRecipient }}
      tickets={{ tickets: chatTickets, onPick: tagTicket }}
      pickersDisabled={conv.sending && !hasLiveChildren}
      voice
      context={<>
        {/* Acting as — WHO the Brain answers as; hidden until there is someone else to be. */}
        <PersonaPicker
          value={persona}
          onChange={onPersona}
          modalities={personaModalities}
          agents={personaAgents}
          labels={personaLabels}
          quietAt={DEFAULT_PERSONA}
        />
        {/* To — the BRAIN (executes) or a participant (talked to). Self-hides when solo. */}
        <RecipientPicker
          participants={participants}
          recipient={recipient}
          onChoose={chooseRecipient}
          labels={recipientLabels}
        />
      </>}
      // Messages queued behind the in-flight run — each sends on its own once the run
      // finishes, or is steered into it now.
      above={queue.length > 0
        ? <QueuedMessages queue={queue} runningChatId={conv.sending ? chatId : null} labels={init.labels} onRemove={onRemoveQueued} />
        : undefined}
      labels={labels}
    />
  );
}
