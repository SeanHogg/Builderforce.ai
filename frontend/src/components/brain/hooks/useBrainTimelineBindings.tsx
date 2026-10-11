import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { selectPendingAskUser, askUserAnchorId, type useRecipientChoice } from '@seanhogg/builderforce-brain-ui';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { useBrainTimelineLabels } from '@/i18n/useBrainTimelineLabels';
import { parseSuggestedActions, type useBrainActions, type useBrainChats, type useBrainConversation } from '@/lib/brain';
import type { BrainMessage } from '@/lib/builderforceApi';

/**
 * Everything the shared <BrainTimeline> and the pending-question banner are
 * handed: labels, tool bridges, render props and answer/replay handlers.
 *
 * Memoize the props handed to the React.memo-wrapped <BrainTimeline> and
 * <ChatTicketsPanel> so they don't get a fresh object/closure every render —
 * otherwise the memo never skips and the transcript re-parses markdown on
 * every keystroke/streaming token (mirrors the VS Code webview App.tsx).
 */
export function useBrainTimelineBindings({ conv, chats, recipient, toolSpecs, runTool, bumpParticipants, submitQueued }: {
  conv: ReturnType<typeof useBrainConversation>;
  chats: ReturnType<typeof useBrainChats>;
  recipient: ReturnType<typeof useRecipientChoice>['recipient'];
  toolSpecs: ReturnType<typeof useBrainActions>['toolSpecs'];
  runTool: ReturnType<typeof useBrainActions>['runTool'];
  /** Re-reads the chat's participant roster (after an invite/remove). */
  bumpParticipants: () => void;
  /**
   * The composer's queue (`useQueuedTurns().submit`): holds the turn and returns true
   * while a run is in flight. An answer or replay goes through it like a typed turn —
   * `conv.send` alone refuses a busy chat silently, which lost answered questions.
   */
  submitQueued: (text: string) => boolean;
}) {
  const tTimeline = useTranslations('brain.timeline');
  const tCommon = useTranslations('common');

  const hasTool = useCallback(
    (name: string) => toolSpecs.some((t) => t.function.name === name),
    [toolSpecs],
  );

  // Every string the shared transcript renders, from the ONE web-side bundle — the
  // same one the Canvas dock mounts, so a step can never be worded differently in
  // the two places the same conversation is read.
  const timelineLabels = useBrainTimelineLabels();

  const timelineApplyCode = useMemo(
    () => (hasTool('apply_code_to_active_file')
      ? (code: string) => { void runTool('apply_code_to_active_file', { code }); }
      : undefined),
    [hasTool, runTool],
  );
  const timelineCreateFile = useMemo(
    () => (hasTool('create_file')
      ? (path: string, content: string) => { void runTool('create_file', { path, content }); }
      : undefined),
    [hasTool, runTool],
  );
  // The conversation hook returns a FRESH object every render and `recipient`
  // recomputes as the user types, so a callback that depends on them would change
  // identity every keystroke and defeat <BrainTimeline>'s memo. Read the latest
  // values from a ref instead, keeping the callbacks below referentially stable.
  // The ref is only READ by event handlers, so it is refreshed after commit (a layout
  // effect, ahead of any user event) rather than written during render.
  const timelineCtxRef = useRef({ conv, chats, recipient });
  useLayoutEffect(() => {
    timelineCtxRef.current = { conv, chats, recipient };
  });
  const onAnswerTimelineQuestion = useCallback((answer: string) => {
    if (submitQueued(answer)) return;
    const { conv: c, recipient: r } = timelineCtxRef.current;
    void c.send(answer, { addressedTo: r });
  }, [submitQueued]);
  /** "Send again" on any message: re-ask with the same text. Addressed to the same
   *  recipient as a freshly typed turn, so replaying in a multi-party chat reaches
   *  whoever the composer is currently pointed at rather than silently the Brain. */
  const onReplayTimelineMessage = useCallback((msg: BrainMessage) => {
    if (submitQueued(msg.content)) return;
    const { conv: c, recipient: r } = timelineCtxRef.current;
    void c.send(msg.content, { addressedTo: r });
  }, [submitQueued]);
  // The question this chat is BLOCKED on, if any. A long transcript buries the agent's
  // ask_user card, so the chat reads as merely idle when it is actually waiting on the
  // user — the VSIX has pinned it at the composer since the session-tabs pass, and this
  // is the same shared predicate + banner, so the two surfaces can never disagree about
  // whether a chat is blocked.
  const pendingQuestion = useMemo(() => selectPendingAskUser(conv.messages), [conv.messages]);
  // The banner renders the SAME <QuestionCard> the timeline does, so its card copy is
  // taken from the timeline bundle rather than re-translated — only the two
  // banner-specific strings are new.
  const askLabels = useMemo(() => ({
    askSubmit: timelineLabels.askSubmit,
    askAnswered: timelineLabels.askAnswered,
    askPending: tTimeline('askPending'),
    askJumpTo: tTimeline('askJumpTo'),
    askDismiss: tCommon('dismiss'),
  }), [timelineLabels, tTimeline, tCommon]);
  const revealPendingQuestion = useCallback(() => {
    if (!pendingQuestion) return;
    document.getElementById(askUserAnchorId(pendingQuestion.messageId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pendingQuestion]);

  const renderTimelineMessage = useCallback(
    (msg: BrainMessage, ctx: { role: 'user' | 'assistant'; text: string }) => (
      <ChatMessageContent
        content={ctx.role === 'assistant' ? parseSuggestedActions(msg.content).content : ctx.text}
        onApplyCode={ctx.role === 'assistant' && hasTool('apply_code_to_active_file') ? (code) => { void runTool('apply_code_to_active_file', { code }); } : undefined}
        onCreateFile={ctx.role === 'assistant' && hasTool('create_file') ? (path, content) => { void runTool('create_file', { path, content }); } : undefined}
      />
    ),
    [hasTool, runTool],
  );
  const renderTimelineStreaming = useCallback(
    (text: string) => <ChatMessageContent content={parseSuggestedActions(text).content} />,
    [],
  );
  const onTicketsChanged = useCallback(() => {
    const { conv: c, chats: ch } = timelineCtxRef.current;
    void ch.reload();
    c.reloadMessages();
    bumpParticipants();
  }, [bumpParticipants]);

  return {
    timelineLabels,
    timelineApplyCode,
    timelineCreateFile,
    onAnswerTimelineQuestion,
    onReplayTimelineMessage,
    pendingQuestion,
    askLabels,
    revealPendingQuestion,
    renderTimelineMessage,
    renderTimelineStreaming,
    onTicketsChanged,
  };
}
