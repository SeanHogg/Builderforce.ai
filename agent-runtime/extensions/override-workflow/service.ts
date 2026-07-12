/**
 * Override Workflow Service
 * Handles approval-mode routing, escalation timeouts, and unblock-on-approval
 */

import { 
  OverrideRequest, 
  ApprovalChain, 
  ApprovalEscalation, 
  ApprovalStatus, 
  ApprovalStrategy,
  ApprovalConfig,
  DEFAULT_APPROVAL_CONFIG,
  DEFAULT_ESCALATION_RULES,
  EscalationRules
} from './types';

interface OverrideStorage {
  get(id: string): Promise<OverrideRequest | null>;
  set(id: string, request: OverrideRequest): Promise<void>;
  list(filter?: any): Promise<OverrideRequest[]>;
  delete(id: string): Promise<void>;
}

interface Callbacks {
  onApprove?: (request: OverrideRequest) => Promise<void>;
  onReject?: (request: OverrideRequest, reason: string) => Promise<void>;
  onCancel?: (request: OverrideRequest) => Promise<void>;
  onEscalate?: (request: OverrideRequest, escalation: ApprovalEscalation) => Promise<void>;
}

export class OverrideWorkflowService {
  private alerts: Set<string> = new Set();
  
  constructor(
    private storage: OverrideStorage,
    private callbacks: Callbacks = {},
    private config: ApprovalConfig = DEFAULT_APPROVAL_CONFIG,
    private escalationRules: EscalationRules = DEFAULT_ESCALATION_RULES
  ) {}

  /**
   * Create a new override request
   */
  async createOverrideRequest(request: Omit<OverrideRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'expired'>): Promise<OverrideRequest> {
    const overrideId = this.generateOverrideId();
    const expiryTime = new Date(Date.now() + this.config.defaultTimeoutMinutes * 60 * 1000);

    const overrideRequest: OverrideRequest = {
      id: overrideId,
      ...request,
      approvedAt: undefined,
      rejectedAt: undefined,
      cancelledAt: undefined,
      expiryAt: expiryTime,
      expired: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveOverride(overrideRequest);

    // Start approval process
    if (overrideRequest.requiresApproval && overrideRequest.enabled) {
      await this.startApprovalProcess(overrideRequest);
    }

    return overrideRequest;
  }

  /**
   * Start approval process for override
   */
  private async startApprovalProcess(request: OverrideRequest): Promise<void> {
    // Determine approvers based on strategy
    const approvers = await this.getApprovers(request);

    if (approvers.length === 0) {
      console.log(`[OverrideWorkflow] No approvers available for ${request.id}`);
      return;
    }

    // Create approval chain
    for (let i = 0; i < approvers.length; i++) {
      await this.createApprovalChain(request, approvers[i], i + 1);
    }

    // Schedule escalation check
    this.scheduleEscalationCheck(request);
  }

  /**
   * Get approvers for an override request
   */
  private async getApprovers(request: OverrideRequest): Promise<Array<{ id: string; name: string }>> {
    // In a real implementation, this would fetch approvers based on:
    // 1. Requester role
    // 2. Alert/rule type
    // 3. Configured approval hierarchy
    // 4. Workforce/team assignments
    
    // Demo: Return default admin approvers
    return [
      { id: 'admin_1', name: 'Admin user 1' },
      request.requesterId !== 'admin_1' ? { id: 'admin_2', name: 'Admin user 2' } : { id: 'admin_1', name: 'Admin user 1' },
    ];
  }

  /**
   * Create approval chain entry
   */
  private async createApprovalChain(
    request: OverrideRequest,
    approver: { id: string; name: string },
    order: number
  ): Promise<ApprovalChain> {
    const chain: ApprovalChain = {
      id: this.generateChainId(),
      overrideRequestId: request.id,
      approverId: approver.id,
      approverName: approver.name,
      order,
      status: 'pending',
    };

    await this.storage.set(`chain_${request.id}_${order}`, chain);
    return chain;
  }

  /**
   * Process approval
   */
  async approve(
    requestId: string,
    approverId: string,
    comment?: string
  ): Promise<boolean> {
    const request = await this.storage.get(requestId);
    
    if (!request || request.approvedAt) {
      return false;
    }

    // Check if approver is in chain
    const chain = await this.storage.get(`chain_${requestId}_${request.approvedCount + 1}`);
    if (!chain || chain.approverId !== approverId || chain.status !== 'pending') {
      return false;
    }

    // Record approval
    chain.status = 'approved';
    chain.result = 'approved';
    chain.comment = comment;
    chain.approvedAt = new Date();
    
    await this.storage.set(`chain_${requestId}_${request.approvedCount + 1}`, chain);

    request.approvedAt = chain.approvedAt;
    request.approvedCount = (request.approvedCount || 0) + 1;
    request.approvedBy = approverId;
    request.approvalStatus = request.approvedCount >= this.config.minimumRequiredApprovals ? 'approved' : 'pending';
    
    await this.saveOverride(request);

    // Trigger callbacks
    await this.callbacks.onApprove?.(request);

    // Unblock if all approvals received
    if (request.approvedCount >= this.config.minimumRequiredApprovals) {
      await this.applyOverride(request);
    }

    return true;
  }

  /**
   * Process rejection
   */
  async reject(
    requestId: string,
    approverId: string,
    reason: string
  ): Promise<boolean> {
    const request = await this.storage.get(requestId);
    
    if (!request || request.rejectedAt) {
      return false;
    }

    // Check if approver is in chain
    const chain = await this.storage.get(`chain_${requestId}_${request.approvedCount + 1}`);
    if (!chain || chain.approverId !== approverId) {
      return false;
    }

    // Record rejection
    chain.status = 'rejected';
    chain.result = 'rejected';
    chain.comment = reason;
    chain.rejectedAt = new Date();
    
    await this.storage.set(`chain_${requestId}_${request.approvedCount + 1}`, chain);

    request.rejectedAt = chain.rejectedAt;
    request.approvedAt = undefined;
    request.approvalStatus = 'rejected';
    
    await this.saveOverride(request);

    // Trigger callbacks
    await this.callbacks.onReject?.(request, reason);

    return true;
  }

  /**
   * Cancel override request
   */
  async cancel(requestId: string, initiatorId: string, reason?: string): Promise<boolean> {
    const request = await this.storage.get(requestId);
    
    if (!request || request.cancelledAt) {
      return false;
    }

    request.cancelledAt = new Date();
    request.expired = true;
    request.approvalStatus = 'cancelled';
    await this.saveOverride(request);

    // Cancel all pending approvals
    await this.cancelAllApprovers(requestId);

    // Trigger callback
    await this.callbacks.onCancel?.(request);

    return true;
  }

  /**
   * Cancel all pending approval requests
   */
  private async cancelAllApprovers(requestId: string): Promise<void> {
    const request = await this.storage.get(requestId);
    if (!request) return;

    for (let i = 0; i < request.approvedCount + 1; i++) {
      const chain = await this.storage.get(`chain_${requestId}_${i + 1}`);
      if (chain && chain.status === 'pending') {
        chain.status = 'cancelled';
        await this.storage.set(`chain_${requestId}_${i + 1}`, chain);
      }
    }
  }

  /**
   * Apply override (unblock-on-approval)
   */
  private async applyOverride(request: OverrideRequest): Promise<void> {
    console.log(`[OverrideWorkflow] Applying override ${request.id}`);
    
    // Apply override to the entity
    await this.executeOverride(request);

    // Notify requester and approvers
    await this.notifyOverrideApplied(request);
  }

  /**
   * Execute override on the target entity
   * In a real implementation, this would update the alert config, rule, etc.
   */
  private async executeOverride(request: OverrideRequest): Promise<void> {
    console.log(`[OverrideWorkflow] Executing override for ${request.entityType}:${request.entityId}`);
    
    // This would typically:
    // 1. Create or update a temporary override record
    // 2. Modify the affected system (e.g., disable alert rule, modify route)
    // 3. Log the override for auditing
    
    this.alerts.add(request.entityId);
  }

  /**
   * Notify relevant parties when override is applied
   */
  private async notifyOverrideApplied(request: OverrideRequest): Promise<void> {
    const message = `Override #${request.id} has been applied successfully for ${request.entityType} "${request.title}"`;
    
    // Notify requesters
    console.log(`[OverrideNotification] Requester ${request.requesterId}: ${message}`);
    
    // Notify all approvers
    const requestLoaded = await this.storage.get(request.id);
    if (requestLoaded?.approvedBy) {
      console.log(`[OverrideNotification] Approver ${requestLoaded.approvedBy}: ${message}`);
    }
  }

  /**
   * Schedule escalation check for override
   */
  private scheduleEscalationCheck(request: OverrideRequest): void {
    const escalationLevel = 1;
    const timeoutMs = (this.escalationRules as any)[`${escalationLevel}ApproverTimeout`] * 60000;
    
    setTimeout(async () => {
      await this.checkEscalation(request);
    }, timeoutMs);
  }

  /**
   * Check if escalation is needed
   */
  private async checkEscalation(request: OverrideRequest): Promise<void> {
    if (request.approvalStatus === 'approved' || request.approvalStatus === 'rejected') {
      return; // No longer pending
    }

    // Determine primary approver
    const chain = await this.storage.get(`chain_${request.id}_${request.approvedCount + 1}`);
    if (!chain || chain.status !== 'pending') {
      return; // Previous approver already acted
    }

    // Check if approver responded
    const elapsed = Date.now() - chain.approvedAt?.getTime() || 0;
    const timeoutMs = (this.escalationRules as any).primaryApproverTimeout * 60000;
    
    if (elapsed > timeoutMs) {
      // Escalate to next level
      await this.escalateToNextApprover(request, chain);
    }
  }

  /**
   * Escalate to next approver level
   */
  private async escalateToNextApprover(
    request: OverrideRequest,
    previousChain: ApprovalChain
  ): Promise<void> {
    console.log(`[OverrideWorkflow] Escalating ${request.id} to next level`);

    const escalation: ApprovalEscalation = {
      id: this.generateEscalationId(),
      overrideRequestId: request.id,
      escalationLevel: (request.approvalLevel || 0) + 1,
      previousApproverId: previousChain.approverId,
      currentApproverId: this.getNextApproverId(request, request.approvalLevel || 0),
      escalationTriggeredAt: new Date(),
      responseDeadlineAt: new Date(Date.now() + (this.escalationRules.secondaryApproverTimeout || 15) * 60000),
    };

    await this.storage.set(`escalation_${request.id}_${escalation.id}`, escalation);

    // Notify target
    await this.callbacks.onEscalate?.(request, escalation);

    console.log(`[OverrideWorkflow] Notified escalation target ${escalation.currentApproverId}`);
  }

  /**
   * Get next approver ID based on escalation level
   */
  private getNextApproverId(request: OverrideRequest, level: number): string {
    const approvers = ['admin_1', 'admin_2', 'admin_3'];
    return approvers[level] || 'admin_last';
  }

  /**
   * Get override request details
   */
  async getOverride(requestId: string): Promise<OverrideRequest | null> {
    return this.storage.get(requestId);
  }

  /**
   * Get approval chain for override
   */
  async getApprovalChain(requestId: string): Promise<ApprovalChain[]> {
    const request = await this.storage.get(requestId);
    if (!request) return [];

    const chains: ApprovalChain[] = [];
    for (let i = 0; i < request.approvedCount + 1; i++) {
      const chain = await this.storage.get(`chain_${requestId}_${i + 1}`);
      if (chain) chains.push(chain);
    }
    return chains;
  }

  /**
   * List all override requests with optional filters
   */
  async listOverrides(filter?: { status?: ApprovalStatus; requesterId?: string; entityType?: string }): Promise<OverrideRequest[]> {
    return this.storage.list(filter);
  }

  /**
   * Save override request
   */
  private async saveOverride(request: OverrideRequest): Promise<void> {
    request.updatedAt = new Date();
    await this.storage.set(request.id, request);
  }

  /**
   * Check if override should be applied (unblock-on-approval)
   */
  async shouldAutoApply(requestId: string): Promise<OverrideRequest | null> {
    const request = await this.storage.get(requestId);
    
    if (!request) {
      return null;
    }

    return request.enabled && 
           request.requiresApproval && 
           request.approvedCount >= this.config.minimumRequiredApprovals &&
           request.approvalStatus === 'pending'
      ? request
      : null;
  }

  /**
   * Generate unique override ID
   */
  private generateOverrideId(): string {
    return `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique chain ID
   */
  private generateChainId(): string {
    return `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique escalation ID
   */
  private generateEscalationId(): string {
    return `escalation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const overrideWorkflowService = new OverrideWorkflowService(
  // Mock storage
  {
    async get(id: string) {
      // In-memory storage would be used
      return mockOverrides.get(id);
    },
    async set(id: string, request: OverrideRequest) {
      mockOverrides.set(id, request);
    },
    async list(filter?: any) {
      return Array.from(mockOverrides.values());
    },
    async delete(id: string) {
      mockOverrides.delete(id);
    },
  },
  {
    async onApprove(request) {
      console.log(`[OverrideWorkflow] Auto-applied: ${request.id}`);
    },
  }
);

// In-memory storage for demo
const mockOverrides = new Map<string, OverrideRequest>();