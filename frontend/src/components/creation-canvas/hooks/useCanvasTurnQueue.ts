/** Starting, queueing and stopping Brain turns — the canvas's binding of the ONE turn door (`useChatTurns`). */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useInsertionEffect, useRef } from 'react';
import type { CanvasExportAction } from '@/lib/canvasExports';
import { useLatestRef } from './useLatestRef';
import { clearRunError, startsRun, useChatTurns, type BrainRunSnapshot } from '@seanhogg/builderforce-brain-embedded';
import { canvasRunKey } from '../brainTurn/canvasRunKey';
import { creationSessionsApi, type CreationTimelineMessage } from '@/lib/builderforceApi';
import type { useTranslations } from 'next-intl';
import type { AssessmentGate } from '@/lib/academic/assessment';

export interface UseCanvasTurnQueueDeps {
  appendTimeline: (role: 'user' | 'assistant' | 'system', body: string, metadata?: CreationTimelineMessage['metadata'], clientMessageId?: string) => string;
  assistantGate: AssessmentGate;
  /** This session's run (`useRunSnapshot(canvasRunKey(sessionId))`). */
  canvasRun: BrainRunSnapshot;
  evaluateCanvas: (promptOverride?: string) => void;
  exportArtifact: (nodeId: string, action: CanvasExportAction) => Promise<string>;
  persistence: 'local' | 'server';
  prompt: string;
  resolvedScopeMode: 'canvas' | 'selection' | 'connected' | 'frame';
  scopedNodeIds: Set<string>;
  sessionId: string;
  setActiveAgentIds: Dispatch<SetStateAction<Set<string>>>;
  setNotice: (text: string) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasTurnQueue({ appendTimeline, assistantGate, canvasRun, evaluateCanvas, exportArtifact, persistence, prompt, resolvedScopeMode, scopedNodeIds, sessionId, setActiveAgentIds, setNotice, setPrompt, t }: UseCanvasTurnQueueDeps) {
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
  /** Assigned below, once `startCanvasTurn` exists — the board callbacks need the
   *  newest closure without re-registering. */
  const startCanvasTurnRef = useRef<(text?: string) => void>(() => {});
  /**
   * Turns typed while Brain is working — THE shared turn door (`useChatTurns`, the same
   * one the Brain panel, the editor chat and Rovr mount). The composer stays live for the
   * whole run: a turn typed mid-run is HELD and sent the moment the current one finishes,
   * so a long research turn never means a dead input box; Stop drops what is held and
   * stops this session's run cell.
   */
  const turns = useChatTurns<string>({
    // The CELL's running, not the narrated turn: a turn typed while a stopped loop is
    // still unwinding waits for it rather than being refused by the single-flight claim.
    running: canvasRun.running,
    runKey: canvasRunKey(sessionId),
    // A flushed turn still answers to the exam gate: a closed-book assessment that began
    // while it was held refuses it like any other turn.
    send: (text) => {
      if (!assistantGate.assistantAllowed) return false;
      evaluateCanvasRef.current(text);
    },
  });
  const queuedTurns = turns.queued;
  const { stop: stopTurns } = turns;
  /**
   * STOP. Interrupts the in-flight turn: the model stream is aborted, the loop
   * refuses to start another round-trip or tool, and anything the user had queued
   * behind it is dropped — they stopped the conversation, not just this sentence.
   *
   * The UI unwinds HERE rather than in the run's rejection handler, because a tool
   * already in flight can take seconds to settle and a Stop that leaves the board
   * saying "Executing…" is not a stop.
   */
  const turn = canvasRun.turn;
  const stopCanvasRun = useCallback(() => {
    // The narrated turn is the authority on whether there is anything to stop. It lives
    // on the run cell, so a board remounted mid-turn still stops it, and the store clears
    // it at the first press — a second press while the loop unwinds is inert.
    if (!turn) return;
    // Drops the held turns; the run store aborts the stream, declines a pending approval
    // and settles the cell.
    stopTurns();
    setActiveAgentIds(new Set());
    setNotice(t('noticeBrainStopped'));
    appendTimeline('system', t('noticeBrainStopped'), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds] }, turn.id ? `${turn.id}:stopped` : undefined);
    if (persistence === 'server' && turn.id) void creationSessionsApi.recordOutcome(sessionId, {
      correlationId: turn.id, action: 'prompt.evaluate', phase: 'failed', actorType: 'user',
      durationMs: Date.now() - turn.startedAt, metadata: { stopped: true },
    }).catch(() => undefined);
  }, [appendTimeline, persistence, resolvedScopeMode, scopedNodeIds, sessionId, setActiveAgentIds, setNotice, stopTurns, t, turn]);
  /**
   * The canvas narrates its own turn failures (`settleCanvasTurnFailure`). An error that
   * escaped the engine body before it could — the run cell's error — is said here once,
   * so no failure is silent.
   */
  const runError = canvasRun.error;
  useEffect(() => {
    if (!runError) return;
    setNotice(runError);
    clearRunError(canvasRunKey(sessionId));
  }, [runError, sessionId, setNotice]);
  /**
   * THE ONE DOOR every user-initiated turn goes through — the composer, "Send
   * again" on a transcript message, an object handing Brain a request.
   *
   * A turn offered while Brain is still working joins the queue instead of being
   * refused, which is what lets the composer stay enabled. `evaluateCanvas` drops
   * a turn on the floor while `thinking` (it is single-flight), so anything that
   * bypasses this door is silently ignored mid-run.
   */
  const { submit: holdTurn } = queuedTurns;
  const startCanvasTurn = useCallback((text?: string) => {
    const value = (text ?? prompt).trim();
    if (!value || !assistantGate.assistantAllowed) return; // a closed-book assessment refuses every turn, composer or not
    // A stop ("Stop the run" — the progress guard's pause offers it) is the Stop: it stops
    // this turn, and with nothing running it starts nothing rather than a fresh run.
    if (!startsRun(value)) {
      if (text === undefined) setPrompt('');
      stopCanvasRun();
      return;
    }
    // The raw hold-or-not step of the door, so an undefined `text` (the composer's own
    // prompt) reaches `evaluateCanvas` as undefined — it reads and clears the prompt itself.
    if (holdTurn(value)) {
      if (text === undefined) setPrompt('');
      return;
    }
    evaluateCanvasRef.current(text);
  }, [assistantGate.assistantAllowed, evaluateCanvasRef, holdTurn, prompt, setPrompt, stopCanvasRun]);
  // eslint-disable-next-line react-hooks/refs
  // Same timing as `useLatestRef`: after commit, before any layout effect.
  useInsertionEffect(() => { startCanvasTurnRef.current = startCanvasTurn; });
  return { startCanvasTurnRef, exportFromNode, startCanvasTurn, stopCanvasRun, queuedTurns };
}
