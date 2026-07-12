/**
 * Override Workflow Service
 * Manages override requests, approvals, escalations, and unblock-on-approval
 */

import { 
  OverrideRequest, 
  ApprovalStep, 
  ApprovalChain, 
  ApprovalStatus, 
  EscalationRule,
  ApprovalDecision,
} from './types';
import { ApprovalStorage, ApprovalChainStorage } from './storage';
import { NotifyService } from './notifications';
import { EmailService } from './email-service';

export class OverrideWorkflowService {
  private overrides: Map<string, OverrideRequest> = new Map();
  private approvalChains: Map<string, ApprovalChain> = new Map();
  private readonly approvalStorage: ApprovalStorage;
  private readonly chainStorage: ApprovalChainStorage;
  private readonly notifyService: NotifyService;
  private readonly emailService: EmailService;
  private escalationRules: Map<string, EscalationRule> = new Map();

  constructor(
    approvalStorage: ApprovalStorage = new ApprovalStorage(),
    chainStorage: ApprovalChainStorage = new ApprovalChainStorage(),
    notifyService: NotifyService = new NotifyService(),
    emailService: EmailService = new EmailService()
  ) {
    this.approvalStorage = approvalStorage;
    this.chainStorage = chainStorage;
    this.notifyService = notifyService;
    this.emailService = emailService;

    this.enableEscalationMonitoring();
  }

  /**
   * Create a new override request
   */
  async createOverrideRequest(
    data: {
      title: string;
      description?: string;
      entityType: string;
      entityId: string;
      reason: string;
      enabled: boolean;
      requiresApproval: boolean;
      approvers?: string[];
    }
  ): Promise<OverrideRequest> {
    const id = this.generateId();
    
    const override: OverrideRequest = {
      id,
      title: data.title,
      description: data.description,
      entityType: data.entityType,
      entityId: data.entityId,
      reason: data.reason,
      enabled: data.enabled,
      requiresApproval: data.requiresApproval,
      approvalStatus: data.requiresApproval ? 'pending' : 'approved',
      entityTypeDisplay: this.getEntityTypeDisplay(data.entityType),
      requestMetadata: {},
      approvalChain: [],
      createdById: 'system', // TODO: attach requester
      createdAt: new Date(),
      expiresAt: null,
      escalatedTo: null,
    };

    if (data.approvers && data.requiresApproval) {
      override.approvalChain = this.generateApprovalChain(override, data.approvers);
    }

    this.overrides.set(id, override);
    await this.saveOverride(override);

    // Create approval if required
    if (data.requiresApproval) {
      for (const approverId of (data.approvers || [])) {
        await this.createApproverStep(override, approverId);
      }
    }

    console.log(`[OverrideWorkflow] Created override: ${id} - ${title}`);
    return override;
  }

  /**
   * Get override by ID
   */
  async getOverride(id: string): Promise<OverrideRequest | null> {
    const override = this.overrides.get(id);
    return override || null;
  }

  /**
   * List overrides with filters
   */
  async listOverrides(filters?: {
    status?: ApprovalStatus;
    requesterId?: string;
    entityType?: string;
    requiresApproval?: boolean;
  }): Promise<OverrideRequest[]> {
    const all = Array.from(this.overrides.values()).filter((o) => {
      if (filters?.status && o.approvalStatus !== filters.status) return false;
      if (filters?.requesterId && o.createdById !== filters.requesterId) return false;
      if (filters?.entityType && o.entityType !== filters.entityType) return false;
      if (filters?.requiresApproval && o.requiresApproval !== filters.requiresApproval) return false;
      return true;
    });

    return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Approve override
   */
  async approve(
    overrideId: string,
    approverId: string,
    comment: string
  ): Promise<boolean> {
    const override = this.overrides.get(overrideId);
    if (!override) return false;

    console.log(`[OverrideWorkflow] Approving override ${overrideId} by ${approverId}`);

    // Get current step
    const currentStep = this.getCurrentApprovalStep(override);
    if (!currentStep || currentStep.approverId !== approverId) {
      console.error(`[OverrideWorkflow] Approver not authorized for step or step not pending: ${approverId}`);
      return false;
    }

    // Update step status
    const updatedStep: ApprovalStep = {
      ...currentStep,
      status: 'approved',
      decision: 'approve' as ApprovalDecision,
      approverId,
      evaluatedAt: new Date(),
      comments: comment || null,
    };

    // Remove current step from chain (it was pending)
    const nextIndex = this.approvalChain.indexOf(currentStep);
    if (nextIndex !== -1) {
      this.approvalChain.splice(nextIndex, 1);
      override.approvalChain.splice(nextIndex, 1);
    }
    
    // Add approved step to chain
    override.approvalChain.push(updatedStep);
    this.approvalChain.push(updatedStep);

    // Check if all approvers have approved
    const approvedSteps = override.approvalChain.filter(s => s.decision === 'approve');
    const approvalCount = approvedSteps.length;
    const totalRequired = this.approvalChain.filter(s => s.required).length;

    if (approvalCount === totalRequired && totalRequired > 0) {
      // Unblock on approval
      await this.unblockOnApproval(override);
    }

    // Persist
    this.overrides.set(overrideId, override);
    await this.saveOverride(override);

    // Notify
    this.notifyService.notifyApproval(override, approverId, comment);
    this.notifyService.notifyRequester(override, 'approved');

    return true;
  }

  /**
   * Reject override
   */
  async reject(
    overrideId: string,
    approverId: string,
    reason: string
  ): Promise<boolean> {
    const override = this.overrides.get(overrideId);
    if (!override) return false;

    console.log(`[OverrideWorkflow] Rejecting override ${overrideId} by ${approverId}`);

    // Get current step
    const currentStep = this.getCurrentApprovalStep(override);
    if (!currentStep) return false;

    // Update step status
    const rejectedStep: ApprovalStep = {
      ...currentStep,
      status: 'rejected',
      decision: 'reject' as ApprovalDecision,
      approverId,
      evaluatedAt: new Date(),
      comments: reason,
    };

    // Remove from pending chain
    const nextIndex = this.approvalChain.indexOf(currentStep);
    if (nextIndex !== -1) {
      this.approvalChain.splice(nextIndex, 1);
      override.approvalChain.splice(nextIndex, 1);
    },
    override.approvalChain.push(rejectedStep);
    this.approvalChain.push(rejectedStep);

    override.approvalStatus = 'rejected';

    // Persist
    this.overrides.set(overrideId, override);
    await this.saveOverride(override);

    // Notify
    this.notifyService.notifyApproval(override, approverId, reason);
    this.notifyService.notifyRequester(override, 'rejected');

    return true;
  }

  /**
   * Cancel override
   */
  async cancel(
    overrideId: string,
    requesterId: string,
    reason: string
  ): Promise<boolean> {
    const override = this.overrides.get(overrideId);
    if (!override) return false;

    if (override.createdById !== requesterId && requesterId !== 'admin') {
      console.error(`[OverrideWorkflow] User not authorized to cancel: ${requesterId}`);
      return false;
    }

    override.approvalStatus = 'cancelled';
    override.cancelledById = requesterId;
    override.cancelledAt = new Date();
    override.cancellationReason = reason;

    this.overrides.set(overrideId, override);
    await this.saveOverride(override);

    this.notifyService.notifyCancellation(override, requesterId, reason);

    return true;
  }

  /**
   * Unblock on approval
   */
  private async unblockOnApproval(override: OverrideRequest): Promise<void> {
    console.log(`[OverrideWorkflow] Auto-unblock requested: ${override.id}`);
    
    // Enable the override and mark the entity
    override.enabled = true;
    override.unblockedAt = new Date();
    override.approvalStatus = 'approved';

    this.overrides.set(override.id, override);
    await this.saveOverride(override);

    notifyService.notifyUnblockSuccess(override);
  }

  /**
   * Get approval chain
   */
  async getApprovalChain(id: string): Promise<ApprovalChain> {
    const override = this.overrides.get(id);
    if (!override) {
      return { steps: [] };
    }

    return {
      steps: override.approvalChain,
      chainId: id,
    };
  }

  /**
   * Check escalation status
   */
  async checkEscalation(overrideId: string): Promise<void> {
    const override = this.overrides.get(overrideId);
    if (!override || override.escalatedTo) return;

    const currentStep = this.getCurrentApprovalStep(override);
    if (!currentStep) return;

    // Check if this step has passed timeout
    const elapsedTime = new Date().getTime() - currentStep.createdAt.getTime();
    const timeoutMs = currentStep.timeout || 30 * 60 * 1000; // default 30 minutes

    if (elapsedTime > timeoutMs) {
      const nextApproverId = this.getNextApproverId(override, currentStep.approverId);
      
      if (nextApproverId) {
        console.log(`[OverrideWorkflow] Escalating override ${overrideId} to ${nextApproverId}`);
        
        override.escalatedTo = nextApproverId;
        override.escalationTriggeredAt = new Date();
        
        await this.emailService.sendEscalationEmail(override, currentStep.approverId, nextApproverId);
        this.notifyService.notifyEscalation(override, currentStep.approverId, nextApproverId);
        
        this.overrides.set(overrideId, override);
        await this.saveOverride(override);
      }
    }
  }

  /**
   * Enable escalation monitoring
   */
  private enableEscalationMonitoring(): void {
    const checkInterval = setInterval(async () => {
      const overrides = Array.from(this.overrides.values()).filter(
        o => o.approvalStatus === 'pending' && !o.expired
      );

      for (const override of overrides) {
        await this.checkEscalation(override.id);
      }
    }, 60 * 1000); // check every minute
  }

  /**
   * Get current approval step
   */
  private getCurrentApprovalStep(override: OverrideRequest): ApprovalStep | undefined {
    return this.approvalChain.find(step => 
      step.status === 'pending' && step.entityId === override.id
    );
  }

  /**
   * Get next approver ID
   */
  private getNextApproverId(override: OverrideRequest, currentApproverId: string): string | null {
    // For demo, return a hardcoded second approver
    // In production, resolve from escalation rules
    return 'admin_2'; // TODO: fetch from configuration
  }

  /**
   * Generate approval chain
   */
  private generateApprovalChain(
    override: OverrideRequest,
    approverIds: string[]
  ): ApprovalStep[] {
    return approverIds.map((approverId, index) => ({
      id: `approver_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
      notifyMethod: 'email',
      email: `${approverId}@example.com`,
      approverId,
      required: true,
      status: 'pending',
      decision: null,
      createdAt: new Date(),
      timeout: 30 * 60 * 1000, // 30 minute timeout
    }));
  }

  /**
   * Create approval step
   */
  private async createApproverStep(
    override: OverrideRequest,
    approverId: string
  ): Promise<void> {
    // In production, persist the step
    this.approvalChain.push({
      id: `approver_step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      notifyMethod: 'email',
      email: `${approverId}@example.com`,
      approverId,
      required: true,
      status: 'pending',
      decision: null,
      createdAt: new Date(),
      timeout: 30 * 60 * 1000,
    });
  }

  /**
   * Save override
   */
  private async saveOverride(override: OverrideRequest): Promise<void> {
    // In production, persist to database
    await this.approvalStorage.save(override);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get entity type display
   */
  private getEntityTypeDisplay(entityType: string): string {
    const displays: Record<string, string> = {
      rule: 'Alert Rule',
      schedule: 'Schedule',
      route: 'Route',
      service: 'Service',
      pipeline: 'Pipeline',
    };
    return displays[entityType] || entityType;
  }

  /**
   * Get escalation rules
   */
  getEscalationRules(): EscalationRule[] {
    return Array.from(this.escalationRules.values());
  }

  /**
   * Set escalation rule
   */
  setEscalationRule(rule: EscalationRule): void {
    this.escalationRules.set(rule.id, {
      ...rule,
      createdAt: new Date(),
    });
  }

  /**
   * Get aggregates
   */
  async getAggregates(): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    requiresApproval: number;
  }> {
    const all = Array.from(this.overrides.values());
    
    return {
      total: all.length,
      pending: all.filter(o => o.approvalStatus === 'pending').length,
      approved: all.filter(o => o.approvalStatus === 'approved').length,
      rejected: all.filter(o => o.approvalStatus === 'rejected').length,
      requiresApproval: all.filter(o => o.requiresApproval).length,
    };
  }
}

// Import notification services
import { NotifyService } from './notifications';
import { NotificationService } from './notifications';
import { NotificationService } from './notifications';
import { EmailService } from './email-service';
import { ApprovalStorage, ApprovalChainStorage } from './storage';

// Export singleton
export const overrideWorkflowService = new OverrideWorkflowService();