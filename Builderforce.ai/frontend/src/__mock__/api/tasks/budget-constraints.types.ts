/**
 * Budget Constraint Types
 * Implements budget constraints for project resource management
 */

export interface BudgetConstraint {
  id: string;
  projectId: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'CAD';
  amount: number;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  category: 'budget' | 'capex' | 'opex' | 'invoice' | 'research';
  status: 'draft' | 'active' | 'expired' | 'rejected';
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateBudgetConstraintRequest {
  projectId: string;
  currency: string;
  amount: number;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  category: string;
  status?: 'draft' | 'active';
  metadata?: Record<string, string | number | boolean>;
}

export interface UpdateBudgetConstraintRequest {
  currency?: string;
  amount?: number;
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
  status?: 'draft' | 'active' | 'expired' | 'rejected';
  metadata?: Record<string, string | number | boolean>;
}

export interface BudgetEnrollment {
  id: string;
  userId: string;
  projectId: string;
  enrolledAt: string;
  status: 'active' | 'inactive' | 'pending';
  role: 'viewer' | 'contributor' | 'maintainer' | 'owner';
}

export interface EnrollmentCheckResult {
  canEnroll: boolean;
  isEnrolled: boolean;
  enrollmentId?: string;
  role: 'viewer' | 'contributor' | 'maintainer' | 'owner';
}

export interface BudgetConstraintAlert {
  id: string;
  constraintId: string;
  type: 'warning' | 'error' | 'info';
  message: string;
  threshold: number;
  currentValue: number;
  createdAt: string;
  isRead: boolean;
}

export interface BudgetConstraintReport {
  projectId: string;
  period: {
    start: string;
    end: string;
  };
  summary: {
    totalBudget: number;
    spent: number;
    remaining: number;
    percentageSpent: number;
    budgetUtilizationRate: number;
  };
  constraints: BudgetConstraint[];
  alerts: BudgetConstraintAlert[];
  topBudgetViolations: BudgetConstraintAlert[];
}