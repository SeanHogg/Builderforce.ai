/**
 * The keyword-matched stand-in for a Brain turn that `useCanvasBrainTurn` runs instead
 * of the model when `NODE_ENV === 'test'`. Moved here VERBATIM from the hook; it is
 * still gated there. `CreationCanvas.test.tsx` and `CreationCanvas.realFlow.test.tsx`
 * assert on what it adds (a roadmap + slides, a feature summary + mockup set, an
 * evaluation card) and on the notices and inspector it opens — none of which the real
 * turn produces — so retiring it means rewriting what those tests assert.
 */
import type { CreationFlowNode } from '../CreationNode';
import { createDefaultCreationData } from '../creationObjectRegistry';
import { associateBrainWithArtifacts } from '@/domains/canvas/domain/canvasBoard';
import { buildLlmCourse } from '@/lib/courseLms';
import type { UseCanvasBrainTurnDeps } from '../hooks/useCanvasBrainTurn';

/** What the fixture reads: the board's deps plus the turn's request and composer clear. */
export interface OfflineTurnFixtureContext extends Pick<UseCanvasBrainTurnDeps,
  | 'canvasText' | 'locale' | 'nodes' | 'openNodeInspector' | 'placeAppendedRef' | 'setEdges'
  | 'setNodes' | 'setNotice' | 'setSelectedId' | 'setThinking' | 't'> {
  requestText: string;
  clearComposer: () => void;
}

/** After 850 ms, put the keyword-matched objects for `requestText` on the board. */
export function scheduleOfflineTurnFixture({ canvasText, clearComposer, locale, nodes, openNodeInspector, placeAppendedRef, requestText, setEdges, setNodes, setNotice, setSelectedId, setThinking, t }: OfflineTurnFixtureContext): void {
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
}
