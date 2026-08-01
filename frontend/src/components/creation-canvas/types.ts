export type CreationObjectKind =
  | 'workflow'
  | 'project'
  | 'website'
  | 'dashboard'
  | 'chat'
  | 'agent'
  | 'staff'
  | 'evaluation'
  | 'dataset'
  | 'table' | 'spreadsheet' | 'chart' | 'report' | 'kpi'
  | 'prototype' | 'code' | 'browser' | 'llm'
  | 'voice'
  | 'document' | 'slides' | 'knowledge' | 'file' | 'url'
  | 'note'
  | 'drawing' | 'frame' | 'comment' | 'timer'
  | 'roadmap'
  | 'prd' | 'release'
  | 'task'
  | 'mockup'
  | 'mockupSet'
  | 'featureSummary'
  | 'team' | 'role' | 'mcp'
  | 'evermind'
  | 'projectComparison'
  | 'standup';

export type CreationNodeData = {
  [key: string]: unknown;
  kind: CreationObjectKind;
  title: string;
  subtitle?: string;
  resourceId?: string;
  status?: string;
  model?: string;
  role?: string;
  focus?: string;
  accent?: string;
};
