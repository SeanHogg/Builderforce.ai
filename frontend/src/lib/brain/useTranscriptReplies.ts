import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { askUserAnchorId, selectPendingAskUser, type AskUserMessageLike, type BrainTimelineLabels } from '@seanhogg/builderforce-brain-ui';

/**
 * THE ONE REPLY PATH out of a transcript — "send again" on a message and the answer to
 * an ask_user card. Both are just the host's next turn with that text, so both go
 * through the ONE `send` the host's composer uses (the web panel's queue-or-send, the
 * canvas's `startCanvasTurn`) and are scoped, queued and narrated like a typed prompt.
 *
 * The web Brain panel and the Creation Canvas each wrote this pair by hand. The
 * callbacks are referentially stable whatever `send` closes over: `<BrainTimeline>` is
 * memoized, and a fresh closure per render would re-parse the whole transcript's
 * markdown on every keystroke and streaming token. `send` is read from a ref refreshed
 * after commit (a layout effect, ahead of any user event), never during render.
 */
export function useTranscriptReplies(send: (text: string) => void) {
  const sendRef = useRef(send);
  useLayoutEffect(() => {
    sendRef.current = send;
  });
  const onAnswerQuestion = useCallback((answer: string) => sendRef.current(answer), []);
  const onReplayMessage = useCallback((message: { content: string }) => sendRef.current(message.content), []);
  return { onAnswerQuestion, onReplayMessage };
}

/**
 * The question a conversation is BLOCKED on, if any, with the copy and the jump the
 * pinned `<PendingQuestionBanner>` needs. A long transcript buries the agent's ask_user
 * card, so the chat reads as merely idle when it is actually waiting on the reader; the
 * banner pins it at the composer. Shared by every web surface that mounts the banner so
 * they can never disagree about whether a chat is blocked.
 *
 * The banner renders the SAME `<QuestionCard>` the timeline does, so its card copy is
 * taken from the host's timeline bundle rather than re-translated — only the banner's
 * own strings are read here.
 */
export function usePendingQuestion(messages: readonly AskUserMessageLike[], timelineLabels: Pick<BrainTimelineLabels, 'askSubmit' | 'askAnswered'>) {
  const tTimeline = useTranslations('brain.timeline');
  const tCommon = useTranslations('common');
  const pendingQuestion = useMemo(() => selectPendingAskUser(messages), [messages]);
  const askLabels = useMemo(() => ({
    askSubmit: timelineLabels.askSubmit,
    askAnswered: timelineLabels.askAnswered,
    askPending: tTimeline('askPending'),
    askJumpTo: tTimeline('askJumpTo'),
    askDismiss: tCommon('dismiss'),
  }), [timelineLabels.askSubmit, timelineLabels.askAnswered, tTimeline, tCommon]);
  const revealPendingQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    document.getElementById(askUserAnchorId(pendingQuestion.messageId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pendingQuestion]);
  return { pendingQuestion, askLabels, revealPendingQuestion };
}
