export interface BudgetConstraint {
  id: string;
  name: string;
  description: string;
  currency: string;
  totalAmount: number;
  softLimitPercentage: number;
  timePeriod: 'one-time' | 'monthly' | 'quarterly' | 'annual' | 'custom';
  scope: 'organization' | 'team' | 'project' | 'resource';
  startDate?: Date;
  endDate?: Date;
  owners: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetSnapshot {
  id: string;
  constraintId: string;
  spentAmount: number;
  remainingAmount: number;
  burnRate: number;
  timestamp: Date;
}

export interface BudgetAlert {
  id: string;
  constraintId: string;
  threshold: number;
  triggeredAt: Date;
  recipients: string[];
  channel: 'in-app' | 'email' | 'slack' | 'sms';
  status: 'pending' | 'sent' | 'failed';
}

export interface BudgetOverride {
  id: string;
  constraintId: string;
  requesterId: string;
  amountRequested: number;
  justification: string;
  urgency: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied' | 'escalated';
  approvalHistory: {
    userId: string;
    action: 'approve' | 'deny' | 'request_info';
    timestamp: Date;
  }[];
}

export interface BudgetReport {
  id: string;
  constraintId: string;
  startDate: Date;
  endDate: Date;
  totalSpent: number;
  budgetUsedPercentage: number;
  costCategories: Record<string, number>;
  exportFormat: 'csv' | 'pdf' | 'json';
  createdAt: Date;
}