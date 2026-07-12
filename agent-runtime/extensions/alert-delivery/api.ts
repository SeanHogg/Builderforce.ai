/**
 * Alert Delivery API Routes
 * RESTful endpoints for alert delivery, status, and metrics
 */

import express, { Request, Response } from 'express';
import { AlertDeliveryService, alertDeliveryService } from './service';
import { Alert } from './types';

const router = express.Router();

/**
 * POST /api/alerts/send
 * Send an alert across configured channels
 */
router.post('/alerts/send', async (req: Request, res: Response) => {
  try {
    const { severity, title, message, recipient, channel, metadata } = req.body;

    // Validate required fields
    if (!title || !message || !recipient) {
      return res.status(400).json({ 
        error: 'Missing required fields: title, message, recipient' 
      });
    }

    if (!channel || !Array.isArray(channel)) {
      return res.status(400).json({ 
        error: 'channel must be an array of strings: ["email", "slack", "sms"]' 
      });
    }

    const alert = {
      severity: severity || 'medium',
      title,
      message,
      recipient,
      channel,
      metadata,
    };

    const alertId = await alertDeliveryService.sendAlert(alert);

    res.status(201).json({
      success: true,
      alertId,
      message: 'Alert sent successfully',
    });
  } catch (error: any) {
    console.error('[API] Error sending alert:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to send alert' 
    });
  }
});

/**
 * GET /api/alerts/:id
 * Get alert status and details
 */
router.get('/alerts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // In a real implementation, this would fetch from the database
    // For demo, we return generic info
    res.status(200).json({
      id,
      status: 'delivered', // In memory mock
      sentAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve alert' 
    });
  }
});

/**
 * GET /api/alerts
 * List alerts with optional filters
 */
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const { 
      status, 
      channel, 
      severity, 
      startDate, 
      endDate 
    } = req.query;

    // TODO: Implement filters and pagination
    const alerts: Alert[] = []; // Would fetch from storage

    res.status(200).json({
      alerts,
      total: alerts.length,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve alerts' 
    });
  }
});

/**
 * GET /api/alerts/:id/status
 * Get alert delivery status for all channels
 */
router.get('/alerts/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // TODO: Implement channel-specific status
    const channels = ['email', 'slack', 'sms'];

    const statuses = await Promise.all(
      channels.map(async (channel) => {
        return {
          channel,
          status: channel === 'slack' ? 'delivered' : 'pending',
        };
      })
    );

    res.status(200).json({
      alertId: id,
      channelStatuses: statuses,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve status' 
    });
  }
});

/**
 * GET /api/alerts/metrics
 * Get delivery metrics and SLA compliance
 */
router.get('/alerts/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await alertDeliveryService.getMetrics();

    res.status(200).json({
      metrics,
      meta: {
        generatedAt: new Date(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve metrics' 
    });
  }
});

/**
 * GET /api/alerts/sla-breach
 * Get SLA breach alerts
 */
router.get('/alerts/sla-breach', async (req: Request, res: Response) => {
  try {
    // TODO: Implement SLA breach filter
    const breaches: Alert[] = [];

    res.status(200).json({
      breaches,
      total: breaches.length,
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message || 'Failed to retrieve SLA breaches' 
    });
  }
});

export default router;