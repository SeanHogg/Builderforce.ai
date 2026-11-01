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

import { memo, useCallback, useMemo } from 'react';
import { webviewInferenceMode } from './inferenceModeOption';
import {
  DEFAULT_PERSONA,
  type BrainPersonaAgent,
  type BrainPersonaChoice,
  type ChatMode,
  type ChatInputAttachment,
  type ComposerDraftStore,
  type ContextUsage,
  type DirectedRecipient,
} from '@seanhogg/builderforce-brain-embedded';
import {
  BrainComposer,
  PersonaPicker,
  QueuedTurnChips,
  RecipientPicker,
  composerModel,
  useComposerMenuRequest,
  type ComposerOptions,
  type QueuedItem,
  type RecipientPickerProps,
} from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from '../authedFetch';
import { openUpgrade } from '../accountPlan';
import { editorConnections } from '../providerConnections';
import { webviewLocalModelStore } from '../pageEngines';
import { post, request, type InitData } from '../vscodeBridge';
import { makeT, personaModalityOptions, personaPickerLabels, queuedTurnLabels, recipientPickerLabels } from './chatLabels';
import { brainComposerLabels } from './composerLabels';
import { editorStarters } from './editorStarters';
import { steerRun } from './chatChildren';
import type { useComposerModels } from './useComposerModels';
import type { useRunShaping } from './useRunShaping';
import type { TypeaheadTicket } from './useTicketRail';


/** What a held VS Code turn carries — its text, who it is addressed to, and any
 *  attachments it was sent with. The steer path clears the composer's `pendingAttachments`
 *  at queue time, so a held turn must keep its own snapshot or `send` would see an empty
 *  composer when it finally drains. */
export interface QueuedTurn {
  text: string;
  recipient: DirectedRecipient | null;
  attachments?: ChatInputAttachment[];
}

export interface VsCodeComposerProps {
  /** This composer's id — the key the chat's error banner opens ITS `/` menu with. */
  composerId: string;
  init: InitData;
  apiReq: AuthedFetch;
  /** The composer's text (`useComposerDraftStore()`): the box subscribes to it, this component never re-renders on a key. */
  draftStore: ComposerDraftStore;
  /**
   * What the conversation hands the composer, as narrow stable fields - NOT the per-render `conversation` object, which is
   * new on every streamed token and would re-render the whole prompt area with each one.
   */
  /** A turn is in flight: Send steers it, an empty box offers Stop. */
  running: boolean;
  /** The files the next turn will carry, and the ports that add / remove them. */
  pendingAttachments: readonly ChatInputAttachment[];
  uploading: boolean;
  onAttach: (file: File) => Promise<void>;
  onRemoveAttachment: (key: string) => void;
  /** How full the model's context was on the last turn. */
  contextUsage: ContextUsage | null;
  onSubmit: () => void;
  /** Alt+Enter mid-run — `useChatSend().queueAfter`: hold the message for after the run
   *  (Send steers the running turn; this is the explicit alternative). */
  onQueue?: () => void;
  /** Whether Send mid-run steers the run (true) or the message is held (false) - `useChatSend().sendSteers`, the door's own predicate; it words the Send button. */
  sendSteers?: boolean;
  /** The composer's Stop — `useChatSend().stop`: drops the held turns AND stops the run. */
  onStop: () => void;
  /** Seed the box with a fixed starter's prompt and focus it — the empty state's tiles do the same. */
  onPickStarter: (prompt: string) => void;
  focusToken?: number;
  chatId: number | null;
  /** The chat's project (chat-first, else the sidebar's) — the Status tab's Evermind and the Memory row. */
  projectId: number | null;
  ensureChatId: () => Promise<number>;
  /** `useTicketRail().typeaheadTickets` — the chat's linked tickets, for the `#` typeahead. */
  chatTickets: TypeaheadTicket[];
  /** `useTicketRail().linkTicket` — binds the LOCAL chat first, then links. */
  linkTicket: (localChatId: number, ticket: { kind: string; ref: string }) => Promise<void>;
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
  queue: readonly QueuedItem<QueuedTurn>[];
  onRemoveQueued: (id: number) => void;
  mode: { value: ChatMode; onChange: (mode: ChatMode) => void };
  memory: { enabled: boolean; onChange: (on: boolean) => void };
  shaping: ReturnType<typeof useRunShaping>;
  models: ReturnType<typeof useComposerModels>;
  /** What actually answered last (under auto, `init.model` is only the plan default). */
  servedModel: string | null | undefined;
  autoMode: { enabled: boolean; onChange: (on: boolean) => void };
  session?: ComposerOptions['session'];
  /** Offer the fixed next steps as chips — off while the empty state shows them as tiles. */
  suggest?: boolean;
}

function VsCodeComposerInner(props: VsCodeComposerProps) {
  const {
    composerId, init, apiReq, draftStore, running, pendingAttachments, uploading, onAttach, onRemoveAttachment, contextUsage,
    onSubmit, onQueue, sendSteers, onStop, onPickStarter, focusToken, chatId, projectId, ensureChatId,
    chatTickets, linkTicket, participants, mentionable, hasLiveChildren,
    recipient, chooseRecipient, persona, onPersona, personaAgents, queue, onRemoveQueued,
    mode, memory, shaping, models, servedModel, autoMode, session, suggest = true,
  } = props;
  const t = useMemo(() => makeT(init.labels), [init.labels]);
  const labels = useMemo(
    () => brainComposerLabels(init.labels, init.modelLabels, init.locale),
    [init.labels, init.modelLabels, init.locale],
  );
  // The Status tab's Connected accounts — Test / Reconnect without leaving the chat.
  const connections = useMemo(() => editorConnections(init.baseUrl), [init.baseUrl]);
  const personaLabels = useMemo(() => personaPickerLabels(init.labels), [init.labels]);
  const personaModalities = useMemo(() => personaModalityOptions(init.labels), [init.labels]);
  const recipientLabels = useMemo(() => recipientPickerLabels(init.labels), [init.labels]);
  const queuedLabels = useMemo(() => queuedTurnLabels(init.labels), [init.labels]);

  // A ticket tagged in the box is linked to the chat — creating the chat first, then
  // binding it, the same path as the ticket a chat was opened for. (`ensureChatId` can
  // fail; `linkTicket` swallows its own errors.)
  const tagTicket = useCallback(async (ticket: TypeaheadTicket) => {
    try {
      await linkTicket(await ensureChatId(), { kind: 'task', ref: ticket.key ?? String(ticket.id) });
    } catch { /* linking is best-effort — a failed link never blocks the chat */ }
  }, [ensureChatId, linkTicket]);

  const attachFiles = useCallback((files: File[]) => {
    for (const f of files) void onAttach(f);
  }, [onAttach]);

  // "Add context": the host picks a workspace file (or the active selection) and the
  // text is attached like a dropped text file — the host keeps it and inlines it into
  // the turn (`hostPersistence.ts` → `attachment.ingress`).
  const addContext = useCallback(() => {
    void (async () => {
      try {
        const ctx = await request<{ path: string; text: string } | null>('context.pick');
        if (!ctx || !ctx.text) return;
        await onAttach(new File([ctx.text], ctx.path || 'context.txt', { type: 'text/plain' }));
      } catch { /* host cancelled / no workspace — nothing to attach */ }
    })();
  }, [onAttach]);

  const { composerModels, modelSelection, chooseModel, catalogLoaded } = models;
  // "Pick a model" (the error banner beside this composer) opens this menu's Model tab.
  const openMenu = useComposerMenuRequest(composerId);
  // One object until a setting moves: the menu (and the composer around it) is memoized on it, so a streamed token or a
  // keystroke elsewhere in the surface does not rebuild the model list.
  const options = useMemo<ComposerOptions>(() => ({
    mode,
    // No project memory behind this chat ⇒ the switch gates nothing; it shows, and says so.
    memory: { enabled: memory.enabled, onChange: memory.onChange, available: projectId != null },
    effort: { value: shaping.effort, onChange: shaping.setEffort },
    thinking: { value: shaping.thinking, onChange: shaping.setThinking },
    model: composerModel({ catalog: composerModels, selection: modelSelection, onChange: chooseModel, effective: servedModel ?? init.model, localStore: webviewLocalModelStore, identityPending: !catalogLoaded }),
    inferenceMode: webviewInferenceMode(init),
    ...(openMenu ? { openMenu } : {}),
    autoMode,
    session,
  }), [mode, memory.enabled, memory.onChange, projectId, shaping, composerModels, modelSelection, chooseModel, servedModel, init, catalogLoaded, openMenu, autoMode, session]);

  const suggestions = useMemo(() => (suggest ? {
    // Fixed next steps — a chip seeds the box; the person edits and sends it. The same
    // list the empty state shows as tiles (`editorStarters`), so not both at once.
    label: t('app.suggestions', 'Suggested next steps'),
    items: editorStarters(t).map((s) => ({ id: s.id, label: s.label, onSelect: () => onPickStarter(s.prompt) })),
  } : undefined), [suggest, t, onPickStarter]);
  const placeholder = recipient
    ? t('app.messageParticipant', 'Message {name}…').replace('{name}', recipient.name)
    : undefined;
  const account = useMemo(
    () => ({ request: apiReq, projectId, locale: init.locale, onUpgrade: openUpgrade, connections }),
    [apiReq, projectId, init.locale, connections],
  );
  const attachments = useMemo(
    () => ({ items: pendingAttachments, onAdd: attachFiles, onRemove: onRemoveAttachment, uploading }),
    [pendingAttachments, attachFiles, onRemoveAttachment, uploading],
  );
  const webBrowsing = useMemo(
    () => ({ on: shaping.webBrowsing, onChange: shaping.setWebBrowsing }),
    [shaping.webBrowsing, shaping.setWebBrowsing],
  );
  const mentions = useMemo(() => ({ participants: mentionable, onPick: chooseRecipient }), [mentionable, chooseRecipient]);
  const tickets = useMemo(() => ({ tickets: chatTickets, onPick: tagTicket }), [chatTickets, tagTicket]);
  const openAccountSettings = useCallback(() => post('settings'), []);
  const context = useMemo(() => (
    <>
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
    </>
  ), [persona, onPersona, personaModalities, personaAgents, personaLabels, participants, recipient, chooseRecipient, recipientLabels]);
  // Messages queued behind the in-flight run — each sends on its own once the run
  // finishes, or is steered into it now. Held turns — the shared chips; a turn addressed to the run (no participant) can be
  // steered into it now instead of after it.
  const above = useMemo(() => (
    <QueuedTurnChips
      items={queue}
      textOf={(turn) => turn.text}
      onRemove={onRemoveQueued}
      {...(running && chatId != null ? {
        onSteer: (item: QueuedItem<QueuedTurn>) => { steerRun(chatId, item.value.text, item.value.attachments); onRemoveQueued(item.id); },
        canSteer: (item: QueuedItem<QueuedTurn>) => !item.value.recipient,
      } : {})}
      labels={queuedLabels}
    />
  ), [queue, onRemoveQueued, running, chatId, queuedLabels]);

  return (
    <BrainComposer
      suggestions={suggestions}
      className="bf-composer"
      draftStore={draftStore}
      onSubmit={onSubmit}
      running={running}
      // Stop drops the held turns too — the person stopped the conversation, not one sentence.
      onStop={onStop}
      // Send steers the running turn; Alt+Enter holds the message for after it.
      {...(onQueue ? { onQueue } : {})}
      {...(sendSteers !== undefined ? { sendSteers } : {})}
      focusToken={focusToken}
      placeholder={placeholder}
      options={options}
      account={account}
      onAccountSettings={openAccountSettings}
      attachments={attachments}
      onAddContext={addContext}
      webBrowsing={webBrowsing}
      mentions={mentions}
      tickets={tickets}
      pickersDisabled={running && !hasLiveChildren}
      voice
      context={context}
      // How full the model's context was on the last turn — the run compacts on its own.
      contextUsage={contextUsage}
      above={above}
      labels={labels}
    />
  );
}

/**
 * Memoized: every prop is a stable value (the surface memoizes the groups it builds), so a streamed token or a keystroke - which
 * re-render the surface or only the textarea - leave the prompt area alone.
 */
export const VsCodeComposer = memo(VsCodeComposerInner);
