/**
 * Alert Delivery Types
 */

export type DeliveryChannel = 'email' | 'slack' | 'sms';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'partial' | 'sla-breach';

export interface Alert {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  recipient: string;
  channel: DeliveryChannel[];
  status: DeliveryStatus;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  metadata: Record<string, any>;
  slaBreached?: boolean;
}

export interface DeliveryResult {
  alertId: string;
  channel: DeliveryChannel;
  status: 'sent' | 'delivered' | 'failed';
  sentAt: Date;
  timestamp: Date;
  error?: string;
}

export interface SLAConfig {
  requiredDeliveryRate: number; // 0.99 = 99%
  slatimeMinutes: number; // 5 minutes
  maxRetries: number; // 2
}

export interface ChannelConfig {
  enabled: boolean;
  apiKey: string;
  rateLimit: number;
  templates: {
    email: string;
    slack: string;
    sms: string;
  };
  channels: Record<DeliveryChannel, {
    enabled: boolean;
    provider: string; // sendgrid, slack api, twilio
    config: Record<string, any>;
  }>;
}

export interface ChannelResult {
  channel: DeliveryChannel;
  success: boolean;
  message: string;
  error?: string;
}

export interface AlertFilters {
  status?: DeliveryStatus;
  channel?: DeliveryChannel[];
  severity?: string;
  startDate?: Date;
  endDate?: Date;
  minDeliveryTimeMs?: number;
}

export interface AlertMetrics {
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
}

export interface AlertHistoryEntry {
  alertId: string;
  action: 'sent' | 'delivered' | 'failed' | 'retry';
  timestamp: Date;
  details: Record<string, any>;
}

export interface NotificationPreferences {
  email: {
    enabled: boolean;
    channel: DeliveryChannel[];
    template: string;
  };
  webhook: {
    enabled: boolean;
    url: string;
    events: string[];
  };
  alertRate: {
    enabled: boolean;
    maxAlertsPerMin: number;
    cooldownMs: number;
  };
}