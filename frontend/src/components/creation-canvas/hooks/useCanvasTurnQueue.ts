/** Starting, queueing and stopping Brain turns. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useInsertionEffect, useRef } from 'react';
import type { CanvasExportAction } from '@/lib/canvasExports';
import { useLatestRef } from './useLatestRef';
import { useQueuedTurns } from '@/lib/brain';
import { creationSessionsApi, type CreationTimelineMessage } from '@/lib/builderforceApi';
import type { useTranslations } from 'next-intl';
import type { AssessmentGate } from '@/lib/academic/assessment';

export interface UseCanvasTurnQueueDeps {
  appendTimeline: (role: 'user' | 'assistant' | 'system', body: string, metadata?: CreationTimelineMessage['metadata'], clientMessageId?: string) => string;
  assistantGate: AssessmentGate;
  canvasRunRef: RefObject<{ abort: AbortController; requestMessageId: string; startedAt: number; } | null>;
  evaluateCanvas: (promptOverride?: string) => void;
  exportArtifact: (nodeId: string, action: CanvasExportAction) => Promise<string>;
  persistence: 'local' | 'server';
  prompt: string;
  resolvedScopeMode: 'canvas' | 'selection' | 'connected' | 'frame';
  scopedNodeIds: Set<string>;
  sessionId: string;
  setActiveAgentIds: Dispatch<SetStateAction<Set<string>>>;
  setBrainRunStartedAt: Dispatch<SetStateAction<number | null>>;
  setNotice: (text: string) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setThinking: Dispatch<SetStateAction<boolean>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  thinking: boolean;
}

export function useCanvasTurnQueue({ appendTimeline, assistantGate, canvasRunRef, evaluateCanvas, exportArtifact, persistence, prompt, resolvedScopeMode, scopedNodeIds, sessionId, setActiveAgentIds, setBrainRunStartedAt, setNotice, setPrompt, setThinking, t, thinking }: UseCanvasTurnQueueDeps) {
  /**
   * Export from a card, at the identity React Flow needs.
   *
   * `exportArtifact` closes over `nodes`, so a card holding it directly would
   * either export a stale document or force `nodeTypes` to change on every board
   * edit — remounting every Object. The ref keeps the callback stable while
   * always running the newest closure, so a paragraph typed a moment ago is in
   * the file.
   */
  const exportRef = useLatestRef(exportArtifact);
  const exportFromNode = useCallback((nodeId: string, action: CanvasExportAction) => {
    void exportRef.current(nodeId, action).then(setNotice);
  }, [exportRef, setNotice]);
  const evaluateCanvasRef = useLatestRef(evaluateCanvas);
  /**
   * Turns typed while Brain is working.
   *
   * The composer stays live for the whole run (see the `ChatInput` below): a turn
   * typed mid-run is HELD and sent the moment the current one finishes, so a long
   * research turn never means a dead input box. Shared with the Brain panel — one
   * queueing rule for every composer in the product.
   */
  /** Assigned below, once `startCanvasTurn` exists — the queue and the board
   *  callbacks both need the newest closure without re-registering. */
  const startCanvasTurnRef = useRef<(text?: string) => void>(() => {});
  const queuedTurns = useQueuedTurns({
    running: thinking,
    // Flushed turns take the same door every other turn takes — see
    // `startCanvasTurn`. Re-queueing is impossible here: the queue only flushes
    // once the run it was held behind has finished.
    send: (text) => startCanvasTurnRef.current(text),
    resetKey: sessionId,
  });
  /**
   * STOP. Interrupts the in-flight turn: the model stream is aborted, the loop
   * refuses to start another round-trip or tool, and anything the user had queued
   * behind it is dropped — they stopped the conversation, not just this sentence.
   *
   * The UI unwinds HERE rather than in the run's rejection handler, because a tool
   * already in flight can take seconds to settle and a Stop that leaves the board
   * saying "Executing…" is not a stop.
   */
  const stopCanvasRun = useCallback(() => {
    const run = canvasRunRef.current;
    // `thinking` is the authority on whether there is anything to stop: a settled
    // run can leave its handle behind, and a Stop that narrates an interruption
    // nobody was waiting on is worse than an inert button.
    if (!run || !thinking) return;
    canvasRunRef.current = null;
    run.abort.abort();
    queuedTurns.clear();
    setThinking(false);
    setActiveAgentIds(new Set());
    setBrainRunStartedAt(null);
    setNotice(t('noticeBrainStopped'));
    appendTimeline('system', t('noticeBrainStopped'), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds] }, `${run.requestMessageId}:stopped`);
    if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, {
      correlationId: run.requestMessageId, action: 'prompt.evaluate', phase: 'failed', actorType: 'user',
      durationMs: performance.now() - run.startedAt, metadata: { stopped: true },
    }).catch(() => undefined);
  }, [appendTimeline, canvasRunRef, persistence, queuedTurns, resolvedScopeMode, scopedNodeIds, sessionId, setActiveAgentIds, setBrainRunStartedAt, setNotice, setThinking, t, thinking]);
  /**
   * THE ONE DOOR every user-initiated turn goes through — the composer, "Send
   * again" on a transcript message, an object handing Brain a request.
   *
   * A turn offered while Brain is still working joins the queue instead of being
   * refused, which is what lets the composer stay enabled. `evaluateCanvas` drops
   * a turn on the floor while `thinking` (it is single-flight), so anything that
   * bypasses this door is silently ignored mid-run.
   */
  const startCanvasTurn = useCallback((text?: string) => {
    const value = (text ?? prompt).trim();
    if (!value || !assistantGate.assistantAllowed) return; // a closed-book assessment refuses every turn, composer or not
    if (queuedTurns.submit(value)) {
      if (text === undefined) setPrompt('');
      return;
    }
    evaluateCanvasRef.current(text);
  }, [assistantGate.assistantAllowed, evaluateCanvasRef, prompt, queuedTurns, setPrompt]);
  // eslint-disable-next-line react-hooks/refs
  // Same timing as `useLatestRef`: after commit, before any layout effect.
  useInsertionEffect(() => { startCanvasTurnRef.current = startCanvasTurn; });
  return { startCanvasTurnRef, exportFromNode, startCanvasTurn, stopCanvasRun, queuedTurns };
}
