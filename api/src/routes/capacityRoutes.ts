/**
 * Capacity Estimation API Routes
 * 
 * Provides API endpoints for empirical velocity calibration, utilization mapping,
 * projection updates, and validation gap micro-estimation.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireRole } from '@/infra/middleware/auth';
import {
  createVelocityEntry,
  getVelocityEntries,
  calculateAgentVelocity,
  invalidateProjectVelocity,
} from '@/application/capacity/EmpiricalVelocityService';
import {
  mapUtilizationFromRoster,
  validateAssigneeApiAccess,
  fetchLiveAssigneeRoster,
} from '@/application/capacity/UtilizationMappingService';
import {
  calculateProjection,
  CalculateProjectionInput,
  invalidateProjection,
  ProjectionResult,
} from '@/application/capacity/ProjectionService';
import {
  batchMicroEstimateGaps,
  microEstimateGap,
  ValidationGapInput,
  compareWithLegacyEstimation,
} from '@/application/capacity/ValidationGapEstimationService';
import { internalLogger } from '@/infra/logger';

const router = Router();

/**
 * POST /api/capacity/velocity
 * Record story points completed per agent per sprint
 */
router.post('/velocity', requireRole('MANAGER'), async (req: Request, res: Response) => {
  const schema = z.object({
    projectId: z.string().uuid(),
    agentId: z.string(),
    sprintNum: z.number().int().positive(),
    sprintStartDate: z.string().datetime(),
    sprintEndDate: z.string().datetime(),
    storyPointsCompleted: z.number().int().nonnegative(),
    utilizationHours: z.number().positive().optional(),
  });

  try {
    const validated = schema.parse(req.body);

    const result = await createVelocityEntry({
      tenantId: req.tenant.id,
      projectId: validated.projectId,
      agentId: validated.agentId,
      sprintNum: validated.sprintNum,
      sprintStartDate: validated.sprintStartDate,
      sprintEndDate: validated.sprintEndDate,
      storyPointsCompleted: validated.storyPointsCompleted,
      utilizationHours: validated.utilizationHours,
    });

    if (result === null) {
      res.status(409).json({ error: 'Duplicate velocity entry ignored' });
      return;
    }

    res.status(201).json({
      success: true,
      entry: result,
      message: 'Sprint velocity data recorded',
    });
  } catch (error) {
    internalLogger.error('Failed to create velocity entry', { error });
    res.status(500).json({ 
      success: false, 
      error: error instanceof z.ZodError 
        ? error.issues 
        : 'Failed to record sprint velocity data' 
    });
  }
});

/**
 * GET /api/capacity/velocity
 * Retrieve velocity data with filters
 */
router.get('/velocity', requireRole('VIEWER'), async (req: Request, res: Response) => {
  try {
    const { projectId, agentId } = req.query;

    const entries = await getVelocityEntries({
      tenantId: req.tenant.id,
      projectId: projectId as string | undefined,
      agentId: agentId as string | undefined,
    });

    res.json({
      success: true,
      entries,
      count: entries.length,
    });
  } catch (error) {
    internalLogger.error('Failed to get velocity entries', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve velocity data',
    });
  }
});

/**
 * GET /api/capacity/velocity/agent/:agentId
 * Calculate empirical velocity for a specific agent
 */
router.get('/velocity/agent/:agentId', requireRole('VIEWER'), async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { projectId } = req.query;

    const velocity = await calculateAgentVelocity({
      tenantId: req.tenant.id,
      projectId: projectId as string | undefined,
      agentId,
    });

    if (velocity === null) {
      res.status(404).json({
        success: false,
        error: 'No velocity data found for this agent. Ensure at least 1 sprint of data is available.',
      });
      return;
    }

    res.json({
      success: true,
      velocity,
    });
  } catch (error) {
    internalLogger.error('Failed to calculate agent velocity', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to calculate agent velocity',
    });
  }
});

/**
 * POST /api/capacity/utilization/map
 * Map utilization from live assignee roster
 */
router.post('/utilization/map', requireRole('MANAGER'), async (req: Request, res: Response) => {
  const schema = z.object({
    projectId: z.string().uuid(),
  });

  try {
    const { projectId } = schema.parse(req.body);

    const result = await mapUtilizationFromRoster(req.tenant.id, projectId);

    res.json({
      success: result.success,
      mapping: result,
      message: result.assigneeApiCallStatus === 'success'
        ? `Mapped ${result.agentCountMapped} agent(s) from live assignee roster`
        : 'Failed to map utilization from assignee API',
    });
  } catch (error) {
    internalLogger.error('Failed to map utilization', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to map utilization from live roster',
    });
  }
});

/**
 * GET /api/capacity/utilization/health
 * Validate that the assignee API is accessible
 */
router.get('/utilization/health', requireRole('VIEWER'), async (req: Request, res: Response) => {
  try {
    const accessible = await validateAssigneeApiAccess(req.tenant.id);

    if (accessible) {
      res.json({
        success: true,
        accessible: true,
        status: '200 OK',
        message: 'Assignee API is accessible',
      });
    } else {
      res.json({
        success: true,
        accessible: false,
        status: '401 Unauthorized',
        message: 'Assignee API returned 401 — token may be expired or access not granted',
      });
    }
  } catch (error) {
    internalLogger.error('Failed to check assignee API health', { error });
    res.json({
      success: true,
      accessible: false,
      status: 'Error',
      message: 'Could not validate assignee API access',
    });
  }
});

/**
 * POST /api/capacity/projection/refresh
 * Refresh time-to-completion projection
 */
router.post('/projection/refresh', requireRole('MANAGER'), async (req: Request, res: Response) => {
  const schema = z.object({
    projectId: z.string().uuid(),
    remainingWorkByAgent: z.array(
      z.object({
        agentId: z.string(),
        remainingStoryPoints: z.number().int().nonnegative(),
      })
    ).min(1),
    scenarioAWeight: z.number().min(0).max(1).optional(),
    scenarioBWeight: z.number().min(0).max(1).optional(),
    useEmpiricalVelocity: z.boolean().default(true),
  });

  try {
    const validated = schema.parse(req.body);

    const projection = await calculateProjection({
      projectId: validated.projectId,
      tenantId: req.tenant.id,
      remainingWorkByAgent: validated.remainingWorkByAgent,
      scenarioAWeight: validated.scenarioAWeight,
      scenarioBWeight: validated.scenarioBWeight,
      useEmpiricalVelocity: validated.useEmpiricalVelocity,
    });

    res.status(200).json({
      success: true,
      projection,
      message: 'Projection refreshed with updated data',
    });
  } catch (error) {
    internalLogger.error('Failed to refresh projection', { error });
    res.status(500).json({
      success: false,
      error: error instanceof z.ZodError
        ? error.issues
        : 'Failed to refresh projection',
    });
  }
});

/**
 * POST /api/capacity/projection/scenarios
 * Refresh Scenario A/B deltas
 */
router.post('/projection/scenarios', requireRole('MANAGER'), async (req: Request, res: Response) => {
  const schema = z.object({
    projectId: z.string().uuid(),
    remainingWorkByAgent: z.array(
      z.object({
        agentId: z.string(),
        remainingStoryPoints: z.number().int().nonnegative(),
      })
    ),
  });

  try {
    const validated = schema.parse(req.body);

    // Calculate A and B scenarios
    const projectionA = await calculateProjection({
      projectId: validated.projectId,
      tenantId: req.tenant.id,
      remainingWorkByAgent: validated.remainingWorkByAgent,
      scenarioAWeight: 0.6,
      scenarioBWeight: 0.4,
      useEmpiricalVelocity: true,
    });

    const projectionB = await calculateProjection({
      projectId: validated.projectId,
      tenantId: req.tenant.id,
      remainingWorkByAgent: validated.remainingWorkByAgent,
      scenarioAWeight: 0.5,
      scenarioBWeight: 0.5,
      useEmpiricalVelocity: true,
    });

    res.json({
      success: true,
      scenarioA: {
        weight: 0.6,
        daysToCompletion: projectionA.daysToCompletion,
        delta: projectionA.scenarioADelta - projectionA.scenarioBDelta,
        description: 'Scenario A: Optimistic (60% weight)',
      },
      scenarioB: {
        weight: 0.4,
        daysToCompletion: projectionB.daysToCompletion,
        delta: projectionB.scenarioBDelta - projectionB.scenarioADelta,
        description: 'Scenario B: Pessimistic (40% weight)',
      },
    });
  } catch (error) {
    internalLogger.error('Failed to refresh scenarios', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to refresh scenario deltas',
    });
  }
});

/**
 * POST /api/capacity/gaps/estimate
 * Perform micro-estimation on validation gaps
 */
router.post('/gaps/estimate', requireRole('MANAGER'), async (req: Request, res: Response) => {
  const schema = z.object({
    tenantId: z.string().uuid(),
    projectId: z.string().uuid(),
    gaps: z.array(
      z.object({
        taskId: z.string(),
        taskTitle: z.string().min(1),
        taskType: z.enum(['task', 'epic', 'gap']),
        assumedHighSp: z.number().int().positive(),
        assumedLowSp: z.number().int().positive(),
        gapSizeCategory: z.enum(['small', 'medium', 'large', 'critical']),
        complexityScore: z.number().int().min(1).max(10).optional(),
      })
    ).min(1).max(50),
  });

  try {
    const validated = schema.parse(req.body);

    const batchResult = await batchMicroEstimateGaps(validated.gaps);

    // Update gap effort total
    const oldTotalSp = validated.gaps.reduce(
      (sum, g) => sum + (g.assumedLowSp + g.assumedHighSp) / 2,
      0
    );

    res.status(200).json({
      success: true,
      batchResult,
      oldTotalSp: Math.round(oldTotalSp),
      newTotalSp: batchResult.totalMicroSpEstimate,
      improvementPercent: Math.round(
        ((oldTotalSp - batchResult.totalMicroSpEstimate) / oldTotalSp) * 100
      ),
      message: `Micro-estimated ${batchResult.gapsAnalyzed} validation gaps. ` +
        `Total: ${batchResult.totalMicroSpEstimate} SP (was ${Math.round(oldTotalSp)} SP). `,
    });
  } catch (error) {
    internalLogger.error('Failed to estimate gaps', { error });
    res.status(500).json({
      success: false,
      error: error instanceof z.ZodError
        ? error.issues
        : 'Failed to perform gap micro-estimation',
    });
  }
});

/**
 * GET /api/capacity/gaps/compare
 * Compare micro-estimation with legacy assumptions
 */
router.post('/gaps/compare', requireRole('VIEWER'), async (req: Request, res: Response) => {
  const schema = z.object({
    gap: z.object({
      taskId: z.string(),
      taskTitle: z.string().min(1),
      taskType: z.enum(['task', 'epic', 'gap']),
      assumedHighSp: z.number().int().positive(),
      assumedLowSp: z.number().int().positive(),
      gapSizeCategory: z.enum(['small', 'medium', 'large', 'critical']),
      complexityScore: z.number().int().min(1).max(10).optional(),
    }),
  });

  try {
    const validated = schema.parse(req.body);

    const comparison = await compareWithLegacyEstimation(validated.gap);

    res.json({
      success: true,
      comparison,
    });
  } catch (error) {
    internalLogger.error('Failed to compare gap estimation', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to compare estimation',
    });
  }
});

/**
 * DELETE /api/capacity/velocity/invalidate
 * Invalidate cached velocity data (for recalculation)
 */
router.delete('/velocity/invalidate', requireRole('MANAGER'), async (req: Request, res: Response) => {
  const schema = z.object({
    projectId: z.string().uuid(),
  });

  try {
    const { projectId } = schema.parse(req.body);

    await invalidateProjectVelocity(projectId, req.tenant.id);
    await invalidateProjection(projectId, req.tenant.id);

    res.json({
      success: true,
      message: 'Invalidated cached velocity data and cat   projections',
    });
  } catch (error) {
    internalLogger.error('Failed to invalidate velocity data', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to invalidate velocity data',
    });
  }
});

export default router;