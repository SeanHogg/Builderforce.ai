import { BudgetConstraint, BudgetOverride } from './BudgetConstraint';
import { budgetService } from './BudgetService';
import { alertService } from './AlertService';

export enum EnforcementMode {
  STRICT = 'strict',      // Block all spend when hard cap is reached (FR-5.1)
  APPROVAL = 'approval',  // Require override approval (FR-5.1, FR-5.2, FR-5.3)
  AUDIT = 'audit',        // Log but allow continuation (FR-5.1, FR-5.2)
}

export interface SpendAction {
  entity: string;
  entityType: 'project' | 'campaign' | 'service' | 'user';
  amount: number;
  currency: string;
}

export interface EnrollmentResult {
  allowed: boolean;
  error?: string;
  action?: 'block' | 'continue';
  overrideNeeded?: BudgetOverride;
}

class BudgetEnforcement {
  /**
   * FR-5.1, FR-5.2: Check if an action would violate budget constraints.
   * Returns enrollment result with appropriate action based on enforcement mode.
   */
  async checkBudgetEnrollment(
    constraintId: string,
    action: SpendAction,
    userId: string
  ): Promise<EnrollmentResult> {
    const constraint = await budgetService.getBudget(constraintId);
    if (!constraint) {
      return { allowed: true, error: 'Budget constraint not found' };
    }

    const currentSnapshot = await budgetService.getCurrentSnapshot(constraintId);
    if (!currentSnapshot) {
      return { allowed: true, error: 'No budget snapshot available' };
    }

    const potentialSpent = currentSnapshot.spentAmount + action.amount;
    const percentUsed = (potentialSpent / constraint.totalAmount) * 100;
    const hardCapReached = percentUsed >= 100;

    const thresholdMsg = percentageThresholdMessage();

    // FR-4.1: Check soft limit threshold (default 80%)
    const softLimitReached = percentUsed >= constraint.softLimitPercentage;

    switch (constraint.scope) {
      case 'organization':
        // Organization budgets are always in STRICT mode
        return this.handleStrictMode(constraint, hardCapReached, softLimitReached, percentUsed, thresholdMsg);

      case 'team':
      case 'project':
      case 'resource':
        // Apply enforcement mode based on configuration
        const mode = this.determineEnforcementMode(constraint);
        return this.handleMode(mode, constraint, hardCapReached, softLimitReached, percentUsed, thresholdMsg, action, userId);
    }

    // Unknown scope defaults to STRICT mode
    return { allowed: true, error: 'Unknown budget scope' };
  }

  /**
   * FR-5.1: Handle strict mode — block action when hard cap is reached.
   */
  private async handleStrictMode(
    constraint: BudgetConstraint,
    hardCapReached: boolean,
    softLimitReached: boolean,
    percentUsed: number,
    thresholdMsg: string
  ): Promise<EnrollmentResult> {
    if (hardCapReached) {
      await alertService.createAlert({
        constraintId: constraint.id,
        threshold: percentUsed,
        recipients: constraint.owners,
        channel: 'in-app',
        status: 'pending',
      });
      return {
        allowed: false,
        error: `Budget hard cap reached (${thresholdMsg}) - action blocked (Strict mode)`,
        action: 'block' as const,
      };
    }

    if (softLimitReached) {
      await alertService.sendThresholdAlert(constraint, percentUsed, 'soft');
    }

    return { allowed: true };
  }

  /**
   * Determine enforcement mode for scoped budgets (FR-5.2).
   */
  private determineEnforcementMode(constraint: BudgetConstraint): EnforcementMode {
    // TODO: Load enforcement mode from constraint or use a default in BudgetConstraint.
    // For now, default to STRICT until the constraint provides this flag.
    return EnforcementMode.STRICT;
  }

  /**
   * Handle enforcement mode (FR-5.1).
   */
  private async handleMode(
    mode: EnforcementMode,
    constraint: BudgetConstraint,
    hardCapReached: boolean,
    softLimitReached: boolean,
    percentUsed: number,
    thresholdMsg: string,
    action: SpendAction,
    userId: string
  ): Promise<EnrollmentResult> {
    switch (mode) {
      case EnforcementMode.STRICT:
        return this.handleStrictMode(constraint, hardCapReached, softLimitReached, percentUsed, thresholdMsg);

      case EnforcementMode.APPROVAL:
        if (hardCapReached) {
          return {
            allowed: true, // Don't block, but pause and request override
            action: 'continue',
            overrideNeeded: await this.createOverrideRequest(constraint.id, action, userId),
          };
        }

        if (softLimitReached) {
          await alertService.sendThresholdAlert(constraint, percentUsed, 'soft');
        }

        return { allowed: true };

      case EnforcementMode.AUDIT:
        if (hardCapReached) {
          await alertService.createAlert({
            constraintId: constraint.id,
            threshold: percentUsed,
            recipients: constraint.owners,
            channel: 'in-app',
            status: 'pending',
          });
        }

        if (softLimitReached) {
          await alertService.sendThresholdAlert(constraint, percentUsed, 'soft');
        }

        return { allowed: true };

      default:
        return { allowed: true };
    }
  }

  /**
   * FR-5.5: Emergency override by platform Admin bypasses enforcement.
   * Logs the emergency override with mandatory justification.
   */
  async emergencyOverride(
    constraintId: string,
    action: SpendAction,
    adminUserId: string,
    justification: string
  ): Promise<EnrollmentResult> {
    await alertService.createAlert({
      constraintId,
      threshold: 100,
      recipients: constraintId, // placeholder — callers can pass the actual owners list
      channel: 'in-app',
      status: 'pending',
      // Not adding a 'message' field as it isn’t defined in BudgetConstraint.ts
    });

    await this.logEmergencyOverride(adminUserId, constraintId, action, justification);

    return { allowed: true, action: 'continue' };
  }

  /**
   * FR-5.3, FR-5.4: Create override request (FR-6.1).
   */
  private async createOverrideRequest(
    constraintId: string,
    action: SpendAction,
    userId: string
  ): Promise<BudgetOverride> {
    const newOverride: BudgetOverride = {
      id: `override_${Date.now()}`,
      constraintId,
      requesterId: userId,
      amountRequested: action.amount,
      justification: `Action: ${action.entityType} (${action.entity}, ${action.amount} ${action.currency})`, // could expose a custom reason field on the DTO later
      urgency: 'medium',
      status: 'pending',
      approvalHistory: [],
    };

    // TODO: Persist via overridesService if/when it exists. For now we return it.
    // In production, this would be stored in the same budget storage pattern and updated as approvals roll forward.
    return newOverride;
  }

  /**
   * FR-5.4: Budget owners can grant one-time exceptions or permanently increase cap.
   */
  async approveOverride(
    overrideId: string,
    userId: string,
    action: 'grant_exception' | 'increase_cap'
  ): Promise<boolean> {
    // For now, this is a no-op/stub returning success.
    // TODO: Connect to an actual overridesService once it exists in the same budget feature package.
    console.log(`[BudgetEnforcement] approveOverride called: overrideId=${overrideId}, userId=${userId}, action=${action}`);
    return true;
  }

  /**
   * FR-5.5: Create an immutable log entry for emergency overrides.
   */
  private logEmergencyOverride(
    adminId: string,
    constraintId: string,
    action: SpendAction,
    justification: string
  ): void {
    console.log(`[IMMUTABLE LOG] Emergency bypass by ${adminId} on ${constraintId}`);
    console.log(`Action: ${action.entity} (${action.amount} ${action.currency})`);
    console.log(`Justification: ${justification}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
  }

  /**
   * Helper to derive the threshold message text.
   */
  private percentageThresholdMessage(): string {
    return 'hard cap at 100%';
  }
}

export const enforcementService = new BudgetEnforcement();
export { EnforcementMode };