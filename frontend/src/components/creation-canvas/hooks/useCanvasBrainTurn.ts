/** One Brain turn on the board — compose the request, run it, stage its proposals. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { getStoredTenantToken } from '@/lib/auth';
import { cSuiteCanvasWorkflow, executiveUseCaseFromPrompt } from '@/lib/templates/promptUseCases';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { creationSessionsApi, type CreationSessionSummary, type CreationTimelineMessage } from '@/lib/builderforceApi';
import { newNode, specBoardOf } from '../canvasNodeHelpers';
import type { CreationFlowNode } from '../CreationNode';
import { aiContextGate, boardInventory, scopeNote } from '@/lib/canvasContextSnapshot';
import { createDefaultCreationData, creationObjectDefinition } from '../creationObjectRegistry';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import { mentionedBoardAgents } from '@/lib/canvas/agentMentions';
import { boardAgents } from '@/lib/canvas/boardAgents';
import { CanvasRunAbortedError, isCanvasRunAborted } from '@/lib/canvasAiErrors';
import { canvasTranscriptForModel } from '@/lib/canvasTranscript';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { runCanonicalCanvasGroupTurn } from '@/lib/creationAgentChat';
import { type CanvasAiCompletion, runCreationCanvasAi } from '@/lib/creationCanvasAi';
import { type BrainAction, type BrainTraceEvent, projectMemoryHooks } from '@seanhogg/builderforce-brain-embedded';
import { apiRequest } from '@/lib/apiClient';
import { teachProjectEvermindFromText } from '@/lib/projectEvermindApi';
import { safeTraceJson } from '../canvasArtifactExport';
import { canvasChangesCanAutoApply, type ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import type { CreationObjectKind } from '../types';
import { associateBrainWithArtifacts } from '@/domains/canvas/domain/canvasBoard';
import { buildLlmCourse } from '@/lib/courseLms';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import type { Edge } from '@xyflow/react';
import type { ConfirmFn } from '@/components/ConfirmProvider';
import type { CanvasNotices } from '@/domains/canvas/application/PersistCanvas';
import type { ChatModelSelection } from '@/components/ChatInput';
import type { CanvasJournal } from '@/lib/canvasActionJournal';
import type { GuestLimitRefusal } from '@/lib/guestLimit';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';

export interface UseCanvasBrainTurnDeps {
  appendTimeline: (role: 'user' | 'assistant' | 'system', body: string, metadata?: CreationTimelineMessage['metadata'], clientMessageId?: string) => string;
  autoApplyRef: RefObject<boolean>;
  brainRuntime: RefObject<{ completions: CanvasAiCompletion[]; disabledModels: string[]; }>;
  canvasActions: BrainAction<unknown, unknown>[];
  canvasNotices: CanvasNotices;
  canvasRunRef: RefObject<{ abort: AbortController; requestMessageId: string; startedAt: number; } | null>;
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
  locale: string;
  members: { userId: string; role: CreationSessionSummary['role']; displayName: string | null; avatarUrl?: string | null; lastSeenAt?: string; viewport?: Record<string, unknown>; cursor?: { x?: number; y?: number; } | null; selection?: string[]; typing?: boolean; watchState?: 'all' | 'mentions' | 'muted'; followingUserId?: string | null; }[];
  memoryEnabled: boolean;
  modelSelection: ChatModelSelection;
  nodes: CanvasObject[];
  openNodeInspector: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null, rect?: DOMRect) => void;
  persistence: 'local' | 'server';
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

export function useCanvasBrainTurn({ appendTimeline, autoApplyRef, brainRuntime, canvasActions, canvasNotices, canvasRunRef, canvasText, confirm, currentUserId, describeTurnError, disableBrainModel, edges, effectiveSelectedIds, evermindProjectId, inFlightUseCaseId, initialPromptSubmitted, journal, lastTurnProvenance, locale, members, memoryEnabled, modelSelection, nodes, openNodeInspector, persistence, placeAppendedRef, prompt, recordBrainCompletion, requireAccount, resolvedScopeMode, scopedNodeIds, scopedNodes, sessionId, sessionMode, setAcceptedProposalIds, setActiveAgentIds, setAutoApplyPending, setBrainRunStartedAt, setBrainTrace, setEdges, setGuestLimit, setModelSelection, setNodes, setNotice, setPrompt, setProposedChanges, setSelectedId, setSelectedIds, setThinking, stage, t, thinking, timeline, title, turnToolCalls, turnUnanswered }: UseCanvasBrainTurnDeps) {
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
    if (process.env.NODE_ENV !== 'test') {
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
      const turnSnapshot = (board: readonly CreationFlowNode[]): string => {
        const scoped = board.filter((node) => scopedNodeIds.has(node.id) || !startIds.has(node.id));
        const scopedIds = new Set(scoped.map((node) => node.id));
        // Restricted objects are stripped of DETAIL here and keep their inventory row —
        // see `aiContextGate` for why withholding is not the same as hiding.
        const aiGate = aiContextGate(scoped);
        return JSON.stringify({
          sessionId, scope: resolvedScopeMode, selectedObjectIds: effectiveSelectedIds,
          // A scoped turn used to send ONLY the scoped objects, with nothing saying
          // the view was partial — so the model answered "that file is not anywhere
          // on the canvas" about a file that was on the canvas, and asked the user
          // to upload it again. The inventory is identity-only (cheap) and always
          // complete, so an absence claim is never available to be made.
          scopeNote: scopeNote(resolvedScopeMode, board.length, scoped.length),
          boardInventory: boardInventory(board, scopedIds),
          ...(aiGate.note ? { confidentialityNote: aiGate.note } : {}),
          objects: ((spec) => aiGate.visible.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data, spec), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true }; }))(specBoardOf(board)),
          connections: stage.edges().filter((edge) => scopedIds.has(edge.source) && scopedIds.has(edge.target)).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
        });
      };
      clearComposer();
      // WHO THIS TURN IS FOR. An @-mention names its agents outright, wherever they are on
      // the board; without one, the agents in reach (selected, or wired to Brain) answer.
      // Mentions used to reach only the model: "@Manager @CFO @Counsel" with Counsel
      // selected asked Counsel alone, and Brain wrote the other two's parts for them.
      const mentionedIds = new Set(mentionedBoardAgents(requestText, boardAgents(nodes)).map((agent) => agent.objectId));
      const connectedAgentNodes = mentionedIds.size
        ? nodes.filter((node) => mentionedIds.has(node.id))
        : nodes.filter((node) => node.data.kind === 'agent' && (
          effectiveSelectedIds.includes(node.id)
          || edges.some((edge) => (edge.source === brainId && edge.target === node.id) || (edge.target === brainId && edge.source === node.id))
        )).slice(0, 3);
      setActiveAgentIds(new Set(connectedAgentNodes.map((agent) => agent.id)));
      const confirmCanvasAction = ({ name, args }: { name: string; args: unknown }) => {
        let preview = '';
        try { const serialized = JSON.stringify(args ?? {}); preview = serialized === '{}' ? '' : serialized.length > 320 ? `${serialized.slice(0, 320)}…` : serialized; } catch { preview = ''; }
        return confirm({ title: t('approveAgentActionTitle'), message: `${t('approveAgentActionBody', { action: name.replaceAll('_', ' ') })}${preview ? `\n\n${preview}` : ''}`, confirmLabel: t('approveAgentActionConfirm') });
      };
      const runGroupTurn = async () => {
        // Stop is honoured between every phase of the turn, not only inside the model
        // stream: a run interrupted while the invited agents are replying must not go
        // on to spend a synthesis turn.
        const throwIfStopped = () => { if (runAbort.signal.aborted) throw new CanvasRunAbortedError(); };
        const historicalConversation = canvasTranscriptForModel(timeline);
        const groupConversation = connectedAgentNodes.length
          ? [...historicalConversation, { role: 'user' as const, content: request }]
          : historicalConversation;
        /** Specialist replies actually gathered this turn — what decides whether the
         *  Brain runs as a synthesis or simply answers the request. */
        let contributions = 0;
        const canonicalObjectIds = new Set<string>();
        const canonicalAgents = connectedAgentNodes.flatMap((agent) => {
          // Two ways a card names a REAL agent: a canonical `agent:<id>` resource, or the
          // `ide_agents.id` a seated built-in teammate carries (`cmo-t14`, see
          // provisionBuiltinAgents / seatTeammate). The second was not read, so on a
          // signed-in board an @CMO fell through to the local-drafts branch below — a
          // full browser tool loop per seat, each free to build, then a synthesis that
          // could not see what they had built. Measured (session bf886fc1): the same
          // app provisioned twice, every competitor card twice, four-minute turns. An
          // @-addressed agent executes in ITS runtime, which is this path.
          const ref = agent.data.resourceId?.match(/^agent:(.+)$/)?.[1]
            ?? (agent.data.builtinAgent === true && typeof agent.data.agentRef === 'string' && agent.data.agentRef.trim()
              ? agent.data.agentRef.trim()
              : undefined);
          if (ref) canonicalObjectIds.add(agent.id);
          return ref ? [{ ref, name: agent.data.title || 'Specialist agent', role: typeof agent.data.role === 'string' ? agent.data.role : undefined }] : [];
        });
        if (persistence === 'server' && canonicalAgents.length) {
          try {
            const existingChatId = nodes.find((node) => node.data.kind === 'chat')?.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
            const projectId = canvasProjectNodes(nodes).map((node) => canvasProjectId(node.data))[0] ?? null;
            const groupTurn = await runCanonicalCanvasGroupTurn({
              chatId: existingChatId ? Number(existingChatId) : null,
              title, projectId,
              sessionId, prompt: request, agents: canonicalAgents,
            });
            throwIfStopped();
            setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, resourceId: `chat:${groupTurn.chatId}`, status: 'Canonical group chat' } } : node));
            for (const { agent, message } of groupTurn.contributions) {
              appendTimeline('assistant', message.content, {
                scope: resolvedScopeMode, objectIds: [...scopedNodeIds],
                authoredBy: { kind: 'agent', ref: agent.ref, name: agent.name },
              }, `${requestMessageId}:agent:${agent.ref}`);
              groupConversation.push({ role: 'assistant', content: `${agent.name}: ${message.content}` });
              contributions += 1;
              setActiveAgentIds((current) => {
                const next = new Set(current);
                const canvasAgent = connectedAgentNodes.find((candidate) => candidate.data.resourceId === `agent:${agent.ref}` || candidate.data.agentRef === agent.ref);
                if (canvasAgent) next.delete(canvasAgent.id);
                return next;
              });
            }
          } catch (error) {
            // A stopped run is the user's decision, not a group-turn failure.
            if (isCanvasRunAborted(error)) throw error;
            const detail = describeTurnError(error, 'noticeAgentGroupFailed');
            appendTimeline('system', t('noticeAgentGroupTurnFailed', { reason: detail }), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:agent-group-error`);
          }
        }
        // AGENTS WITH NO RUNTIME BEHIND THEM still answer, in their own names. On a board
        // that lives only on this device that is every card: guest drafts cannot call the
        // tenant workforce runtime, so each is a local persona with the canvas tools, and
        // is never presented as a canonical agent. On a signed-in board it is the cards the
        // canonical turn above could not reach, and those answer TALK-ONLY, with no canvas
        // tools. They used to be skipped outright, because a full tool loop per card had an
        // "invited specialist" building the user's app before Brain did; but a skipped
        // card left an @-addressed agent with no reply, and Brain wrote one for it.
        const draftAgentNodes = persistence === 'server'
          ? connectedAgentNodes.filter((node) => !canonicalObjectIds.has(node.id))
          : connectedAgentNodes;
        if (draftAgentNodes.length) {
          for (const agent of draftAgentNodes) {
            const name = agent.data.title || 'Draft specialist';
            const ref = agent.id;
            try {
              const contribution = await runCreationCanvasAi({
                prompt: 'Contribute a specialist perspective to the latest request.', canvasSnapshot: turnSnapshot(stage.nodes()),
                guestTurnId: requestMessageId,
                guestTurnInput: request,
                persistence, canvasActions: persistence === 'server' ? [] : canvasActions, notices: canvasNotices, routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
                autoApprove: autoApplyRef.current, confirmAction: confirmCanvasAction,
                disabledModels: brainRuntime.current.disabledModels,
                onCompletion: recordBrainCompletion, onModelDisabled: disableBrainModel,
                onModelFallback: (model) => setModelSelection({ mode: 'model', model }),
                participant: { ref, name, instructions: typeof agent.data.instructions === 'string' ? agent.data.instructions : agent.data.subtitle },
                conversation: groupConversation,
                signal: runAbort.signal,
              });
              if (contribution.trim()) {
                appendTimeline('assistant', contribution.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'agent', ref, name } }, `${requestMessageId}:draft-agent:${agent.id}`);
                groupConversation.push({ role: 'assistant', content: `${name}: ${contribution.trim()}` });
                contributions += 1;
              }
            } catch (error) {
              // Brain synthesis still runs with the available transcript — unless the
              // user stopped the turn, which ends every remaining specialist too.
              if (isCanvasRunAborted(error)) throw error;
            }
            finally {
              setActiveAgentIds((current) => {
                const next = new Set(current);
                next.delete(agent.id);
                return next;
              });
            }
          }
        }
        throwIfStopped();
        return runCreationCanvasAi({
          // A synthesis only when there is something to synthesize. Agents that were
          // connected but produced nothing (no runtime, or a failed group turn) leave the
          // Brain answering the request itself, against the transcript it actually has.
          prompt: contributions > 0
            ? `The invited agents have each replied above, under their own names. Complete the user's requested outcome from what they said: resolve disagreements and make the final Canvas changes. Do not repeat or rewrite their replies, and never speak for an agent who did not reply. End with a short summary: one line per agent with their key point, then what was actually created.`
            : request,
          // The board as it is NOW — after the invited agents' work landed on it — not
          // as it was when the turn began. See `turnSnapshot`.
          canvasSnapshot: turnSnapshot(stage.nodes()), persistence, canvasActions, notices: canvasNotices,
          guestTurnId: requestMessageId,
          guestTurnInput: request,
          // The session's mode + the project the ticket would be filed against, so a
          // WORK turn has somewhere to put the work it creates.
          mode: sessionMode,
          projectId: evermindProjectId,
          ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
          routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
          autoApprove: autoApplyRef.current, confirmAction: confirmCanvasAction,
          disabledModels: brainRuntime.current.disabledModels,
          onCompletion: recordBrainCompletion, onModelDisabled: disableBrainModel,
          onModelFallback: (model) => setModelSelection({ mode: 'model', model }),
          onUnanswered: (outcome) => { turnUnanswered.current = outcome; },
          // The canvas runner takes recall + learn only, and deliberately NOT the
          // memory-first answer tier the conversational Brain uses: a canvas turn is a
          // COMMAND ("add a node", "lay these out"), and replaying a stored answer for
          // one would return prose where an artifact was asked for. Recall still
          // grounds it; contribution still happens.
          ...(persistence === 'server' && memoryEnabled && evermindProjectId != null ? { evermind: {
            // The Brain's one server-backed recall (same route, same contract, never throws).
            recall: projectMemoryHooks(evermindProjectId, apiRequest).recall,
            learn: (answer: string, question: string) => teachProjectEvermindFromText(evermindProjectId, answer, question),
          } } : {}),
          onTrace: (event) => {
            // Every tool and MCP call, as it happens. The trace already existed
            // for display; journalling it is what puts the CALLS beside the
            // timings and the user's actions in one ordered record.
            //
            // A FAILURE JOURNALS ITS REASON. This recorded `detail: 'error'` and
            // nothing else, while the reason sat right there in `event.result` —
            // and `brainTrace` is cleared at the start of every turn, so a
            // failure from an earlier turn became permanently unexplainable.
            // A real diagnostics report came in reading `canvas_read_snapshot
            // FAILED — error` twice with no way to find out why. The word
            // "error" is the one thing the reader already knows from `ok:false`.
            journal.current.record({
              kind: 'tool', label: event.label, at: event.ts,
              durationMs: event.durationMs ?? 0,
              ...(event.isError === true ? { ok: false } : {}),
              detail: event.isError === true
                ? safeTraceJson(event.result) || event.category
                : event.category,
            });
            if (event.category === 'tool' && event.label) turnToolCalls.current.add(event.label);
            setBrainTrace((current) => [...current, event]);
          },
          conversation: contributions > 0 ? groupConversation : historicalConversation,
          signal: runAbort.signal,
        });
      };
      // The turn, start to finish — including the SCOPE it ran against, which is
      // the fact that explained the reported "I don't see that file" answer and
      // which nothing was recording.
      const turnDone = journal.current.begin(
        'turn', 'brain.turn',
        `scope=${resolvedScopeMode} (${scopedNodes.length}/${nodes.length} objects) · ${request.slice(0, 80)}`,
      );
      void runGroupTurn().then((answer) => {
        // A run the user stopped has no result to record. `stopCanvasRun` already
        // unwound the UI and wrote the "you stopped this" line; a late answer from a
        // request that was already in flight must not overwrite it.
        if (runAbort.signal.aborted) return;
        if (canvasRunRef.current?.abort === runAbort) canvasRunRef.current = null;
        // A runtime notice ("I couldn't prepare any canvas changes…") is NOT something
        // Brain said, and writing it into the transcript as an assistant reply is what
        // let one failed turn become the template for the next: the following request
        // carried it as an example answer and a free model reproduced it verbatim.
        // Recorded as a failed turn instead — visible to the user, invisible to the model.
        const unanswered = turnUnanswered.current;
        turnUnanswered.current = null;
        // A turn that ran at all means the allowance is no longer spent (a new day,
        // or they took the account) — retire the conversion CTA the refusal armed.
        setGuestLimit(null);
        const changes = stage.drain();
        const changedKinds = new Set(changes.flatMap((change) => {
          if (change.type === 'object.add') return [change.node.data.kind];
          if ('objectId' in change) {
            const target = nodes.find((node) => node.id === change.objectId)
              ?? changes.find((candidate): candidate is Extract<ProposedCanvasChange, { type: 'object.add' }> => candidate.type === 'object.add' && candidate.node.id === change.objectId)?.node;
            return target ? [target.data.kind] : [];
          }
          return [];
        }));
        const executiveContractSatisfied = !executiveWorkflow || executiveWorkflow.outputs.some((kind) => changedKinds.has(kind as CreationObjectKind));
        turnDone({ ok: executiveContractSatisfied, detail: `${changes.length} proposed change(s)${executiveUseCase ? ` · ${executiveUseCase.id} ${executiveContractSatisfied ? 'complete' : 'incomplete'}` : ''}` });
        const shouldAutoApply = changes.length > 0 && (autoApplyRef.current || canvasChangesCanAutoApply(changes));
        if (answer.trim() && unanswered) {
          appendTimeline('system', answer.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:unanswered`);
          setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, subtitle: request, aiResponse: answer.trim() } } : node));
        } else if (answer.trim()) {
          appendTimeline('assistant', answer.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'brain', ref: 'brain', name: 'Brain' }, ...lastTurnProvenance() }, `${requestMessageId}:assistant`);
          setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, subtitle: request, aiResponse: answer.trim() } } : node));
          const promptTargets = effectiveSelectedIds.filter((id) => id !== brainId && nodes.some((node) => node.id === id && node.data.kind !== 'chat'));
          if (promptTargets.length) setEdges((current) => associateBrainWithArtifacts(current, brainId, promptTargets));
        }
        if (!executiveContractSatisfied && executiveUseCase && executiveWorkflow) {
          appendTimeline('system', `${executiveUseCase.label} is incomplete: the run did not successfully create or update an allowed ${executiveWorkflow.outputs.join(' or ')} Canvas object.`, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:use-case-incomplete`);
        }
        if (changes.length) {
          setProposedChanges(changes);
          setAcceptedProposalIds(new Set(changes.map((change) => change.id)));
          // Basic, non-destructive canvas output (including authored visual/image
          // objects and the response attached to them) applies immediately. A
          // user should not have to approve the ordinary result of their own
          // prompt, and on mobile the review surface may not be visible yet.
          setAutoApplyPending(shouldAutoApply);
        }
        setThinking(false);
        setActiveAgentIds(new Set());
        setNotice(!executiveContractSatisfied && executiveUseCase
          ? `${executiveUseCase.label} did not produce its required Canvas artifact.`
          : changes.length ? t(shouldAutoApply ? 'noticeApplyingBrainChanges' : 'noticeBrainChangesAwaitReview', { count: changes.length }) : t('noticeBrainFinished'));
        trackActivity('creation_ai_evaluation_completed', { sessionId, metadata: { clientSurface: canvasSurface(), proposedChangeCount: changes.length, objectKinds: [...new Set(nodes.map((node) => node.data.kind))], ...(executiveUseCase ? { useCaseId: executiveUseCase.id, contractSatisfied: executiveContractSatisfied } : {}) } });
        if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: executiveContractSatisfied ? 'succeeded' : 'failed', actorType: 'brain', durationMs: performance.now() - promptStartedAt, metricKey: 'artifacts_proposed', metricValue: changes.length, unit: 'count', metadata: executiveUseCase ? { useCaseId: executiveUseCase.id, contractSatisfied: executiveContractSatisfied, allowedOutputs: executiveWorkflow?.outputs } : undefined }).catch(() => undefined);
      }).catch((error) => {
        if (isCanvasRunAborted(error) || runAbort.signal.aborted) {
          // Stop is not a failure. The journal still closes the turn (an open span
          // would make the next diagnostics report unreadable), and the transcript
          // entry was written by `stopCanvasRun` at the moment the user asked.
          turnDone({ ok: false, detail: 'stopped by user' });
          if (canvasRunRef.current?.abort === runAbort) canvasRunRef.current = null;
          return;
        }
        if (canvasRunRef.current?.abort === runAbort) canvasRunRef.current = null;
        const detail = describeTurnError(error, 'noticeBrainFailed');
        turnDone({ ok: false, detail });
        appendTimeline('system', detail, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:error`);
        setThinking(false);
        setActiveAgentIds(new Set());
        setNotice(detail);
        if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: 'failed', actorType: 'brain', durationMs: performance.now() - promptStartedAt, metadata: executiveUseCase ? { useCaseId: executiveUseCase.id, contractSatisfied: false } : undefined }).catch(() => undefined);
      });
      return;
    }
    window.setTimeout(() => {
      const request = requestText.toLowerCase();
      if (/\b(?:course|training|lms|academy|learn)\b/.test(request) && /\b(?:llm|language model)\b/.test(request)) {
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const course: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 420, y: 180 }, data: { kind: 'course', title: t('runtimeObject.llmCourse'), status: t('runtimeObject.status.readyToLearn'), subtitle: t('runtimeObject.llmCourseSubtitle'), course: buildLlmCourse(canvasText, locale) } };
        const lab: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1020, y: 230 }, data: { ...createDefaultCreationData('code'), title: t('runtimeObject.llmLab'), status: t('runtimeObject.status.practiceWorkspace'), language: 'python', code: '# Build your tokenizer, model, and training loop here\n' } };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [course, lab])]);
        setEdges((current) => associateBrainWithArtifacts([...current, { id: crypto.randomUUID(), source: course.id, target: lab.id, type: 'smoothstep', label: 'practice', animated: true, data: { connectionKind: 'reference' } }], brain?.id || '', [course.id], 'Created with Brain'));
        setSelectedId(course.id); openNodeInspector(course.id); setThinking(false); clearComposer(); setNotice(t('noticeLlmCourseAdded')); return;
      }
      if (request.includes('roadmap')) {
        const project = nodes.find((node) => node.data.kind === 'project');
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const roadmap: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'roadmap', title: request.includes('executive') ? t('runtimeObject.executiveRoadmap') : t('runtimeObject.salesRoadmap'), status: t('runtimeObject.status.aiGenerated') } };
        const slides: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 315 }, data: { kind: 'slides', title: request.includes('executive') ? t('runtimeObject.executiveSlides') : t('runtimeObject.salesSlides'), status: t('runtimeObject.status.aiGenerated') } };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [roadmap, slides])]);
        setEdges((current) => associateBrainWithArtifacts([...current, ...(project ? [{ id: crypto.randomUUID(), source: project.id, target: roadmap.id, type: 'smoothstep' as const }] : []), { id: crypto.randomUUID(), source: roadmap.id, target: slides.id, type: 'smoothstep', label: 'presents', animated: true }], brain?.id || '', [roadmap.id], 'Created with Brain'));
        setSelectedId(roadmap.id); openNodeInspector(roadmap.id); setThinking(false); clearComposer(); setNotice(t('noticeRoadmapAdded')); return;
      }
      if (request.includes('top 10') || request.includes('requested features')) {
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const summary: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 500, y: 260 }, data: { kind: 'featureSummary', title: t('runtimeObject.featureSummary'), status: t('runtimeObject.status.synthesized') } };
        const mockupItems = (['onboarding', 'analytics', 'approvals', 'voice', 'dashboards', 'handoffs', 'mobileReview', 'audit', 'templates', 'collaboration'] as const)
          .map((key) => t(`runtimeObject.mockupItem.${key}`));
        const mockups: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 300 }, data: { kind: 'mockupSet', title: t('runtimeObject.featureMockups'), status: t('runtimeObject.status.readyForReview'), subtitle: t('runtimeObject.featureMockupsSubtitle'), items: mockupItems, sources: [{ label: t('runtimeObject.feedbackEvidence'), resource: '/api/feedback' }] } };
        setNodes((current) => [...current, ...placeAppendedRef.current(current, [summary, mockups])]);
        setEdges((current) => associateBrainWithArtifacts([...current, { id: crypto.randomUUID(), source: summary.id, target: mockups.id, type: 'smoothstep', animated: true }], brain?.id || '', [summary.id], 'Created with Brain'));
        setSelectedId(mockups.id); openNodeInspector(mockups.id); setThinking(false); clearComposer(); setNotice(t('noticeFeatureSummaryAdded')); return;
      }
      const evaluationId = crypto.randomUUID();
      setNodes((current) => [...current, ...placeAppendedRef.current(current, [{ id: evaluationId, type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'evaluation', title: t('runtimeObject.evaluation'), status: t('runtimeObject.status.aiEvaluation') } }])]);
      const workflow = nodes.find((node) => node.data.kind === 'workflow');
      const website = nodes.find((node) => node.data.kind === 'website');
      const brain = nodes.find((node) => node.data.kind === 'chat');
      setEdges((current) => associateBrainWithArtifacts([...current, ...[workflow, website].filter((node): node is CreationFlowNode => !!node).map((node) => ({ id: crypto.randomUUID(), source: node.id, target: evaluationId, type: 'smoothstep', animated: true }))], brain?.id || '', [evaluationId], 'Created with Brain'));
      setSelectedId(evaluationId);
      openNodeInspector(evaluationId);
      setThinking(false);
      clearComposer();
      setNotice(t('noticeEvaluationAdded'));
    }, 850);
  }, [appendTimeline, canvasActions, canvasNotices, canvasText, confirm, currentUserId, locale, describeTurnError, disableBrainModel, effectiveSelectedIds, edges, evermindProjectId, lastTurnProvenance, members, memoryEnabled, modelSelection, nodes, openNodeInspector, persistence, prompt, recordBrainCompletion, requireAccount, resolvedScopeMode, scopedNodeIds, scopedNodes, sessionId, sessionMode, setEdges, setNodes, setNotice, stage, t, thinking, timeline, title]);
  return { evaluateCanvas };
}
