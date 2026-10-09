/** Reviewing what a turn proposed — auto-apply, apply, reject. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from 'react';
import type { CreationFlowNode } from '../CreationNode';
import { executeModelComparison } from '@/lib/modelComparison';
import type { ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import { persistCanonicalProjectPrd } from '../canvasProjectSync';
import { type CanvasObject, canvasPlacementFlags } from '@/domains/canvas/domain/canvasObject';
import { associateBrainWithArtifacts } from '@/domains/canvas/domain/canvasBoard';
import { selectionWithinBoard } from '@/domains/canvas/domain/selection';
import { leadsToRoom } from '@/lib/canvas/roomCreations';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';
import type { useTranslations } from 'next-intl';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasLayoutViewport } from '@/lib/canvasGridFit';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';

export interface UseCanvasProposalReviewDeps {
  acceptedProposalIds: Set<string>;
  autoApplyPending: boolean;
  comparisonModelIds: string[];
  describeTurnError: (error: unknown, fallbackKey: 'noticeBrainFailed' | 'noticeAgentTestFailed' | 'noticeAgentGroupFailed') => string;
  /** A lens is creating the board's app (`useCanvasEntryApp`, pending and not failed). The
   *  FIRST turn waits for it, so it starts on a board that has a build to write into
   *  rather than authoring cards about the request. A failed create releases it. */
  entryAppPending: boolean;
  evaluateCanvas: (promptOverride?: string) => void;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  hydratedRef: RefObject<boolean>;
  initialFocusId: string | null | undefined;
  initialPrompt: string | null | undefined;
  initialPromptSubmittedRef: RefObject<boolean>;
  layoutViewportRef: RefObject<() => CanvasLayoutViewport>;
  modelComparisonStartedRef: RefObject<boolean>;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  proposedChanges: ProposedCanvasChange[];
  selectedId: string | null;
  sessionId: string;
  setAcceptedProposalIds: Dispatch<SetStateAction<Set<string>>>;
  setAutoApplyMode: (enabled: boolean) => void;
  setAutoApplyPending: Dispatch<SetStateAction<boolean>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPendingBrainActions: Dispatch<SetStateAction<{ objectId: string; action: string; }[]>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setProposedChanges: Dispatch<SetStateAction<ProposedCanvasChange[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setSurface: (next: CanvasSurfaceId, targetId?: string | null, origin?: CanvasSurfaceId | null) => void;
  stage: CanvasProposalStage;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  thinking: boolean;
  timeline: CanvasTimelineMessage[];
}

export function useCanvasProposalReview({ acceptedProposalIds, autoApplyPending, comparisonModelIds, describeTurnError, entryAppPending, evaluateCanvas, flowRef, hydratedRef, initialFocusId, initialPrompt, initialPromptSubmittedRef, layoutViewportRef, modelComparisonStartedRef, nodes, persistence, proposedChanges, selectedId, sessionId, setAcceptedProposalIds, setAutoApplyMode, setAutoApplyPending, setEdges, setNodes, setNotice, setPendingBrainActions, setPrompt, setProposedChanges, setSelectedId, setSelectedIds, setSurface, stage, t, thinking, timeline }: UseCanvasProposalReviewDeps) {
  useEffect(() => {
    if (!hydratedRef.current || modelComparisonStartedRef.current || comparisonModelIds.length < 2) return;
    const initial = timeline.find((message) => message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:'));
    if (!initial?.body.trim()) return;
    const completed = nodes.filter((node) => node.data.comparisonPrompt === initial.body && node.data.comparisonState === 'completed');
    if (comparisonModelIds.every((model) => completed.some((node) => node.data.comparisonModel === model))) {
      modelComparisonStartedRef.current = true;
      return;
    }

    modelComparisonStartedRef.current = true;
    initialPromptSubmittedRef.current = true;
    const promptId = `comparison-prompt:${sessionId}`;
    const resultIds = new Map(comparisonModelIds.map((model, index) => [model, `comparison-result:${index}:${sessionId}`]));
    const promptNode: CreationFlowNode = {
      id: promptId,
      type: 'creation',
      position: { x: 100, y: 180 },
      data: {
        kind: 'chat',
        title: t('comparison.promptTitle'),
        subtitle: initial.body,
        status: t('comparison.sharedPrompt'),
        comparisonPrompt: initial.body,
      },
    };
    const resultNodes: CreationFlowNode[] = comparisonModelIds.map((model, index) => ({
      id: resultIds.get(model)!,
      type: 'creation',
      position: { x: 620, y: 60 + index * 280 },
      data: {
        kind: 'document',
        title: model,
        subtitle: t('comparison.responseFrom', { model }),
        status: t('comparison.executing'),
        model,
        comparisonModel: model,
        comparisonPrompt: initial.body,
        comparisonState: 'running',
        markdown: t('comparison.executingWith', { model }),
      },
    }));
    setNodes([promptNode, ...resultNodes]);
    setEdges(comparisonModelIds.map((model) => ({
      id: `comparison-edge:${resultIds.get(model)}`,
      source: promptId,
      target: resultIds.get(model)!,
      type: 'smoothstep',
      label: t('comparison.executesWith', { model }),
      animated: true,
    })));
    setNotice(t('comparison.runningCount', { count: comparisonModelIds.length }));

    void Promise.all(comparisonModelIds.map(async (model) => {
      try {
        const output = await executeModelComparison({ prompt: initial.body, model, persistence });
        setNodes((current) => current.map((node) => node.id === resultIds.get(model) ? {
          ...node,
          data: {
            ...node.data,
            status: t('comparison.completed'),
            comparisonState: 'completed',
            markdown: output || t('comparison.emptyOutput'),
          },
        } : node));
      } catch (error) {
        setNodes((current) => current.map((node) => node.id === resultIds.get(model) ? {
          ...node,
          data: {
            ...node.data,
            status: t('comparison.failed'),
            comparisonState: 'failed',
            markdown: describeTurnError(error, 'noticeBrainFailed'),
          },
        } : node));
      }
    })).then(() => {
      setNotice(t('comparison.finished'));
    });
  }, [comparisonModelIds, describeTurnError, hydratedRef, initialPromptSubmittedRef, modelComparisonStartedRef, nodes, persistence, sessionId, setEdges, setNodes, setNotice, t, timeline]);

  useEffect(() => {
    if (comparisonModelIds.length >= 2) return;
    if (!hydratedRef.current || initialPromptSubmittedRef.current || thinking || entryAppPending) return;
    const initial = timeline.find((message) => message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:'));
    if (!initial || timeline.some((message) => message.messageRole === 'assistant')) return;
    initialPromptSubmittedRef.current = true;
    setPrompt(initial.body);
    evaluateCanvas(initial.body);
  }, [comparisonModelIds.length, entryAppPending, thinking, timeline, evaluateCanvas, hydratedRef, initialPromptSubmittedRef, setPrompt]);

  useEffect(() => {
    const request = initialPrompt?.trim();
    if (!request || !hydratedRef.current || initialPromptSubmittedRef.current || thinking || entryAppPending) return;
    if (initialFocusId && selectedId !== initialFocusId) return;
    initialPromptSubmittedRef.current = true;
    setPrompt(request);
    evaluateCanvas(request);
  }, [entryAppPending, evaluateCanvas, hydratedRef, initialFocusId, initialPrompt, initialPromptSubmittedRef, selectedId, setPrompt, thinking]);

  const applyProposedChanges = useCallback(async () => {
    const selected = proposedChanges.filter((change) => acceptedProposalIds.has(change.id));
    const additions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add');
    const updates = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.update' }> => change.type === 'object.update');
    const deletions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.delete' }> => change.type === 'object.delete');
    const layouts = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.layout' }> => change.type === 'object.layout');
    const actions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.action' }> => change.type === 'object.action');
    const connectionAdditions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.add' }> => change.type === 'connection.add');
    const connectionUpdates = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.update' }> => change.type === 'connection.update');
    const connectionDeletions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.delete' }> => change.type === 'connection.delete');
    const deletedObjectIds = new Set(deletions.map((change) => change.objectId));
    const deletedConnectionIds = new Set(connectionDeletions.map((change) => change.connectionId));
    let materializedAdditions = additions;
    const canonicalPrds = additions.filter((change) => change.node.data.kind === 'prd' && change.node.data.canonicalPrdPending === true);
    if (canonicalPrds.length) {
      setNotice(t('noticeSavingPrd'));
      try {
        materializedAdditions = await Promise.all(additions.map(async (change) => {
          if (!canonicalPrds.includes(change)) return change;
          return { ...change, node: await persistCanonicalProjectPrd(change.node) };
        }));
      } catch (error) {
        setNotice(error instanceof Error ? t('noticePrdNotSavedReason', { reason: error.message }) : t('noticePrdNotSaved'));
        return;
      }
    }
    setNodes((current) => {
      const next = [...current, ...materializedAdditions.map((change) => change.node)];
      return next
        .filter((node) => !deletedObjectIds.has(node.id))
        .map((node) => updates.reduce((value, change) => value.id === change.objectId ? { ...value, data: { ...value.data, ...change.patch } } : value, node))
        .map((node) => layouts.reduce((value, change) => {
          if (value.id !== change.objectId) return value;
          const locked = change.locked ?? value.data.placementLocked === true;
          return {
            ...value,
            ...(change.position ? { position: change.position } : {}),
            ...(change.hidden != null ? { hidden: change.hidden } : {}),
            ...canvasPlacementFlags(locked),
            style: { ...value.style, ...(change.width != null ? { width: change.width } : {}), ...(change.height != null ? { height: change.height } : {}) },
            data: { ...value.data, ...(change.hidden != null ? { placementHidden: change.hidden } : {}), ...(change.locked != null ? { placementLocked: change.locked } : {}) },
          };
        }, node));
    });
    setEdges((current) => {
      const reviewed = [...current, ...connectionAdditions.map((change) => change.edge)]
        .filter((edge) => !deletedConnectionIds.has(edge.id) && !deletedObjectIds.has(edge.source) && !deletedObjectIds.has(edge.target))
        .map((edge) => connectionUpdates.reduce((value, change) => value.id === change.connectionId ? { ...value, ...(change.patch.label != null ? { label: change.patch.label } : {}), data: { ...value.data, ...(change.patch.kind ? { connectionKind: change.patch.kind } : {}) } } : value, edge));
      const brain = nodes.find((node) => node.data.kind === 'chat');
      const changedArtifactIds = [...materializedAdditions.map((change) => change.node.id), ...updates.map((change) => change.objectId), ...layouts.map((change) => change.objectId), ...actions.map((change) => change.objectId)];
      return brain && changedArtifactIds.length ? associateBrainWithArtifacts(reviewed, brain.id, changedArtifactIds, 'Changed with Brain') : reviewed;
    });
    // `selectionWithinBoard`, in the same change as the deletion.
    //
    // This used to clear the multi-selection only when the SINGLE `selectedId`
    // happened to be one of the deleted objects, and not at all when the proposal
    // also added something — so a turn that deleted one of three selected cards
    // left `selectedIds` naming an object the board no longer held, and a turn
    // that added and deleted left every stale id in place. The invariant says
    // "in the same change, not on the next render", which is what makes this a
    // filter here rather than an effect that tidies up afterwards.
    if (deletedObjectIds.size) setSelectedIds((current) => selectionWithinBoard(current, nodes.filter((node) => !deletedObjectIds.has(node.id))));
    if (materializedAdditions.length) setSelectedId(materializedAdditions[materializedAdditions.length - 1]!.node.id);
    else if (selectedId && deletedObjectIds.has(selectedId)) { setSelectedId(null); setSelectedIds([]); }
    // A 3D creation stands in the ROOM — that is where it is walked round and opened
    // from — and a room design IS the room, so a turn that made either takes the
    // reader there, on every device.
    if (materializedAdditions.some((change) => leadsToRoom(change.node.data.kind))) setSurface('room');
    if (layoutViewportRef.current().narrow && materializedAdditions.length) {
      const brainId = nodes.find((node) => node.data.kind === 'chat')?.id;
      const focusIds = [brainId, ...materializedAdditions.map((change) => change.node.id)].filter((id): id is string => !!id);
      window.setTimeout(() => {
        void flowRef.current?.fitView({ nodes: focusIds.map((id) => ({ id })), padding: .18, minZoom: .62, maxZoom: .9, duration: 350 });
      }, 0);
    }
    if (actions.length) setPendingBrainActions((current) => [...current, ...actions.filter((change) => !deletedObjectIds.has(change.objectId)).map(({ objectId, action }) => ({ objectId, action }))]);
    setProposedChanges([]);
    setAcceptedProposalIds(new Set());
    setNotice(canonicalPrds.length ? t('noticePrdsSavedChangesApplied', { prds: canonicalPrds.length, count: selected.length }) : t('noticeReviewedChangesApplied', { count: selected.length }));
    trackActivity('creation_change_set_applied', { sessionId, metadata: { clientSurface: canvasSurface(), commandCount: selected.length } });
  }, [acceptedProposalIds, flowRef, layoutViewportRef, nodes, proposedChanges, selectedId, sessionId, setAcceptedProposalIds, setEdges, setNodes, setNotice, setPendingBrainActions, setProposedChanges, setSelectedId, setSelectedIds, setSurface, t]);

  useEffect(() => {
    if (!autoApplyPending || !proposedChanges.length || acceptedProposalIds.size !== proposedChanges.length) return;
    setAutoApplyPending(false);
    void applyProposedChanges();
  }, [acceptedProposalIds.size, applyProposedChanges, autoApplyPending, proposedChanges.length, setAutoApplyPending]);

  const applyAndEnableAutoApply = useCallback(() => {
    setAutoApplyMode(true);
    void applyProposedChanges();
  }, [applyProposedChanges, setAutoApplyMode]);

  const rejectProposedChanges = useCallback(() => {
    setProposedChanges([]);
    setAcceptedProposalIds(new Set());
    stage.reset();
    setAutoApplyPending(false);
    setNotice(t('noticeChangesRejected'));
  }, [setAcceptedProposalIds, setAutoApplyPending, setNotice, setProposedChanges, stage, t]);
  return { rejectProposedChanges, applyAndEnableAutoApply, applyProposedChanges };
}
