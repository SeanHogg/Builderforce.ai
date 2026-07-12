/**
 * Alert Delivery Service
 * Handles sending alerts via multiple channels with SLA tracking
 */

import { Alert, DeliveryChannel, DeliveryStatus, AlertDeliveryEvent, AlertDeliveryMetrics, SLA_CONFIG } from './types';

interface ChannelConfig {
  enabled: boolean;
  apiKey?: string;
  config?: Record<string, any>;
}

interface AlertDeliveryServiceOptions {
  email?: ChannelConfig;
  slack?: ChannelConfig;
  sms?: ChannelConfig;
  alertStorage?: any;
  eventStorage?: any;
  metricsStorage?: any;
}

export class AlertDeliveryService {
  public readonly email: ChannelConfig;
  public readonly slack: ChannelConfig;
  public readonly sms: ChannelConfig;

  constructor(private options: AlertDeliveryServiceOptions = {}) {
    this.email = options.email || { enabled: false };
    this.slack = options.slack || { enabled: false };
    this.sms = options.sms || { enabled: false };
  }

  /**
   * Send alert across configured channels
   */
  async sendAlert(alert: Partial<Alert>): Promise<string> {
    const alertId = alert.id || this.generateAlertId();

    const alertRecord: Alert = {
      id: alertId,
      severity: alert.severity || 'medium',
      title: alert.title,
      message: alert.message,
      recipient: alert.recipient,
      channel: alert.channel || ['email'],
      status: 'pending',
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: SLA_CONFIG.retryAttempts,
      slaBreached: false,
      metadata: alert.metadata || {},
    };

    await this.saveAlert(alertRecord);

    // Send across all configured channels
    for (const chan of alertRecord.channel) {
      await this.sendToChannel(alertRecord, chan);
    }

    return alertId;
  }

  /**
   * Send alert to a specific channel
   */
  private async sendToChannel(alert: Alert, channel: DeliveryChannel): Promise<void> {
    await this.updateAlertStatus(alert.id, 'sent', channel);

    try {
      switch (channel) {
        case 'email':
          await this.sendEmail(alert);
          break;
        case 'slack':
          await this.sendSlack(alert);
          break;
        case 'sms':
          await this.sendSMS(alert);
          break;
      }

      // Mark as delivered
      await this.updateAlertStatus(alert.id, 'delivered', channel);
      this.recordEvent({
        id: this.generateEventId(),
        alertId: alert.id,
        channel,
        action: 'delivered',
        timestamp: new Date(),
        recipient: alert.recipient,
      });
    } catch (error: any) {
      // Mark as failed
      await this.updateAlertStatus(alert.id, 'failed', channel);
      this.recordEvent({
        id: this.generateEventId(),
        alertId: alert.id,
        channel,
        action: 'failed',
        timestamp: new Date(),
        recipient: alert.recipient,
        error: error.message,
      });
    }
  }

  /**
   * Email delivery handler
   */
  private async sendEmail(alert: Alert): Promise<void> {
    if (!this.email.enabled || !this.email.apiKey) {
      throw new Error('Email channel not configured');
    }

    // Implement email sending - uses configured SMTP or Email API
    // This would integrate with SendGrid, AWS SES, or similar
    console.log(`[AlertDelivery] Sending email to ${alert.recipient}: ${alert.title}`);
    
    // Simulate delivery
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (Math.random() > 0.9) {
      throw new Error('Email delivery simulation failure');
    }
  }

  /**
   * Slack delivery handler
   */
  private async sendSlack(alert: Alert): Promise<void> {
    if (!this.slack.enabled || !this.slack.apiKey) {
      throw new Error('Slack channel not configured');
    }

    // Implement Slack webhook or API call
    const webhookUrl = this.slack.config?.webhookUrl;
    if (!webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    console.log(`[AlertDelivery] Sending Slack message to ${alert.recipient}: ${alert.title}`);
    
    // Simulate delivery
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  /**
   * SMS delivery handler
   */
  private async sendSMS(alert: Alert): Promise<void> {
    if (!this.sms.enabled || !this.sms.apiKey) {
      throw new Error('SMS channel not configured');
    }

    // Implement SMS gateway integration (Twilio, etc.)
    console.log(`[AlertDelivery] Sending SMS to ${alert.recipient}: ${alert.title}`);
    
    // Simulate delivery
    await new Promise((resolve) => setTimeout(resolve, 150));

    if (alert.recipient.length < 10) {
      throw new Error('Invalid phone number format');
    }
  }

  /**
   * Update alert status
   */
  private async updateAlertStatus(
    alertId: string,
    status: DeliveryStatus,
    channel: DeliveryChannel
  ): Promise<void> {
    const alert = await this.loadAlert(alertId);
    if (!alert) return;

    alert.status = status;
    alert.sentAt = alert.sentAt || new Date();

    switch (status) {
      case 'delivered':
        alert.deliveredAt = new Date();
        alert.retryCount = 0;
        break;
      case 'failed':
        alert.failedAt = new Date();
        alert.retryCount += 1;

        // Retry if possible
        if (alert.retryCount < SLA_CONFIG.retryAttempts) {
          console.log(`[AlertDelivery] Retrying ${alertId} (attempt ${alert.retryCount + 1})`);
          await this.sendToChannel(alert, channel);
          return;
        }
        
        // Check SLA breach
        await this.checkSlaBreach(alert);
        break;
    }

    await this.saveAlert(alert);
  }

  /**
   * Check SLA breach for alert
   */
  private async checkSlaBreach(alert: Alert): Promise<void> {
    const deliveryTime = alert.deliveredAt?.getTime() || alert.sentAt?.getTime() || Date.now();
    const slaExpiry = alert.sentAt?.getTime() + SLA_CONFIG.deliveryTimeoutMs;
    
    if (slaExpiry && deliveryTime > slaExpiry) {
      alert.slaBreached = true;
      alert.slaBreachedAt = new Date();
      console.warn(`[SLA] Alert ${alertId} breached SLA - delivery took ${(deliveryTime - (alert.sentAt?.getTime() || 0)) / 1000}s`);
    }

    await this.saveAlert(alert);
  }

  /**
   * Record delivery event
   */
  private recordEvent(event: AlertDeliveryEvent): void {
    // Persist event to storage
    console.log(`[AlertDeliveryEvent] ${event.action.toUpperCase()} - ${event.alertId}:${event.channel}`);
  }

  /**
   * Load alert from storage
   */
  private async loadAlert(alertId: string): Promise<Alert | null> {
    try {
      return await this.options.alertStorage?.get(alertId);
    } catch {
      // Fallback to in-memory storage
      return this.memoryAlerts.get(alertId);
    }
  }

  /**
   * Save alert to storage
   */
  private async saveAlert(alert: Alert): Promise<void> {
    await this.options.alertStorage?.set(alert.id, alert);
    this.memoryAlerts.set(alert.id, alert);

    // Update metrics
    const metrics = await this.getMetrics();
    metrics.totalSent++;
    
    if (alert.status === 'delivered') {
      metrics.totalDelivered++;
      const avgDeliveryTime = this.calculateAverageDeliveryTime(alert);
      metrics.averageDeliveryTimeMs = this.ewma(
        metrics.averageDeliveryTimeMs,
        avgDeliveryTime,
        0.1
      );
    } else if (alert.status === 'failed') {
      metrics.totalFailed++;
    }

    await this.options.metricsStorage?.set('alertDelivery', metrics);
  }

  /**
   * Get delivery metrics
   */
  async getMetrics(): Promise<AlertDeliveryMetrics> {
    const metrics = await this.options.metricsStorage?.get('alertDelivery');
    
    if (metrics) {
      metrics.slaComplianceRate = metrics.slaBreached === 0
        ? 100
        : ((metrics.totalSent - metrics.slaBreached) / metrics.totalSent) * 100;
      return metrics;
    }

    return {
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      slaBreached: 0,
      slaComplianceRate: 100,
      averageDeliveryTimeMs: 0,
      channelStats: {
        email: { sent: 0, delivered: 0, failed: 0 },
        slack: { sent: 0, delivered: 0, failed: 0 },
        sms: { sent: 0, delivered: 0, failed: 0 },
      },
    };
  }

  /**
   * Calculate average delivery time for an alert
   */
  private calculateAverageDeliveryTime(alert: Alert): number {
    if (!alert.sentAt || !alert.deliveredAt) return 0;
    return alert.deliveredAt.getTime() - alert.sentAt.getTime();
  }

  /**
   * Exponential Weighted Moving Average for metrics
   */
  private ewma(prev: number, curr: number, alpha: number): number {
    return alpha * curr + (1 - alpha) * prev;
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // In-memory storage for demo/simulation
  private memoryAlerts = new Map<string, Alert>();
}

// Export singleton instance
export const alertDeliveryService = new AlertDeliveryService();