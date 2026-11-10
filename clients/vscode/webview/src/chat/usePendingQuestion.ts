/**
 * The question this chat is BLOCKED on, restated at the composer — one shared predicate
 * (`selectPendingAskUser`), so banner and card never disagree — and the banner's "show me",
 * which goes through the transcript's own reveal: the question's message is paged into the
 * render window and the stick-to-bottom scroll lets go.
 */
import { useCallback, useMemo, useState } from 'react';
import { selectPendingAskUser } from '@seanhogg/builderforce-brain-ui';
import type { InitData } from '../vscodeBridge';
import { askUserLabels } from './chatLabels';

export function usePendingQuestion(messages: Parameters<typeof selectPendingAskUser>[0], labels: InitData['labels']) {
  const pendingQuestion = useMemo(() => selectPendingAskUser(messages), [messages]);
  const askLabels = useMemo(() => askUserLabels(labels), [labels]);
  const [reveal, setReveal] = useState<{ id: number; nonce: number } | null>(null);
  const revealQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    setReveal((r) => ({ id: pendingQuestion.messageId, nonce: (r?.nonce ?? 0) + 1 }));
  }, [pendingQuestion]);
  return { pendingQuestion, askLabels, reveal, revealQuestion };
}
