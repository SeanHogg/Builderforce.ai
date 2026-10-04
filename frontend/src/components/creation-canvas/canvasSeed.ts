import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { CreationFlowNode } from './CreationNode';
import { createFlowStepData } from '@/domains/workflow/domain/flowStepObject';
import type { CreationNodeData } from './types';
import type { Edge } from '@xyflow/react';

export const SEED = {
  workflow: '00000000-0000-4000-8000-000000000001', website: '00000000-0000-4000-8000-000000000002',
  dashboard: '00000000-0000-4000-8000-000000000003', chat: '00000000-0000-4000-8000-000000000004',
  sarah: '00000000-0000-4000-8000-000000000005', jordan: '00000000-0000-4000-8000-000000000006',
  agent: '00000000-0000-4000-8000-000000000007', workflowWebsite: '00000000-0000-4000-8000-000000000008',
  websiteDashboard: '00000000-0000-4000-8000-000000000009',
  workflowTrigger: '00000000-0000-4000-8000-00000000000a', workflowDraft: '00000000-0000-4000-8000-00000000000b',
  workflowPublish: '00000000-0000-4000-8000-00000000000c', workflowTriggerDraft: '00000000-0000-4000-8000-00000000000d',
  workflowDraftPublish: '00000000-0000-4000-8000-00000000000e',
};

/**
 * The demo board a LOCAL canvas opens on. A builder over the board's translator rather
 * than a constant: every title here is persisted with the board, so it is minted in the
 * board's language (person names and the product name "Brain" stay as written).
 */
export function initialNodes(t: CanvasTextTranslator): CreationFlowNode[] {
  const s = (key: string) => t(`seedBoard.${key}`);
  return [
    // A SECTION, not a legacy `workflow` card: the canvas IS the workflow, so the
    // seeded flow is a frame holding the steps it runs. Sized to stay clear of the
    // website seeded at x=610 — frame containment reads a step's CENTRE against this
    // rect, so the frame's right edge has to end well short of it.
    { id: SEED.workflow, type: 'creation', position: { x: 80, y: 45 }, style: { width: 480, height: 260 }, zIndex: -1, data: { kind: 'frame', title: s('workflow'), framePurpose: t('flowStep.framePurpose') } },
    { id: SEED.workflowTrigger, type: 'creation', position: { x: 100, y: 95 }, style: { width: 140, height: 150 }, data: createFlowStepData('trigger', s('weekdayCadence')) as CreationNodeData },
    { id: SEED.workflowDraft, type: 'creation', position: { x: 260, y: 95 }, style: { width: 140, height: 150 }, data: { ...(createFlowStepData('agent', s('draftCopy')) as CreationNodeData), stepConfig: { role: 'code-creator', task: s('draftCopyTask') } } },
    { id: SEED.workflowPublish, type: 'creation', position: { x: 420, y: 95 }, style: { width: 140, height: 150 }, data: createFlowStepData('output', s('publishPage')) as CreationNodeData },
    { id: SEED.website, type: 'creation', position: { x: 610, y: 45 }, data: { kind: 'website', title: s('landingPage'), status: s('draft') } },
    { id: SEED.dashboard, type: 'creation', position: { x: 1140, y: 55 }, data: { kind: 'dashboard', title: s('forecast') } },
    // The Brain Object is 390px wide once the conversation is placed INSIDE it, so
    // the row beside it starts clear of that — a seeded board that reads well docked
    // and then overlaps itself the moment Brain goes inline is the first impression.
    { id: SEED.chat, type: 'creation', position: { x: 80, y: 380 }, data: { kind: 'chat', title: 'Brain' } },
    { id: SEED.sarah, type: 'creation', position: { x: 520, y: 455 }, data: { kind: 'staff', title: 'Sarah', role: s('marketing'), focus: s('sarahFocus'), accent: 'var(--canvas-obj-evermind)' } },
    { id: SEED.jordan, type: 'creation', position: { x: 800, y: 455 }, data: { kind: 'staff', title: 'Jordan', role: s('design'), focus: s('jordanFocus'), accent: 'var(--canvas-obj-staff)' } },
    { id: SEED.agent, type: 'creation', position: { x: 1080, y: 455 }, data: { kind: 'agent', title: s('strategist'), status: s('draft'), model: 'gpt-4o', subtitle: s('strategistSubtitle') } },
  ];
}

export function initialEdges(t: CanvasTextTranslator): Edge[] {
  return [
    { id: SEED.workflowTriggerDraft, source: SEED.workflowTrigger, target: SEED.workflowDraft, type: 'smoothstep', data: { connectionKind: 'control' } },
    { id: SEED.workflowDraftPublish, source: SEED.workflowDraft, target: SEED.workflowPublish, type: 'smoothstep', data: { connectionKind: 'control' } },
    { id: SEED.workflowWebsite, source: SEED.workflow, target: SEED.website, label: t('seedBoard.publishes'), type: 'smoothstep', data: { connectionKind: 'control' } },
    { id: SEED.websiteDashboard, source: SEED.website, target: SEED.dashboard, label: t('seedBoard.measures'), type: 'smoothstep', data: { connectionKind: 'data' } },
  ];
}
