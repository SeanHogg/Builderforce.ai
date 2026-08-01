export type CreationObjectKind =
  | 'workflow'
  | 'website'
  | 'dashboard'
  | 'chat'
  | 'agent'
  | 'staff'
  | 'evaluation'
  | 'dataset'
  | 'voice'
  | 'note';

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
