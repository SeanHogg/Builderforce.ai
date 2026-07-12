import {
  BudgetConstraint,
  BudgetSnapshot,
  BudgetAlert,
  BudgetOverride,
  BudgetReport,
} from './BudgetConstraint';

// Mock storage for demonstration - in production, this would connect to a database
class BudgetService {
  private constraints: Map<string, BudgetConstraint> = new Map();
  private snapshots: Map<string, BudgetSnapshot[]> = new Map();
  private alerts: Map<string, BudgetAlert[]> = new Map();
  private overrides: Map<string, BudgetOverride[]> = new Map();

  /**
   * FR-1.1: Create a new budget constraint
   */
  async createBudget(constraint: Omit<BudgetConstraint, 'id' | 'createdAt' | 'updatedAt'>): Promise<BudgetConstraint> {
    const newConstraint: BudgetConstraint = {
      ...constraint,
      id: `budget_${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.constraints.set(newConstraint.id, newConstraint);
    this.snapshots.set(newConstraint.id, []);
    this.alerts.set(newConstraint.id, []);

    return newConstraint;
  }

  /**
   * Get budget by ID
   */
  async getBudget(constraintId: string): Promise<BudgetConstraint | null> {
    return this.constraints.get(constraintId) || null;
  }

  /**
   * Get all budgets for a scope
   */
  async getBudgetsByScope(scope: BudgetConstraint['scope'], userId?: string): Promise<BudgetConstraint[]> {
    const filtered = Array.from(this.constraints.values()).filter(
      (b) => b.scope === scope // Would add user permission filtering here
    );
    
    // Apply user filtering for ProjectManager role
    if (userId && scope === 'project') {
      // In production, you would check which projects the user is assigned to
      // For now, we'll filter by project ownership
      return filtered.filter(b => b.owners.includes(userId));
    }
    
    return filtered;
  }

  /**
   * Update budget metadata (FR-1.1, FR-2.3)
   */
  async updateBudget(
    constraintId: string,
    updates: Partial<Omit<BudgetConstraint, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<BudgetConstraint | null> {
    const constraint = this.constraints.get(constraintId);
    if (!constraint) {
      return null;
    }

    const updated = {
      ...constraint,
      ...updates,
      updatedAt: new Date(),
    };

    this.constraints.set(constraintId, updated);
    return updated;
  }

  /**
   * FR-1.4: Clone a budget from an existing one
   */
  async cloneBudget(sourceId: string, newName: string): Promise<BudgetConstraint | null> {
    const source = this.constraints.get(sourceId);
    if (!source) {
      return null;
    }

    return this.createBudget({
      name: newName,
      description: `${source.description} (cloned from ${source.name})`,
      currency: source.currency,
      totalAmount: source.totalAmount,
      softLimitPercentage: source.softLimitPercentage,
      timePeriod: source.timePeriod,
      scope: source.scope,
      owners: [...source.owners],
      startDate: source.startDate,
      endDate: source.endDate,
    });
  }

  /**
   * FR-3.1: Get current snapshot for a budget
   */
  async getCurrentSnapshot(constraintId: string): Promise<BudgetSnapshot | null> {
    const snapshots = this.snapshots.get(constraintId) || [];
    if (snapshots.length === 0) {
      return {
        id: `snapshot_${Date.now()}`,
        constraintId,
        spentAmount: 0,
        remainingAmount: 0,
        burnRate: 0,
        timestamp: new Date(),
      };
    }

    // Use the most recent snapshot
    return snapshots[snapshots.length - 1];
  }

  /**
   * FR-3.2: Refresh spend data (can be triggered periodically)
   */
  async refreshSpendData(constraintId: string): Promise<void> {
    const constraint = this.constraints.get(constraintId);
    if (!constraint) {
      return;
    }

    const currentSnapshot = await this.getCurrentSnapshot(constraintId);
    const spentAmount = currentSnapshot?.spentAmount || 0;
    const remainingAmount = constraint.totalAmount - spentAmount;

    const snapshot: BudgetSnapshot = {
      id: `snapshot_${Date.now()}`,
      constraintId,
      spentAmount,
      remainingAmount,
      burnRate: 0, // Would be calculated based on historical data
      timestamp: new Date(),
    };

    const snapshots = this.snapshots.get(constraintId) || [];
    snapshots.push(snapshot);
    this.snapshots.set(constraintId, snapshots);
  }

  /**
   * FR-4.5: Log an alert
   */
  async createAlert(alert: Omit<BudgetAlert, 'id' | 'triggeredAt'>): Promise<BudgetAlert> {
    const newAlert: BudgetAlert = {
      ...alert,
      id: `alert_${Date.now()}`,
      triggeredAt: new Date(),
    };

    const alerts = this.alerts.get(alert.constraintId) || [];
    alerts.push(newAlert);
    this.alerts.set(alert.constraintId, alerts);

    return newAlert;
  }

  /**
   * FR-4.4: Check and prevent duplicate alerts within cooldown period (24h)
   */
  async canTriggerAlert(constraintId: string, threshold: number): Promise<boolean> {
    const alerts = this.alerts.get(constraintId) || [];
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Check if there's a recent alert for the same threshold
    const recentAlert = alerts.find(
      (a) =>
        a.threshold === threshold &&
        a.status !== 'failed' &&
        a.triggeredAt > twentyFourHoursAgo
    );

    return !recentAlert;
  }

  /**
   * FR-7.1: Generate a budget utilization report
   */
  async generateReport(
    constraintId: string,
    startDate: Date,
    endDate: Date,
    format: 'csv' | 'pdf' | 'json' = 'json'
  ): Promise<BudgetReport> {
    const constraint = this.constraints.get(constraintId);
    if (!constraint) {
      throw new Error(`Constraint ${constraintId} not found`);
    }

    const snapshots = this.snapshots.get(constraintId) || [];
    const filteredSnapshots = snapshots.filter(
      (s) => s.timestamp >= startDate && s.timestamp <= endDate
    );

    const totalSpent = filteredSnapshots.reduce((sum, s) => sum + s.spentAmount, 0);
    const budgetUsedPercentage = (totalSpent / constraint.totalAmount) * 100;
    const costCategories: Record<string, number> = {}; // Would be populated from actual cost data

    const report: BudgetReport = {
      id: `report_${Date.now()}`,
      constraintId,
      startDate,
      endDate,
      totalSpent,
      budgetUsedPercentage,
      costCategories,
      exportFormat: format,
      createdAt: new Date(),
    };

    return report;
  }
}

// Export singleton instance
export const budgetService = new BudgetService();