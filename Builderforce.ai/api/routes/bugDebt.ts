/**
 * Bug Debt Overview API Routes
 * 
 * REST endpoints for bug debt metrics:
 * - GET /api/bug-debt/overview?period=week|month
 */

import { Router, Request, Response } from 'express';
import { bugDebtService } from '../api/bugDebt.service';

const router = Router();

/**
 * Get current overview of open bugs
 * Query params:
 * - period: 'week' | 'month' (default: week)
 */
router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as 'week' | 'month') || 'week';
    
    const overview = await bugDebtService.getOverview(period);
    
    res.json({
      success: true,
      data: overview,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error fetching bug debt overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bug debt overview',
      timestamp: new Date(),
    });
  }
});

/**
 * Standalone endpoint to fetch raw open bugs (for debugging or other uses)
 */
router.get('/bugs', async (req: Request, res: Response): Promise<void> => {
  try {
    const bugs = await bugDebtService.fetchOpenBugs();
    
    res.json({
      success: true,
      data: bugs,
      count: bugs.length,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error fetching open bugs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch open bugs',
      timestamp: new Date(),
    });
  }
});

export default router;