/**
 * Override Workflow System
 * Handles approval-mode routing, escalation timeouts, and unblock-on-approval
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type ApprovalStrategy = 'sequential' | 'parallel';

export interface OverrideRequest {
  id: string;
  title: string;
  description: string;
  requesterId: string;
  requesterName: string;
  entityType: 'alert' | 'rule' | 'config';
  entityId: string;
  reason: string;
  enabled: boolean; // True if override should be applied automatically
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  createdAt: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  cancelledAt?: Date;
  expiryAt?: Date;
  expired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalChain {
  id: string;
  overrideRequestId: string;
  approverId: string;
  approverName: string;
  order: number;
  status: ApprovalStatus;
  result?: 'approved' | 'rejected';
  comment?: string;
  approvedAt?: Date;
  rejectedAt?: Date;
}

export interface ApprovalEscalation {
  id: string;
  overrideRequestId: string;
  escalationLevel: number;
  previousApproverId?: string;
  currentApproverId: string;
  escalationTriggeredAt: Date;
  responseDeadlineAt: Date;
  respondedAt?: Date;
  response?: 'approved' | 'rejected';
  responseNote?: string;
}

export interface ApprovalConfig {
  defaultStrategy: ApprovalStrategy;
  defaultTimeoutMinutes: number;
  minimumRequiredApprovals: number;
  thirdPartyApproved?: boolean; // Configuration flag to allow overrides without approval
}

/**
 * Escalation rules for override requests
 */
export interface EscalationRules {
  version: 1;
  primaryApproverTimeout: number; // Minutes before escalation
  secondaryApproverTimeout: number; // Minutes before further escalation
  maxLevels: number;
  notifyOriginalOnEscalation: boolean;
  notifyOriginalOnApprove: boolean;
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  defaultStrategy: 'sequential',
  defaultTimeoutMinutes: 30,
  minimumRequiredApprovals: 1,
  thirdPartyApproved: false,
};

export const DEFAULT_ESCALATION_RULES: EscalationRules = {
  version: 1,
  primaryApproverTimeout: 30,
  secondaryApproverTimeout: 15,
  maxLevels: 3,
  notifyOriginalOnEscalation: true,
  notifyOriginalOnApprove: true,
};