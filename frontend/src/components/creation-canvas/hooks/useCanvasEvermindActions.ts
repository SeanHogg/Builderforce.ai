/** Evermind objects — attach a project, expand the pipeline, open training, evaluate. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { getProjectEvermindContributions, getProjectEvermindHead } from '@/lib/projectEvermindApi';
import { projectEvermindNodePatch } from '../canvasProjectSync';
import { faultText } from '@/lib/apiClient';
import type { CreationNodeData, CreationObjectKind } from '../types';
import { newNode } from '../canvasNodeHelpers';
import { createFlowStepData } from '@/domains/workflow/domain/flowStepObject';
import { type Edge, MarkerType, type ReactFlowInstance } from '@xyflow/react';
import { evaluateModel } from '@/lib/api';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';
import type { CreationFlowNode } from '../CreationNode';

export interface UseCanvasEvermindActionsDeps {
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  nodes: CanvasObject[];
  openNodeInspector: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null, rect?: DOMRect) => void;
  persistence: 'local' | 'server';
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  selectedNode: CanvasObject | null;
  sessionId: string;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setEvermindLiveByNodeId: Dispatch<SetStateAction<Record<string, Partial<CreationNodeData>>>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setTrainingFocus: Dispatch<SetStateAction<{ nodeId: string; projectId: number | string; localOnly: boolean; } | null>>;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasEvermindActions({ flowRef, nodes, openNodeInspector, persistence, placeAppendedRef, selectedNode, sessionId, setEdges, setEvermindLiveByNodeId, setNodes, setNotice, setSelectedId, setSelectedIds, setTrainingFocus, t }: UseCanvasEvermindActionsDeps) {
  const attachEvermindProject = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const evermindNodeId = selectedNode.id;
    const project = canvasProjectNodes(nodes)[0];
    if (!project) { setNotice(t('noticeNeedSavedProject')); return; }
    const projectId = canvasProjectId(project.data)!;
    setNodes((current) => current.map((node) => node.id === evermindNodeId ? { ...node, data: { ...node.data, resourceId: `evermind:${projectId}`, projectId, status: 'Syncing project…' } } : node));
    setEdges((current) => current.some((edge) => edge.source === project.id && edge.target === selectedNode.id) ? current : [...current, { id: crypto.randomUUID(), source: project.id, target: selectedNode.id, label: 'owns model', type: 'smoothstep' }]);
    void Promise.all([getProjectEvermindHead(projectId), getProjectEvermindContributions(projectId)]).then(([head, activity]) => {
      setEvermindLiveByNodeId((current) => ({ ...current, [evermindNodeId]: projectEvermindNodePatch(head, activity) }));
      setNotice(t('noticeEvermindAttached'));
    }).catch((error) => setNotice(faultText(error, t('noticeLoadEvermindFailed'))));
  }, [nodes, selectedNode, setEdges, setEvermindLiveByNodeId, setNodes, setNotice, t]);

  const expandEvermindPipeline = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const existing = nodes.filter((node) => node.data.modelPipelineFor === selectedNode.id);
    if (existing.length) {
      const start = existing.find((node) => node.data.pipelineStep === 1) ?? existing[0]!;
      setSelectedId(start.id); setSelectedIds([start.id]); openNodeInspector(start.id);
      window.setTimeout(() => void flowRef.current?.fitView({ nodes: [selectedNode, ...existing].map((node) => ({ id: node.id })), padding: .16, duration: 400 }), 0);
      setNotice(t('noticeDatasetStepOne'));
      return;
    }
    const specs: Array<{ kind: CreationObjectKind; title: string; status: string; x: number; y: number; step: number; instruction: string; detail?: Partial<CreationNodeData>; pipelineSteps?: Array<{ title: string; status: string }> }> = [
      { kind: 'dataset', title: `${selectedNode.data.title} training corpus`, status: 'Start here', x: -430, y: -20, step: 1, instruction: 'Select this card, then import a CSV or TSV in Details.' },
      // A guided STAGE is a section too: what used to be a `workflow` card's
      // display-only `steps` list (cosmetic status lines, never compiler input) is
      // now a frame holding one status-only `flowStep` per line — see below.
      { kind: 'frame', title: 'Tokenize examples', status: 'Waiting for data', x: -430, y: 250, step: 2, instruction: 'Review the corpus, then run tokenization.', pipelineSteps: [{ title: 'Inspect corpus', status: 'Waiting' }, { title: 'Build vocabulary', status: 'Waiting' }, { title: 'Verify tokens', status: 'Waiting' }] },
      { kind: 'frame', title: 'Distil & tune', status: 'Waiting for tokens', x: -20, y: 250, step: 3, instruction: 'Choose self-learning or a teacher, then adapt the model.', pipelineSteps: [{ title: 'Choose teacher', status: 'Waiting' }, { title: 'Create exemplars', status: 'Waiting' }, { title: 'Adapt weights', status: 'Waiting' }, { title: 'Save version', status: 'Waiting' }] },
      { kind: 'evaluation', title: 'Quality gate', status: 'Waiting for version', x: 800, y: 15, step: 4, instruction: 'Test learned answers before enabling replies.', detail: { verdict: 'Awaiting trained version', gaps: ['Run readiness prompts', 'Compare held-out loss', 'Approve the version'], recommendations: ['Complete distillation and tuning first.', 'Check regression against prior learnings.', 'Publish only after the model is coherent.'] } },
      { kind: 'dashboard', title: 'Learning telemetry', status: 'Waiting for run', x: 800, y: 300, step: 5, instruction: 'Observe loss, weight movement, and learned examples.', detail: { kpis: [{ label: 'Loss', value: '—', trend: 'After first run' }, { label: 'Weights moved', value: '—', trend: 'After first run' }, { label: 'Examples learned', value: '0', trend: 'No run yet' }], chartLabels: ['No training runs yet'], chartValues: [0] } },
    ];
    const created = specs.map((spec) => {
      const node = newNode(spec.kind, { x: selectedNode.position.x + spec.x, y: selectedNode.position.y + spec.y });
      node.data = { ...node.data, ...spec.detail, title: spec.title, status: spec.status, modelPipelineFor: selectedNode.id, pipelineStep: spec.step, pipelineStart: spec.step === 1, pipelineInstruction: spec.instruction, ...(spec.kind === 'frame' ? { framePurpose: spec.instruction } : {}) };
      if (spec.kind === 'frame') { node.style = { width: 380, height: 70 + (spec.pipelineSteps?.length ?? 0) * 54 }; node.zIndex = -1; }
      return node;
    });
    // One status-only `flowStep` per cosmetic line, positioned inside the stage
    // frame it belongs to. `pipelineStep`/`modelPipelineFor` (not any board wiring)
    // are what drive this walkthrough, so these carry no connections of their own.
    const stageSteps = specs.flatMap((spec, index) => (spec.pipelineSteps ?? []).map((line, lineIndex) => {
      const node = newNode('flowStep', { x: created[index]!.position.x + 20, y: created[index]!.position.y + 60 + lineIndex * 54 });
      node.style = { width: 340, height: 46 };
      node.data = { ...node.data, ...createFlowStepData('agent', line.title), status: line.status, modelPipelineFor: selectedNode.id };
      return node;
    }));
    const [dataset, tokenizer, tuning, evaluation, telemetry] = created;
    const sequence = [
      { source: dataset!.id, target: tokenizer!.id, label: '1 · examples' },
      { source: tokenizer!.id, target: tuning!.id, label: '2 · tokens' },
      { source: tuning!.id, target: selectedNode.id, label: '3 · learned version' },
      { source: selectedNode.id, target: evaluation!.id, label: '4 · test' },
      { source: evaluation!.id, target: telemetry!.id, label: '5 · observe' },
    ];
    setNodes((current) => { const base = current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, pipelineExpanded: true } } : node); return [...base, ...placeAppendedRef.current(base, [...created, ...stageSteps])]; });
    setEdges((current) => [...current, ...sequence.map((edge) => ({ ...edge, id: crypto.randomUUID(), type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed } }))]);
    setSelectedId(dataset!.id); setSelectedIds([dataset!.id]); openNodeInspector(dataset!.id);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [selectedNode, ...created, ...stageSteps].map((node) => ({ id: node.id })), padding: .16, duration: 400 }), 0);
    setNotice(t('noticeDatasetStepOne'));
  }, [flowRef, nodes, openNodeInspector, placeAppendedRef, selectedNode, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, t]);

  const openEvermindTraining = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    expandEvermindPipeline();
    const attached = selectedNode.data.resourceId?.match(/^evermind:(\d+)$/)?.[1];
    const projectNode = canvasProjectNodes(nodes)[0];
    const projectId = attached ? Number(attached) : projectNode ? canvasProjectId(projectNode.data) : null;
    if (persistence === 'server' && !projectId) {
      setNotice(t('noticeNeedProjectForTraining'));
      return;
    }
    setTrainingFocus({ nodeId: selectedNode.id, projectId: projectId ?? `local-${sessionId}`, localOnly: persistence === 'local' });
    setNotice(persistence === 'local' ? 'Local-only adapter studio opened' : t('noticeAdapterStudioOpened'));
  }, [expandEvermindPipeline, nodes, persistence, selectedNode, sessionId, setNotice, setTrainingFocus, t]);

  const evaluateEvermind = useCallback((nodeId?: string) => {
    const target = nodes.find((node) => node.id === nodeId && node.data.kind === 'evermind')
      ?? (selectedNode?.data.kind === 'evermind' ? selectedNode : null);
    if (!target) return;
    const jobId = typeof target.data.trainingJobId === 'string' ? target.data.trainingJobId : '';
    if (!jobId) { setNotice(t('noticeTrainBeforeEval')); return; }
    setNotice(t('noticeEvaluatingAdapter'));
    void evaluateModel(jobId).then((result) => {
      const existing = nodes.find((node) => node.data.kind === 'evaluation' && node.data.modelEvaluationFor === target.id);
      const evaluation = existing ?? newNode('evaluation', { x: target.position.x + 560, y: target.position.y });
      evaluation.data = {
        ...evaluation.data,
        title: `${target.data.title} evaluation`,
        status: 'Evaluated',
        modelEvaluationFor: target.id,
        verdict: result.score >= .8 ? 'Passed' : result.score >= .6 ? 'Review required' : 'Failed',
        score: result.score,
        content: result.details,
        results: [
          { label: 'Overall', value: result.score },
          { label: 'Code correctness', value: result.code_correctness ?? 0 },
          { label: 'Reasoning quality', value: result.reasoning_quality ?? 0 },
          { label: 'Hallucination rate', value: result.hallucination_rate ?? 0 },
        ],
      };
      setNodes((current) => existing ? current.map((node) => node.id === existing.id ? evaluation : node) : [...current, evaluation]);
      setEdges((current) => current.some((edge) => edge.source === target.id && edge.target === evaluation.id) ? current : [...current, { id: crypto.randomUUID(), source: target.id, target: evaluation.id, type: 'smoothstep', label: 'evaluated by', animated: true }]);
      setNotice(t('noticeEvermindEvalComplete', { score: (result.score * 100).toFixed(0) }));
    }).catch((error) => setNotice(faultText(error, t('noticeEvermindEvalFailed'))));
  }, [nodes, selectedNode, setEdges, setNodes, setNotice, t]);
  return { openEvermindTraining, evaluateEvermind, attachEvermindProject, expandEvermindPipeline };
}
