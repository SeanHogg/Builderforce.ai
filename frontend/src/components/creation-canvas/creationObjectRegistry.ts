import type { CreationNodeData, CreationObjectKind } from './types';

export type CreationObjectGroup = 'Build' | 'Data' | 'Knowledge' | 'Insights' | 'Work' | 'People' | 'Agents' | 'Models' | 'Collaborate' | 'Integrations';

export interface CreationObjectDefinition {
  kind: CreationObjectKind;
  label: string;
  icon: string;
  group: CreationObjectGroup;
  createData: () => CreationNodeData;
}

export const CREATION_OBJECT_REGISTRY: readonly CreationObjectDefinition[] = [
  { kind: 'workflow', label: 'Workflow', icon: '⌘', group: 'Build', createData: () => ({ kind: 'workflow', title: 'Untitled workflow', status: 'Ready' }) },
  { kind: 'website', label: 'Website', icon: '◎', group: 'Build', createData: () => ({ kind: 'website', title: 'Website concept', status: 'Draft' }) },
  { kind: 'chat', label: 'Chat', icon: '●', group: 'Build', createData: () => ({ kind: 'chat', title: 'Brain' }) },
  { kind: 'dataset', label: 'Dataset', icon: '▤', group: 'Build', createData: () => ({ kind: 'dataset', title: 'Imported dataset.csv' }) },
  { kind: 'table', label: 'Table', icon: '▦', group: 'Data', createData: () => ({ kind: 'table', title: 'Data table', status: 'Draft' }) },
  { kind: 'spreadsheet', label: 'Spreadsheet', icon: '▤', group: 'Data', createData: () => ({ kind: 'spreadsheet', title: 'Untitled spreadsheet', status: 'Draft' }) },
  { kind: 'chart', label: 'Chart', icon: '▥', group: 'Data', createData: () => ({ kind: 'chart', title: 'Data visualization', status: 'Connect a dataset' }) },
  { kind: 'kpi', label: 'KPI', icon: '↗', group: 'Data', createData: () => ({ kind: 'kpi', title: 'Key metric', status: 'Live' }) },
  { kind: 'dashboard', label: 'Dashboard', icon: '▥', group: 'Insights', createData: () => ({ kind: 'dashboard', title: 'Performance dashboard' }) },
  { kind: 'report', label: 'Report', icon: '▤', group: 'Insights', createData: () => ({ kind: 'report', title: 'Live report', status: 'Draft' }) },
  { kind: 'evaluation', label: 'Evaluation', icon: '✦', group: 'Insights', createData: () => ({ kind: 'evaluation', title: 'Canvas evaluation', status: 'AI evaluation' }) },
  { kind: 'projectComparison', label: 'Comparison', icon: '≈', group: 'Insights', createData: () => ({ kind: 'projectComparison', title: 'Project comparison', status: 'Add two projects', projects: [], sources: [] }) },
  { kind: 'roadmap', label: 'Roadmap', icon: '↗', group: 'Insights', createData: () => ({ kind: 'roadmap', title: 'Executive sales roadmap', status: 'Draft' }) },
  { kind: 'note', label: 'Note', icon: '◇', group: 'Insights', createData: () => ({ kind: 'note', title: 'Note', subtitle: 'Add context for your collaborators.' }) },
  { kind: 'prototype', label: 'WYSIWYG', icon: '▣', group: 'Build', createData: () => ({ kind: 'prototype', title: 'Interactive prototype', status: 'Draft' }) },
  { kind: 'code', label: 'Code', icon: '</>', group: 'Build', createData: () => ({ kind: 'code', title: 'Code workspace', status: 'Draft' }) },
  { kind: 'browser', label: 'Browser preview', icon: '◎', group: 'Build', createData: () => ({ kind: 'browser', title: 'Live preview', status: 'Ready' }) },
  { kind: 'llm', label: 'LLM', icon: '◉', group: 'Models', createData: () => ({ kind: 'llm', title: 'Language model', status: 'Blueprint', model: 'gpt-4o' }) },
  { kind: 'project', label: 'Project', icon: '▦', group: 'Work', createData: () => ({ kind: 'project', title: 'BuilderForce launch', status: 'Not linked', subtitle: 'Search for a canonical project in the inspector.' }) },
  { kind: 'task', label: 'Task', icon: '✓', group: 'Work', createData: () => ({ kind: 'task', title: 'Build approved mockup', status: 'Ready', role: 'Campaign Strategist' }) },
  { kind: 'prd', label: 'PRD', icon: '▤', group: 'Work', createData: () => ({ kind: 'prd', title: 'Product requirements', status: 'Draft' }) },
  { kind: 'release', label: 'Release', icon: '◆', group: 'Work', createData: () => ({ kind: 'release', title: 'Release plan', status: 'Planning' }) },
  { kind: 'mockup', label: 'Mockup', icon: '▣', group: 'Work', createData: () => ({ kind: 'mockup', title: 'Interactive feature mockup', status: 'Draft' }) },
  { kind: 'mockupSet', label: 'Mockup set', icon: '▦', group: 'Work', createData: () => ({ kind: 'mockupSet', title: 'Feature mockup set', status: 'Expandable', items: [] }) },
  { kind: 'featureSummary', label: 'Feature summary', icon: '★', group: 'Work', createData: () => ({ kind: 'featureSummary', title: 'Top 10 requested features', status: 'Synthesized' }) },
  { kind: 'staff', label: 'Staff member', icon: '●', group: 'People', createData: () => ({ kind: 'staff', title: 'Teammate', role: 'Contributor', focus: 'Add a current focus from the inspector.', accent: '#3978f6' }) },
  { kind: 'team', label: 'Team', icon: '◉', group: 'People', createData: () => ({ kind: 'team', title: 'Team', status: 'Gathering' }) },
  { kind: 'role', label: 'Role', icon: '◇', group: 'People', createData: () => ({ kind: 'role', title: 'Role', status: 'Unassigned' }) },
  { kind: 'standup', label: 'Stand-up', icon: '◎', group: 'People', createData: () => ({ kind: 'standup', title: 'Impromptu stand-up', status: 'Gathering', participants: [], summary: 'Add staff members and agents from this canvas. Brain will facilitate current work, blockers, and follow-ups.' }) },
  { kind: 'agent', label: 'Agent', icon: '✦', group: 'Agents', createData: () => ({ kind: 'agent', title: 'New agent', status: 'Draft', model: 'gpt-4o', subtitle: 'Configure or link a live workforce agent.' }) },
  { kind: 'voice', label: 'Voice', icon: '◖', group: 'Agents', createData: () => ({ kind: 'voice', title: 'Voice note' }) },
  { kind: 'document', label: 'Document', icon: '▤', group: 'Knowledge', createData: () => ({ kind: 'document', title: 'Untitled document', status: 'Draft' }) },
  { kind: 'slides', label: 'Slides', icon: '▣', group: 'Knowledge', createData: () => ({ kind: 'slides', title: 'Executive presentation', status: 'Draft' }) },
  { kind: 'knowledge', label: 'Knowledge', icon: '◇', group: 'Knowledge', createData: () => ({ kind: 'knowledge', title: 'Knowledge item' }) },
  { kind: 'file', label: 'File', icon: '□', group: 'Knowledge', createData: () => ({ kind: 'file', title: 'Attached file' }) },
  { kind: 'url', label: 'URL', icon: '↗', group: 'Knowledge', createData: () => ({ kind: 'url', title: 'Web resource' }) },
  { kind: 'frame', label: 'Frame', icon: '□', group: 'Collaborate', createData: () => ({ kind: 'frame', title: 'Presentation frame', status: 'Canvas frame' }) },
  { kind: 'drawing', label: 'Drawing', icon: '⌁', group: 'Collaborate', createData: () => ({ kind: 'drawing', title: 'Sketch', subtitle: 'Draw and annotate an idea.' }) },
  { kind: 'comment', label: 'Comment', icon: '●', group: 'Collaborate', createData: () => ({ kind: 'comment', title: 'Comment thread' }) },
  { kind: 'timer', label: 'Timer', icon: '◷', group: 'Collaborate', createData: () => ({ kind: 'timer', title: 'Focus timer', status: '05:00' }) },
  { kind: 'mcp', label: 'MCP tool', icon: '⌘', group: 'Integrations', createData: () => ({ kind: 'mcp', title: 'Connected tool', status: 'Choose operation' }) },
  { kind: 'evermind', label: 'Evermind', icon: '🧠', group: 'Models', createData: () => ({ kind: 'evermind', title: 'Untitled Evermind', status: 'Blueprint', subtitle: 'Create, teach, tune, evaluate, and publish a self-learning model on this canvas.', evermindVersion: 0, contributions: 0 }) },
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

export const CREATION_PALETTE_GROUPS = (['Build', 'Data', 'Knowledge', 'Insights', 'Work', 'People', 'Agents', 'Models', 'Collaborate', 'Integrations'] as const)
  .map((group) => ({ group, items: CREATION_OBJECT_REGISTRY.filter((definition) => definition.group === group) }));
