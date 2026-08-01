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
  | 'voice'
  | 'note'
  | 'roadmap'
  | 'task'
  | 'mockup'
  | 'featureSummary';

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
