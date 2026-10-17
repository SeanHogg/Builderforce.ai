/**
 * The conversation, as THE shared `<AiSurface>`: the info strip (a synced chat's tickets
 * and spend) as its rail, the shared `<BrainTimeline>` over the device record and the
 * live run — or, before the first message, the shared empty state with Rovr's fixed
 * starters — the error card as its notice, and a footer holding the confirmation card
 * the safety gate pauses on and the shared composer. Which chat is open is chosen from
 * the header's History lever (`RovrChatHistory`).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AiSurface,
  BrainTimeline,
  ChatErrorBanner,
  QueuedTurnChips,
  StarterGroup,
  StarterTile,
  SurfaceEmptyState,
  SurfaceFooter,
  timelineCatalogLookup,
  timelineLabelsFrom,
  useQueuedTurns,
} from '@seanhogg/builderforce-brain-ui';
import catalogs from 'virtual:rovr-timeline-catalogs';
import { deriveChatTitle, type BrainMessage } from '@seanhogg/builderforce-brain-embedded';
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
  const labels = useMemo(
    () => timelineLabelsFrom(timelineCatalogLookup(catalogs[uiCatalogLocale()]), { assistant: 'Rovr', empty: t('chatEmpty') }),
    [],
  );
  const [messages, reload] = useLoaded<BrainMessage[]>(
    () => (chatId === null ? Promise.resolve([]) : services.records.listMessages(chatId)),
    [],
    [chatId],
  );
  // The loop persisted a turn (or the run settled) — re-read the device record.
  useEffect(reload, [run.messagesEpoch, run.running, reload]);

  // One turn, start to finish. A turn typed while a run streams is HELD by the queue
  // and delivered on the run's falling edge — the composer's Send says "Queue message".
  const deliver = async (text: string) => {
    let id = chatId;
    if (id === null) {
      // The first message creates the chat — with the `/` choices made before it existed.
      id = await onNewChat();
      await services.records.updateChat(id, chatOptions.draft);
    }
    const current = await services.records.getChat(id);
    if (current && current.title === t('newChatTitle')) {
      // The ONE first-message title rule every surface uses (brain-embedded).
      const title = deriveChatTitle(text);
      if (title) await services.records.updateChat(id, { title });
      onChatsChanged();
    }
    try {
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

  const queued = useQueuedTurns({ running: run.running, send: (text) => void deliver(text), resetKey: chatId });
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (queued.submit(text)) return;
    void deliver(text);
  };
  const stop = () => {
    queued.clear();
    if (chatId !== null) services.host.stop(chatId);
  };

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
          composer={(
            <RovrComposer
              value={draft}
              onChange={setDraft}
              onSubmit={send}
              running={run.running}
              onStop={stop}
              above={(
                <QueuedTurnChips
                  items={queued.items}
                  textOf={(text) => text}
                  onRemove={queued.remove}
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
