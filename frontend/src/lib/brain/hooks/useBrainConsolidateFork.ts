import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { consolidationMarkerContent, consolidationMetadata } from '@seanhogg/builderforce-brain-embedded';
import type { useBrainChats, useBrainConversation } from '@/lib/brain';
import { brain } from '@/lib/builderforceApi';
import { faultText } from '@/lib/apiClient';

/**
 * Consolidate / Fork.
 *
 * Consolidate: summarize the whole chat into ONE compact assistant message
 * tagged as a consolidation marker. The conversation loop seeds the next turn
 * FROM this marker, so a long chat sends its summary as base context instead of
 * the full history. Fork does the same but into a NEW chat it then switches to.
 * (Web parity for the VS Code webview App.tsx consolidate/fork actions.)
 */
export function useBrainConsolidateFork({ chats, conv, pinnedProjectId, viewingProjectId }: {
  chats: ReturnType<typeof useBrainChats>;
  conv: ReturnType<typeof useBrainConversation>;
  pinnedProjectId: number | null;
  viewingProjectId: number | null;
}) {
  const tBrain = useTranslations('brain');
  const [consolidating, setConsolidating] = useState(false);
  const [forking, setForking] = useState(false);
  const canConsolidate = chats.activeChatId != null && conv.messages.length >= 2 && !conv.sending;

  const consolidate = useCallback(async () => {
    const chatId = chats.activeChatId;
    if (chatId == null || consolidating || forking) return;
    setConsolidating(true);
    conv.clearError();
    try {
      const result = await brain.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || tBrain('nothingToConsolidate'));
        return;
      }
      await brain.sendMessages(chatId, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      conv.reloadMessages();
      void chats.reload();
    } catch (e) {
      conv.setError(faultText(e, tBrain('consolidateFailed')));
    } finally {
      setConsolidating(false);
    }
  }, [chats, consolidating, forking, conv, tBrain]);

  const fork = useCallback(async () => {
    const chatId = chats.activeChatId;
    if (chatId == null || forking || consolidating) return;
    setForking(true);
    conv.clearError();
    try {
      const result = await brain.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || tBrain('nothingToFork'));
        return;
      }
      const sourceTitle = chats.activeChat?.title || tBrain('newChatFallback');
      const projectId = chats.activeChat?.projectId ?? pinnedProjectId ?? viewingProjectId ?? null;
      const forkTitle = tBrain('forkOf', { title: sourceTitle }).slice(0, 80);
      const created = await chats.create({ title: forkTitle, projectId });
      if (!created) return;
      await brain.sendMessages(created.id, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      conv.reloadMessages();
      void chats.reload();
    } catch (e) {
      conv.setError(faultText(e, tBrain('forkFailed')));
    } finally {
      setForking(false);
    }
  }, [chats, forking, consolidating, conv, pinnedProjectId, viewingProjectId, tBrain]);

  return { canConsolidate, consolidating, forking, consolidate, fork };
}
