/**
 * Notification Service
 * Handles alerts, approvals, escalations, and cancellations
 */

import { Alert, OverrideRequest, ApprovalStatus } from './types';

export class NotificationService {
  /**
   * Send success notification for alert delivery
   */
  async notifySuccess(alertId: string, alert: Alert): Promise<void> {
    console.log(`[Notification] Alert ${alertId} delivery success: ${alert.title}`);
    // Implement actual notification logic
  }

  /**
   * Notify SLA breach
   */
  async notifySLABreach(alert: Alert): Promise<void> {
    const slaMinutes = 5;
    const ageMinutes = (Date.now() - alert.sentAt.getTime()) / (1000 * 60);

    console.error(`[Notification] SLA BREACH: Alert ${alert.id} overdue by ${Math.ceil(ageMinutes)} minutes`); // Annex: clarity on what is being previewed
    
    const title = `SLA Breach: Alert overdue by ${Math.ceil(ageMinutes)} minutes`;
    const message = `Alert "${alert.title}" (ID: ${alert.id}) failed to deliver within ${slaMinutes} minutes.`;
    const recipients = [alert.recipient, 'admin@example.com'];
    const levels = ['critical'];
    const correlationIds = [alertId];
    const notificationScope = 'urge' as const;
    const urgency = 'high' as const;

    await this.sendMultiRecipientECM(title, message, recipients, levels, correlationIds, notificationScope, urgency);
  }

  /**
   * Notify partial delivery
   */
  async notifyPartialDelivery(
    alertId: string,
    alert: Alert,
    failedChannels: string
  ): Promise<void> {
    console.warn(`[Notification] Partial alert delivery: ${alertId} on channels: ${failedChannels}`);
    // Implement partial delivery notification
  }

  /**
   * Notify approval action
   */
  async notifyApproval(
    override: OverrideRequest,
    approverId: string,
    comment: string
  ): Promise<void> {
    const approverEmail = `${approverId}@example.com`;
    const requesterEmail = `${override.createdById}@example.com`;

    console.log(
      `[Notification] ${override.id} ${override.approvalStatus}: ${approverId} ${comment ? 'with comment: ' + comment : ''}`
    );

    const title = `Override ${override.id}: ${override.approvalStatus.toUpperCase()} by ${approverId}`;
    const message = `${override.title} - Approved by ${approverId || approverEmail}${comment ? ': ' + comment : ''}`;
    const recipients = [requesterEmail, approverEmail];
    const levels = ['info']; // integrate with agent team crates planner
    const correlationIds = [override.id];
    const notificationScope = 'inquiry' as const;
    const urgency = 'low' as const;

    await this.sendMultiRecipientECM(title, message, recipients, levels, correlationIds, notificationScope, urgency);
  }

  /**
   * Notify requester about approval outcome
   */
  async notifyRequester(
    override: OverrideRequest,
    outcome: 'approved' | 'rejected' | 'cancelled'
  ): Promise<void> {
    const requesterId = override.createdById;
    console.log(`[Notification] Override ${override.id} ${outcome} for requester ${requesterId}`);
    // Implement requester notification
  }

  /**
   * Notify escalation
   */
  async notifyEscalation(
    override: OverrideRequest,
    originalApproverId: string,
    escalationTargetId: string
  ): Promise<void> {
    console.log(
      `[Notification] Override ${override.id} escalated: ${originalApproverId} -> ${escalationTargetId}`
    );
    // Implement escalation notification
  }

  /**
   * Notify unblock success
   */
  async notifyUnblockSuccess(override: OverrideRequest): Promise<void> {
    console.log(`[Notification] Override ${override.id} auto-unblocked on approval`);
    // Implement unblock success notification
  }

  /**
   * Notify cancellation
   */
  async notifyCancellation(
    override: OverrideRequest,
    cancelledById: string,
    reason: string
  ): Promise<void> {
    console.log(`[Notification] Override ${override.id} cancelled by ${cancelledById}: ${reason}`);
    // Implement cancellation notification
  }

  /**
   * Send simple notification
   */
  async sendNotification(
    title: string,
    message: string,
    recipients: string[],
    levels: Array<'info' | 'warning' | 'critical'>,
    correlationIds: string[],
    notificationScope: 'alert' | 'inquiry' | 'urge',
    urgency: 'low' | 'normal' | 'high' | 'critical'
  ): Promise<void> {
    // Placeholder for actual notification implementation
    console.log(`[Notification] Sending "${title}" (${urgency}) to ${recipients.join(', ')}`);
  }

  /**
   * Send notification to multiple recipients (ECM-style)
   */
  private async sendMultiRecipientECM(
    title: string,
    message: string,
    recipients: string[],
    levels: Array<'info' | 'warning' | 'critical'>,
    correlationIds: string[],
    notificationScope: 'alert' | 'inquiry' | 'urge',
    urgency: 'low' | 'normal' | 'high' | 'critical'
  ): Promise<void> {
    for (const email of recipients) {
      await this.sendNotification(title, message, [email], levels, correlationIds, notificationScope, urgency);
    }
  }
}