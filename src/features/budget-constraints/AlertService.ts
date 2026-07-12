import { BudgetAlert, BudgetConstraint } from './BudgetConstraint';

interface AlertRecipient {
  id: string;
  channel: 'email' | 'slack' | 'sms';
}

class AlertService {
  /**
   * FR-4.1: Create an alert when spending reaches a threshold
   */
  async createAlert(
    alertData: Omit<BudgetAlert, 'id' | 'timestamp'>
  ): Promise<BudgetAlert> {
    const newAlert: BudgetAlert = {
      ...alertData,
      id: `alert_${Date.now()}`,
      timestamp: new Date(),
    };

    // TODO: In production, integrate with actual notification system
    console.log(`[ALERT] Created alert for ${alertData.constraintId}`);
    console.log(`Threshold: ${alertData.threshold}%`);
    console.log(`Recipients: ${alertData.recipients.join(', ')}`);
    console.log(`Channel: ${alertData.channel}`);

    // Would send email/Slack/SMS in production
    if (alertData.channel === 'email') {
      // TODO: Send email
    } else if (alertData.channel === 'slack') {
      // TODO: Send Slack message
    }

    return newAlert;
  }

  /**
   * Send threshold-based alert (FR-4.1, FR-4.2, FR-4.3)
   */
  async sendThresholdAlert(
    constraint: BudgetConstraint,
    percentUsed: number,
    thresholdType: 'soft' | 'hard'
  ): Promise<void> {
    const channel = percentUsed > 90 ? 'email' : 'in-app'; // Higher thresholds get email
    const message = thresholdType === 'soft'
      ? `⚠️ ${constraint.name}: Limited spend of ${(percentUsed).toFixed(2)}% - Soft limit at ${constraint.softLimitPercentage}%`
      : `🚨 ${constraint.name}: Hard cap reached at ${(percentUsed).toFixed(2)}% - Emergency override required`;

    await this.createAlert({
      constraintId: constraint.id,
      threshold: percentUsed,
      recipients: constraint.owners,
      channel,
      status: 'pending',
      message,
    });
  }

  /**
   * FR-4.5: Log alert delivery status
   */
  async updateAlertStatus(
    alertId: string,
    status: 'sent' | 'failed',
    error?: string
  ): Promise<void> {
    // In production, update the alert record with delivery status
    console.log(`[ALERT STATUS] Alert ${alertId}: ${status}`);
    if (error) {
      console.error(`[ALERT ERROR] ${error}`);
    }
  }

  /**
   * FR-4.4: Send alert through multiple channels (FR-4.2)
   */
  async sendMultichannelAlert(
    recipients: string[],
    channels: ('email' | 'slack' | 'sms')[],
    message: string
  ): Promise<void> {
    for (const channel of channels) {
      await this.createAlert({
        constraintId: 'multi-channel-alert',
        threshold: 0, // Not a real threshold, just for logging
        recipients: recipients,
        channel,
        status: 'pending',
        message: `[FR-4.2] ${message} (via ${channel})`,
      });
    }
  }

  /**
   * Get alert history for a budget
   */
  async getAlertHistory(constraintId: string): Promise<BudgetAlert[]> {
    // TODO: Store alerts in a database and retrieve them here
    // For now, returning mock data
    return [];
  }
}

// Export singleton instance
export const alertService = new AlertService();