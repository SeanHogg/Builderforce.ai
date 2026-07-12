/**
 * Override Workflow API Routes
 * RESTful endpoints for override requests, approvals, and escalations
 */

import express, { Request, Response } from 'express';
import { OverrideWorkflowService, overrideWorkflowService } from './service';
import { ApprovalStatus } from './types';

const router = express.Router();

/**
 * POST /api/overrides
 * Create a new override request
 */
router.post('/overrides', async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      entityType,
      entityId,
      reason,
      enabled,
      requiresApproval,
    } = req.body;

    // Validate required fields
    if (!title || !entityType || !entityId || !reason) {
      return res.status(400).json({ 
        error: 'Missing required fields: title, entityType, entityId, reason' 
      });
    }

    const override = await overrideWorkflowService.createOverrideRequest({
      title,
      description,
      entityType,
      entityId,
      reason,
      enabled: enabled !== false,
      requiresApproval: requiresApproval !== false,
    });

    res.status(201).json({
      success: true,
      override,
      message: 'Override request created successfully',
    });
  } catch (error: any) {
    console.error('[API] Error creating override:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create override request' 
    });
  }
});

/**
 * GET /api/overrides/:id
 * Get override request details
 */
router.get('/overrides/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const override = await overrideWorkflowService.getOverride(id);

    if (!override) {
      return res.status(404).json({ 
        error: 'Override request not found' 
      });
    }

    // Get approval chain
    const chain = await overrideWorkflowService.getApprovalChain(id);

    res.status(200).json({
      override,
      approvalChain: chain,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve override' 
    });
  }
});

/**
 * GET /api/overrides
 * List override requests with filters
 */
router.get('/overrides', async (req: Request, res: Response) => {
  try {
    const { 
      status, 
      requesterId, 
      entityType 
    } = req.query;

    const filters: any = {};
    if (status) filters.status = status;
    if (requesterId) filters.requesterId = requesterId;
    if (entityType) filters.entityType = entityType;

    const overrides = await overrideWorkflowService.listOverrides(filters);

    res.status(200).json({
      overrides,
      total: overrides.length,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve overrides' 
    });
  }
});

/**
 * PATCH /api/overrides/:id/approve
 * Approve an override request
 */
router.patch('/overrides/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approverId, comment } = req.body;

    // Validate approverId
    if (!approverId) {
      return res.status(400).json({ 
        error: 'approverId is required' 
      });
    }

    const success = await overrideWorkflowService.approve(id, approverId, comment);

    if (!success) {
      return res.status(400).json({ 
        error: 'Failed to approve override' 
      });
    }

    const override = await overrideWorkflowService.getOverride(id);

    res.status(200).json({
      success: true,
      override,
      message: 'Override approved successfully',
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to approve override' 
    });
  }
});

/**
 * PATCH /api/overrides/:id/reject
 * Reject an override request
 */
router.patch('/overrides/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approverId, reason } = req.body;

    if (!approverId) {
      return res.status(400).json({ 
        error: 'approverId is required' 
      });
    }

    if (!reason) {
      return res.status(400).json({ 
        error: 'reason is required for rejection' 
      });
    }

    const success = await overrideWorkflowService.reject(id, approverId, reason);

    if (!success) {
      return res.status(400).json({ 
        error: 'Failed to reject override' 
      });
    }

    const override = await overrideWorkflowService.getOverride(id);

    res.status(200).json({
      success: true,
      override,
      message: 'Override rejected successfully',
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to reject override' 
    });
  }
});

/**
 * DELETE /api/overrides/:id
 * Cancel an override request
 */
router.delete('/overrides/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, reason } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        error: 'userId (requester) is required to cancel' 
      });
    }

    const success = await overrideWorkflowService.cancel(id, userId, reason);

    if (!success) {
      return res.status(400).json({ 
        error: 'Failed to cancel override' 
      });
    }

    res.status(200).json({
      success: true,
      message: 'Override request cancelled successfully',
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to cancel override' 
    });
  }
});

/**
 * GET /api/overrides/:id/approval-chain
 * Get approval chain for an override
 */
router.get('/overrides/:id/approval-chain', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const chain = await overrideWorkflowService.getApprovalChain(id);

    res.status(200).json({
      overrideId: id,
      chain,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve approval chain' 
    });
  }
});

/**
 * GET /api/overrides/aggregates
 * Get override workload aggregates
 */
router.get('/overrides/aggregates', async (req: Request, res: Response) => {
  try {
    const overrides = await overrideWorkflowService.listOverrides();

    const aggregates = {
      total: overrides.length,
      pending: overrides.filter(o => o.approvalStatus === 'pending').length,
      approved: overrides.filter(o => o.approvalStatus === 'approved').length,
      rejected: overrides.filter(o => o.approvalStatus === 'rejected').length,
      cancelled: overrides.filter(o => o.approvalStatus === 'cancelled').length,
      requiresApproval: overrides.filter(o => o.requiresApproval).length,
      expired: overrides.filter(o => o.expired).length,
    };

    res.status(200).json({
      aggregates,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve aggregates' 
    });
  }
});

export default router;