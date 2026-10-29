/**
 * The conversation, as THE shared `<AiSurface>`: the info strip (a synced chat's tickets
 * and spend) as its rail, the shared `<BrainTimeline>` over the device record and the
 * live run — or, before the first message, the shared empty state with Rovr's fixed
 * starters — the error card as its notice, and a footer holding the confirmation card
 * the safety gate pauses on, the question the agent is blocked on (the shared pending-
 * question banner) and the shared composer. The conversation is THE shared
 * `useBrainConversation` — the same hook as the web Brain and the VS Code webview, with
 * Rovr's stream, device record and run-time parts (`prepareRun`) injected — so the turn,
 * the run, its error and its remedies ("Switch to Hybrid" re-sends the refused turn) are
 * one code path on every surface. Every turn — typed, a starter sent, an answered
 * question — leaves through THE shared `useChatTurns` door, and the first one creates the
 * chat through THE shared `useChatCreation`. Which chat is open is chosen from
 * the header's History lever (`RovrChatHistory`).
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  AiSurface,
  BrainTimeline,
  ChatErrorBanner,
  DEFAULT_ASK_USER_LABELS,
  ModelFallbackNotice,
  DEFAULT_QUEUED_TURN_LABELS,
  PendingQuestionBanner,
  QueuedTurnChips,
  modelRemedies,
  StarterGroup,
  StarterTile,
  SurfaceEmptyState,
  SurfaceFooter,
  askUserAnchorId,
  selectPendingAskUser,
  stringsFrom,
  timelineCatalogLookup,
  timelineLabelsFrom,
  useModelFallback,
} from '@seanhogg/builderforce-brain-ui';
import catalogs from 'virtual:rovr-timeline-catalogs';
import { chatDoorLiveness, deriveChatTitle, useBrainConversation, useChatCreation, useChatTurns } from '@seanhogg/builderforce-brain-embedded';
import { PRICING_URL } from '../config';
import { t, uiCatalogLocale, type MessageKey } from '../i18n/t';
import type { LocalChat } from '../store/records';
import { ChatInfoStrip } from './ChatInfoStrip';
import { ConfirmCard } from './ConfirmCard';
import { connectRequiredProvider } from '../inference/connectedAccount';
import { KimiConnectCard } from './KimiConnect';
import { useInferenceModeState, useRun, useServices } from './hooks';
import { rovrLookup } from './labels/rovrLookup';
import { RovrComposer } from './RovrComposer';
import { ROVR_STARTERS } from './rovrStarters';
import { useRovrChatOptions } from './useRovrChatOptions';
import { rovrPrefetchTimeline } from './knowledge/knowledgeChips';
import type { KnowledgeChipIntent } from '@builderforce/knowledge-browser';

/** brain-ui's canonical queued-turn keys → Rovr messages. */
const QUEUED_KEY: Readonly<Record<string, MessageKey>> = { list: 'queuedList', hint: 'queuedHint', remove: 'queuedRemove' };

export interface ChatViewProps {
  chats: LocalChat[];
  chatId: number | null;
  onNewChat(): Promise<number>;
  onChatsChanged(): void;
  onOpenSettings(): void;
  /** Text another view puts in THIS composer (Knowledge's *Fix with agent*); the person
   *  presses send. Taken once — `onDraftSeedTaken` clears it, so a later remount of the
   *  chat does not put it back. */
  draftSeed?: string | null;
  onDraftSeedTaken?(): void;
  /** A chat answer's knowledge chip (Open in graph, Choose a folder to review) → the Knowledge tab. */
  onOpenKnowledge?(intent: KnowledgeChipIntent): void;
}

export function ChatView({ chats, chatId, onNewChat, onChatsChanged, onOpenSettings, draftSeed, onDraftSeedTaken, onOpenKnowledge }: ChatViewProps) {
  // A deterministic answer's line and chips, in Rovr's words; its knowledge chips open the tab.
  const prefetch = useMemo(() => (onOpenKnowledge ? rovrPrefetchTimeline(t, onOpenKnowledge) : undefined), [onOpenKnowledge]);
  const services = useServices();
  const inferenceMode = useInferenceModeState();
  // The notice names the chat it happened in; opening another chat retires it.
  useEffect(() => { services.modelFallback.clear(); }, [chatId, services.modelFallback]);
  const fallback = useModelFallback(services.modelFallback);
  const fallbackNotice = fallback ? (
    <ModelFallbackNotice
      channel={services.modelFallback}
      // Chrome substitutes `$1`; brain-ui fills its `{model}` token — one translation.
      labels={{ fallback: t('modelFallback', '{model}'), dismiss: t('dismiss') }}
    />
  ) : null;
  // The composer below, as the error banner names it to open its `/` menu.
  const composerId = useId();
  const run = useRun(chatId);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (!draftSeed) return;
    setDraft(draftSeed);
    onDraftSeedTaken?.();
  }, [draftSeed, onDraftSeedTaken]);
  const chat = chats.find((c) => c.id === chatId);
  const chatOptions = useRovrChatOptions(chat, onChatsChanged);
  // The transcript's copy — and the pending question's, from the same `brain.timeline` catalog.
  const [labels, askLabels] = useMemo(() => {
    const lookup = timelineCatalogLookup(catalogs[uiCatalogLocale()]);
    return [
      timelineLabelsFrom(lookup, { assistant: 'Rovr', empty: t('chatEmpty') }),
      { ...stringsFrom(DEFAULT_ASK_USER_LABELS, lookup), askDismiss: t('dismiss') },
    ] as const;
  }, []);
  // The first message creates the chat — with the `/` choices made before it existed —
  // and names it by THE one first-message title rule (brain-embedded). A second send
  // before the device record's write lands JOINS that creation.
  const { ensureChatId, onFirstUserTurn } = useChatCreation({
    chatId,
    create: async () => {
      const created = await onNewChat();
      await services.records.updateChat(created, chatOptions.draft);
      return created;
    },
    autoTitle: async (id, text) => {
      const current = await services.records.getChat(id);
      if (current?.title !== t('newChatTitle')) return;
      const title = deriveChatTitle(text);
      if (title) await services.records.updateChat(id, { title });
      onChatsChanged();
    },
    // The prompt itself, on the device — the platform create carries it when the chat
    // reaches the cloud (migration 1245), which also covers an offline first turn.
    // Write-once: a chat that already has one keeps it, and the panel reads it from
    // the platform chat. Never awaited (the seam's contract) so a failed device write
    // cannot break the first turn — and so this port reports its own failure.
    onCaptureOriginalRequest: async (id, text) => {
      try {
        const current = await services.records.getChat(id);
        if (current?.originalRequest) return;
        await services.records.updateChat(id, { originalRequest: text });
        onChatsChanged();
      } catch (error) {
        services.reportError(error, 'chat.captureOriginalRequest');
      }
    },
  });

  // THE shared conversation over this chat: the transcript (the device record), the
  // turn, the run and its live view, Stop, the error and the refused turn's re-send.
  const conv = useBrainConversation({
    chatId,
    ensureChatId,
    onFirstUserTurn: (id, text) => { void onFirstUserTurn(id, text); },
    // What only Rovr knows at run time: the browser tools bound to THIS chat, the
    // working tab's prompt, the chat's `/` choices (`host/rovrRunHost.ts`).
    prepareRun: services.host.prepareRun,
    onActivity: onChatsChanged,
  });
  const messages = conv.messages;

  // THE one door a turn leaves through: a turn typed while a run streams STEERS it (the
  // composer's Send says so) - it interrupts the step in flight and reaches the next model
  // call; what the run never drained is sent as the next turn. The explicit "Queue for
  // after" holds one for the run's falling edge. Stop drops what is held, then stops the run.
  const turns = useChatTurns<string>({
    ...chatDoorLiveness(conv),
    runKey: chatId,
    send: async (text) => {
      try {
        return await conv.send(text);
      } catch (error) {
        services.reportError(error, 'chat.send');
        return false;
      } finally {
        onChatsChanged();
      }
    },
    stop: conv.stop,
  });
  // A turn the door did not keep (the send failed before it was saved - an expired session) gives its
  // words back to the box, as the web and the editor do: a message is never lost to a failed send.
  const offer = (text: string, door: (text: string) => Promise<boolean>) => {
    setDraft('');
    void door(text).then((kept) => { if (!kept) setDraft((cur) => cur || text); });
  };
  const send = () => {
    const text = draft.trim();
    if (text) offer(text, turns.submit);
  };
  const queueAfter = () => {
    const text = draft.trim();
    if (text) offer(text, turns.queueAfter);
  };
  // An answered ask_user card is a turn like a typed one: a failed send gives the answer back to the box.
  const answer = useCallback((text: string) => {
    void turns.submit(text).then((kept) => { if (!kept) setDraft((cur) => cur || text); });
  }, [turns.submit]);

  // The question this chat is blocked on, restated above the composer — the same
  // predicate the transcript's card uses, so banner and card never disagree.
  const pendingQuestion = useMemo(() => selectPendingAskUser(messages), [messages]);
  const revealQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    document.getElementById(askUserAnchorId(pendingQuestion.messageId))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pendingQuestion]);

  const empty = messages.length === 0 && !conv.sending && !conv.streamingText;

  // THE shared AI surface body: rail · thread (or the empty state) · notices · footer.
  return (
    <AiSurface
      className="rovr-chat"
      label={t('tabChat')}
      rail={chatOptions.signedIn && chat?.serverId ? (
        <ChatInfoStrip
          serverId={chat.serverId}
          projectId={chatOptions.projectId}
          chats={chats}
          run={run}
          onChanged={onChatsChanged}
        />
      ) : null}
      thread={(
        <BrainTimeline
          conversationKey={chatId}
          messages={messages}
          trace={conv.trace}
          streamingText={conv.streamingText}
          isRunning={conv.sending}
          activity={conv.activity}
          labels={labels}
          assistantName="Rovr"
          onAnswerQuestion={answer}
          // The thumb is the E5 `rating` verdict on the latest local reply (resolved by
          // the shared hook, in this page where Rovr's model stream runs). Rovr's device
          // record keeps no server rating, so the press is a verdict, not a stored fact.
          onRateMessage={conv.rateMessage}
          ratings={conv.ratings}
          {...(prefetch ? { prefetch } : {})}
        />
      )}
      empty={empty ? (
        <SurfaceEmptyState
          layout="docked"
          title={t('chatEmptyTitle')}
          hint={t('chatEmpty')}
          starters={(
            <StarterGroup heading={t('suggestionsLabel')}>
              {ROVR_STARTERS.map((s) => (
                <StarterTile key={s.id} icon={s.icon} label={t(s.label)} hint={t(s.prompt)} onClick={() => setDraft(t(s.prompt))} />
              ))}
            </StarterGroup>
          )}
        />
      ) : undefined}
      notices={fallbackNotice || conv.error ? (
        <>
          {/* Hybrid's pick failed and the turn was answered with Auto — said in one line. */}
          {fallbackNotice}
          {conv.error && connectRequiredProvider(conv.error) === 'kimi' ? (
            // A Kimi turn whose account is not connected (or not granted to Rovr yet): offer
            // the connect right here — clearing the failed turn once it lands.
            <KimiConnectCard onConnected={conv.clearError} />
          ) : conv.error ? (
            <ChatErrorBanner
              className="rovr-chat__error"
              error={t('runFailed', conv.error)}
              action={conv.errorAction}
              onDismiss={conv.clearError}
              onSignIn={onOpenSettings}
              // Nothing can take the turn for a reason sign-in won't fix: brain-ui's ONE
              // remedies — Hybrid (only on Local only), Settings (where on-device models are
              // downloaded), and this composer's Model tab for "Pick a model".
              {...modelRemedies({
                mode: inferenceMode.loaded ? inferenceMode.mode : undefined,
                setMode: (mode) => services.policy.setInferenceMode(mode),
                composerId,
                onDismiss: conv.clearError,
                downloadLocalModel: onOpenSettings,
                // "Switch to Hybrid" re-sends the refused turn — the one already on record.
                retry: () => { conv.retryLastTurn(); },
              })}
              onReconnect={onOpenSettings}
              onUpgrade={() => void chrome.tabs.create({ url: PRICING_URL })}
              onValidateCard={() => void chrome.tabs.create({ url: PRICING_URL })}
              labels={{
                signIn: t('signIn'),
                reconnect: t('signIn'),
                noModel: t('needModelOrSignIn'),
                noLocalModel: t('noLocalModel'),
                switchToHybrid: t('switchToHybrid'),
                downloadLocalModel: t('downloadLocalModel'),
                noSpecificModel: t('noSpecificModel'),
                pickModel: t('pickModel'),
            engineCrashed: t('engineCrashed'),
            engineDetached: t('engineDetached'),
            modelKeepsCrashing: t('modelKeepsCrashing'),
            continuationTimedOut: t('continuationTimedOut'),
            manageLocalModels: t('manageLocalModels'),
                platformRefusedMode: t('platformRefusedMode'),
                platformRefusedSync: t('platformRefusedSync'),
                platformRefusedSetting: t('platformRefusedSetting'),
                upgrade: t('upgrade'),
                upgradeToPlan: t('upgradeToPlan'),
                addCard: t('addCard'),
                dismiss: t('dismiss'),
              }}
            />
          ) : null}
        </>
      ) : null}
      footer={(
        <SurfaceFooter
          confirm={conv.pendingConfirm && chatId !== null ? <ConfirmCard chatId={chatId} call={conv.pendingConfirm} /> : null}
          question={pendingQuestion && (
            <PendingQuestionBanner
              key={pendingQuestion.messageId}
              payload={pendingQuestion.payload}
              labels={askLabels}
              onAnswer={answer}
              onReveal={revealQuestion}
            />
          )}
          composer={(
            <RovrComposer
              composerId={composerId}
              value={draft}
              onChange={setDraft}
              onSubmit={send}
              running={conv.sending}
              onStop={turns.stop}
              onQueue={queueAfter}
              sendSteers={turns.steers({ directed: false })}
              above={(
                <QueuedTurnChips
                  items={turns.queued.items}
                  textOf={(text) => text}
                  onRemove={turns.queued.remove}
                  labels={stringsFrom(DEFAULT_QUEUED_TURN_LABELS, rovrLookup((k) => QUEUED_KEY[k]))}
                />
              )}
              showSuggestions={!empty}
              contextUsage={conv.contextUsage}
              chatOptions={chatOptions}
              onOpenSettings={onOpenSettings}
            />
          )}
        />
      )}
    />
  );
}
