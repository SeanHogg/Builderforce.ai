/**
 * The conversation, as THE shared `<AiSurface>`: the info strip (a synced chat's tickets
 * and spend) as its rail, the shared `<BrainTimeline>` over the device record and the
 * live run — or, before the first message, the shared empty state with Rovr's fixed
 * starters — the error card as its notice, and a footer holding the confirmation card
 * the safety gate pauses on, the question the agent is blocked on (the shared pending-
 * question banner) and the shared composer. Every turn — typed, a starter sent, an
 * answered question — leaves through THE shared `useChatTurns` door, and the first one
 * creates the chat through THE shared `useChatCreation`. Which chat is open is chosen from
 * the header's History lever (`RovrChatHistory`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AiSurface,
  BrainTimeline,
  ChatErrorBanner,
  DEFAULT_ASK_USER_LABELS,
  PendingQuestionBanner,
  QueuedTurnChips,
  StarterGroup,
  StarterTile,
  SurfaceEmptyState,
  SurfaceFooter,
  askUserAnchorId,
  selectPendingAskUser,
  stringsFrom,
  timelineCatalogLookup,
  timelineLabelsFrom,
} from '@seanhogg/builderforce-brain-ui';
import catalogs from 'virtual:rovr-timeline-catalogs';
import { deriveChatTitle, useChatCreation, useChatTurns, type BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { PRICING_URL } from '../config';
import { t, uiCatalogLocale } from '../i18n/t';
import type { LocalChat } from '../store/records';
import { ChatInfoStrip } from './ChatInfoStrip';
import { ConfirmCard } from './ConfirmCard';
import { useLoaded, useRun, useServices } from './hooks';
import { RovrComposer } from './RovrComposer';
import { ROVR_STARTERS } from './rovrStarters';
import { useRovrChatOptions } from './useRovrChatOptions';

export interface ChatViewProps {
  chats: LocalChat[];
  chatId: number | null;
  onNewChat(): Promise<number>;
  onChatsChanged(): void;
  onOpenSettings(): void;
}

export function ChatView({ chats, chatId, onNewChat, onChatsChanged, onOpenSettings }: ChatViewProps) {
  const services = useServices();
  const run = useRun(chatId);
  const [draft, setDraft] = useState('');
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
  const [messages, reload] = useLoaded<BrainMessage[]>(
    () => (chatId === null ? Promise.resolve([]) : services.records.listMessages(chatId)),
    [],
    [chatId],
  );
  // The loop persisted a turn (or the run settled) — re-read the device record.
  useEffect(reload, [run.messagesEpoch, run.running, reload]);

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
  });

  // One turn, start to finish.
  const deliver = async (text: string) => {
    try {
      const id = await ensureChatId();
      if (id === null) return;
      await onFirstUserTurn(id, text);
      const sending = services.host.send(id, text);
      reload();
      await sending;
    } catch (error) {
      services.reportError(error, 'chat.send');
    } finally {
      reload();
      onChatsChanged();
    }
  };

  // THE one door a turn leaves through: a turn typed while a run streams is HELD and
  // delivered on the run's falling edge (the composer's Send says "Queue message");
  // Stop drops what is held, then stops the run.
  const turns = useChatTurns<string>({
    running: run.running,
    runKey: chatId,
    send: deliver,
    stop: () => {
      if (chatId !== null) services.host.stop(chatId);
    },
  });
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void turns.submit(text);
  };
  const answer = useCallback((text: string) => void turns.submit(text), [turns.submit]);

  // The question this chat is blocked on, restated above the composer — the same
  // predicate the transcript's card uses, so banner and card never disagree.
  const pendingQuestion = useMemo(() => selectPendingAskUser(messages), [messages]);
  const revealQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    document.getElementById(askUserAnchorId(pendingQuestion.messageId))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pendingQuestion]);

  const empty = messages.length === 0 && !run.running && !run.streamingText;

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
          messages={messages}
          trace={run.trace}
          streamingText={run.streamingText}
          isRunning={run.running}
          activity={run.activity}
          labels={labels}
          assistantName="Rovr"
          onAnswerQuestion={answer}
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
      notices={run.error ? (
        <ChatErrorBanner
          className="rovr-chat__error"
          error={t('runFailed', run.error)}
          action={run.errorAction}
          onDismiss={() => chatId !== null && services.host.clearError(chatId)}
          onSignIn={onOpenSettings}
          onReconnect={onOpenSettings}
          onUpgrade={() => void chrome.tabs.create({ url: PRICING_URL })}
          onValidateCard={() => void chrome.tabs.create({ url: PRICING_URL })}
          labels={{
            signIn: t('signIn'),
            reconnect: t('signIn'),
            noModel: t('needModelOrSignIn'),
            upgrade: t('upgrade'),
            upgradeToPlan: t('upgradeToPlan'),
            addCard: t('addCard'),
            dismiss: t('dismiss'),
          }}
        />
      ) : null}
      footer={(
        <SurfaceFooter
          confirm={run.pendingConfirm && chatId !== null ? <ConfirmCard chatId={chatId} call={run.pendingConfirm} /> : null}
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
              value={draft}
              onChange={setDraft}
              onSubmit={send}
              running={run.running}
              onStop={turns.stop}
              above={(
                <QueuedTurnChips
                  items={turns.queued.items}
                  textOf={(text) => text}
                  onRemove={turns.queued.remove}
                  labels={{ list: t('queuedList'), hint: t('queuedHint'), remove: t('queuedRemove') }}
                />
              )}
              showSuggestions={!empty}
              chatOptions={chatOptions}
              onOpenSettings={onOpenSettings}
            />
          )}
        />
      )}
    />
  );
}
