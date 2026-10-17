/**
 * The conversation: the shared info strip (a synced chat's tickets and spend), the
 * shared `<BrainTimeline>` transcript over the device record and the live run, the
 * confirmation card the safety gate pauses on, and the shared composer.
 */
import { useEffect, useMemo, useState } from 'react';
import { BrainTimeline, timelineCatalogLookup, timelineLabelsFrom, useQueuedTurns } from '@seanhogg/builderforce-brain-ui';
import catalogs from 'virtual:rovr-timeline-catalogs';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { t, uiCatalogLocale } from '../i18n/t';
import type { LocalChat } from '../store/records';
import { ChatInfoStrip } from './ChatInfoStrip';
import { ConfirmCard } from './ConfirmCard';
import { useLoaded, useRun, useServices } from './hooks';
import { RovrComposer } from './RovrComposer';
import { useRovrChatOptions } from './useRovrChatOptions';

const TITLE_MAX = 60;

export interface ChatViewProps {
  chats: LocalChat[];
  chatId: number | null;
  onSelect(chatId: number): void;
  onNewChat(): Promise<number>;
  onChatsChanged(): void;
  onOpenSettings(): void;
}

export function ChatView({ chats, chatId, onSelect, onNewChat, onChatsChanged, onOpenSettings }: ChatViewProps) {
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
      await services.records.updateChat(id, { title: text.replace(/\s+/g, ' ').slice(0, TITLE_MAX) });
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

  const needsModel = /not_signed_in/.test(run.error);

  return (
    <section className="rovr-chat">
      <div className="rovr-row rovr-chat__bar">
        <label className="rovr-sr" htmlFor="rovr-chat-select">
          {t('chatPickerLabel')}
        </label>
        <select
          id="rovr-chat-select"
          className="rovr-select"
          value={chatId ?? ''}
          onChange={(e) => onSelect(Number(e.target.value))}
          disabled={chats.length === 0}
        >
          {chats.length === 0 && <option value="">{t('noChats')}</option>}
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button type="button" className="rovr-btn" onClick={() => void onNewChat()}>
          {t('newChat')}
        </button>
      </div>

      {chatOptions.signedIn && chat?.serverId ? (
        <ChatInfoStrip
          serverId={chat.serverId}
          projectId={chatOptions.projectId}
          chats={chats}
          run={run}
          onChanged={onChatsChanged}
        />
      ) : null}

      <div className="rovr-chat__transcript">
        <BrainTimeline
          messages={messages}
          trace={run.trace}
          streamingText={run.streamingText}
          isRunning={run.running}
          activity={run.activity}
          labels={labels}
          assistantName="Rovr"
        />
      </div>

      {run.error && (
        <div className="rovr-banner" role="alert">
          <p>{needsModel ? t('needModelOrSignIn') : t('runFailed', run.error)}</p>
          <div className="rovr-row">
            {needsModel && (
              <button type="button" className="rovr-btn rovr-btn--primary" onClick={onOpenSettings}>
                {t('signIn')}
              </button>
            )}
            <button type="button" className="rovr-btn" onClick={() => chatId !== null && services.host.clearError(chatId)}>
              {t('dismiss')}
            </button>
          </div>
        </div>
      )}

      {run.pendingConfirm && chatId !== null && <ConfirmCard chatId={chatId} call={run.pendingConfirm} />}

      <RovrComposer
        value={draft}
        onChange={setDraft}
        onSubmit={send}
        running={run.running}
        onStop={stop}
        below={queued.count > 0 ? (
          <p className="rovr-muted" role="status">
            {queued.count === 1 ? t('queuedOne') : t('queuedMany', String(queued.count))}
          </p>
        ) : null}
        chatOptions={chatOptions}
        onOpenSettings={onOpenSettings}
      />
    </section>
  );
}
