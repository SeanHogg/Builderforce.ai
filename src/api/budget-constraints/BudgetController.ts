/**
 * Budget Controller
 *
 * REST API for budget constraint management, visibility, alerts, and reporting.
 * Supports the features described in the Budget Constraints PRD.
 */

import type { Request, Response, NextFunction } from 'express';
import { budgetService, BudgetConstraint } from '../../features/budget-constraints/BudgetService.js';
import { alertService } from '../../features/budget-constraints/AlertService.js';
import {
  enforcementService,
  EnrollmentResult,
  SpendAction,
  EnforcementMode,
} from '../../features/budget-constraints/BudgetEnforcement.js';

// Health/Healthz endpoints
router.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'budget-controller' });
});

// List budgets with optional filtering and user assignment
// GET /api/budgets?scope=project&userId=user123
router.get('/budgets', async (req: Request, res: Response) => {
  try {
    const scope = req.query.scope as BudgetConstraint['scope'];
    const userId = req.query.userId as string | undefined;
    const budgets = await budgetService.getBudgetsByScope(scope, userId);
    res.json(budgets);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list budgets' });
  }
});

// Get a single budget by ID
// GET /api/budgets/:id
router.get('/budgets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const budget = await budgetService.getBudget(id);
    if (!budget) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }
    res.json(budget);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

// Create a new budget constraint
// POST /api/budgets
router.post('/budgets', async (req: Request, res: Response) => {
  try {
    const budgetData = req.body;
    const newBudget = await budgetService.createBudget(budgetData);
    res.status(201).json(newBudget);
  } catch (err) {
    res.status(400).json({ error: 'Failed to create budget' });
  }
});

// Update budget metadata
// PATCH /api/budgets/:id
router.patch('/budgets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = await budgetService.updateBudget(id, updates);
    if (!updated) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update budget' });
  }
});

// Refresh spend data for a budget
// POST /api/budgets/:id/refresh
router.post('/budgets/:id/refresh', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await budgetService.refreshSpendData(id);
    res.json({ status: 'success', message: 'Spend data refreshed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh spend data' });
  }
});

// Check budget enrollment for a spend action
// POST /api/budgets/:id/check
// Body: { entityType: "project"|"campaign"|"service"|"user", entity: string, amount: number, currency: string }
router.post('/budgets/:id/check', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { entityType, entity, amount, currency } = req.body as SpendAction;
    const userId = req.query.userId as string;

    const result: EnrollmentResult = await enforcementService.checkBudgetEnrollment(id, { entityType, entity, amount, currency }, userId);

    if (!result.allowed && result.action === 'block') {
      // FR-5.1: Return HTTP 402 when hard cap is reached in strict mode
      res.status(402).json({ error: result.error, action: result.action });
    } else {
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to check budget enrollment' });
  }
});

// Get alerts for a budget
// GET /api/budgets/:id/alerts
router.get('/budgets/:id/alerts', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const history = await alertService.getAlertHistory(id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// Generate a budget utilization report
// GET /api/reports?constraintId=xxx&startDate=2025-01-01&endDate=2025-12-31&format=json
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const { constraintId, startDate, endDate, format } = req.query;
    if (!constraintId || !startDate || !endDate) {
      res.status(400).json({ error: 'constraintId, startDate, and endDate are required' });
      return;
    }

    const budget = await budgetService.getBudget(constraintId as string);
    if (!budget) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    const budgetReport = await budgetService.generateReport(
      constraintId as string,
      start,
      end,
      (format as BudgetConstraint['timePeriod']) as BudgetConstraint['timePeriod']
    );
    res.json(budgetReport);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Submit an override request
// POST /api/budgets/:id/overrides
// Body: { amountRequested, urgency, justification }
router.post('/budgets/:id/overrides', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amountRequested, urgency, justification } = req.body;
    // For now, enforce: amountRequest must be positive and urgency must be among enum values.
    // The override DTO in BudgetConstraint would be used to construct the record.
    if (typeof amountRequested !== 'number' || amountRequested <= 0) {
      res.status(400).json({ error: 'Invalid amountRequested' });
      return;
    }
    const override: BudgetConstraint['BudgetOverride'] = {
      id: `override_${Date.now()}`,
      constraintId: id,
      requesterId: 'unauthenticated_user_placeholder',
      amountRequested,
      urgency: (urgency || 'medium') as BudgetConstraint['BudgetOverride']['urgency'],
      status: 'pending',
      justification,
      approvalHistory: [],
    };
    // Since we don’t have overridesService yet, we would persist it. For now, return it as shown.
    res.status(201).json(override);
  } catch (err) {
    res.status(500).json({ error: 'Failed to request override' });
  }
});

// Approve or deny an override
// PATCH /api/budgets/:id/overrides/:reqId
router.patch('/budgets/:id/overrides/:reqId', async (req: Request, res: Response) => {
  try {
    const { id, reqId } = req.params;
    const { action, rationale } = req.body;
    const isValidAction = action === 'approve' || action === 'deny';
    const userId = (req.query.userId as string) || 'system';
    // Connector to overridesService if/when it exists.
    // For now, return 200 to echo the request if it’s valid.
    if (!isValidAction) {
      res.status(400).json({ error: 'Invalid action. Useapprove/deny' });
      return;
    }
    res.json({ status: 'success', overrideId: reqId, action, performedBy: userId, note: rationale || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process override' });
  }
});

// Fetch enforcement modes available
// GET /api/enforcement-modes
router.get('/enforcement-modes', (_req, res) => {
  const modes = [
    { value: EnforcementMode.STRICT, description: 'Block all spend when hard cap is reached' },
    { value: EnforcementMode.APPROVAL, description: 'Require override approval' },
    { value: EnforcementMode.AUDIT, description: 'Log but allow continuation' },
  ] as const;
  res.json(modes);
});

export default BudgetController;