/**
 * The conversation: the shared `<BrainTimeline>` transcript over the device record and
 * the live run, the confirmation card the safety gate pauses on, and the composer.
 */
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { BrainTimeline, timelineCatalogLookup, timelineLabelsFrom } from '@seanhogg/builderforce-brain-ui';
import catalogs from 'virtual:rovr-timeline-catalogs';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { t, uiCatalogLocale } from '../i18n/t';
import type { LocalChat } from '../store/records';
import { ConfirmCard } from './ConfirmCard';
import { useLoaded, useRun, useServices } from './hooks';

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

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || run.running) return;
    setDraft('');
    const id = chatId ?? (await onNewChat());
    const chat = await services.records.getChat(id);
    if (chat && chat.title === t('newChatTitle')) {
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

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
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

      <form className="rovr-composer" onSubmit={(e) => void send(e)}>
        <label className="rovr-sr" htmlFor="rovr-composer-input">
          {t('composerLabel')}
        </label>
        <textarea
          id="rovr-composer-input"
          className="rovr-input"
          rows={2}
          value={draft}
          placeholder={t('composerPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        {run.running ? (
          <button type="button" className="rovr-btn" onClick={() => chatId !== null && services.host.stop(chatId)}>
            {t('stop')}
          </button>
        ) : (
          <button type="submit" className="rovr-btn rovr-btn--primary" disabled={!draft.trim()}>
            {t('send')}
          </button>
        )}
      </form>
    </section>
  );
}
