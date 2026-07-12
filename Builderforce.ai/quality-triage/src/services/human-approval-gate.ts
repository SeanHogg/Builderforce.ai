/**
 * Human Approval Gate
 *
 * Provides approval workflow before committing agent-generated changes to main branch.
 */

import { RecommendationAction, Recommendation, HumanApprovalRequest, RecommendationStatus } from '../types.js';

export interface ApprovalState {
  approved: boolean;
  approvedAt: string;
  approvedBy: string;
  agentProposal?: any;
  rejectionReason?: string;
}

export interface ApprovalWorkflowOptions {
  requireHumanReview: boolean;
  requireDoubleSignature: boolean;
}

export class HumanApprovalGate {
  private approvals: Map<string, ApprovalState>;
  private readonly DEFAULT_OPTIONS: ApprovalWorkflowOptions = {
    requireHumanReview: true,
    requireDoubleSignature: false,
  };

  constructor() {
    this.approvals = new Map();
  }

  /**
   * Submit recommendation for human approval
   */
  submitForApproval(
    recommendationId: string,
    agentProposal?: any,
    options: ApprovalWorkflowOptions = {}
  ): this {
    this.approvals.set(recommendationId, {
      approved: false,
      approvedAt: '',
      approvedBy: '',
      agentProposal: agentProposal || null,
    });

    return this;
  }

  /**
   * Check if a recommendation requires approval
   */
  requiresApproval(recommendationId: string): boolean {
    const approval = this.approvals.get(recommendationId);
    return !approval?.approved;
  }

  /**
   * Approve a recommendation
   */
  approve(
    recommendationId: string,
    approverId: string,
    approverName: string = 'Human Reviewer',
    agentProposal?: any
  ): boolean {
    const approval = this.approvals.get(recommendationId);

    if (!approval) {
      throw new Error(`Approval not found for recommendation: ${recommendationId}`);
    }

    if (approval.approved) {
      // Already approved by another reviewer
      return false;
    }

    approval.approved = true;
    approval.approvedAt = new Date().toISOString();
    approval.approvedBy = approverName;
    approval.agentProposal = agentProposal || approval.agentProposal;

    return true;
  }

  /**
   * Reject a recommendation
   */
  reject(
    recommendationId: string,
    reason: string
  ): boolean {
    const approval = this.approvals.get(recommendationId);

    if (!approval) {
      throw new Error(`Approval not found for recommendation: ${recommendationId}`);
    }

    if (approval.approved) {
      throw new Error(`Cannot reject an already approved recommendation: ${recommendationId}`);
    }

    approval.approved = false;
    approval.rejectReason = reason;

    return true;
  }

  /**
   * Get approval state for a recommendation
   */
  getApprovalState(recommendationId: string): ApprovalState | undefined {
    return this.approvals.get(recommendationId);
  }

  /**
   * Check if recommendation is approved
   */
  isApproved(recommendationId: string): boolean {
    const approval = this.approvals.get(recommendationId);
    return approval?.approved === true;
  }

  /**
   * Get all pending approvals
   */
  getPendingApprovals(): string[] {
    return Array.from(this.approvals.entries())
      .filter(([_, state]) => !state.approved)
      .map(([id]) => id);
  }

  /**
   * Compile suggestions from approved recommendations
   */
  compileApprovedRecommendations(): Array<{
    id: string;
    recommendation: Recommendation;
    action: RecommendationAction;
  }> {
    const compiled: Array<{
      id: string;
      recommendation: Recommendation;
      action: RecommendationAction;
    }> = [];

    for (const [recId, approval] of this.approvals.entries()) {
      if (approval.approved) {
        compiled.push({
          id: recId,
          recommendation: this.generateFromApproval(recId),
          action: {
            id: `${recId}-action-${Date.now()}`,
            recommendationId: recId,
            actionedBy: 'human',
            action: 'approved',
            startedAt: new Date().toISOString(),
            defectScoreBefore: 0,
            defectScoreAfter: 0,
            actualImpact: 'Pending execution',
          },
        });
      }
    }

    return compiled;
  }

  /**
   * Create recommendation from approval state
   */
  private generateFromApproval(recId: string): Recommendation {
    // In production, this would retrieve the full recommendation object
    return {
      id: recId,
      type: 'refactoring',
      priority: 80,
      estimatedImpact: 'Agent-generated refactor pending approval',
      estimatedEffort: 'MEDIUM',
      targetPath: 'unknown',
      rationale: 'Pending human review',
      action: 'Pending approval',
      status: RecommendationStatus.PENDING_APPROVAL,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Process human approval request
   */
  processApprovalRequest(request: HumanApprovalRequest): {
    approved: boolean;
    message?: string;
    requirement: 'needs-approval' | 'approved' | 'rejected';
  } {
    if (!request.approved) {
      // Rejected
      if (!request.rejectionReason) {
        return {
          approved: false,
          requirement: 'rejected',
          message: 'Rejection requires a reason.',
        };
      }

      this.reject(request.recommendationId, request.rejectionReason);

      return {
        approved: false,
        requirement: 'rejected',
        message: `Recommendation ${request.recommendationId} rejected: ${request.rejectionReason}`,
      };
    }

    // Approved
    if (!this.requiresApproval(request.recommendationId)) {
      return {
        approved: true,
        requirement: 'approved',
        message: `Recommendation ${request.recommendationId} is already approved.`,
      };
    }

    // Execute approval
    this.approve(
      request.recommendationId,
      'human',
      'Human Manager',
      request.agentProposal
    );

    return {
      approved: true,
      requirement: 'approved',
      message: `Recommendation ${request.recommendationId} is now approved and ready for execution.`,
    };
  }

  /**
   * Return recommendations to pending state
   */
  rollBack(id: string): boolean {
    const approval = this.approvals.get(id);
    if (!approval) return false;

    approval.approved = false;
    approval.approvedAt = '';
    approval.approvedBy = '';
    approval.agentProposal = undefined;

    return true;
  }

  /**
   * Export approval state for persistence
   */
  exportState(): Record<string, ApprovalState> {
    return Object.fromEntries(this.approvals);
  }

  /**
   * Import approval state from persistence
   */
  importState(state: Record<string, ApprovalState>): this {
    this.approvals = new Map(Object.entries(state));
    return this;
  }

  /**
   * Clear completed approvals (keep pending ones)
   */
  clearCompleted(): this {
    this.approvals = new Map(
      Array.from(this.approvals.entries()).filter(([_, state]) => !state.approved)
    );
    return this;
  }
}