/** Shared, transport-neutral Creation Canvas contract used by web and VSIX. */
export const CREATION_OBJECT_KINDS = [
  'workflow', 'project', 'website', 'dashboard', 'chat', 'agent', 'staff', 'evaluation', 'dataset',
  'table', 'spreadsheet', 'chart', 'report', 'kpi', 'prototype', 'code', 'browser', 'llm', 'voice', 'video',
  'document', 'slides', 'knowledge', 'file', 'url', 'note', 'drawing', 'frame', 'comment', 'timer',
  'roadmap', 'prd', 'release', 'task', 'mockup', 'mockupSet', 'featureSummary', 'team', 'role', 'mcp',
  'evermind', 'projectComparison', 'standup',
  'repository', 'selection', 'diagnostics', 'terminal', 'service',
  'salesPipeline', 'salesContact', 'salesCampaign', 'targetMarket', 'salesGoal', 'salesMeeting',
] as const;

export type CreationObjectKind = typeof CREATION_OBJECT_KINDS[number];

export const CREATION_CONNECTION_KINDS = [
  'data', 'control', 'reference', 'presentation', 'delivery', 'membership',
] as const;

export type CreationConnectionKind = typeof CREATION_CONNECTION_KINDS[number];

export const CREATION_COMMAND_TYPES = [
  'graph.replace', 'object.add', 'object.update', 'object.move', 'object.delete',
  'connection.add', 'connection.delete', 'viewport.set',
] as const;

export type CreationCommandType = typeof CREATION_COMMAND_TYPES[number];

export function isCreationObjectKind(value: unknown): value is CreationObjectKind {
  return typeof value === 'string' && (CREATION_OBJECT_KINDS as readonly string[]).includes(value);
}

export function isCreationCommandType(value: unknown): value is CreationCommandType {
  return typeof value === 'string' && (CREATION_COMMAND_TYPES as readonly string[]).includes(value);
}

export function isCreationConnectionKind(value: unknown): value is CreationConnectionKind {
  return typeof value === 'string' && (CREATION_CONNECTION_KINDS as readonly string[]).includes(value);
}
