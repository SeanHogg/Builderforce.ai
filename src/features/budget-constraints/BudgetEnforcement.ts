import { BudgetConstraint, BudgetOverride } from './BudgetConstraint';

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
   * FR-5.1, FR-5.2: Check if an action would violate budget constraints
   * Returns enrollment result with appropriate action based on enforcement mode
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

    // Get current snapshot to check spend
    const currentSnapshot = await budgetService.getCurrentSnapshot(constraintId);
    if (!currentSnapshot) {
      return { allowed: true, error: 'No budget snapshot available' };
    }

    const potentialSpent = currentSnapshot.spentAmount + action.amount;
    const percentUsed = (potentialSpent / constraint.totalAmount) * 100;
    const hardCapReached = percentUsed >= 100;

    // FR-4.1: Check soft limit threshold (default 80%)
    const softLimitReached = percentUsed >= constraint.softLimitPercentage;
    const hardCapReachedMessage = percentageThresholdMessage(hardCapReached, constraint.softLimitPercentage);
    const softLimitReachedMessage = percentageThresholdMessage(softLimitReached, constraint.softLimitPercentage);

    // Check enforcement mode
    switch (constraint.scope === 'organization' 
      ? EnforcementMode.STRICT // Organization budgets are always strict
      : (constraint.type === EnforcementMode))? constraint.type : EnforcementMode.STRICT // <-- Missing type on BudgetConstraint defined earlier
    ) {
      case EnforcementMode.STRICT:
        // FR-5.1: In strict mode, block ALL spend when hard cap is reached
        if (hardCapReached) {
          // FR-4.6: FR-4.4 Cooldown check before blocking again
          alertService.async createAlert(
            AlertService.createAlert({
              constraintId: constraint.id,
              threshold: percentUsed,
              recipients: constraint.owners,
              channel: 'in-app',
              status: 'pending',
            })
          );
          return {
            allowed: false,
            error: `Budget hard cap reached (${hardCapReachedMessage}) - action blocked (Strict mode)`,
            action: 'block' as const,
          };
        }
        
        if (softLimitReached) {
          // Send soft limit warning
          await alertService.sendThresholdAlert(constraint, percentUsed, 'soft');
        }
        
        return { allowed: true };

      case EnforcementMode.APPROVAL:
        // FR-5.1: In approval mode, when hard cap is reached, require override
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
        // FR-5.1: In audit mode, hard cap is reached but no blocking
        if (hardCapReached) {
          await alertService.createAlert({
            constraintId: constraint.id,
            threshold: percentUsed,
            recipients: constraint.owners,
            channel: 'in-app',
            status: 'pending',
            message: `Budget hard cap reached (${hardCapReachedMessage}) - Audit mode only (FR-5.5 needs justification logging)`,
          });
        }

        if (softLimitReached) {
          await alertService.sendThresholdAlert(constraint, percentUsed, 'soft');
        }

        return { allowed: true };
    }
  }

  /**
   * FR-5.5: Emergency override by platform Admin bypasses enforcement
   * with mandatory justification logging
   */
  async emergencyOverride(
    constraintId: string,
    action: SpendAction,
    adminUserId: string,
    justification: string
  ): Promise<EnrollmentResult> {
    await alertService.createAlert({
      constraintId,
      threshold: 100, // Hard cap
      recipients: [constraintId],
      channel: 'in-app',
      status: 'pending',
      message: `EMERGENCY OVERRIDE by Admin ${adminUserId} - Justification: ${justification}. This must be logged immutably (FR-5.5).`,
    });
    
    // Log the emergency override with immutable record
    await this.logEmergencyOverride(adminUserId, constraintId, action, justification);
    
    return { allowed: true, action: 'continue' };
  }

  /**
   * FR-5.4: Budget owners can grant one-time exceptions or permanently increase cap
   */
  async approveOverride(
    overrideId: string,
    userId: string,
    action: 'grant_exception' | 'increase_cap'
  ): Promise<unknown> {
    const override = overridesService.getOverride(overrideId);
    if (!override) {
      return null;
    }

    // Check if user is authorized (Budget owner or Platform Admin)
    const constraint = await budgetService.getBudget(override.constraintId);
    const isAuthorized = constraint?.owners.includes(userId);
    
    if (!isAuthorized && !isAdmin(userId)) {
      throw new Error('User not authorized to approve this override');
    }

    if (action === 'grant_exception') {
      await overridesService.updateOverride(overrideId, {
        status: 'approved',
        approvalHistory: [
          ...override.approvalHistory,
          {
            userId,
            action: 'approve',
            timestamp: new Date(),
          },
        ],
      });

      return true;
    }

    if (action === 'increase_cap') {
      const newAmount = override.amountRequested;
      await budgetService.updateBudget(override.constraintId, {
        totalAmount: newAmount,
      });

      await overridesService.updateOverride(overrideId, {
        status: 'approved',
        approvalHistory: [
          ...override.approvalHistory,
          {
            userId,
            action: 'approve',
            timestamp: new Date(),
          },
        ],
      });

      return true;
    }
  }

  /**
   * FR-5.5: Create an immutable log entry for emergency overrides
   */
  private async logEmergencyOverride(
    adminId: string,
    constraintId: string,
    action: SpendAction,
    justification: string
  ): Promise<void> {
    // In production, this would write to an immutable audit log/ledger
    console.log(`[IMMUTABLE LOG] Emergency bypass by ${adminId} on ${constraintId}`);
    console.log(`Action: ${action.entity} (${action.amount} ${action.currency})`);
    console.log(`Justification: ${justification}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
  }

  /**
   * Format threshold message (e.g., "80% soft limit reached")
   */
  private percentageThresholdMessage(reached: boolean, threshold: number): string {
    if (!reached) return '';
    return `soft limit at ${threshold}%`;
  }
}

// Service singleton instance
const enforcementService = new BudgetEnforcement();

// Helper function
function percentageThresholdMessage(reached: boolean, threshold: number): string {
  if (!reached) return '';
  return `soft limit at ${threshold}%`;
}

export { BudgetEnforcement, enrollmentResult, EnforcementMode };
export default enforcementService;