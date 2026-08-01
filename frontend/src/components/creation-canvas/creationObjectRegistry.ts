import type { CreationNodeData, CreationObjectKind } from './types';

export type CreationObjectGroup = 'Build' | 'Insights' | 'Work' | 'People' | 'Agents' | 'Models';

export interface CreationObjectDefinition {
  kind: CreationObjectKind;
  label: string;
  icon: string;
  group: CreationObjectGroup;
  createData: () => CreationNodeData;
}

const resource = (kind: string) => `${kind}:${crypto.randomUUID()}`;

export const CREATION_OBJECT_REGISTRY: readonly CreationObjectDefinition[] = [
  { kind: 'workflow', label: 'Workflow', icon: '⌘', group: 'Build', createData: () => ({ kind: 'workflow', title: 'Untitled workflow', status: 'Ready', resourceId: resource('workflow') }) },
  { kind: 'website', label: 'Website', icon: '◎', group: 'Build', createData: () => ({ kind: 'website', title: 'Website concept', status: 'Live', resourceId: resource('website') }) },
  { kind: 'chat', label: 'Chat', icon: '●', group: 'Build', createData: () => ({ kind: 'chat', title: 'Brain', resourceId: resource('chat') }) },
  { kind: 'dataset', label: 'Dataset', icon: '▤', group: 'Build', createData: () => ({ kind: 'dataset', title: 'Imported dataset.csv', resourceId: resource('dataset') }) },
  { kind: 'dashboard', label: 'Dashboard', icon: '▥', group: 'Insights', createData: () => ({ kind: 'dashboard', title: 'Performance dashboard', resourceId: resource('dashboard') }) },
  { kind: 'evaluation', label: 'Evaluation', icon: '✦', group: 'Insights', createData: () => ({ kind: 'evaluation', title: 'Canvas evaluation', status: 'AI evaluation' }) },
  { kind: 'projectComparison', label: 'Comparison', icon: '≈', group: 'Insights', createData: () => ({ kind: 'projectComparison', title: 'Project comparison', status: 'Add two projects', projects: [], sources: [] }) },
  { kind: 'roadmap', label: 'Roadmap', icon: '↗', group: 'Insights', createData: () => ({ kind: 'roadmap', title: 'Executive sales roadmap', status: 'Draft' }) },
  { kind: 'note', label: 'Note', icon: '◇', group: 'Insights', createData: () => ({ kind: 'note', title: 'Note', subtitle: 'Add context for your collaborators.' }) },
  { kind: 'project', label: 'Project', icon: '▦', group: 'Work', createData: () => ({ kind: 'project', title: 'BuilderForce launch', status: 'On track', subtitle: 'Product and go-to-market delivery.', resourceId: resource('project') }) },
  { kind: 'task', label: 'Task', icon: '✓', group: 'Work', createData: () => ({ kind: 'task', title: 'Build approved mockup', status: 'Ready', role: 'Campaign Strategist' }) },
  { kind: 'mockup', label: 'Mockup', icon: '▣', group: 'Work', createData: () => ({ kind: 'mockup', title: 'Interactive feature mockup', status: 'Draft' }) },
  { kind: 'featureSummary', label: 'Feature summary', icon: '★', group: 'Work', createData: () => ({ kind: 'featureSummary', title: 'Top 10 requested features', status: 'Synthesized' }) },
  { kind: 'staff', label: 'Staff member', icon: '●', group: 'People', createData: () => ({ kind: 'staff', title: 'Teammate', role: 'Contributor', focus: 'Add a current focus from the inspector.', accent: '#3978f6', resourceId: resource('staff') }) },
  { kind: 'standup', label: 'Stand-up', icon: '◎', group: 'People', createData: () => ({ kind: 'standup', title: 'Impromptu stand-up', status: 'Gathering', participants: [], summary: 'Add staff members and agents from this canvas. Brain will facilitate current work, blockers, and follow-ups.' }) },
  { kind: 'agent', label: 'Agent', icon: '✦', group: 'Agents', createData: () => ({ kind: 'agent', title: 'New agent', status: 'Online', model: 'gpt-4o', subtitle: 'Helps the team analyze and improve work.', resourceId: resource('agent') }) },
  { kind: 'voice', label: 'Voice', icon: '◖', group: 'Agents', createData: () => ({ kind: 'voice', title: 'Voice note', resourceId: resource('voice') }) },
  { kind: 'evermind', label: 'Evermind', icon: '🧠', group: 'Models', createData: () => ({ kind: 'evermind', title: 'Untitled Evermind', status: 'Blueprint', subtitle: 'Create, teach, tune, evaluate, and publish a self-learning model on this canvas.', resourceId: resource('evermind'), evermindVersion: 0, contributions: 0 }) },
] as const;

const byKind = new Map(CREATION_OBJECT_REGISTRY.map((definition) => [definition.kind, definition]));

export function creationObjectDefinition(kind: CreationObjectKind): CreationObjectDefinition {
  const definition = byKind.get(kind);
  if (!definition) throw new Error(`Unregistered creation object: ${kind}`);
  return definition;
}

export function createDefaultCreationData(kind: CreationObjectKind): CreationNodeData {
  return creationObjectDefinition(kind).createData();
}

export const CREATION_PALETTE_GROUPS = (['Build', 'Insights', 'Work', 'People', 'Agents', 'Models'] as const)
  .map((group) => ({ group, items: CREATION_OBJECT_REGISTRY.filter((definition) => definition.group === group) }));
