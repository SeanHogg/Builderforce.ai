/**
 * Override Workflow Types
 */

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum ApprovalDecision {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export enum EscalationStatus {
  PENDING = 'pending',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
}

export enum ApprovalStepNotifyMethod {
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  SLACK = 'slack',
}

export interface ApprovalStep {
  id: string;
  notifyMethod: ApprovalStepNotifyMethod;
  email: string | null;
  approverId: string;
  required: boolean;
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  comments: string | null;
  createdAt: Date;
  evaluatedAt: Date | null;
  timeout?: number;
}

export interface ApprovalChain {
  id: string;
  steps: ApprovalStep[];
  createdAt: Date;
  resolvedAt: Date | null;
}

export type AuthorizationType = 'owner' | 'approver' | 'admin' | 'anyone';

export type WorkflowMode = 'auto-approve' | 'approval-required' | 'escalation-enabled';

export interface EscalationRule {
  id: string;
  workflowId: string;
  stepId: string;
  condition: string;
  action: string;
  targetApproverId: string;
  enabled: boolean;
  cooldownMs?: number;
  createdAt: Date;
}

export type NotificationScope = 'requester' | 'approver' | 'escalation' | 'all';

export interface NotificationConfig {
  type: NotificationScope;
  enabled: boolean;
  channel: 'email' | 'slack' | 'webhook';
  template: string;
  encoding?: 'url' | 'html' | 'json';
}

export interface OverrideMetadata {
  entityType: string;
  entityId: string;
  originalValues: Record<string, any>;
  changedValues: Record<string, any>;
  changeReason: string;
  relatedAlerts?: string[];
  auditTrail: AuditEntry[];
  reqMetKeys: string[];
  endDate?: Date;
  recallDate?: Date;
}

export interface AuditEntry {
  id: string;
  action: 'create' | 'approve' | 'reject' | 'cancel' | 'escalate' | 'recall' | 'unblock';
  actor: string;
  actorType: 'user' | 'system' | 'workflow';
  timestamp: Date;
  details: Record<string, any>;
}

export interface OverrideWorkflowConfig {
  defaultTimeoutMinutes: number;
  escalationCooldownMinutes: number;
  requireApprovalForSeverity: Array<'critical' | 'high'>;
  maxApprovalsPerOverride: number;
  enableUnblockOnApproval: boolean;
}

export interface ApprovalEvaluationRequest {
  approvalId: string;
  overrideId: string;
  approverId: string;
  decision: 'approve' | 'reject';
  comments?: string;
  riskScore?: number;
  riskFactors?: string[];
}

export interface ApprovalEvaluationResult {
  approved: boolean;
  latencyMs: number;
  riskAssessment: RiskAssessment;
  feedback?: string;
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high';
  factors: string[];
  impactScore: number;
  likelihoodScore: number;
  severityOverride?: string;
  timeSensitive?: boolean;
  autoApproval?: boolean;
}

export interface EscalationTrigger {
  overrideId: string;
  approverId: string;
  reason: string;
  originalApproverEmail: string;
  escalationTargetId: string;
  escalationTargetEmail: string;
  timestamp: Date;
}

export interface WorkflowAggregates {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  requiresApproval: number;
  overdue: number;
  escalationCount: number;
}

export interface WorkflowSummary {
  workflowId: string;
  mode: WorkflowMode;
  totalRequests: number;
  approvalRate: number;
  averageApprovalTimeMs: number;
  expiredCount: number;
  recallCount: number;
}