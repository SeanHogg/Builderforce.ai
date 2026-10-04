/** Building a runnable flow from a frame, and the Evermind build/template seams that start from one. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo, useState } from 'react';
import { resolveCanvasFlowNode } from '../canvasFlowTarget';
import { subflowSessionIdsOn } from '@/domains/workflow/domain/subflow';
import { useSubflowBoards } from '@/domains/canvas/presentation/useSubflowBoards';
import { canvasSessionGateway } from '@/domains/canvas/infrastructure/canvasSessionGateway';
import { compileBoardFlow } from '@/domains/workflow/domain/compileBoardFlow';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { flowDefinitionIdOf, flowDefinitionRef } from '@/domains/workflow/domain/flowDefinitionRef';
import { type WorkflowApprovalMode, type WorkflowDefinitionGraph, workflowDefinitions } from '@/lib/builderforceApi';
import { boundingRect } from '@/domains/canvas/domain/canvasFrame';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import { newNode } from '../canvasNodeHelpers';
import { loadTemplateGraph } from '@/lib/evermindBuild';
import { boardFlowFromDefinition } from '@/domains/workflow/domain/boardFlowFromDefinition';
import type { CreationNodeData } from '../types';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';

export interface UseCanvasFlowBuildDeps {
  connectionKind: 'presentation' | 'data' | 'delivery' | 'control' | 'reference' | 'membership' | 'blocks' | 'verifies';
  edgesRef: RefObject<Edge[]>;
  errorText: (error: unknown) => string;
  framedBoardRef: RefObject<{ memberIdsOf: (frameId: string) => string[]; }>;
  nodes: CanvasObject[];
  nodesRef: RefObject<CanvasObject[]>;
  persistence: 'local' | 'server';
  requireAccount: (action: string, title: string, description: string) => void;
  selectedNode: CanvasObject | null;
  sessionId: string;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  updateNodeData: (nodeId: string, patch: Partial<CreationNodeData>) => void;
}

export function useCanvasFlowBuild({ connectionKind, edgesRef, errorText, framedBoardRef, nodes, nodesRef, persistence, requireAccount, selectedNode, sessionId, setEdges, setNodes, setNotice, t, updateNodeData }: UseCanvasFlowBuildDeps) {
  /** Resolve which workflow node an action applies to: the one named, else the
   *  selection, else the only one on the board. Shared by build and run. */
  const resolveWorkflowNode = useCallback(
    // A FRAME that holds a built flow is as runnable as a legacy `workflow` card: the
    // definition id lives on whichever object stands for the flow, and since the board
    // became the workflow that object is the section that bounds it.
    //
    // The predicate itself lives in `canvasFlowTarget.ts` because the SESSION ACTION has
    // to ask the same question — Run must be offered for exactly the objects Run can act
    // on, and two copies of "is this a flow" is how a button gets shown for one object
    // and then runs another.
    (workflowId?: string) => resolveCanvasFlowNode(nodes, { preferredId: workflowId, selected: selectedNode }),
    [nodes, selectedNode],
  );

  /**
   * THE BOARD, COMPILED — turn the steps inside a frame into a real definition.
   *
   * This is what "the canvas is the workflow" cashes out to. There is no separate
   * document being edited somewhere else and no modal to open: the objects on the
   * board ARE the graph, the connections between them ARE the edges, and the outlet
   * an arm was drawn from IS the label the executor prunes on.
   *
   * The FRAME is the unit, because a board holds more than one flow and a section is
   * how a person says which steps belong together. Running with no frame at all draws
   * one round the steps first — the alternative is either refusing (a board full of
   * steps that will not run) or compiling every step on the board into one graph (a
   * flow nobody authored).
   *
   * All-or-nothing on issues, for the reason a compiler always refuses an
   * underspecified step: a graph that runs, reports success and does nothing that was
   * asked for is worse than one that will not build. Each unbuildable step SAYS what
   * it needs, on the card, so the board is the error report too.
   */
  /**
   * THE CHILD CANVASES THIS BOARD RUNS.
   *
   * A `subflow` step nests another canvas, and the compiler is synchronous — so the
   * boards it may need have to be in memory before a build starts. The hook watches
   * which canvases the board references and loads them; an unresolved one becomes a
   * refusal naming the canvas, never a step left silently out of the graph.
   */
  const subflowSessionIds = useMemo(
    () => subflowSessionIdsOn(nodes.map((node) => ({ data: node.data as unknown as Record<string, unknown> }))),
    [nodes],
  );
  const resolveSubflow = useSubflowBoards(subflowSessionIds, canvasSessionGateway);

  const buildFlowFromFrame = useCallback(async (frameId: string): Promise<string | null> => {
    if (persistence === 'local') {
      requireAccount('workflow', t('buildWorkflowGateTitle'), t('buildWorkflowGate'));
      return null;
    }
    const board = nodesRef.current;
    const frame = board.find((node) => node.id === frameId);
    if (!frame) return null;
    const memberIds = new Set(framedBoardRef.current.memberIdsOf(frameId));
    const objects = board
      .filter((node) => memberIds.has(node.id))
      .map((node) => ({ id: node.id, position: node.position, data: node.data as unknown as Record<string, unknown> }));
    const connections = edgesRef.current
      .filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target))
      .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null }));

    // `stack` starts at THIS canvas so a board nesting itself is refused as the
    // cycle it is, rather than recursing once before noticing.
    const { definition, issues, compiledCount } = compileBoardFlow(objects, connections, { resolveSubflow, stack: [sessionId] });
    if (issues.length > 0) {
      const explain = (issue: (typeof issues)[number]) => t(`flowIssue.${issue.messageKey}` as 'flowIssue.noSteps', issue.values ?? {});
      const blocked = new Map(issues.filter((issue) => issue.objectId).map((issue) => [issue.objectId, explain(issue)]));
      setNodes((current) => current.map((node) => blocked.has(node.id)
        ? { ...node, data: { ...node.data, status: t('flowStep.needsSetup'), flowStepIssue: blocked.get(node.id) } }
        : node));
      setNotice(explain(issues[0]!));
      updateNodeData(frameId, { status: t('flowStep.needsSetup') });
      return null;
    }
    // A step that WAS blocked and is now fine must stop saying so — a stale error on a
    // card is indistinguishable from a live one.
    setNodes((current) => current.map((node) => (memberIds.has(node.id) && node.data.flowStepIssue
      ? { ...node, data: { ...node.data, flowStepIssue: undefined, status: '' } }
      : node)));

    const projectId = canvasProjectNodes(board).map((node) => canvasProjectId(node.data))[0] ?? null;
    const name = frame.data.title || t('flowStep.untitledFlow');
    const linked = flowDefinitionIdOf(frame.data as unknown as Record<string, unknown>) ?? '';
    try {
      // The section's own two controls travel WITH the graph, exactly as the legacy
      // card's did: a section reading "Approval required" that compiled to a definition
      // with no gate would run unapproved (see migration 1092), and one with no run
      // target saves as built and refuses at run time. `builderforce` is the default
      // because a canvas flow runs on the hosted cloud runtime unless somebody says
      // otherwise, and the canvas offers no host picker to say it with.
      const runTarget = typeof frame.data.runTarget === 'string' && frame.data.runTarget ? frame.data.runTarget : 'builderforce';
      const approvalMode = frame.data.approvalMode === 'required' || frame.data.approvalMode === 'autonomous'
        ? (frame.data.approvalMode as WorkflowApprovalMode)
        : undefined;
      const saved = linked
        ? await workflowDefinitions.update(linked, { name, definition, runTarget, ...(approvalMode ? { approvalMode } : {}) })
        : await workflowDefinitions.create({ name, definition, runTarget, ...(approvalMode ? { approvalMode } : {}), ...(projectId != null ? { projectId } : {}) });
      updateNodeData(frameId, {
        resourceId: flowDefinitionRef(saved.id),
        resourceSubtype: 'definition',
        workflowExecutable: true,
        workflowStepCount: compiledCount,
        status: t('flowStep.built'),
      });
      setNotice(t('noticeWorkflowBuilt', { count: compiledCount }));
      return saved.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('noticeWorkflowNotRunnable');
      updateNodeData(frameId, { status: t('flowStep.needsSetup') });
      setNotice(message);
      return null;
    }
  }, [persistence, requireAccount, resolveSubflow, sessionId, setNodes, setNotice, t, updateNodeData]);

  /**
   * Build the flow the person is looking at, drawing the section first if there is none.
   *
   * A frame is the unit a flow is built from, and requiring one before anything can run
   * would make the first flow somebody draws fail for a reason that is about bookkeeping
   * rather than about their work. So the steps get a frame round them — which is what
   * they meant — and then it builds.
   */
  const buildFlow = useCallback((nodeId?: string): Promise<string | null> => {
    const board = nodesRef.current;
    const target = nodeId ? board.find((node) => node.id === nodeId) : null;
    if (target?.data.kind === 'frame') return buildFlowFromFrame(target.id);
    const steps = board.filter((node) => node.data.kind === 'flowStep');
    if (steps.length === 0) { setNotice(t('flowIssue.noSteps')); return Promise.resolve(null); }
    const rect = boundingRect(steps.map((node) => ({
      id: node.id, kind: node.data.kind, position: node.position, size: canvasNodeDimensions(node), data: node.data as unknown as Record<string, unknown>,
    })), 60);
    const frame = newNode('frame', { x: rect.x, y: rect.y });
    frame.style = { width: rect.width, height: rect.height };
    frame.zIndex = -1;
    frame.data = { ...frame.data, title: t('flowStep.untitledFlow'), framePurpose: t('flowStep.framePurpose') };
    setNodes((current) => [frame, ...current]);
    setNotice(t('flowStep.framedForBuild'));
    // The frame has to exist on the board before its membership can be read — the
    // containment is geometric, and geometry is what the next render establishes.
    return new Promise((resolve) => { window.setTimeout(() => { void buildFlowFromFrame(frame.id).then(resolve); }, 0); });
  }, [buildFlowFromFrame, setNodes, setNotice, t]);

  /**
   * The section whose steps are being run IN THE BROWSER, and the graph they compile to.
   *
   * Evermind BUILD steps do not run in the cloud at all — they run here, on this
   * device's GPU, through `lib/evermindBuild.ts`. That runner had exactly one door, a
   * panel inside the standalone workflow builder, and it moved with the capability
   * rather than being deleted alongside the shell that used to host it.
   */
  const [evermindBuild, setEvermindBuild] = useState<{ name: string; projectId: number | null; graph: WorkflowDefinitionGraph } | null>(null);

  const openEvermindBuild = useCallback((frameId: string) => {
    const board = nodesRef.current;
    const frame = board.find((node) => node.id === frameId);
    if (!frame) return;
    const memberIds = new Set(framedBoardRef.current.memberIdsOf(frameId));
    const { definition, issues } = compileBoardFlow(
      board.filter((node) => memberIds.has(node.id)).map((node) => ({ id: node.id, position: node.position, data: node.data as unknown as Record<string, unknown> })),
      edgesRef.current
        .filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target))
        .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null })),
      { resolveSubflow, stack: [sessionId] },
    );
    // The in-browser runner compiles the graph itself, so an unbuildable step has to be
    // reported the same way the cloud path reports it rather than reaching the engine.
    if (issues.length > 0) { setNotice(t(`flowIssue.${issues[0]!.messageKey}` as 'flowIssue.noSteps', issues[0]!.values ?? {})); return; }
    const projectId = canvasProjectNodes(board).map((node) => canvasProjectId(node.data))[0] ?? null;
    setEvermindBuild({ name: frame.data.title || t('flowStep.untitledFlow'), projectId, graph: definition });
  }, [resolveSubflow, sessionId, setNotice, t]);

  /**
   * Lay a starting Evermind pipeline out inside a frame.
   *
   * Eight steps nobody wants to place by hand, wired in the order the engine runs them,
   * dropped INSIDE the section that will build them — which is what makes the frame the
   * unit of a flow rather than a decoration around one.
   */
  const loadEvermindTemplate = useCallback((frameId: string, templateId: 'train-llm' | 'teach-code') => {
    const frame = nodesRef.current.find((node) => node.id === frameId);
    if (!frame) return;
    setNotice(t('flowStep.opening'));
    void loadTemplateGraph(templateId).then((graph) => {
      const unpacked = boardFlowFromDefinition(graph, { x: frame.position.x + 40, y: frame.position.y + 60 });
      const idByRef = new Map<string, string>();
      const stepNodes = unpacked.steps.map((step) => {
        const node = newNode('flowStep', step.position);
        idByRef.set(step.ref, node.id);
        node.data = { ...node.data, ...step.data } as CreationNodeData;
        return node;
      });
      setNodes((current) => current.map((node) => (node.id === frameId
        // The section grows to hold what was just put in it — containment is geometric,
        // so a frame that did not cover its own pipeline would not own it.
        ? { ...node, style: { ...node.style, width: Math.max(Number(node.style?.width) || 0, unpacked.frame.size.width + 80), height: Math.max(Number(node.style?.height) || 0, unpacked.frame.size.height + 80) } }
        : node)).concat(stepNodes));
      setEdges((current) => [
        ...current,
        ...unpacked.connections.flatMap((connection) => {
          const source = idByRef.get(connection.sourceRef);
          const dest = idByRef.get(connection.targetRef);
          return source && dest ? [{ id: crypto.randomUUID(), source, target: dest, type: connectionKind }] : [];
        }),
      ]);
      setNotice(t('flowStep.opened', { count: stepNodes.length }));
    }).catch((error: Error) => setNotice(errorText(error)));
  }, [connectionKind, setEdges, setNodes, setNotice, t, errorText]);
  return { resolveWorkflowNode, buildFlowFromFrame, buildFlow, openEvermindBuild, loadEvermindTemplate, evermindBuild, setEvermindBuild };
}
