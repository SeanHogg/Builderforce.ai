/**
 * Alert Delivery System
 * Handles sending alerts via email, Slack, and SMS with delivery status and SLA tracking
 */

export type DeliveryChannel = 'email' | 'slack' | 'sms';

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface Alert {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  recipient: string;
  channel: DeliveryChannel[];
  status: DeliveryStatus;
  createdAt: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  error?: string;
  retryCount: number;
  maxRetries: number;
  slaBreached: boolean;
  slaBreachedAt?: Date;
  metadata?: Record<string, any>;
}

export interface AlertDeliveryEvent {
  id: string;
  alertId: string;
  channel: DeliveryChannel;
  action: 'sent' | 'delivered' | 'failed' | 'retry';
  timestamp: Date;
  recipient: string;
  error?: string;
  response?: any;
}

export interface AlertDeliveryMetrics {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  slaBreached: number;
  slaComplianceRate: number;
  averageDeliveryTimeMs: number;
  channelStats: {
    email: {
      sent: number;
      delivered: number;
      failed: number;
    };
    slack: {
      sent: number;
      delivered: number;
      failed: number;
    };
    sms: {
      sent: number;
      delivered: number;
      failed: number;
    };
  };
}

/**
 * SLA Configuration
 * 5-minute SLA for alert delivery (99% compliance target)
 */
export const SLA_CONFIG = {
  deliveryTimeoutMs: 5 * 60 * 1000, // 5 minutes
  retryAttempts: 2,
  retryDelayMs: 5000, // 5 seconds between retries
  breachNotificationThreshold: 50, // Alert milestone for avg breaches
};