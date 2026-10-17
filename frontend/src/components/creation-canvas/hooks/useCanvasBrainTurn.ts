/** One Brain turn on the board — compose the request, run it, stage its proposals. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { getStoredTenantToken } from '@/lib/auth';
import { cSuiteCanvasWorkflow, executiveUseCaseFromPrompt } from '@/lib/templates/promptUseCases';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { creationSessionsApi, type CreationSessionSummary, type CreationTimelineMessage } from '@/lib/builderforceApi';
import { newNode } from '../canvasNodeHelpers';
import type { CreationFlowNode } from '../CreationNode';
import type { CanvasAiCompletion } from '@/lib/canvasAiRun';
import { isRunning, startEngineRun, type BrainAction } from '@seanhogg/builderforce-brain-embedded';
import type { ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import { adoptableInitialMessage } from '../brainTurn/adoptableInitialMessage';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import type { Edge } from '@xyflow/react';
import type { CanvasNotices } from '@/lib/canvasNotices';
import type { ChatModelSelection } from '@/components/ChatInput';
import type { CanvasJournal } from '@/lib/canvasActionJournal';
import type { CanvasRunShaping } from '@/lib/canvasAiTurnBudget';
import type { GuestLimitRefusal } from '@/lib/guestLimit';
import { canvasTurnSnapshot } from '../brainTurn/turnSnapshot';
import { turnAgentNodes } from '../brainTurn/turnParticipants';
import { runCanvasGroupTurn } from '../brainTurn/runCanvasGroupTurn';
import { type CanvasTurnSettleContext, settleCanvasTurnFailure, settleCanvasTurnSuccess } from '../brainTurn/settleCanvasTurn';
import { previewPicksContext, takePreviewPicks } from '@/lib/workspace/previewPick';
import { canvasRunKey } from '../brainTurn/canvasRunKey';

export interface UseCanvasBrainTurnDeps {
  appendTimeline: (role: 'user' | 'assistant' | 'system', body: string, metadata?: CreationTimelineMessage['metadata'], clientMessageId?: string) => string;
  autoApplyRef: RefObject<boolean>;
  brainRuntimeRef: RefObject<{ completions: CanvasAiCompletion[]; disabledModels: string[]; }>;
  canvasActions: BrainAction<unknown, unknown>[];
  canvasNotices: CanvasNotices;
  /** The in-flight turn's correlation id and start — what Stop records. The run itself
   *  (abort, trace, approvals) lives in the run store under `canvasRunKey(sessionId)`. */
  canvasRunRef: RefObject<{ requestMessageId: string; startedAt: number; } | null>;
  currentUserId: string | null;
  describeTurnError: (error: unknown, fallbackKey: 'noticeBrainFailed' | 'noticeAgentTestFailed' | 'noticeAgentGroupFailed') => string;
  disableBrainModel: (model: string) => void;
  edges: Edge[];
  effectiveSelectedIds: string[];
  evermindProjectId: number | null;
  inFlightUseCaseIdRef: RefObject<string | null>;
  initialPromptSubmittedRef: RefObject<boolean>;
  journalRef: RefObject<CanvasJournal>;
  lastTurnProvenance: () => { model?: string; tools?: string[]; };
  members: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  memoryEnabled: boolean;
  modelSelection: ChatModelSelection;
  /** The composer's Effort and Thinking for this session. */
  runShaping: CanvasRunShaping;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  prompt: string;
  recordBrainCompletion: (completion: CanvasAiCompletion) => void;
  requireAccount: (action: string, title: string, description: string) => void;
  resolvedScopeMode: 'frame' | 'selection' | 'canvas' | 'connected';
  scopedNodeIds: Set<string>;
  scopedNodes: CanvasObject[];
  sessionId: string;
  sessionMode: 'chat' | 'work';
  setAcceptedProposalIds: Dispatch<SetStateAction<Set<string>>>;
  setActiveAgentIds: Dispatch<SetStateAction<Set<string>>>;
  setAutoApplyPending: Dispatch<SetStateAction<boolean>>;
  setBrainRunStartedAt: Dispatch<SetStateAction<number | null>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setGuestLimit: Dispatch<SetStateAction<GuestLimitRefusal | null>>;
  setModelSelection: Dispatch<SetStateAction<ChatModelSelection>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setProposedChanges: Dispatch<SetStateAction<ProposedCanvasChange[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  stage: CanvasProposalStage;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  timeline: CanvasTimelineMessage[];
  title: string;
  turnToolCallsRef: RefObject<Set<string>>;
  turnUnansweredRef: RefObject<{ reason: string; detail?: string; } | null>;
}

export function useCanvasBrainTurn({ appendTimeline, autoApplyRef, brainRuntimeRef, canvasActions, canvasNotices, canvasRunRef, currentUserId, describeTurnError, disableBrainModel, edges, effectiveSelectedIds, evermindProjectId, inFlightUseCaseIdRef, initialPromptSubmittedRef, journalRef, lastTurnProvenance, members, memoryEnabled, modelSelection, runShaping, nodes, persistence, prompt, recordBrainCompletion, requireAccount, resolvedScopeMode, scopedNodeIds, scopedNodes, sessionId, sessionMode, setAcceptedProposalIds, setActiveAgentIds, setAutoApplyPending, setBrainRunStartedAt, setEdges, setGuestLimit, setModelSelection, setNodes, setNotice, setPrompt, setProposedChanges, setSelectedId, setSelectedIds, stage, t, timeline, title, turnToolCallsRef, turnUnansweredRef }: UseCanvasBrainTurnDeps) {
  const evaluateCanvas = useCallback((promptOverride?: string) => {
    const requestText = (promptOverride ?? prompt).trim();
    // The run store is the truth about whether a turn is in flight (`thinking` trails it
    // by a render): a second start would be refused by the store anyway, but only after
    // this turn had already written its request into the transcript.
    if (!requestText || isRunning(canvasRunKey(sessionId))) return;
    // A tenant board with no tenant token cannot run a turn: the request would leave
    // without an Authorization header and come back 401 "Missing or malformed
    // Authorization header" — which is exactly what one signed-in user's diagnostics
    // recorded (session bf886fc1), on a board that had been working minutes earlier.
    // The token store is the value the transport authorizes with, so asking it here
    // predicts the call exactly; the answer is the same account prompt every other
    // tenant action raises, in the viewer's language, instead of a raw auth error
    // written into the transcript and filed as a support ticket.
    if (persistence === 'server' && !getStoredTenantToken()) {
      requireAccount('brain_turn', t('gateBrainTurnTitle'), t('gateBrainTurnBody'));
      return;
    }
    /**
     * Only a turn the user just typed empties the composer. A replay, a queued turn
     * flushing, or an object-initiated request carries its own text — clearing on
     * those wipes whatever the user is typing RIGHT NOW, which is exactly what the
     * composer staying live while a run streams makes possible.
     */
    const clearComposer = () => { if (promptOverride === undefined) setPrompt(''); };
    // ONE reader of the contract marker, shared with the tool's recovery path —
    // the prompt's `Execution contract <id>:` was written by
    // `executiveCanvasPrompt`, so this scan and that writer are two halves of
    // one fact and must not each carry their own copy of the string.
    const executiveUseCase = executiveUseCaseFromPrompt(requestText);
    // Published for the duration of the turn so the tool can fall back to it.
    inFlightUseCaseIdRef.current = executiveUseCase?.id ?? null;
    const executiveWorkflow = executiveUseCase ? cSuiteCanvasWorkflow(executiveUseCase) : null;
    trackActivity('creation_prompt_submitted', { sessionId, metadata: { clientSurface: canvasSurface(), scope: resolvedScopeMode, objectKinds: [...new Set(scopedNodes.map((node) => node.data.kind))], ...(executiveUseCase ? { useCaseId: executiveUseCase.id } : {}) } });
    // THE run: one cell in the shared run store (`startEngineRun`), keyed by the session —
    // single-flight, outliving whichever placement started it, stopped by `stopRun`, and
    // asking for approvals through the gate the surface's ToolConfirmBar answers. The
    // body below runs synchronously up to its first await, inside the store's claim.
    void startEngineRun(canvasRunKey(sessionId), async (run) => {
      setBrainRunStartedAt(Date.now());
      setNotice(t('noticeBrainEvaluating'));
      const initialMessage = initialPromptSubmittedRef.current ? adoptableInitialMessage(timeline, requestText) : undefined;
      const promptAuthor = persistence === 'server' ? members.find((member) => member.userId === currentUserId) : null;
      const requestMessageId = appendTimeline('user', requestText, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'human', ref: currentUserId || 'local', name: promptAuthor?.displayName || 'You' } }, initialMessage?.clientMessageId);
      const promptStartedAt = performance.now();
      // What Stop records against. The abort handle is the run cell's, created when the
      // store claimed it, so a Stop pressed while the request is assembled still lands.
      canvasRunRef.current = { requestMessageId, startedAt: promptStartedAt };
      if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: 'started', metadata: { scope: resolvedScopeMode, ...(executiveUseCase ? { useCaseId: executiveUseCase.id } : {}) } }).catch(() => undefined);
      // A composer submission is a chat interaction, so reveal its Brain object
      // immediately. Waiting for the vendor request to succeed left a blank canvas
      // (and hid useful streaming/failure state) whenever the provider cascade
      // rejected the turn.
      const existingChat = nodes.find((node) => node.data.kind === 'chat');
      const brainId = existingChat?.id ?? crypto.randomUUID();
      if (!existingChat) {
        const brain = { ...newNode('chat', { x: 120, y: 120 }), id: brainId };
        brain.data = { ...brain.data, title: 'Brain', subtitle: requestText };
        setNodes((current) => current.some((node) => node.data.kind === 'chat') ? current : [...current, brain]);
      }
      setSelectedId(brainId);
      setSelectedIds([brainId]);
      stage.reset();
      turnUnansweredRef.current = null;
      turnToolCallsRef.current = new Set();
      setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, trace: [] } } : node));
      setProposedChanges([]);
      const request = requestText;
      // The board as ONE loop of this turn sees it. A function rather than a value,
      // because a turn can run more than one loop — the invited agents first, then the
      // Brain synthesis — and the synthesis must see what the agents just put on the
      // board. Built once from the turn-start `nodes`, it showed the synthesis the
      // board the agents had already changed as if they had not, and the synthesis
      // re-made their objects (session bf886fc1: the same app built twice). Anything
      // added since the turn began is in scope for a later loop whatever the selection
      // was — it is this turn's own work.
      const startIds = new Set(nodes.map((node) => node.id));
      // The elements picked for the composer — in the app's preview ("Select to edit") or by
      // Insights' "Apply in composer" (selector-anchored) — are what a TYPED turn is about;
      // every pick's note rides every loop's view of the board and is spent by this turn. A
      // replay or a queued turn carries its own text and leaves standing picks for the next one.
      const pickNotes = promptOverride === undefined ? previewPicksContext(takePreviewPicks()) : '';
      const pickNote = pickNotes ? `\n\n${pickNotes}` : '';
      const turnSnapshot = (board: readonly CreationFlowNode[]): string => canvasTurnSnapshot(board, stage.edges(), { sessionId, scope: resolvedScopeMode, selectedObjectIds: effectiveSelectedIds, scopedNodeIds, startIds }) + pickNote;
      clearComposer();
      const connectedAgentNodes = turnAgentNodes(requestText, nodes, edges, effectiveSelectedIds, brainId);
      setActiveAgentIds(new Set(connectedAgentNodes.map((agent) => agent.id)));
      // The turn, start to finish — including the SCOPE it ran against, which is
      // the fact that explained the reported "I don't see that file" answer and
      // which nothing was recording.
      const turnDone = journalRef.current.begin(
        'turn', 'brain.turn',
        `scope=${resolvedScopeMode} (${scopedNodes.length}/${nodes.length} objects) · ${request.slice(0, 80)}`,
      );
      const settle: CanvasTurnSettleContext = { appendTimeline, autoApplyRef, brainId, canvasRunRef, describeTurnError, effectiveSelectedIds, executiveUseCase, executiveWorkflow, lastTurnProvenance, nodes, persistence, promptStartedAt, request, requestMessageId, resolvedScopeMode, signal: run.signal, scopedNodeIds, sessionId, setAcceptedProposalIds, setActiveAgentIds, setAutoApplyPending, setEdges, setGuestLimit, setNodes, setNotice, setProposedChanges, stage, t, turnDone, turnUnansweredRef };
      try {
        const answer = await runCanvasGroupTurn({ appendTimeline, autoApplyRef, brainId, brainRuntimeRef, canvasActions, canvasNotices, connectedAgentNodes, describeTurnError, disableBrainModel, evermindProjectId, journalRef, memoryEnabled, modelSelection, runShaping, nodes, persistence, recordBrainCompletion, request, requestMessageId, resolvedScopeMode, scopedNodeIds, sessionId, sessionMode, setActiveAgentIds, setModelSelection, setNodes, run, stage, t, timeline, title, turnSnapshot, turnToolCallsRef, turnUnansweredRef });
        settleCanvasTurnSuccess(settle, answer);
      } catch (error) {
        // The canvas narrates its own failure (transcript row, notice, outcome record), so
        // the run settles cleanly rather than repeating it as the cell's error.
        settleCanvasTurnFailure(settle, error);
      }
    });
  }, [prompt, persistence, inFlightUseCaseIdRef, sessionId, resolvedScopeMode, scopedNodes, setBrainRunStartedAt, setNotice, t, initialPromptSubmittedRef, timeline, members, appendTimeline, scopedNodeIds, currentUserId, canvasRunRef, nodes, setSelectedId, setSelectedIds, stage, turnUnansweredRef, turnToolCallsRef, setNodes, setProposedChanges, edges, effectiveSelectedIds, setActiveAgentIds, journalRef, autoApplyRef, describeTurnError, lastTurnProvenance, setAcceptedProposalIds, setAutoApplyPending, setEdges, setGuestLimit, brainRuntimeRef, canvasActions, canvasNotices, disableBrainModel, evermindProjectId, memoryEnabled, modelSelection, runShaping, recordBrainCompletion, sessionMode, setModelSelection, title, requireAccount, setPrompt]);
  return { evaluateCanvas };
}
