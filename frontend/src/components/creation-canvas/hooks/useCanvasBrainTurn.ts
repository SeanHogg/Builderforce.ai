/** One Brain turn on the board — compose the request, run it, stage its proposals. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { getStoredTenantToken } from '@/lib/auth';
import { cSuiteCanvasWorkflow, executiveUseCaseFromPrompt } from '@/lib/templates/promptUseCases';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { creationSessionsApi, type CreationSessionSummary, type CreationTimelineMessage } from '@/lib/builderforceApi';
import { newNode } from '../canvasNodeHelpers';
import type { CreationFlowNode } from '../CreationNode';
import type { CanvasAiCompletion } from '@/lib/creationCanvasAi';
import type { BrainAction, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import type { Edge } from '@xyflow/react';
import type { ConfirmFn } from '@/components/ConfirmProvider';
import type { CanvasNotices } from '@/lib/canvasNotices';
import type { ChatModelSelection } from '@/components/ChatInput';
import type { CanvasJournal } from '@/lib/canvasActionJournal';
import type { GuestLimitRefusal } from '@/lib/guestLimit';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import { canvasTurnSnapshot } from '../brainTurn/turnSnapshot';
import { turnAgentNodes } from '../brainTurn/turnParticipants';
import { runCanvasGroupTurn } from '../brainTurn/runCanvasGroupTurn';
import { type CanvasTurnSettleContext, settleCanvasTurnFailure, settleCanvasTurnSuccess } from '../brainTurn/settleCanvasTurn';

export interface UseCanvasBrainTurnDeps {
  appendTimeline: (role: 'user' | 'assistant' | 'system', body: string, metadata?: CreationTimelineMessage['metadata'], clientMessageId?: string) => string;
  autoApplyRef: RefObject<boolean>;
  brainRuntime: RefObject<{ completions: CanvasAiCompletion[]; disabledModels: string[]; }>;
  canvasActions: BrainAction<unknown, unknown>[];
  canvasNotices: CanvasNotices;
  canvasRunRef: RefObject<{ abort: AbortController; requestMessageId: string; startedAt: number; } | null>;
  /** UNREAD — only the deleted test-only fixture used it; drop it here and at the call site in CreationCanvas.tsx together. */
  canvasText: CanvasTextTranslator;
  confirm: ConfirmFn;
  currentUserId: string | null;
  describeTurnError: (error: unknown, fallbackKey: 'noticeBrainFailed' | 'noticeAgentTestFailed' | 'noticeAgentGroupFailed') => string;
  disableBrainModel: (model: string) => void;
  edges: Edge[];
  effectiveSelectedIds: string[];
  evermindProjectId: number | null;
  inFlightUseCaseId: RefObject<string | null>;
  initialPromptSubmitted: RefObject<boolean>;
  journal: RefObject<CanvasJournal>;
  lastTurnProvenance: () => { model?: string; tools?: string[]; };
  /** UNREAD — only the deleted test-only fixture used it; drop it here and at the call site in CreationCanvas.tsx together. */
  locale: string;
  members: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  memoryEnabled: boolean;
  modelSelection: ChatModelSelection;
  nodes: CanvasObject[];
  /** UNREAD — only the deleted test-only fixture used it; drop it here and at the call site in CreationCanvas.tsx together. */
  openNodeInspector: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null, rect?: DOMRect) => void;
  persistence: 'local' | 'server';
  /** UNREAD — only the deleted test-only fixture used it; drop it here and at the call site in CreationCanvas.tsx together. */
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
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
  setBrainTrace: Dispatch<SetStateAction<BrainTraceEvent[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setGuestLimit: Dispatch<SetStateAction<GuestLimitRefusal | null>>;
  setModelSelection: Dispatch<SetStateAction<ChatModelSelection>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setProposedChanges: Dispatch<SetStateAction<ProposedCanvasChange[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setThinking: Dispatch<SetStateAction<boolean>>;
  stage: CanvasProposalStage;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  thinking: boolean;
  timeline: CanvasTimelineMessage[];
  title: string;
  turnToolCalls: RefObject<Set<string>>;
  turnUnanswered: RefObject<{ reason: string; detail?: string; } | null>;
}

export function useCanvasBrainTurn({ appendTimeline, autoApplyRef, brainRuntime, canvasActions, canvasNotices, canvasRunRef, confirm, currentUserId, describeTurnError, disableBrainModel, edges, effectiveSelectedIds, evermindProjectId, inFlightUseCaseId, initialPromptSubmitted, journal, lastTurnProvenance, members, memoryEnabled, modelSelection, nodes, persistence, prompt, recordBrainCompletion, requireAccount, resolvedScopeMode, scopedNodeIds, scopedNodes, sessionId, sessionMode, setAcceptedProposalIds, setActiveAgentIds, setAutoApplyPending, setBrainRunStartedAt, setBrainTrace, setEdges, setGuestLimit, setModelSelection, setNodes, setNotice, setPrompt, setProposedChanges, setSelectedId, setSelectedIds, setThinking, stage, t, thinking, timeline, title, turnToolCalls, turnUnanswered }: UseCanvasBrainTurnDeps) {
  const evaluateCanvas = useCallback((promptOverride?: string) => {
    const requestText = (promptOverride ?? prompt).trim();
    if (!requestText || thinking) return;
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
    inFlightUseCaseId.current = executiveUseCase?.id ?? null;
    const executiveWorkflow = executiveUseCase ? cSuiteCanvasWorkflow(executiveUseCase) : null;
    trackActivity('creation_prompt_submitted', { sessionId, metadata: { clientSurface: canvasSurface(), scope: resolvedScopeMode, objectKinds: [...new Set(scopedNodes.map((node) => node.data.kind))], ...(executiveUseCase ? { useCaseId: executiveUseCase.id } : {}) } });
    setThinking(true);
    setBrainRunStartedAt(Date.now());
    setNotice(t('noticeBrainEvaluating'));
    const initialMessage = initialPromptSubmitted.current ? timeline.find((message) => (message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:')) && message.body === requestText) : undefined;
    const promptAuthor = persistence === 'server' ? members.find((member) => member.userId === currentUserId) : null;
    const requestMessageId = appendTimeline('user', requestText, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'human', ref: currentUserId || 'local', name: promptAuthor?.displayName || 'You' } }, initialMessage?.clientMessageId);
    const promptStartedAt = performance.now();
    // The handle Stop reaches this run through. Created before the first await so a
    // Stop pressed while the request is still being assembled still lands.
    const runAbort = new AbortController();
    canvasRunRef.current = { abort: runAbort, requestMessageId, startedAt: promptStartedAt };
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
    turnUnanswered.current = null;
    turnToolCalls.current = new Set();
    setBrainTrace([]);
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
    const turnSnapshot = (board: readonly CreationFlowNode[]): string => canvasTurnSnapshot(board, stage.edges(), { sessionId, scope: resolvedScopeMode, selectedObjectIds: effectiveSelectedIds, scopedNodeIds, startIds });
    clearComposer();
    const connectedAgentNodes = turnAgentNodes(requestText, nodes, edges, effectiveSelectedIds, brainId);
    setActiveAgentIds(new Set(connectedAgentNodes.map((agent) => agent.id)));
    // The turn, start to finish — including the SCOPE it ran against, which is
    // the fact that explained the reported "I don't see that file" answer and
    // which nothing was recording.
    const turnDone = journal.current.begin(
      'turn', 'brain.turn',
      `scope=${resolvedScopeMode} (${scopedNodes.length}/${nodes.length} objects) · ${request.slice(0, 80)}`,
    );
    const settle: CanvasTurnSettleContext = { appendTimeline, autoApplyRef, brainId, canvasRunRef, describeTurnError, effectiveSelectedIds, executiveUseCase, executiveWorkflow, lastTurnProvenance, nodes, persistence, promptStartedAt, request, requestMessageId, resolvedScopeMode, runAbort, scopedNodeIds, sessionId, setAcceptedProposalIds, setActiveAgentIds, setAutoApplyPending, setEdges, setGuestLimit, setNodes, setNotice, setProposedChanges, setThinking, stage, t, turnDone, turnUnanswered };
    void runCanvasGroupTurn({ appendTimeline, autoApplyRef, brainId, brainRuntime, canvasActions, canvasNotices, confirm, connectedAgentNodes, describeTurnError, disableBrainModel, evermindProjectId, journal, memoryEnabled, modelSelection, nodes, persistence, recordBrainCompletion, request, requestMessageId, resolvedScopeMode, scopedNodeIds, sessionId, sessionMode, setActiveAgentIds, setBrainTrace, setModelSelection, setNodes, signal: runAbort.signal, stage, t, timeline, title, turnSnapshot, turnToolCalls, turnUnanswered })
      .then((answer) => settleCanvasTurnSuccess(settle, answer))
      .catch((error) => settleCanvasTurnFailure(settle, error));
  }, [appendTimeline, canvasActions, canvasNotices, confirm, currentUserId, describeTurnError, disableBrainModel, effectiveSelectedIds, edges, evermindProjectId, lastTurnProvenance, members, memoryEnabled, modelSelection, nodes, persistence, prompt, recordBrainCompletion, requireAccount, resolvedScopeMode, scopedNodeIds, scopedNodes, sessionId, sessionMode, setEdges, setNodes, setNotice, stage, t, thinking, timeline, title]);
  return { evaluateCanvas };
}
