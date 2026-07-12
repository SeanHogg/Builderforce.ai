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

export type AssigneeKind = 'agent' | 'human' | 'hire';

export interface RosterFiller {
  kind: AssigneeKind;
  ref: string;
  name: string;
  via: 'assignment' | 'lane' | 'agent-skill' | 'discipline';
  /** Set when `via === 'assignment'`: the assignment row id, so the UI can unassign. */
  assignmentId?: string;
}

/** An explicit "pin an agent / human member / hire to a role" record. `projectId`
 *  null = a workspace-default (Workforce → Roles); set = a project's roster. */
export interface RoleAssignment {
  id: string;
  roleKey: string;
  assigneeKind: AssigneeKind;
  assigneeRef: string;
  assigneeName: string | null;
  projectId: number | null;
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

// ── Coordinated Role Participation: manifest + accountability record ──────────
export type ParticipantState =
  | 'pending' | 'assigned' | 'in_progress' | 'completed' | 'changes_requested' | 'waived' | 'skipped' | 'unstaffed';

export interface ManifestParticipant {
  id: string;
  stageKey: string | null;
  roleKey: string;
  roleName: string;
  responsibility: Responsibility;
  required: boolean;
  source: string;
  assigneeKind: string | null;
  assigneeRef: string | null;
  assigneeName: string | null;
  state: ParticipantState;
  signoffId: string | null;
  childTaskId: number | null;
  note: string | null;
}

export interface SignoffContribution {
  executionId?: number;
  prdRevision?: number;
  prUrl?: string;
  diffFiles?: string[];
  reviewThreadRef?: string;
  toolRunId?: string;
}

export interface AccountabilitySignoff {
  roleKey: string;
  roleName: string;
  memberKind: string | null;
  memberRef: string | null;
  memberName: string | null;
  verdict: string;
  summary: string | null;
  contribution: SignoffContribution | null;
  waiveReason: string | null;
  createdAt: string;
}

export type AccountabilityGapKind = 'unsigned' | 'unstaffed' | 'no_contribution' | 'waived' | 'changes_requested';
export interface AccountabilityGap {
  kind: AccountabilityGapKind;
  roleKey: string;
  roleName: string;
  detail: string;
}

export interface AccountabilityReport {
  taskId: number;
  requiredCount: number;
  completedCount: number;
  percentComplete: number;
  participants: ManifestParticipant[];
  signoffs: AccountabilitySignoff[];
  gaps: AccountabilityGap[];
}

export interface ParticipantsSummaryRow {
  taskId: number;
  completed: number;
  required: number;
  percent: number;
}
