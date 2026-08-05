import type { CreationNodeData, CreationObjectKind } from './types';
import { CREATION_CONNECTION_KINDS, type CreationConnectionKind } from '@builderforce/creation-canvas-contract';

export type CreationObjectGroup = 'Build' | 'Data' | 'Knowledge' | 'Insights' | 'Work' | 'People' | 'Agents' | 'Models' | 'Collaborate' | 'Integrations';

export interface CreationObjectDefinition {
  kind: CreationObjectKind;
  label: string;
  icon: string;
  group: CreationObjectGroup;
  createData: () => CreationNodeData;
  capability?: string;
  renderer: 'creation';
  inspector: 'creation';
  actions: readonly string[];
  /** Content fields Brain may author for this object kind. Common identity fields
   * (title, subtitle, status) are added automatically. */
  mutableFields: readonly string[];
  allowedConnections: readonly CreationConnectionKind[];
  contextAdapter: (data: CreationNodeData) => Record<string, unknown>;
  previewAdapter: (data: CreationNodeData) => { kind: CreationObjectKind; title: string; status?: string };
}
type BaseCreationObjectDefinition = Pick<CreationObjectDefinition, 'kind' | 'label' | 'icon' | 'group' | 'createData'>;

const BASE_CREATION_OBJECT_REGISTRY = [
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
  { kind: 'repository', label: 'Repository', icon: '⑂', group: 'Build', createData: () => ({ kind: 'repository', title: 'Source repository', status: 'Linked from VS Code' }) },
  { kind: 'selection', label: 'Editor selection', icon: '⌗', group: 'Build', createData: () => ({ kind: 'selection', title: 'Editor selection', status: 'Referenced from VS Code' }) },
  { kind: 'diagnostics', label: 'Diagnostics', icon: '⚠', group: 'Build', createData: () => ({ kind: 'diagnostics', title: 'Editor diagnostics', status: 'Ready to run', diagnostics: [], results: [], nextSteps: [] }) },
  { kind: 'terminal', label: 'Terminal output', icon: '>_', group: 'Build', createData: () => ({ kind: 'terminal', title: 'Terminal output', status: 'Review for secrets' }) },
  { kind: 'service', label: 'Local service', icon: '◎', group: 'Build', createData: () => ({ kind: 'service', title: 'Local service', status: 'Preview from VS Code' }) },
  { kind: 'llm', label: 'LLM', icon: '◉', group: 'Models', createData: () => ({ kind: 'llm', title: 'Language model', status: 'Blueprint', model: 'gpt-4o' }) },
  { kind: 'project', label: 'Project', icon: '▦', group: 'Work', createData: () => ({ kind: 'project', title: 'BuilderForce launch', status: 'Not linked', subtitle: 'Search for a canonical project in the inspector.' }) },
  { kind: 'salesPipeline', label: 'Sales pipeline', icon: '↗', group: 'Work', createData: () => ({ kind: 'salesPipeline', title: 'Sales pipeline', status: 'Live', stages: ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won'] }) },
  { kind: 'salesCampaign', label: 'Sales campaign', icon: '◎', group: 'Work', createData: () => ({ kind: 'salesCampaign', title: 'New campaign', status: 'Draft' }) },
  { kind: 'salesContact', label: 'Sales contact', icon: '●', group: 'People', createData: () => ({ kind: 'salesContact', title: 'New contact', status: 'New', stage: 'new' }) },
  { kind: 'targetMarket', label: 'Target market', icon: '◇', group: 'Insights', createData: () => ({ kind: 'targetMarket', title: 'Target market', status: 'Researching' }) },
  { kind: 'salesGoal', label: 'Weekly sales goal', icon: '✓', group: 'Insights', createData: () => ({ kind: 'salesGoal', title: 'Weekly goals', status: 'Active', outreachTarget: 50, contactsTarget: 20, meetingsTarget: 3 }) },
  { kind: 'salesMeeting', label: 'Sales meeting', icon: '◷', group: 'Collaborate', createData: () => ({ kind: 'salesMeeting', title: 'Sales meeting', status: 'Needs scheduling', durationMinutes: 30 }) },
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
  { kind: 'video', label: 'Video', icon: '▶', group: 'Build', createData: () => ({ kind: 'video', title: 'Video studio', status: 'Draft' }) },
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
] as const satisfies readonly BaseCreationObjectDefinition[];

const CAPABILITIES: Partial<Record<CreationObjectKind, string>> = {
  evermind: 'evermind', mcp: 'integrations', agent: 'agents', llm: 'models', voice: 'voice', video: 'video',
};
const ACTIONS: Partial<Record<CreationObjectKind, readonly string[]>> = {
  workflow: ['edit', 'run'], website: ['edit', 'preview', 'publish'], prototype: ['edit', 'preview'],
  dataset: ['import', 'profile', 'visualize'], chart: ['refresh', 'drill'], dashboard: ['refresh', 'drill'],
  project: ['expand', 'compare'], task: ['assign', 'deliver'], agent: ['inspect', 'configure', 'assign'],
  evermind: ['teach', 'train', 'evaluate', 'publish'], voice: ['record', 'play'], video: ['generate', 'preview'], mcp: ['authenticate', 'execute'],
  mockup: ['preview', 'deliver'], mockupSet: ['expand', 'deliver'], standup: ['start'],
  salesPipeline: ['refresh', 'review'], salesContact: ['qualify', 'advance'], salesCampaign: ['draft', 'schedule', 'execute'],
  targetMarket: ['research', 'segment'], salesGoal: ['review', 'update'], salesMeeting: ['schedule', 'invite'],
};

const MUTABLE_FIELDS = {
  workflow: ['content', 'steps', 'approvalMode', 'runTarget'],
  website: ['content', 'websiteHeadline', 'websiteBody', 'websiteCta', 'websiteAccent', 'viewport', 'pages', 'subdomain', 'url', 'siteUrl', 'pathUrl'],
  chat: ['content', 'aiResponse', 'messages', 'trace'],
  dataset: ['content', 'columns', 'rows', 'sampleRows', 'rowCount'],
  table: ['content', 'columns', 'rows'],
  spreadsheet: ['content', 'columns', 'rows', 'formulas'],
  chart: ['content', 'chartType', 'chartTitle', 'xAxisLabel', 'yAxisLabel', 'chartLabels', 'chartValues', 'kpis', 'sources'],
  kpi: ['content', 'value', 'target', 'unit', 'trend', 'sources'],
  dashboard: ['content', 'kpis', 'chartLabels', 'chartValues', 'sources', 'fetchedAt', 'dateRange'],
  report: ['content', 'markdown', 'chartLabels', 'chartValues', 'sources'],
  evaluation: ['content', 'verdict', 'gaps', 'recommendations', 'sources'],
  projectComparison: ['content', 'projects', 'sources', 'fetchedAt', 'recommendations'],
  roadmap: ['content', 'items', 'milestones', 'sources'],
  note: ['content', 'markdown'],
  prototype: ['content', 'websiteHeadline', 'websiteBody', 'websiteCta', 'websiteAccent', 'viewport', 'pages'],
  code: ['content', 'code', 'language', 'path'],
  browser: ['content', 'url', 'viewport'],
  repository: ['content', 'url', 'branch'],
  selection: ['content', 'code', 'language', 'path', 'range'],
  diagnostics: ['content', 'diagnostics', 'findings', 'checks', 'items', 'severity', 'result', 'results', 'summary', 'verdict', 'nextSteps', 'recommendations', 'actions', 'remediation', 'path', 'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount'],
  terminal: ['content', 'exitCode'],
  service: ['content', 'url', 'port'],
  llm: ['content', 'model', 'instructions', 'parameters'],
  project: ['content', 'projectLens', 'sources', 'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount', 'diagnostics', 'recommendations', 'qualityUpdatedAt'],
  salesPipeline: ['content', 'ownerUserId', 'stages', 'pipelineCounts', 'recommendations', 'sources'],
  salesContact: ['content', 'ownerUserId', 'contactId', 'email', 'company', 'market', 'stage', 'lastTouchAt'],
  salesCampaign: ['content', 'ownerUserId', 'campaignId', 'market', 'subject', 'sent', 'replies', 'scheduledAt'],
  targetMarket: ['content', 'ownerUserId', 'market', 'segments', 'channels', 'recommendations', 'sources'],
  salesGoal: ['content', 'ownerUserId', 'outreachTarget', 'contactsTarget', 'meetingsTarget', 'revenueGoalCents', 'referralLink', 'salesLink', 'progress', 'recommendations'],
  salesMeeting: ['content', 'ownerUserId', 'contactId', 'scheduledAt', 'durationMinutes', 'attendees', 'meetingUrl'],
  task: ['content', 'role', 'assignee', 'agentName', 'agentRef', 'priority', 'acceptanceCriteria', 'taskKey', 'prdTitle', 'prdStatus', 'prdSummary', 'prdCount'],
  prd: ['content', 'markdown', 'requirements', 'userStories'],
  release: ['content', 'items', 'milestones', 'releaseDate'],
  mockup: ['content', 'items', 'viewport', 'sources', 'deliveryProjectRef', 'deliveryProjectName', 'mockupAgentRef', 'mockupAgentName'],
  mockupSet: ['content', 'items', 'sources'],
  featureSummary: ['content', 'items', 'sources'],
  staff: ['content', 'role', 'focus', 'accent'],
  team: ['content', 'participants', 'summary'],
  role: ['content', 'role', 'responsibilities'],
  standup: ['content', 'participants', 'summary'],
  agent: ['content', 'model', 'instructions', 'tools', 'autonomy'],
  voice: ['content', 'transcript', 'voiceId', 'audioUrl'],
  video: ['content', 'prompt', 'videoUrl', 'duration', 'modelSlug', 'maxFrames', 'frameCount', 'videoWidth', 'videoHeight', 'generatedFrames'],
  document: ['content', 'markdown', 'sources'],
  slides: ['content', 'markdown', 'items', 'sources'],
  knowledge: ['content', 'markdown', 'sources'],
  file: ['content', 'fileName', 'mimeType', 'url'],
  url: ['content', 'url', 'sources'],
  frame: ['content', 'framePurpose', 'frameColor', 'frameBorder'],
  drawing: ['content', 'points', 'drawingWidth', 'drawingHeight', 'stroke', 'strokeWidth'],
  comment: ['content', 'resolved', 'mentions'],
  timer: ['content', 'duration', 'remaining', 'running'],
  mcp: ['content', 'toolName', 'operation', 'arguments'],
  evermind: ['content', 'model', 'instructions', 'teacherModel', 'inferenceEnabled', 'evermindVersion', 'evermindSeeded', 'contributions', 'pendingContributions', 'recentLearnings', 'trainingLoss', 'learningMode', 'lastLearnedAt', 'quarantinedAt', 'quarantineReason', 'evalPoint', 'stages', 'sources'],
} as const satisfies Record<CreationObjectKind, readonly string[]>;

const COMMON_MUTABLE_FIELDS = ['title', 'subtitle', 'status', 'deliverables'] as const;
const SENSITIVE_MUTATION_KEY = /(?:secret|token|password|credential|authorization|api.?key|cookie)/i;

function sanitizeMutationValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 40_000);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeMutationValue(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).flatMap(([key, item]) => {
    if (SENSITIVE_MUTATION_KEY.test(key)) return [];
    const safe = sanitizeMutationValue(item, depth + 1);
    return safe === undefined ? [] : [[key, safe]];
  }));
  return undefined;
}

export function creationObjectMutableFields(kind: CreationObjectKind): readonly string[] {
  return [...COMMON_MUTABLE_FIELDS, ...MUTABLE_FIELDS[kind]];
}

/** Drop unknown and sensitive values before an LLM-authored patch reaches state. */
export function sanitizeCreationObjectPatch(kind: CreationObjectKind, value: unknown): Partial<CreationNodeData> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(creationObjectMutableFields(kind));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (!allowed.has(key) || SENSITIVE_MUTATION_KEY.test(key)) return [];
    const safe = sanitizeMutationValue(item);
    return safe === undefined ? [] : [[key, safe]];
  })) as Partial<CreationNodeData>;
}
/**
 * Explicit, content-safe fields Brain may receive from a Canvas Object.
 * Imported rows, prompts, credentials, tokens, and arbitrary inspector state are
 * intentionally absent. Structured evidence is retained so comparisons,
 * evaluations, roadmaps, and charts can be grounded rather than title-only.
 */
const CONTEXT_FIELDS = [
  'kind', 'title', 'subtitle', 'status', 'resourceId', 'model', 'role', 'focus',
  'fetchedAt', 'dateRange', 'projectLens', 'columns', 'rowCount', 'sampleRows', 'chartTitle', 'xAxisLabel', 'yAxisLabel', 'chartLabels', 'chartValues',
  'projects', 'sources', 'items', 'summary', 'participants', 'evermindVersion',
  'contributions', 'inferenceEnabled', 'teacherModel', 'viewport', 'content', 'markdown',
  'steps', 'websiteHeadline', 'websiteBody', 'websiteCta', 'pages', 'kpis', 'verdict',
  'gaps', 'recommendations', 'milestones', 'code', 'language', 'path', 'url', 'branch',
  'diagnostics', 'findings', 'checks', 'results', 'result', 'nextSteps', 'actions', 'remediation',
  'instructions', 'parameters', 'assignee', 'agentName', 'agentRef', 'priority', 'acceptanceCriteria', 'taskKey',
  'prdTitle', 'prdStatus', 'prdSummary', 'prdCount', 'requirements',
  'userStories', 'responsibilities', 'tools', 'autonomy', 'transcript', 'stages',
  'approvalMode', 'runTarget', 'deliveryProjectRef', 'deliveryProjectName', 'mockupAgentRef', 'mockupAgentName',
  'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount', 'qualityUpdatedAt',
  'ownerUserId', 'contactId', 'campaignId', 'email', 'company', 'market', 'stage', 'lastTouchAt',
  'pipelineCounts', 'subject', 'sent', 'replies', 'scheduledAt', 'segments', 'channels',
  'outreachTarget', 'contactsTarget', 'meetingsTarget', 'progress', 'durationMinutes', 'attendees', 'meetingUrl',
  'revenueGoalCents', 'referralLink', 'salesLink',
] as const;
const SENSITIVE_CONTEXT_KEY = /(?:secret|token|password|credential|authorization|api.?key|cookie)/i;

function safeContextValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 2_000);
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => safeContextValue(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).flatMap(([key, item]) => {
      if (SENSITIVE_CONTEXT_KEY.test(key)) return [];
      const safe = safeContextValue(item, depth + 1);
      return safe === undefined ? [] : [[key, safe]];
    }));
  }
  return undefined;
}

export function creationObjectAiContext(data: CreationNodeData): Record<string, unknown> {
  return Object.fromEntries(CONTEXT_FIELDS.flatMap((field) => {
    const value = safeContextValue(data[field]);
    return value === undefined ? [] : [[field, value]];
  }));
}

export const CREATION_OBJECT_REGISTRY: readonly CreationObjectDefinition[] = BASE_CREATION_OBJECT_REGISTRY.map((definition) => ({
  ...definition,
  ...(CAPABILITIES[definition.kind] ? { capability: CAPABILITIES[definition.kind] } : {}),
  renderer: 'creation' as const,
  inspector: 'creation' as const,
  actions: [...new Set(['inspect', 'edit', ...(ACTIONS[definition.kind] ?? [])])],
  mutableFields: creationObjectMutableFields(definition.kind),
  allowedConnections: CREATION_CONNECTION_KINDS,
  contextAdapter: creationObjectAiContext,
  previewAdapter: (data: CreationNodeData) => ({ kind: data.kind, title: data.title, ...(data.status ? { status: data.status } : {}) }),
}));

const byKind = new Map(CREATION_OBJECT_REGISTRY.map((definition) => [definition.kind, definition]));

export function creationObjectDefinition(kind: CreationObjectKind): CreationObjectDefinition {
  const definition = byKind.get(kind);
  if (!definition) throw new Error(`Unregistered creation object: ${kind}`);
  return definition;
}

export function createDefaultCreationData(kind: CreationObjectKind): CreationNodeData {
  return creationObjectDefinition(kind).createData();
}

export function availableCreationObjects(capabilities: ReadonlySet<string>): readonly CreationObjectDefinition[] {
  return CREATION_OBJECT_REGISTRY.filter((definition) => !definition.capability || capabilities.has(definition.capability));
}

export const CREATION_PALETTE_GROUPS = (['Build', 'Data', 'Knowledge', 'Insights', 'Work', 'People', 'Agents', 'Models', 'Collaborate', 'Integrations'] as const)
  .map((group) => ({ group, items: CREATION_OBJECT_REGISTRY.filter((definition) => definition.group === group) }));
