/** Settling one Brain turn — record its answer and stage its proposals, or record why it failed. */
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { isCanvasRunAborted } from '@/lib/canvasAiErrors';
import { canvasChangesCanAutoApply, type ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import { associateBrainWithArtifacts } from '@/domains/canvas/domain/canvasBoard';
import type { CanvasJournal } from '@/lib/canvasActionJournal';
import type { ExecutiveCanvasWorkflow, PromptUseCase } from '@/lib/templates/promptUseCases';
import type { CreationObjectKind } from '../types';
import type { UseCanvasBrainTurnDeps } from '../hooks/useCanvasBrainTurn';

/** What settling a turn reads: the board's live deps plus the facts this turn fixed when it began. */
export interface CanvasTurnSettleContext extends Pick<UseCanvasBrainTurnDeps,
  | 'appendTimeline' | 'autoApplyRef' | 'canvasRunRef' | 'describeTurnError' | 'effectiveSelectedIds'
  | 'lastTurnProvenance' | 'nodes' | 'persistence' | 'resolvedScopeMode' | 'scopedNodeIds' | 'sessionId'
  | 'setAcceptedProposalIds' | 'setActiveAgentIds' | 'setAutoApplyPending' | 'setEdges' | 'setGuestLimit'
  | 'setNodes' | 'setNotice' | 'setProposedChanges' | 'setThinking' | 'stage' | 't' | 'turnUnansweredRef'> {
  /** The user's request, trimmed. */
  request: string;
  /** The transcript id of the request — every line this turn writes is keyed off it. */
  requestMessageId: string;
  /** The Brain object this turn answered through. */
  brainId: string;
  /** Stop's handle on this run. */
  runAbort: AbortController;
  /** `performance.now()` when the turn began. */
  promptStartedAt: number;
  /** Closes the turn's journal span. */
  turnDone: ReturnType<CanvasJournal['begin']>;
  /** The executive use case the prompt carried a contract for, if any. */
  executiveUseCase: PromptUseCase | null;
  executiveWorkflow: ExecutiveCanvasWorkflow | null;
}

/** The turn answered: write the answer, stage what it proposed, report the outcome. */
export function settleCanvasTurnSuccess(ctx: CanvasTurnSettleContext, answer: string): void {
  const { appendTimeline, autoApplyRef, brainId, canvasRunRef, effectiveSelectedIds, executiveUseCase, executiveWorkflow, lastTurnProvenance, nodes, persistence, promptStartedAt, request, requestMessageId, resolvedScopeMode, runAbort, scopedNodeIds, sessionId, setAcceptedProposalIds, setActiveAgentIds, setAutoApplyPending, setEdges, setGuestLimit, setNodes, setNotice, setProposedChanges, setThinking, stage, t, turnDone, turnUnansweredRef } = ctx;
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
  const unanswered = turnUnansweredRef.current;
  turnUnansweredRef.current = null;
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
}

/** The turn threw: close it as stopped, or record the failure where the user and diagnostics see it. */
export function settleCanvasTurnFailure(ctx: CanvasTurnSettleContext, error: unknown): void {
  const { appendTimeline, canvasRunRef, describeTurnError, executiveUseCase, persistence, promptStartedAt, requestMessageId, resolvedScopeMode, runAbort, scopedNodeIds, sessionId, setActiveAgentIds, setNotice, setThinking, turnDone } = ctx;
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
}
