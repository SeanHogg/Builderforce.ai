/** The model side of one Brain turn — invited agents first, then the Brain answer or synthesis. */
import { CanvasRunAbortedError, isCanvasRunAborted } from '@/lib/canvasAiErrors';
import { canvasTranscriptForModel } from '@/lib/canvasTranscript';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { runCanonicalCanvasGroupTurn } from '@/lib/creationAgentChat';
import { runCreationCanvasAi } from '@/lib/creationCanvasAi';
import { projectMemoryHooks } from '@seanhogg/builderforce-brain-embedded';
import { apiRequest } from '@/lib/apiClient';
import { teachProjectEvermindFromText } from '@/lib/projectEvermindApi';
import { safeTraceJson } from '../canvasArtifactExport';
import type { CreationFlowNode } from '../CreationNode';
import type { UseCanvasBrainTurnDeps } from '../hooks/useCanvasBrainTurn';
import { canonicalTurnAgents } from './turnParticipants';

/** What one group turn reads: the board's live deps plus the facts this turn fixed when it began. */
export interface CanvasGroupTurnContext extends Pick<UseCanvasBrainTurnDeps,
  | 'appendTimeline' | 'autoApplyRef' | 'brainRuntime' | 'canvasActions' | 'canvasNotices' | 'confirm'
  | 'describeTurnError' | 'disableBrainModel' | 'evermindProjectId' | 'journal' | 'memoryEnabled'
  | 'modelSelection' | 'nodes' | 'persistence' | 'recordBrainCompletion' | 'resolvedScopeMode'
  | 'scopedNodeIds' | 'sessionId' | 'sessionMode' | 'setActiveAgentIds' | 'setBrainTrace'
  | 'setModelSelection' | 'setNodes' | 'stage' | 't' | 'timeline' | 'title' | 'turnToolCalls' | 'turnUnanswered'> {
  /** The user's request, trimmed. */
  request: string;
  /** The transcript id of the request — every reply this turn writes is keyed off it. */
  requestMessageId: string;
  /** The Brain object this turn answers through. */
  brainId: string;
  /** The agents this turn is for — see `turnAgentNodes`. */
  connectedAgentNodes: readonly CreationFlowNode[];
  /** Stop's handle on this run. */
  signal: AbortSignal;
  /** The board as one loop of this turn sees it — see `canvasTurnSnapshot`. */
  turnSnapshot: (board: readonly CreationFlowNode[]) => string;
}

/** Ask the user before a tool mutates tenant state, showing what it would send. */
function canvasActionConfirmer({ confirm, t }: Pick<CanvasGroupTurnContext, 'confirm' | 't'>) {
  return ({ name, args }: { name: string; args: unknown }) => {
    let preview = '';
    try { const serialized = JSON.stringify(args ?? {}); preview = serialized === '{}' ? '' : serialized.length > 320 ? `${serialized.slice(0, 320)}…` : serialized; } catch { preview = ''; }
    return confirm({ title: t('approveAgentActionTitle'), message: `${t('approveAgentActionBody', { action: name.replaceAll('_', ' ') })}${preview ? `\n\n${preview}` : ''}`, confirmLabel: t('approveAgentActionConfirm') });
  };
}

/** Run the turn's model loops and resolve with the Brain's answer. */
export async function runCanvasGroupTurn(ctx: CanvasGroupTurnContext): Promise<string> {
  const { appendTimeline, autoApplyRef, brainId, brainRuntime, canvasActions, canvasNotices, connectedAgentNodes, describeTurnError, disableBrainModel, evermindProjectId, journal, memoryEnabled, modelSelection, nodes, persistence, recordBrainCompletion, request, requestMessageId, resolvedScopeMode, scopedNodeIds, sessionId, sessionMode, setActiveAgentIds, setBrainTrace, setModelSelection, setNodes, signal, stage, t, timeline, title, turnSnapshot, turnToolCalls, turnUnanswered } = ctx;
  const confirmCanvasAction = canvasActionConfirmer(ctx);
  // Stop is honoured between every phase of the turn, not only inside the model
  // stream: a run interrupted while the invited agents are replying must not go
  // on to spend a synthesis turn.
  const throwIfStopped = () => { if (signal.aborted) throw new CanvasRunAbortedError(); };
  const historicalConversation = canvasTranscriptForModel(timeline);
  const groupConversation = connectedAgentNodes.length
    ? [...historicalConversation, { role: 'user' as const, content: request }]
    : historicalConversation;
  /** Specialist replies actually gathered this turn — what decides whether the
   *  Brain runs as a synthesis or simply answers the request. */
  let contributions = 0;
  const { agents: canonicalAgents, objectIds: canonicalObjectIds } = canonicalTurnAgents(connectedAgentNodes);
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
          signal,
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
    signal,
  });
}
