import { Router } from 'express';
import type { Request, Response } from 'express';
import { BudgetConstraint, EnrollmentCheckResult, BudgetConstraintAlert, BudgetConstraintReport } from '../__mock__/api/tasks/budget-constraints.types';

const router = Router();

// Mock database
const budgetConstraints: BudgetConstraint[] = [];
const overrideRequests: Record<string, any> = {};
const alerts: BudgetConstraintAlert[] = [];
const reports: BudgetConstraintReport[] = [];

// Helper to check enrollment
const checkEnrollment = (userId: string, projectId: string): EnrollmentCheckResult => {
  // Default: viewer role with no enrollment
  return {
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

// ── Overview Endpoints ────────────────────────────────────────────────────────

// LIST - Get all budget constraints for a project
router.get('/', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  const hasPermission = validatePermissions(userId as string, projectId as string, 'project-manager');
  // AC-16: Return 403 for Viewer (READ_PERMISSION)
  if (!hasPermission) {
    return res.status(403).json({ error: 'Access denied: Forbid READ_PERMISSION users' });
  }

  const constraints = budgetConstraints.filter(c => c.projectId === projectId);
  res.json(constraints);
});

// CREATE - Create a new budget constraint
router.post('/', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const constraint: BudgetConstraint = {
    ...req.body,
    id: `constraint-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: userId as string,
  };
  budgetConstraints.push(constraint);
  res.status(201).json(constraint);
});

// ── Single-Item Endpoints ─────────────────────────────────────────────────────

router.get('/:constraintId', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  const { constraintId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  const hasPermission = validatePermissions(userId as string, projectId as string, 'project-manager');
  // AC-16: Return 403 for Viewer (READ_PERMISSION)
  if (!hasPermission) {
    return res.status(403).json({ error: 'Access denied: Forbid READ_PERMISSION users' });
  }

  const constraint = budgetConstraints.find(c => c.id === constraintId);
  if (!constraint) return res.status(404).json({ error: 'Constraint not found' });
  res.json(constraint);
});

router.put('/:constraintId', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  const { constraintId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const index = budgetConstraints.findIndex(c => c.id === constraintId);
  if (index === -1) return res.status(404).json({ error: 'Constraint not found' });
  const updated = { ...budgetConstraints[index], ...req.body, updatedAt: new Date().toISOString() };
  budgetConstraints[index] = updated;
  res.json(updated);
});

router.patch('/:constraintId', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  const { constraintId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const index = budgetConstraints.findIndex(c => c.id === constraintId);
  if (index === -1) return res.status(404).json({ error: 'Constraint not found' });
  const updated = { ...budgetConstraints[index], ...req.body, updatedAt: new Date().toISOString() };
  budgetConstraints[index] = updated;
  res.json(updated);
});

// ── Enrollment & Strict-Mode ───────────────────────────────────────────────────

// Enrollment check (returns enrollment result)
router.get('/enrollment', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!userId || !projectId) return res.status(400).json({ error: 'userId and projectId are required' });

  const result = checkEnrollment(userId as string, projectId as string);
  res.json(result);
});

// Enrollment check with strict- enforcement (AC-9: return HTTP 402 for actions requiring enrollment)
router.get('/enrollment/strict', (req: Request, res: Response) => {
  const strictMode = req.query.strictMode === 'true';
  if (!strictMode) return res.status(400).json({ error: 'strictMode=true is required' });
  const { userId, projectId } = req.query;
  if (!userId || !projectId) return res.status(400).json({ error: 'userId and projectId are required' });

  const result = checkEnrollment(userId as string, projectId as string);
  // AC-9: Return HTTP 402 if strict- enforcement is on and enrollment check fails
  if (!result.isEnrolled) {
    return res.status(402).json({
      error: 'Enrollment required to perform this operation',
      enrollmentRequired: true,
    });
  }
  res.json(result);
});

// ── Override Endpoints ───────────────────────────────────────────────────────

// Override Request: create a budget constraint override
router.post('/:constraintId/overrides', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  const { constraintId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const overrideId = `override-${Date.now()}`;
  overrideRequests[overrideId] = {
    constraintId,
    userId,
    ...req.body,
    id: overrideId,
    createdAt: new Date().toISOString(),
  };
  res.status(201).json(overrideRequests[overrideId]);
});

// GET /overrides/:overrideId — retrieve a specific override request
router.get('/overrides/:overrideId', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  const { overrideId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const override = overrideRequests[overrideId];
  if (!override) return res.status(404).json({ error: 'Override not found' });
  res.json(override);
});

// GET /overrides/recent — retrieve recent override requests with optional filters
router.get('/overrides/recent', (req: Request, res: Response) => {
  const { userId, projectId, type = 'all', limit = 50, startDate, endDate } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }

  let filtered = Object.values(overrideRequests).filter(o => o.projectId === projectId);
  if (type !== 'all') {
    filtered = filtered.filter(o => o.type === type);
  }
  if (startDate) {
    const start = new Date(startDate as string);
    filtered = filtered.filter(o => new Date(o.createdAt) >= start);
  }
  if (endDate) {
    const end = new Date(endDate as string);
    filtered = filtered.filter(o => new Date(o.createdAt) <= end);
  }

  // Paginate
  const take = parseInt(limit as string, 10);
  filtered = filtered.slice(0, take);

  res.json(filtered);
});

// ── Alerts Endpoints ──────────────────────────────────────────────────────────

// GET /alerts — list budget constraint alerts for a project
router.get('/alerts', (req: Request, res: Response) => {
  const { userId, projectId, type } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }

  let filtered = alerts.filter(a => a.projectId === projectId);
  if (type) {
    filtered = filtered.filter(a => a.type === type);
  }
  filtered = filtered.filter(a => !a.isRead);

  res.json(filtered);
});

// Create a budget constraint alert (admin)
router.post('/alerts', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const alert: BudgetConstraintAlert = {
    id: `alert-${Date.now()}`,
    constraintId: req.body.constraintId || '',
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  alerts.push(alert);
  res.status(201).json(alert);
});

// Mark an alert as read
router.patch('/alerts/:alertId/read', (req: Request, res: Response) => {
  const { userId, projectId, alertId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const alert = alerts.find(a => a.id === alertId);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  alert.isRead = true;
  res.json(alert);
});

// ── Reports Endpoints ──────────────────────────────────────────────────────────

// GET /reports/summary — summary report for a project
router.get('/reports/summary', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const constraints = budgetConstraints.filter(c => c.projectId === projectId);
  const spent = constraints.reduce((sum, c) => sum + (c.amount || 0), 0);
  const totalBudget = spent; // No difference yet; implement spend tracking per FR-7.4
  const remaining = totalBudget - spent;
  const percentageSpent = totalBudget > 0 ? (spent / totalBudget) * 100 : 0;
  const budgetUtilizationRate = percentageSpent;

  const report: BudgetConstraintReport = {
    projectId,
    period: { start: new Date().toISOString().split('T')[0], end: new Date().toISOString().split('T')[0] },
    summary: {
      totalBudget,
      spent,
      remaining,
      percentageSpent,
      budgetUtilizationRate,
    },
    constraints,
    alerts: alerts.filter(a => a.projectId === projectId),
    topBudgetViolations: alerts.filter(a => a.type === 'error' && a.projectId === projectId),
  };

  res.json(report);
});

// POST /reports/summary — generate a new report
router.post('/reports/summary', (req: Request, res: Response) => {
  const { userId, projectId, period } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const report: BudgetConstraintReport = {
    projectId,
    period: {
      start: typeof period === 'string' ? period : new Date().toISOString().split('T')[0],
      end: typeof period === 'string' ? period : new Date().toISOString().split('T')[0],
    },
    summary: {
      totalBudget: 0,
      spent: 0,
      remaining: 0,
      percentageSpent: 0,
      budgetUtilizationRate: 0,
    },
    constraints: budgetConstraints.filter(c => c.projectId === projectId),
    alerts: alerts.filter(a => a.projectId === projectId),
    topBudgetViolations: alerts.filter(a => a.type === 'error' && a.projectId === projectId),
  };

  reports.push(report);
  res.status(201).json(report);
});

// ── Refresh Endpoints ──────────────────────────────────────────────────────────

// PUT /refresh — refresh all budget constraints for a project
router.put('/refresh', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  // Simulate refresh logic
  res.json({ message: 'Constraints refreshed' });
});

// PATCH /refresh — refresh all or selected constraints
router.patch('/refresh', (req: Request, res: Response) => {
  const { userId, projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!validatePermissions(userId as string, projectId as string, 'project-manager')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const constraintIds = (req.body.constraintIds as string[]) || [];
  if (constraintIds.length > 0) {
    // Refresh only selected constraints
    return res.json({ message: `Refreshed ${constraintIds.length} constraints` });
  }
  // Refresh all
  res.json({ message: 'All constraints refreshed' });
});

export default router;