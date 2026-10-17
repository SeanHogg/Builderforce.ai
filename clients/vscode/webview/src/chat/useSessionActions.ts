/**
 * The conversation's own actions in the composer's `/` menu — Consolidate (summarize the
 * chat into ONE compact assistant message the next turns build on) and Fork (summarize,
 * then continue in a NEW chat seeded with that summary) — plus the open chat's lock
 * state for the rail's People section. Lifted out of the chat surface unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  consolidationMarkerContent,
  consolidationMetadata,
  type BrainChat,
  type BrainPersistenceAdapter,
  type UseBrainConversation,
} from '@seanhogg/builderforce-brain-embedded';

/** LOCK state for the open chat (owner-only toggle in the rail's People section). */
export function useChatVisibility(chatId: number | null, persistence: BrainPersistenceAdapter) {
  const [chatVisibility, setChatVisibility] = useState<'shared' | 'locked'>('shared');
  const [chatIsOwner, setChatIsOwner] = useState(false);
  useEffect(() => {
    if (chatId == null) { setChatVisibility('shared'); setChatIsOwner(false); return; }
    let cancelled = false;
    persistence.getChat(chatId).then((c) => {
      if (cancelled) return;
      const meta = c as unknown as { visibility?: 'shared' | 'locked'; isOwner?: boolean };
      setChatVisibility(meta.visibility ?? 'shared');
      setChatIsOwner(!!meta.isOwner);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [chatId, persistence]);
  return { chatVisibility, setChatVisibility, chatIsOwner };
}

export function useSessionActions({ chatId, conv, persistence, activeChat, fallbackProjectId, setChatId, reloadChats, t }: {
  chatId: number | null;
  conv: UseBrainConversation;
  persistence: BrainPersistenceAdapter;
  activeChat: BrainChat | null;
  /** Where a fork of a project-less chat lands (the sidebar's project). */
  fallbackProjectId: number | null;
  setChatId: (id: number | null) => void;
  reloadChats: () => void;
  t: (key: string, fallback: string) => string;
}) {
  // Async, so guard against double-clicks while in flight.
  const [consolidating, setConsolidating] = useState(false);
  const [forking, setForking] = useState(false);

  // The conversation loop seeds the next turn FROM the consolidation marker, so a long
  // chat sends its summary as the base context instead of the full history.
  const canConsolidate = chatId != null && conv.messages.length >= 2 && !conv.sending;
  const consolidate = useCallback(async () => {
    if (chatId == null || consolidating) return;
    setConsolidating(true);
    conv.clearError();
    try {
      const result = await persistence.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || t('app.nothingToConsolidate', 'Not enough conversation to consolidate yet.'));
        return;
      }
      await persistence.sendMessages(chatId, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      conv.reloadMessages();
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Consolidate failed');
    } finally {
      setConsolidating(false);
    }
  }, [chatId, consolidating, persistence, conv, reloadChats, t]);

  // Continue a fresh, compact conversation (same project) without the whole history.
  const fork = useCallback(async () => {
    if (chatId == null || forking) return;
    setForking(true);
    conv.clearError();
    try {
      const result = await persistence.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || t('app.nothingToFork', 'Not enough conversation to fork yet.'));
        return;
      }
      const sourceTitle = activeChat?.title || t('app.newChat', 'New chat');
      const projectId = activeChat?.projectId ?? fallbackProjectId ?? null;
      const forkTitle = t('app.forkTitle', 'Fork of {title}').replace('{title}', sourceTitle).slice(0, 80);
      const chat = await persistence.createChat({ title: forkTitle, projectId });
      await persistence.sendMessages(chat.id, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      setChatId(chat.id);
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Fork failed');
    } finally {
      setForking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, forking, persistence, conv, reloadChats, activeChat?.title, activeChat?.projectId, fallbackProjectId, t]);

  return chatId != null
    ? { canConsolidate, consolidating, forking, onConsolidate: consolidate, onFork: fork }
    : undefined;
}
