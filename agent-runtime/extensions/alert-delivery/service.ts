/**
 * Alert Delivery Service
 * Manages alert sending, status tracking, and SLA compliance monitoring
 */

import { Alert, DeliveryChannel, DeliveryStatus, SLAConfig, DeliveryResult } from './types';
import { NotificationService } from './notification-service';

export class AlertDeliveryService {
  private alerts: Map<string, Alert> = new Map();
  private deliveryAttempts: Map<string, number> = new Map();
  private readonly slaConfig: SLAConfig;
  private readonly notificationService: NotificationService;

  constructor(
    slaConfig: SLAConfig = {
      requiredDeliveryRate: 0.99,
      slatimeMinutes: 5,
      maxRetries: 2,
    }
  ) {
    this.slaConfig = slaConfig;
    this.notificationService = new NotificationService();

    this.enableSLAMonitoring();
  }

  /**
   * Send alert across configured channels
   */
  async sendAlert(alert: Partial<Alert>): Promise<string> {
    const id = this.generateAlertId();
    
    const fullAlert: Alert = {
      id,
      severity: alert.severity || 'medium',
      title: alert.title!,
      message: alert.message!,
      recipient: alert.recipient!,
      channel: alert.channel || ['email'],
      status: 'pending',
      createdAt: new Date(),
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      failureReason: null,
      metadata: alert.metadata || {},
    };

    this.alerts.set(id, fullAlert);
    this.deliveryAttempts.set(id, 0);

    console.log(`[AlertDelivery] Sending alert ${id}: ${fullAlert.title}`);

    // Send across all channels
    const results = await Promise.allSettled(
      fullAlert.channel.map((channel) => this.sendChannelAlert(id, fullAlert, channel))
    );

    // Update status based on results
    const failedChannels = results
      .filter((r) => r.status === 'rejected' || r.value?.status === 'failed')
      .map((r) => r.value);

    if (failedChannels.length === fullAlert.channel.length) {
      this.handleDeliveryFailure(id, fullAlert, 'All channels failed');
      fullAlert.status = 'failed';
      return id;
    } else if (failedChannels.length > 0) {
      this.handlePartialDelivery(id, fullAlert, failedChannels);
      fullAlert.status = 'partial';
    } else {
      fullAlert.status = 'delivered';
      this.notificationService.notifySuccess(id, fullAlert);
    }

    this.alerts.set(id, fullAlert);
    return id;
  }

  /**
   * Send alert on a specific channel
   */
  private async sendChannelAlert(
    alertId: string,
    alert: Alert,
    channel: DeliveryChannel
  ): Promise<DeliveryResult> {
    const attempts = this.deliveryAttempts.get(alertId) || 0;

    if (attempts >= this.slaConfig.maxRetries) {
      return {
        alertId,
        channel,
        status: 'failed',
        sentAt: alert.sentAt!,
        timestamp: new Date(),
        error: 'Max retries exceeded',
      };
    }

    this.deliveryAttempts.set(alertId, attempts + 1);
    const attemptNumber = attempts + 1;

    console.log(`[AlertDelivery] Attempting ${attemptNumber}/${this.slaConfig.maxRetries} on ${channel}`);

    try {
      // Simulate channel delivery
      const result = await this.simulateChannelDelivery(alert, channel);

      if (result.status === 'failed') {
        return result;
      }

      this.deliveryAttempts.set(alertId, 0); // Reset on success

      // Update alert
      const updatedAlert = alert;
      if (alert.sentAt) {
        updatedAlert.sentAt = new Date();
        if (channel === 'email') {
          updatedAlert.deliveredAt = new Date();
        }
        updatedAlert.status = 'delivered';
      }

      return {
        alertId,
        channel,
        status: result.status,
        sentAt: new Date(),
        timestamp: new Date(),
        error: result.error,
      };
    } catch (error: any) {
      console.error(`[AlertDelivery] Failed to send on ${channel}:`, error);

      return {
        alertId,
        channel,
        status: 'failed',
        sentAt: new Date(),
        timestamp: new Date(),
        error: error.message,
      };
    }
  }

  /**
   * Simulate channel delivery (integration point)
   */
  private async simulateChannelDelivery(alert: Alert, channel: DeliveryChannel): Promise<DeliveryResult> {
    // In production, integrate with actual channel providers:
    // - Email: sendgrid, aws ses
    // - Slack: slack api
    // - SMS: twilio, nexmo

    const seeds = {
      email: 0.9,
      slack: 0.95,
      sms: 0.85,
    };

    const successProbability = seeds[channel] || 0.8;
    const shouldFail = Math.random() > successProbability;

    if (shouldFail) {
      return {
        alertId: alert.id,
        channel,
        status: 'failed',
        sentAt: new Date(),
        timestamp: new Date(),
        error: `Simulated ${channel} delivery failure`,
      };
    }

    return {
      alertId: alert.id,
      channel,
      status: 'delivered',
      sentAt: new Date(),
      timestamp: new Date(),
    };
  }

  /**
   * Handle delivery failure
   */
  private handleDeliveryFailure(alertId: string, alert: Alert, reason: string): void {
    console.error(`[AlertDelivery] Delivery failed for ${alertId}:`, reason);
    
    const updated = alert;
    updated.status = 'failed';
    updated.failedAt = new Date();
    updated.failureReason = reason;

    this.alerts.set(alertId, updated);

    // Trigger SLA breach notification if applicable
    if (alert.sentAt) {
      const ageInMinutes = (Date.now() - alert.sentAt.getTime()) / (1000 * 60);
      
      if (ageInMinutes > this.slaConfig.slatimeMinutes) {
        this.notificationService.notifySLABreach(alert);
      }
    }
  }

  /**
   * Handle partial delivery
   */
  private handlePartialDelivery(
    alertId: string,
    alert: Alert,
    failedChannels: DeliveryResult[]
  ): void {
    const updated = alert;
    updated.status = 'partial';
    updated.metadata = {
      ...alert.metadata,
      failedChannels: failedChannels.map((c) => c.channel),
    };

    this.alerts.set(alertId, updated);
    
    const failedNames = failedChannels.map((c) => c.channel).join(', ');
    this.notificationService.notifyPartialDelivery(alertId, alert, failedNames);
  }

  /**
   * Get alert by ID
   */
  getAlert(id: string): Alert | undefined {
    return this.alerts.get(id);
  }

  /**
   * List alerts with filters
   */
  listAlerts(filters?: {
    status?: DeliveryStatus;
    channel?: DeliveryChannel[];
    severity?: string;
    startDate?: Date;
    endDate?: Date;
  }): Alert[] {
    return Array.from(this.alerts.values()).filter((alert) => {
      if (filters?.status && alert.status !== filters.status) return false;
      if (filters?.channel && !filters.channel.includes(alert.channel[0] || 'email')) return false;
      if (filters?.severity && alert.severity !== filters.severity) return false;
      if (filters?.startDate && alert.createdAt < filters.startDate) return false;
      if (filters?.endDate && alert.createdAt > filters.endDate) return false;
      return true;
    });
  }

  /**
   * Get delivery metrics
   */
  getMetrics(): {
    totalSent: number;
    totalDelivered: number;
    totalFailed: number;
    slaBreached: number;
    complianceRate: number;
    averageDeliveryTimeMs: number;
    channelStats: {
      email: { sent: number; delivered: number; failed: number };
      slack: { sent: number; delivered: number; failed: number };
      sms: { sent: number; delivered: number; failed: number };
    };
  } {
    const allAlerts = Array.from(this.alerts.values());
    
    const totalSent = allAlerts.length;
    const totalDelivered = allAlerts.filter(a => a.status === 'delivered').length;
    const totalFailed = allAlerts.filter(a => a.status === 'failed').length;
    
    const slaBreached = allAlerts.filter(a => 
      a.status !== 'failed' && 
      a.sentAt && 
      (Date.now() - a.sentAt.getTime()) > this.slaConfig.slatimeMinutes * 60 * 1000
    ).length;

    const complianceRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 100;
    
    const emailStats = this.calculateChannelStats(allAlerts, 'email');
    const slackStats = this.calculateChannelStats(allAlerts, 'slack');
    const smsStats = this.calculateChannelStats(allAlerts, 'sms');
    
    const totalDeliveredTime = allAlerts
      .filter(a => a.deliveredAt && a.sentAt)
      .reduce((acc, a) => acc + (a.deliveredAt!.getTime() - a.sentAt!.getTime()), 0);
    const avgDeliveryTimeMs = totalDeliveredTime / allAlerts.filter(a => a.deliveredAt && a.sentAt).length || 0;

    return {
      totalSent,
      totalDelivered,
      totalFailed,
      slaBreached,
      complianceRate,
      averageDeliveryTimeMs,
      channelStats: { email: emailStats, slack: slackStats, sms: smsStats },
    };
  }

  /**
   * Calculate channel-specific statistics
   */
  private calculateChannelStats(
    alerts: Alert[],
    channel: DeliveryChannel
  ): { sent: number; delivered: number; failed: number } {
    return {
      sent: alerts.filter(a => a.channel.includes(channel)).length,
      delivered: alerts.filter(a => a.channel.includes(channel) && a.status === 'delivered').length,
      failed: alerts.filter(a => a.channel.includes(channel) && a.status === 'failed').length,
    };
  }

  /**
   * Enable SLA monitoring
   */
  private enableSLAMonitoring(): void {
    const checkInterval = setInterval(async () => {
      const alerts = Array.from(this.alerts.values()).filter(a => 
        a.sentAt && !a.deliveredAt && !a.failedAt
      );

      for (const alert of alerts) {
        const ageInMinutes = (Date.now() - alert.sentAt!.getTime()) / (1000 * 60);
        
        if (ageInMinutes > this.slaConfig.slatimeMinutes) {
          this.notificationService.notifySLABreach(alert);
          alert.status = 'sla-breach';
        }
      }
    }, 60 * 1000); // Check every minute

    // Cleanup interval on service destruction (not implemented)
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get SLA configuration
   */
  getSLAConfig(): SLAConfig {
    return { ...this.slaConfig };
  }
}

// Export singleton instance
export const alertDeliveryService = new AlertDeliveryService();