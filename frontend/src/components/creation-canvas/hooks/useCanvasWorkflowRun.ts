/** Unpacking, compiling and running workflows; saving agents authored on the board. */
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { boardFlowFromDefinition, type UnpackedFlow } from '@/domains/workflow/domain/boardFlowFromDefinition';
import { newNode } from '../canvasNodeHelpers';
import type { CreationNodeData } from '../types';
import { workflowDefinitions } from '@/lib/builderforceApi';
import { flowStepsFromCanvasSteps } from '@/domains/workflow/domain/flowStepsFromCanvasSteps';
import { type CreationDeliverable, withCreationDeliverable } from '@/lib/creationDeliverables';
import { createCloudAgent, updateAgent } from '@/lib/api';
import { faultText } from '@/lib/apiClient';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';

export interface UseCanvasWorkflowRunDeps {
  buildFlowFromFrame: (frameId: string) => Promise<string | null>;
  canRun: boolean;
  connectionKind: 'presentation' | 'data' | 'delivery' | 'control' | 'reference' | 'membership' | 'blocks' | 'verifies';
  errorText: (error: unknown) => string;
  persistence: 'local' | 'server';
  requireAccount: (action: string, title: string, description: string) => void;
  resolveWorkflowNode: (workflowId?: string) => CanvasObject | null;
  selectedNode: CanvasObject | null;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasWorkflowRun({ buildFlowFromFrame, canRun, connectionKind, errorText, persistence, requireAccount, resolveWorkflowNode, selectedNode, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, t }: UseCanvasWorkflowRunDeps) {
  /**
   * OPEN A LEGACY WORKFLOW CARD ON THE BOARD — the migration path for every workflow
   * authored before the canvas WAS the workflow.
   *
   * The card is REPLACED by the section it was standing in for: a frame holding one
   * `flowStep` object per step, wired the way the flow was wired, with a labeled edge
   * reattached to the outlet its label names. Replaced rather than kept beside it,
   * because a card and the steps it stands for both on the board is two editable copies
   * of one graph, and the one that would be saved is whichever was touched last.
   *
   * ── TWO SOURCES, ONE PLACEMENT ───────────────────────────────────────────────
   * A card either points at a SAVED definition (it was built once) or carries an
   * AUTHORED step list that never was. Both lower to the same board section —
   * `boardFlowFromDefinition` for the saved graph, `flowStepsFromCanvasSteps` for the
   * authored list — so the placement below is written once. That authored list used to
   * be lowered SERVER-side by `POST /api/workflow-definitions/from-canvas`: a SECOND
   * compiler, for a card whose only editor was a modal that no longer exists, producing
   * a definition nobody could then open or change. Opening is the only thing that
   * happens to a legacy card now, and the board's compiler is the only one.
   *
   * The definition id moves to the frame when there is one, so Build and Run keep
   * pointing at the same row and this is an OPEN rather than a fork.
   */
  const unpackWorkflow = useCallback((workflowId?: string) => {
    const target = resolveWorkflowNode(workflowId);
    if (!target || target.data.kind !== 'workflow') { setNotice(t('noticeNeedWorkflow')); return; }
    const targetId = target.id;
    /**
     * Draw the section this card stood for, and delete the card.
     *
     * `runTarget` and `approvalMode` travel WITH it. They used to be dropped here, so a
     * card reading "Approval required" unpacked into a section that compiled to a
     * definition with NO gate and ran unapproved — the failure migration 1092 exists to
     * prevent. The frame declares the same two controls the card does (see
     * `canvasKindSettings.simple.ts`), so carrying them across is a copy of one value,
     * not a translation between two vocabularies.
     */
    const placeFlow = (unpacked: UnpackedFlow, title: string, definitionId: string) => {
      const frame = newNode('frame', unpacked.frame.position);
      frame.style = { width: unpacked.frame.size.width, height: unpacked.frame.size.height };
      frame.zIndex = -1;
      frame.data = {
        ...frame.data,
        title,
        framePurpose: t('flowStep.framePurpose'),
        ...(typeof target.data.runTarget === 'string' && target.data.runTarget ? { runTarget: target.data.runTarget } : {}),
        ...(target.data.approvalMode === 'required' || target.data.approvalMode === 'autonomous'
          ? { approvalMode: target.data.approvalMode }
          : {}),
        ...(definitionId
          ? { resourceId: `workflow:${definitionId}`, resourceSubtype: 'definition', workflowExecutable: true }
          : {}),
      };
      const idByRef = new Map<string, string>();
      const stepNodes = unpacked.steps.map((step) => {
        const node = newNode('flowStep', step.position);
        idByRef.set(step.ref, node.id);
        node.data = { ...node.data, ...step.data } as CreationNodeData;
        return node;
      });
      setNodes((current) => [frame, ...current.filter((node) => node.id !== targetId), ...stepNodes]);
      setEdges((current) => [
        ...current.filter((edge) => edge.source !== targetId && edge.target !== targetId),
        ...unpacked.connections.flatMap((connection) => {
          const source = idByRef.get(connection.sourceRef);
          const dest = idByRef.get(connection.targetRef);
          return source && dest ? [{
            id: crypto.randomUUID(),
            source,
            target: dest,
            type: connectionKind,
            ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
            ...(connection.label ? { label: connection.label } : {}),
          }] : [];
        }),
      ]);
      setSelectedId(frame.id); setSelectedIds([frame.id]);
      setNotice(t('flowStep.opened', { count: stepNodes.length }));
    };

    const definitionId = typeof target.data.resourceId === 'string' && target.data.resourceId.startsWith('workflow:')
      ? target.data.resourceId.slice('workflow:'.length)
      : '';
    if (definitionId) {
      setNotice(t('flowStep.opening'));
      void workflowDefinitions.get(definitionId)
        .then((detail) => placeFlow(boardFlowFromDefinition(detail.definition, target.position), detail.name, detail.id))
        .catch((error: Error) => setNotice(errorText(error)));
      return;
    }
    // Never built, so there is no saved graph and the authored list IS the flow. A step
    // that names no action becomes one that SAYS what it still needs, on the board,
    // rather than being refused — refusing would strand the intention in JSON that no
    // surface can edit, which is the failure this whole change is about.
    const authored = Array.isArray(target.data.steps) ? target.data.steps : [];
    if (authored.length === 0) { setNotice(t('flowStep.nothingToOpen')); return; }
    placeFlow(
      flowStepsFromCanvasSteps(authored, target.position, {
        untitledStep: (position: number) => t('flowStep.untitledStep', { position }),
      }),
      target.data.title || t('flowStep.untitledFlow'),
      '',
    );
  }, [resolveWorkflowNode, t, setNotice, setNodes, setEdges, setSelectedId, setSelectedIds, connectionKind, errorText]);

  /**
   * BUILD WHAT IS DRAWN — and there is exactly one thing that compiles a canvas.
   *
   * A frame's steps ARE the definition, so a frame is dispatched to the board compiler.
   * Dispatched HERE rather than at each call site so Run, the section's own Build and
   * Brain's `canvas_build_workflow` all reach the same one.
   *
   * A legacy `workflow` card has no build path of its own any more. Its authored list
   * was lowered by a second compiler on the server for a card whose only editor was a
   * modal that no longer exists, so building one minted a definition that nobody could
   * subsequently open or change. It is OPENED onto the board first, and from there it is
   * an ordinary section that this compiler builds like any other.
   */
  const compileWorkflow = useCallback(async (workflowId?: string): Promise<string | null> => {
    const target = resolveWorkflowNode(workflowId);
    if (!target) { setNotice(t('noticeNeedWorkflow')); return null; }
    if (target.data.kind === 'frame') return buildFlowFromFrame(target.id);
    setNotice(t('flowStep.openToBuild'));
    return null;
  }, [buildFlowFromFrame, resolveWorkflowNode, setNotice, t]);

  const runWorkflow = useCallback((workflowId?: string) => {
    if (!canRun) { setNotice(t('noticeNeedRunnerAccess')); return; }
    const target = resolveWorkflowNode(workflowId);
    if (!target) { setNotice(t('noticeNeedWorkflow')); return; }
    const targetId = target.id;
    // A run record is a past execution, not something that can be run again.
    if (persistence === 'server' && target.data.workflowExecutable === false) {
      setNotice(t('noticeWorkflowRunRecord'));
      return;
    }
    // A draft that has never been built has nothing to run. It is BUILT first —
    // and if it cannot be built, the run stops here with the reasons on the card.
    // The old code instead waited 1400ms and wrote a `delivered` deliverable with
    // `validation: passed`, so a workflow that had never executed anything
    // reported "Complete". Nothing here may report success it did not observe.
    const linkedId = target.data.resourceId?.startsWith('workflow:') ? target.data.resourceId.slice('workflow:'.length) : '';
    void (async () => {
      const definitionId = linkedId || await compileWorkflow(targetId);
      if (!definitionId) return;
      const started: CreationDeliverable = { id: crypto.randomUUID(), action: 'run', artifactKind: 'workflow-run', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-workflows' };
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running', deliverables: withCreationDeliverable(node.data, started) } } : node));
      setNotice(t('noticeStartingWorkflow'));
      await workflowDefinitions.get(definitionId).then((definition) => {
        if (!definition.runTargetRuntime) throw new Error('Choose a run target in the Workflow inspector before running it');
        return workflowDefinitions.run(definitionId, {
          runtime: definition.runTargetRuntime,
          agentHostId: definition.runTargetAgentHostId,
          cloudAgentRef: definition.runTargetCloudAgentRef,
        });
      }).then((run) => {
        // A definition whose card says "Approval required" answers with a real
        // pending approval INSTEAD of a run. The card says exactly that. The
        // regression this file's comment above describes — a 1400ms timer writing
        // `delivered` + `validation: passed` for a workflow that never executed —
        // is the same lie a "Running" card would tell here, so the deliverable
        // records `not_run` and nothing polls for a run that was never started.
        if (run.status === 'pending') {
          const awaiting: CreationDeliverable = { ...started, resourceRef: `approval:${run.approvalId}`, validation: { status: 'not_run', detail: run.reason } };
          setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Awaiting approval', workflowApprovalId: run.approvalId, deliverables: withCreationDeliverable(node.data, awaiting) } } : node));
          setNotice(run.reason);
          return;
        }
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running', workflowRunId: run.workflowId, workflowTaskCount: run.taskCount, deliverables: withCreationDeliverable(node.data, { ...started, resourceRef: `workflow-run:${run.workflowId}`, metadata: { taskCount: run.taskCount } }) } } : node));
        setNotice(t('noticeWorkflowStarted', { count: run.taskCount }));
        const pollRun = (remaining: number) => {
          if (remaining <= 0) return;
          window.setTimeout(() => {
            void workflowDefinitions.runs(definitionId).then((runs) => {
              const currentRun = runs.find((candidate) => candidate.id === run.workflowId);
              if (!currentRun) { pollRun(remaining - 1); return; }
              const normalized = currentRun.status.toLowerCase();
              const terminal = ['completed', 'complete', 'failed', 'cancelled', 'canceled'].includes(normalized);
              const label = normalized === 'completed' || normalized === 'complete' ? 'Complete' : normalized === 'failed' ? 'Run failed' : normalized === 'cancelled' || normalized === 'canceled' ? 'Cancelled' : currentRun.status;
              setNodes((nodesNow) => nodesNow.map((node) => {
                if (node.id !== targetId) return node;
                const terminalDeliverable: CreationDeliverable | null = terminal ? { ...started, status: normalized === 'completed' || normalized === 'complete' ? 'delivered' : 'failed', completedAt: currentRun.completedAt || new Date().toISOString(), resourceRef: `workflow-run:${run.workflowId}`, validation: { status: normalized === 'completed' || normalized === 'complete' ? 'passed' : 'failed', detail: `Workflow ${currentRun.status}` }, metadata: { taskCount: run.taskCount }, ...(!(normalized === 'completed' || normalized === 'complete') ? { error: `Workflow ${currentRun.status}` } : {}) } : null;
                return { ...node, data: { ...node.data, status: label, workflowRunStatus: currentRun.status, workflowCompletedAt: currentRun.completedAt, ...(terminalDeliverable ? { deliverables: withCreationDeliverable(node.data, terminalDeliverable) } : {}) } };
              }));
              if (terminal) setNotice(t('noticeWorkflowStatus', { status: label.toLowerCase() }));
              else pollRun(remaining - 1);
            }).catch(() => pollRun(remaining - 1));
          }, 2_000);
        };
        pollRun(30);
      }).catch((error) => {
        const message = errorText(error);
        const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Run failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        setNotice(message);
      });
    })();
  }, [canRun, compileWorkflow, errorText, persistence, resolveWorkflowNode, setNodes, setNotice, t]);

  const saveAgent = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'agent') return;
    const ref = selectedNode.data.resourceId?.startsWith('agent:') ? selectedNode.data.resourceId.slice('agent:'.length) : '';
    if (!ref && persistence === 'local') { requireAccount('agent', t('saveCollaborator'), t('saveCollaboratorGate')); return; }
    const personality = typeof selectedNode.data.personality === 'string' ? selectedNode.data.personality.trim() : '';
    const direction = typeof selectedNode.data.instructions === 'string' ? selectedNode.data.instructions.trim() : selectedNode.data.subtitle || '';
    const bio = [personality, direction].filter(Boolean).join('\n\n');
    const baseModel = selectedNode.data.model && selectedNode.data.model !== 'auto' ? String(selectedNode.data.model) : undefined;
    const input = { name: selectedNode.data.title, title: selectedNode.data.role || selectedNode.data.title, bio, skills: Array.isArray(selectedNode.data.tools) ? selectedNode.data.tools.map(String) : undefined, baseModel };
    setNotice(ref ? t('savingAgentSettings') : t('creatingWorkforceAgent'));
    void (ref ? updateAgent(ref, input) : createCloudAgent(input))
      .then((saved) => {
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, resourceId: `agent:${saved.id}`, status: 'Configured' } } : node));
        setNotice(ref ? t('agentSettingsSaved') : t('agentCreatedReady'));
      })
      .catch((error) => setNotice(faultText(error, t('agentSettingsSaveFailed'))));
  }, [persistence, requireAccount, selectedNode, setNodes, setNotice, t]);
  return { compileWorkflow, runWorkflow, unpackWorkflow, saveAgent };
}
