/** Agent objects — add knowledge and run a test prompt against the agent. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { newNode, specBoardOf } from '../canvasNodeHelpers';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { type CanvasAiCompletion, runCreationCanvasAi } from '@/lib/creationCanvasAi';
import { scoreAgentTestResponse } from '../canvasAgentTest';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CreationFlowNode } from '../CreationNode';
import type { Edge } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import type { CanvasNotices } from '@/domains/canvas/application/PersistCanvas';
import type { ChatModelSelection } from '@/components/ChatInput';

export interface UseCanvasAgentTestingDeps {
  brainRuntime: RefObject<{ completions: CanvasAiCompletion[]; disabledModels: string[]; }>;
  canEdit: boolean;
  canvasNotices: CanvasNotices;
  describeTurnError: (error: unknown, fallbackKey: 'noticeBrainFailed' | 'noticeAgentTestFailed' | 'noticeAgentGroupFailed') => string;
  disableBrainModel: (model: string) => void;
  edges: Edge[];
  modelSelection: ChatModelSelection;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  recordBrainCompletion: (completion: CanvasAiCompletion) => void;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasAgentTesting({ brainRuntime, canEdit, canvasNotices, describeTurnError, disableBrainModel, edges, modelSelection, nodes, persistence, placeAppendedRef, recordBrainCompletion, setEdges, setNodes, setNotice, t }: UseCanvasAgentTestingDeps) {
  const addAgentKnowledge = useCallback((agentId: string, content: string) => {
    const agent = nodes.find((node) => node.id === agentId && node.data.kind === 'agent');
    const authored = content.trim();
    if (!agent || !authored || !canEdit) return;
    const knowledge = newNode('knowledge', { x: agent.position.x - 390, y: agent.position.y + 40 });
    knowledge.data = { ...knowledge.data, title: `${agent.data.title} knowledge`, status: 'Ready', markdown: authored, content: authored, sources: [{ label: 'Authored in Agent inspector', resource: `session:${agent.id}` }] };
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [knowledge])]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: knowledge.id, target: agent.id, type: 'smoothstep', label: 'grounds', animated: true, data: { connectionKind: 'reference' } }]);
    setNotice(t('noticeKnowledgeConnected'));
  }, [canEdit, nodes, persistence, setEdges, setNodes]);

  const runAgentTest = useCallback(async (agentId: string, testPrompt: string, expected: string) => {
    const agent = nodes.find((node) => node.id === agentId && node.data.kind === 'agent');
    if (!agent || !testPrompt.trim()) return;
    const connectedIds = new Set(edges.flatMap((edge) => edge.source === agentId ? [edge.target] : edge.target === agentId ? [edge.source] : []));
    const knowledge = nodes.filter((node) => connectedIds.has(node.id) && ['knowledge', 'document', 'dataset', 'file', 'url'].includes(node.data.kind));
    const evaluations = nodes.filter((node) => node.data.kind === 'evaluation');
    const evaluationNode = evaluations.find((node) => connectedIds.has(node.id)) || (evaluations.length === 1 ? evaluations[0] : undefined);
    if (evaluationNode && !connectedIds.has(evaluationNode.id)) {
      connectedIds.add(evaluationNode.id);
      setEdges((current) => current.some((edge) => (edge.source === agentId && edge.target === evaluationNode.id) || (edge.target === agentId && edge.source === evaluationNode.id)) ? current : [...current, { id: crypto.randomUUID(), source: agentId, target: evaluationNode.id, type: 'smoothstep', label: 'evaluated by', animated: true, data: { connectionKind: 'reference' } }]);
    }
    const snapshot = JSON.stringify({
      testMode: true,
      agent: { id: agent.id, ...creationObjectDefinition('agent').contextAdapter(agent.data, specBoardOf(nodes)) },
      knowledge: ((board) => knowledge.map((node) => ({ id: node.id, ...creationObjectDefinition(node.data.kind).contextAdapter(node.data, board) })))(specBoardOf(nodes)),
    });
    setNodes((current) => current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testPrompt, testExpected: expected, testStatus: 'Running', testResponse: '' } } : node));
    setNotice(t('noticeTestingAgent', { name: agent.data.title }));
    try {
      const response = await runCreationCanvasAi({
        prompt: testPrompt.trim(), canvasSnapshot: snapshot, persistence, canvasActions: [], notices: canvasNotices,
        disabledModels: brainRuntime.current.disabledModels,
        onCompletion: recordBrainCompletion, onModelDisabled: disableBrainModel,
        ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
        routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
        participant: { ref: agent.data.resourceId || agent.id, name: agent.data.title, instructions: typeof agent.data.instructions === 'string' ? agent.data.instructions : agent.data.subtitle },
      });
      const score = scoreAgentTestResponse(response, expected);
      const status = score.passed == null ? 'Completed · review response' : score.passed ? 'Passed' : 'Failed';
      const result = { id: crypto.randomUUID(), prompt: testPrompt.trim(), expected: expected.trim(), response, status, passed: score.passed, matched: score.matched, missing: score.missing, runAt: new Date().toISOString(), knowledgeObjectIds: knowledge.map((node) => node.id) };
      setNodes((current) => {
        const evaluation = evaluationNode ? current.find((node) => node.id === evaluationNode.id) : undefined;
        const currentAgent = current.find((node) => node.id === agentId);
        const priorHistory = Array.isArray(currentAgent?.data.testHistory) ? currentAgent.data.testHistory : [];
        const updated = current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testPrompt, testExpected: expected, testResponse: response, testStatus: status, testHistory: [result, ...priorHistory].slice(0, 25), status: 'Tested' } } : node);
        if (!evaluation) return updated;
        const priorResults = Array.isArray(evaluation.data.testResults) ? evaluation.data.testResults : [];
        const results = [result, ...priorResults].slice(0, 100);
        const scored = results.filter((item) => item && typeof item === 'object' && typeof (item as { passed?: unknown }).passed === 'boolean') as Array<{ passed: boolean }>;
        const passed = scored.filter((item) => item.passed).length;
        return updated.map((node) => node.id === evaluation.id ? { ...node, data: { ...node.data, testResults: results, runCount: results.length, passRate: scored.length ? Math.round(passed / scored.length * 100) : null, lastRunAt: result.runAt, verdict: status, status: 'Tested', gaps: score.missing, recommendations: score.missing.map((item) => `Improve the response so it demonstrates: ${item}`) } } : node);
      });
      setNotice(t('noticeAgentTestResult', { name: agent.data.title, status: status.toLowerCase() }));
    } catch (error) {
      const message = describeTurnError(error, 'noticeAgentTestFailed');
      setNodes((current) => current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testStatus: t('noticeAgentTestStatusError', { reason: message }) } } : node));
      setNotice(message);
    }
  }, [describeTurnError, disableBrainModel, edges, modelSelection, nodes, persistence, recordBrainCompletion, setEdges, setNodes, t]);
  return { addAgentKnowledge, runAgentTest };
}
