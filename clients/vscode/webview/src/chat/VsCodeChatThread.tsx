/**
 * The chat surface's THREAD slot: the shared `<BrainTimeline>` inside the editor's
 * translation wiring, judging "mine vs a teammate's" against the signed-in viewer.
 * Extracted from `VsCodeChatSurface` (the container) — the transcript and what it
 * needs to translate live here together.
 */
import { useMemo, type ComponentProps } from 'react';
import type { useBrainConversation } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline, ownMessageOf } from '@seanhogg/builderforce-brain-ui';
import type { InitData } from '../vscodeBridge';
import { useViewerId } from './useViewerId';
import { VsCodeTranslationProvider } from './VsCodeTranslationProvider';
import { useRunDeltaCards } from './runDelta/useRunDeltaCards';

type TimelineProps = ComponentProps<typeof BrainTimeline>;

export interface VsCodeChatThreadProps {
  init: InitData;
  conv: ReturnType<typeof useBrainConversation>;
  chatId: number | null;
  labels: TimelineProps['labels'];
  modelIdentity: TimelineProps['modelIdentity'];
  onAnswerQuestion: TimelineProps['onAnswerQuestion'];
  onReplayMessage: TimelineProps['onReplayMessage'];
  revealMessage: TimelineProps['revealMessage'];
  prefetch: TimelineProps['prefetch'];
}

export function VsCodeChatThread({ init, conv, chatId, labels, modelIdentity, onAnswerQuestion, onReplayMessage, revealMessage, prefetch }: VsCodeChatThreadProps) {
  // The signed-in user (the token's subject) is the viewer: a teammate's message is offered for translation, the viewer's own never.
  const viewerId = useViewerId();
  const isOwnMessage = useMemo(() => ownMessageOf(viewerId), [viewerId]);
  // The run delta card at the end of each run, and its details panel (PRD 41 §C11).
  const runDelta = useRunDeltaCards(chatId, conv.messages, labels);
  return (
    <VsCodeTranslationProvider init={init}>
      <BrainTimeline
        messages={conv.messages}
        trace={conv.trace}
        streamingText={conv.sending ? conv.streamingText : ''}
        isRunning={conv.sending}
        activity={conv.activity}
        // Sent, not saved yet: the turn shows now - and a draft chat shows the thread, not its empty state.
        pendingUserText={conv.pendingTurn?.text}
        // The model doing the work, once its route is known.
        liveModel={conv.servedBy?.model}
        liveAccount={conv.servedBy?.account}
        loading={conv.loadingMessages}
        assistantName="BuilderForce"
        labels={labels}
        isOwnMessage={isOwnMessage}
        modelIdentity={modelIdentity}
        onAnswerQuestion={onAnswerQuestion}
        onReplayMessage={onReplayMessage}
        onRateMessage={conv.rateMessage}
        ratings={conv.ratings}
        revealMessage={revealMessage}
        conversationKey={chatId}
        prefetch={prefetch}
        renderMessage={runDelta.renderMessage}
      />
      {runDelta.panel}
    </VsCodeTranslationProvider>
  );
}
