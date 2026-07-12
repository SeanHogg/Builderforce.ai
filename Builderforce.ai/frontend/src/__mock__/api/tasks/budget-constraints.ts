import { Request, Response } from 'express';
import { BudgetConstraint, CreateBudgetConstraintRequest, UpdateBudgetConstraintRequest, EnrollmentCheckResult, BudgetConstraintAlert, BudgetConstraintReport } from '../__mock__/api/tasks/budget-constraints.types';

// Mock database
const budgetConstraints: BudgetConstraint[] = [];
const enrollments: Record<string, EnrollmentCheckResult> = {};

// Helper to check enrollment
const checkEnrollment = (userId: string, projectId: string): EnrollmentCheckResult => {
  const key = `${userId}-${projectId}`;
  return enrollments[key] || {
    canEnroll: true,
    isEnrolled: false,
    role: 'viewer',
  };
};

// Helper to validate permissions
const validatePermissions = (userId: string, projectId: string, requiredRole: 'viewer' | 'project-manager') => {
  const { isEnrolled, role } = checkEnrollment(userId, projectId);
  if (!isEnrolled) return false;
  if (requiredRole === 'viewer' && role !== 'viewer') return false;
  if (requiredRole === 'project-manager' && role !== 'project-manager') return false;
  return true;
};

// Enrollment endpoint
export const enrollUser = (req: Request, res: Response) => {
  const { userId, projectId, role } = req.body;
  const key = `${userId}-${projectId}`;
  enrollments[key] = {
    canEnroll: true,
    isEnrolled: true,
    role,
  };
  res.status(201).json({ message: 'Enrollment successful' });
};

// List budget constraints
export const listBudgetConstraints = (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const constraints = budgetConstraints.filter(c => c.projectId === projectId);
  res.json(constraints);
};

// Create budget constraint
export const createBudgetConstraint = (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const constraint: BudgetConstraint = {
    ...req.body,
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: userId as string,
  };
  budgetConstraints.push(constraint);
  res.status(201).json(constraint);
};

// Get budget constraint
export const getBudgetConstraint = (req: Request, res: Response) => {
  const { userId, projectId, constraintId } = req.query;
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const constraint = budgetConstraints.find(c => c.id === constraintId);
  if (!constraint) return res.status(404).json({ error: 'Constraint not found' });
  res.json(constraint);
};

// Update budget constraint
export const updateBudgetConstraint = (req: Request, res: Response) => {
  const { userId, projectId, constraintId } = req.query;
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const index = budgetConstraints.findIndex(c => c.id === constraintId);
  if (index === -1) return res.status(404).json({ error: 'Constraint not found' });
  const updated = { ...budgetConstraints[index], ...req.body, updatedAt: new Date().toISOString() };
  budgetConstraints[index] = updated;
  res.json(updated);
};

// Refresh budget constraints
export const refreshBudgetConstraints = (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  // Simulate refresh logic
  res.json({ message: 'Constraints refreshed' });
};

// Enrollment check
export const checkEnrollmentStatus = (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  const result = checkEnrollment(userId as string, projectId as string);
  res.json(result);
};

// Add route definitions to express app
// (This would be done in the main API file)
// app.use('/budget-constraints', budgetConstraintsRouter);