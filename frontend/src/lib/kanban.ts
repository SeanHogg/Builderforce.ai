/**
 * Agentic Workforce Kanban — frontend types (mirror the api application/kanban).
 */
export type Discipline =
  | 'engineering' | 'product' | 'design' | 'qa' | 'devops' | 'data' | 'security' | 'other';
export type Responsibility = 'owner' | 'reviewer' | 'contributor';
export type RequirementKind = 'role' | 'diagnostic' | 'review';
export type RequirementGate = 'off' | 'soft' | 'hard';
export type LaneGate = 'auto' | 'human';
export type TemplateVisibility = 'private' | 'tenant' | 'public';

export interface JobRole {
  key: string;
  name: string;
  description?: string;
  discipline: Discipline;
  color?: string;
  icon?: string;
  builtin: boolean;
  position: number;
}

export interface LaneRequirement {
  kind: RequirementKind;
  ref: string;
  responsibility?: Responsibility;
  isRequired: boolean;
  description?: string;
  position: number;
}

export interface TemplateLane {
  key: string;
  name: string;
  position: number;
  isTerminal: boolean;
  gate: LaneGate;
  requirementGate: RequirementGate;
  requirements: LaneRequirement[];
}

export interface KanbanTemplate {
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: string;
  teamType?: string;
  builtin: boolean;
  parentTemplateId?: string | null;
  visibility: TemplateVisibility;
  published: boolean;
  priceCents?: number | null;
  pricingModel?: string | null;
  priceUnit?: string | null;
  installCount: number;
  version: number;
  lanes: TemplateLane[];
}

export interface TemplateSummary {
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: string;
  teamType?: string;
  builtin: boolean;
  visibility: TemplateVisibility;
  published: boolean;
  priceCents?: number | null;
  installCount: number;
  laneCount: number;
  roleCount: number;
}

export interface RosterFiller {
  kind: 'human' | 'agent';
  ref: string;
  name: string;
  via: 'lane' | 'agent-skill' | 'discipline';
}

export interface RosterRole {
  roleKey: string;
  name: string;
  discipline: string;
  icon?: string;
  color?: string;
  description?: string;
  required: boolean;
  lanes: string[];
  status: 'filled' | 'gap';
  filledBy: RosterFiller[];
}

export interface RecommendedRoster {
  templateId: string;
  templateName: string;
  roles: RosterRole[];
  filledCount: number;
  gapCount: number;
}

export interface UnmetRequirement {
  laneKey: string;
  laneName: string;
  kind: RequirementKind;
  ref: string;
  responsibility?: Responsibility;
  reason: 'missing' | 'changes_requested';
  description?: string;
}

export interface TicketAudit {
  status: 'pass' | 'flagged';
  coverage: number;
  requiredCount: number;
  satisfiedCount: number;
  missing: UnmetRequirement[];
}

export interface FlaggedTicket {
  taskId: number;
  title: string;
  status: string;
  projectId: number;
  coverage: number;
  missing: UnmetRequirement[];
}
