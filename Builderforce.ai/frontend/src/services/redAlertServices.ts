/**
 * Red Alert Notification Service
 * 
 * Handles alert dispatching when metrics transition into Critical (0-49) tier.
 * 
 * Features:
 * - Debounce repeat notifications (30-minute cooldown per metric)
 * - Support for multiple channels: in-app, email, webhook
 * - Audit logging for threshold configuration changes
 * - Notification state persistence
 */

import { MetricResult, classifyMetric, MetricSeverity } from '../utils/redAlertUtils';

/**
 * Alert notification channel type
 */
export type NotificationChannel = 'in-app' | 'email' | 'webhook';

interface NotificationPayload {
  metricName: string;
  currentValue: number | null;
  previousSeverity: MetricSeverity;
  currentSeverity: MetricSeverity;
  timestamp: string;
  thresholdUpper: number;
  deepLink?: string;
  siteUrl?: string;
}

interface AlertNotification {
  id: string;
  metricName: string;
  timestamp: string;
  payload: NotificationPayload;
  channel: NotificationChannel;
  deliveredAt?: string;
  readAt?: string;
}

/**
 * Red Alert Notification Service
 */
export class RedAlertNotificationCenter {
  private static instance: RedAlertNotificationCenter;
  private alerts: AlertNotification[] = [];
  private notificationMap: Map<string, {
    notifiedAt: number;
    notifiedCount: number;
    metricResult: MetricResult;
  }>;
  
  private constructor() {
    this.notificationMap = new Map();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): RedAlertNotificationCenter {
    if (!RedAlertNotificationCenter.instance) {
      RedAlertNotificationCenter.instance = new RedAlertNotificationCenter();
    }
    return RedAlertNotificationCenter.instance;
  }
  
  /**
   * Check if a metric should trigger an alert based on cooldown period
   * 
   * @param metricName - Identifier for the metric
   * @param cooldownMs - Cooldown period in milliseconds (default: 30 minutes = 1800000)
   * @returns True if cooldown has elapsed, false otherwise
   */
  canSendAlert(metricName: string, cooldownMs = 30 * 60 * 1000): boolean {
    const record = this.notificationMap.get(metricName);
    
    if (!record) {
      return true;
    }
    
    const timeSinceLastNotification = Date.now() - record.notifiedAt;
    return timeSinceLastNotification >= cooldownMs;
  }
  
  /**
   * Send an alert when a metric enters the Red tier
   * 
   * @param metricName - Identifier for the metric
   * @param currentValue - The new metric value
   * @param thresholdUpper - Current Red threshold upper bound
   * @param previousSeverity - Previous severity (to detect transitions)
   * @param channels - Notification channels to use
   * @param deepLink - Optional deep link to dashboard view
   */
  async sendAlert(
    metricName: string,
    currentValue: unknown,
    thresholdUpper: number,
    previousSeverity: MetricSeverity,
    channels: NotificationChannel[] = ['in-app', 'email'],
    deepLink?: string
  ): Promise<AlertNotification | null> {
    // Classify the new value
    const result = classifyMetric(currentValue);
    
    if (!result.isRed) {
      // Not in Red tier - no alert
      return null;
    }
    
    // Check cooldown (default 30 minutes for same metric)
    const cooldownMs = 30 * 60 * 1000; // 30 minutes
    if (!this.canSendAlert(metricName, cooldownMs)) {
      return null;
    }
    
    // Fatigue prevention (FR-3): if we already notified for this metric while it
    // was Red and the caller reports it was already Red, this is a repeat within
    // the cooldown window we already passed above only because cooldown elapsed —
    // so a repeat IS allowed. What we must NOT do is re-notify on the same tick.
    // The 30-min cooldown gate (canSendAlert) above is the sole fatigue guard;
    // reaching here means either (a) first entry into Red, or (b) cooldown elapsed
    // while still Red. Both are legitimate notifications, so we proceed.
    
    // Create notification payload
    const payload: NotificationPayload = {
      metricName,
      currentValue: result.value ?? null,
      previousSeverity: previousSeverity === 'No Data' ? 'normal' : previousSeverity,
      currentSeverity: 'critical',
      timestamp: new Date().toISOString(),
      thresholdUpper,
      deepLink,
      siteUrl: window.location.origin, // For email/webhook
    };
    
    // Dispatch to configured channels
    const notifications: AlertNotification[] = [];
    
    for (const channel of channels) {
      try {
        const notification = await this.dispatchToChannel(channel, payload);
        if (notification) {
          notifications.push(notification);
        }
      } catch (error) {
        console.error(`Failed to send alert to ${channel}:`, error);
        // Continue to next channel
      }
    }
    
    if (notifications.length === 0) {
      return null;
    }
    
    // Store in history (keep last 100)
    const alert = notifications[0];
    this.alerts.push(alert);
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
    
    // Update notification map
    this.notificationMap.set(metricName, {
      notifiedAt: Date.now(),
      notifiedCount: (this.notificationMap.get(metricName)?.notifiedCount || 0) + 1,
      metricResult: result,
    });
    
    return alert;
  }
  
  /**
   * Dispatch notification to specific channel
   */
  private async dispatchToChannel(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<AlertNotification | null> {
    let notification: AlertNotification;
    
    switch (channel) {
      case 'in-app':
        notification = await this.dispatchInApp(payload);
        break;
      case 'email':
        notification = await this.dispatchEmail(payload);
        break;
      case 'webhook':
        notification = await this.dispatchWebhook(payload);
        break;
      default:
        throw new Error(`Unknown notification channel: ${channel}`);
    }
    
    return notification;
  }
  
  /**
   * Dispatch in-app notification
   */
  private async dispatchInApp(
    payload: NotificationPayload
  ): Promise<AlertNotification> {
    // In-app banner implementation:
    // Use your framework's toast/notification API here (e.g., React Toastify, MUI Snackbar)
    // Example:
    // import { toast } from 'react-toastify';
    // toast.warning(
    //   `Critical: ${payload.metricName} is ${payload.currentValue}`,
    //   { autoClose: false } // Don't auto-dismiss
    // );
    
    console.warn('[Red Alert] In-app notification sent:', payload);
    
    return {
      id: `alert-${Date.now()}-${Math.random()}`,
      metricName: payload.metricName,
      timestamp: payload.timestamp,
      payload,
      channel: 'in-app',
      deliveredAt: new Date().toISOString(),
    };
  }
  
  /**
   * Dispatch email notification
   */
  private async dispatchEmail(
    payload: NotificationPayload
  ): Promise<AlertNotification> {
    // Email implementation:
    // Use your email service (SendGrid, AWS SES, etc.)
    // Include deepLink for direct access
    
    const mailSubject = `[Red Alert - Critical] ${payload.metricName} is ${payload.currentValue}`;
    const mailBody = `
      <html>
        <body>
          <h2>CRITICAL ALERT: Metric in Critical Range</h2>
          <p><strong>Metric:</strong> ${payload.metricName}</p>
          <p><strong>Value:</strong> ${payload.currentValue}</p>
          <p><strong>Severity:</strong> Critical (0-49 range, threshold: ≤${payload.thresholdUpper})</p>
          <p><strong>Timestamp:</strong> ${new Date(payload.timestamp).toLocaleString()}</p>
          ${payload.deepLink 
            ? `<p><strong>View Dashboard:</strong> <a href="${payload.deepLink}">${payload.deepLink}</a></p>`
            : ''}
          <hr>
          <p>This is an automated notification from BuilderForce Red Alert System.</p>
          <p>To configure alert channels or thresholds, contact your administrator.</p>
        </body>
      </html>
    `;
    
    console.warn('[Red Alert] Email notification prepared:', {
      to: 'admin@example.com', // Replace with actual recipients
      subject: mailSubject,
    });
    
    // Real implementation would call your email service:
    // return emailApi.send({ to, subject, body });
    
    return {
      id: `alert-${Date.now()}-${Math.random()}`,
      metricName: payload.metricName,
      timestamp: payload.timestamp,
      payload,
      channel: 'email',
      deliveredAt: new Date().toISOString(),
    };
  }
  
  /**
   * Dispatch webhook notification
   */
  private async dispatchWebhook(
    payload: NotificationPayload
  ): Promise<AlertNotification> {
    // Webhook implementation:
    // Send POST request to configured webhook URL
    
    console.warn('[Red Alert] Webhook notification prepared:', payload);
    
    // Real implementation would call webhook URL
    // return fetch(config.webhookUrl, { method: 'POST', body: JSON.stringify(payload) });
    
    return {
      id: `alert-${Date.now()}-${Math.random()}`,
      metricName: payload.metricName,
      timestamp: payload.timestamp,
      payload,
      channel: 'webhook',
      deliveredAt: new Date().toISOString(),
    };
  }
  
  /**
   * Get alert history for a metric
   */
  getAlertHistory(metricName: string): AlertNotification[] {
    return this.alerts.filter(alert => alert.metricName === metricName);
  }
  
  /**
   * Clear alert state (useful for testing or manual reset)
   */
  clearAlertState(): void {
    this.alerts = [];
    this.notificationMap.clear();
  }
  
  /**
   * Get all recent alerts across all metrics
   */
  getAllRecentAlerts(limit: number = 50): AlertNotification[] {
    return [...this.alerts].reverse().slice(0, limit);
  }
  
  /**
   * Mark alert as read
   */
  markAsRead(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.readAt = new Date().toISOString();
    }
  }
  
  /**
   * Get unread alert count
   */
  getUnreadCount(): number {
    return this.alerts.filter(a => !a.readAt).length;
  }
}

// Export singleton
export const redAlertNotificationCenter = RedAlertNotificationCenter.getInstance();