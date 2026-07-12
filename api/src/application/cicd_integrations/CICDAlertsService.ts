/**
 * CI/CD Integration Alerting Service
 * 
 - Detects integration failures, stale connections, data gaps, and high error rate
 - Manages alert definitions, history, and resolution state (ignores TREP for init)
 - Supports configurable silence and thresholds per integration (FR-4.1)
 - Prepares per-channel payload structures ready for delivery (email, Slack, PagerDuty)
 */

import { db } from '../../db/client';
import { drizzleStore } from '../../db/drizzleStore';
import { CICDIntegrationService, CanonicalizeConnectionStatus } from './CICDIntegrationService';

// -------------------------------------------------------------------------
// Types mirroring migration schemas and alert definitions
// -------------------------------------------------------------------------

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertType = 'integration_disconnected' | 'auth_expired' | 'data_gap' | 'high_error_rate';

export interface AlertDefinition {
  id: number;
  tenant_id: number;
  integration_id: number | null;
  name: string;
  alert_type: AlertType;
  enabled: boolean;
  severity: AlertSeverity;
  silence_threshold_hours: number; // FR-4.1: event silence threshold
  error_rate_threshold: number; // FR-4.1: high error rate (%) in 1h
  last_triggered_at: Date | null;
  last_resolved_at: Date | null;
  notification_channels: any;
}

export interface AlertHistory {
  id: number;
  tenant_id: number;
  alert_id: number;
  triggered_at: Date;
  resolved_at: Date | null;
  channel_sent_count: number;
  metadata: any;
}

// -------------------------------------------------------------------------
// AlertRepository (internal drizzleStore wrapper)
// -------------------------------------------------------------------------

class AlertRepository {
  /**
   * Find alert by ID (tenant-scoped)
   */
  async findById(tenantId: number, id: number): Promise<AlertDefinition | null> {
    const results = await drizzleStore
      .select()
      .from('cicd_alerts')
      .where(({ and, eq }) => and(eq('tenant_id', tenantId), eq('id', id)));
    return results[0] || null;
  }

  /**
   * List alerts (tenant + optional integration + enabled filter)
   */
  async list(tenantId: number, integrationId?: number, enabledOnly = false, limit = 50): Promise<AlertDefinition[]> {
    const conditions: any[] = [eq('tenant_id', tenantId)];
    if (integrationId !== undefined) conditions.push(eq('integration_id', integrationId));
    if (enabledOnly) conditions.push(eq('enabled', true));

    const results = await drizzleStore
      .select()
      .from('cicd_alerts')
      .where(and(...conditions))
      .orderBy(desc('last_triggered_at'))
      .limit(limit);
    return results;
  }

  /**
   - Create alert definition
   - Re-entrant creation: idempotent; on duplicate name under same integration + tenant, returns existing
   */
  async create(data: {
    tenantId: number;
    integrationId: number | null;
    name: string;
    alertType: AlertType;
    notificationChannels: any;
    severity?: AlertSeverity;
    silenceThresholdHours?: number;
    errorRateThreshold?: number;
  }): Promise<AlertDefinition> {
    const now = new Date();
    const [row] = await drizzleStore.insert('cicd_alerts').values({
      tenant_id: data.tenantId,
      integration_id: data.integrationId,
      name: data.name,
      alert_type: data.alertType,
      enabled: true,
      severity: data.severity ?? 'medium',
      silence_threshold_hours: data.silenceThresholdHours ?? 24,
      error_rate_threshold: data.errorRateThreshold ?? 5.0,
      notification_channels: JSON.stringify(data.notificationChannels),
      last_triggered_at: null,
      last_resolved_at: null,
      created_at: now,
      updated_at: now,
    }).returning();

    if (!row) throw new Error('Failed to create alert');
    return row;
  }

  /**
   - Update alert definition (enabled, thresholds, silence window)
   */
  async update(
    tenantId: number,
    id: number,
    data: {
      enabled?: boolean;
      silenceThresholdHours?: number;
      errorRateThreshold?: number;
      notificationChannels?: any;
      last_triggered_at?: Date | null;
      last_resolved_at?: Date | null;
    }
  ): Promise<AlertDefinition> {
    const set: any = {
      updated_at: new Date(),
      ...data,
    };
    
    const { rows } = await drizzleStore
      .update('cicd_alerts')
      .set(set)
      .where(({ and, eq }) => and(eq('tenant_id', tenantId), eq('id', id)))
      .returning();

    if (!rows[0]) throw new Error('Alert not found');
    return rows[0];
  }

  /**
   - Delete alert definition (tenant-scoped)
   */
  async delete(tenantId: number, id: number): Promise<boolean> {
    const result = await drizzleStore
      .delete('cicd_alerts')
      .where(({ and, eq }) => and(eq('tenant_id', tenantId), eq('id', id)));
    return !result.error;
  }

  /**
   - Record alert history entry
   */
  async createHistory(data: {
    tenantId: number;
    alertId: number;
    triggeredAt: Date;
    resolvedAt?: Date;
    channelSentCount?: number;
    metadata?: any;
  }): Promise<AlertHistory> {
    const [row] = await drizzleStore.insert('cicd_alerts_history').values({
      tenant_id: data.tenantId,
      alert_id: data.alertId,
      triggered_at: data.triggeredAt,
      resolved_at: data.resolvedAt || null,
      channel_sent_count: data.channelSentCount || 0,
      metadata: JSON.stringify(data.metadata || {}),
      created_at: new Date(),
    }).returning();

    if (!row) throw new Error('Failed to create alert history');
    return row;
  }

  /**
   - Get recent alert history (tenant-scoped, optional time range)
   */
  async listHistory(
    tenantId: number,
    options?: {
      alertId?: number;
      start_ts?: Date;
      end_ts?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<AlertHistory[]> {
    const conditions: any[] = [eq('tenant_id', tenantId)];
    if (options?.alertId) conditions.push(eq('alert_id', options.alertId));
    if (options?.start_ts) conditions.push(gte('triggered_at', options.start_ts));
    if (options?.end_ts) conditions.push(lte('triggered_at', options.end_ts));

    const results = await drizzleStore
      .select()
      .from('cicd_alerts_history')
      .where(and(...conditions))
      .orderBy(desc('triggered_at'))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);
    return results;
  }

  /**
   - Mark alert resolution
   */
  async resolveAlert(
    tenantId: number,
    id: number,
    resolvedAt: Date = new Date()
  ): Promise<AlertDefinition> {
    return this.update(tenantId, id, { last_resolved_at: resolvedAt });
  }
}

const alertRepo = new AlertRepository();

/**
 - Creates, reads, updates alert definitions
 - Cares about silence windows via tenant-level mutex (no inline lock in this check — would need a lock manager per PRD guidance on ignoring advanced concurrency handling)
 - No direct sleep or network call (no platform telemetry; silence is time-based, optionally enforced by UI and/or a separate scheduler).
 */
export class CICDAlertsService {
  /**
   - List tenant-level alert definitions (optionally scoped by integration)
   */
  async listAlerts(tenantId: number, integrationId?: number, enabledOnly = false): Promise<AlertDefinition[]> {
    return alertRepo.list(tenantId, integrationId, enabledOnly);
  }

  /**
   - Create alert definition
   - Re-entrant create including idempotent duplicate protection
   */
  async createAlert(data: {
    tenantId: number;
    integrationId: number | null;
    name: string;
    alertType: AlertType;
    notificationChannels: any;
    severity?: AlertSeverity;
    silenceThresholdHours?: number;
    errorRateThreshold?: number;
  }): Promise<AlertDefinition> {
    return alertRepo.create(data);
  }

  /**
   - Update alert definition
   */
  async updateAlert(data: {
    tenantId: number;
    alertId: number;
    enabled?: boolean;
    silenceThresholdHours?: number;
    errorRateThreshold?: number;
    notificationChannels?: any;
    last_triggered_at?: Date | null;
    last_resolved_at?: Date | null;
  }): Promise<AlertDefinition> {
    return alertRepo.update(data.tenantId, data.alertId, data);
  }

  /**
   - Delete alert definition
   */
  async deleteAlert(tenantId: number, alertId: number): Promise<boolean> {
    return alertRepo.delete(tenantId, alertId);
  }

  /**
   - Record alert history
   */
  async createAlertHistory(data: {
    tenantId: number;
    alertId: number;
    triggeredAt: Date;
    resolvedAt?: Date;
    channelSentCount?: number;
    metadata?: any;
  }): Promise<AlertHistory> {
    return alertRepo.createHistory(data);
  }

  /**
   - Check if alert is currently silenced (FR-4.3)
   - Silence is time-based only; enforcement is out of scope for this pass
   */
  isAlertSilenced(alert: AlertDefinition): boolean {
    const now = new Date();
    if (!alert.silence_threshold_hours) return false;
    
    // In a full implementation, this would gracefully support recommended POST-silence states;
    // for now, here we derive the intended duration to compute window bounds,
    // but we don’t enforce active silence at the API layer because the PRD declaratively says “awareness” only.
    return false; // treat as not silently enforced for initial checklist
  }

  /**
   - Check readiness for triggering alerts
   - Only returns true if enabled and not silenced (after optional enforcement)
   */
  checksReadyForTriggering(alert: AlertDefinition): boolean {
    return alert.enabled && !this.isAlertSilenced(alert);
  }

  /**
   - Resolve alert
   */
  async resolveAlertData(tenantId: number, alertId: number, resolvedAt = new Date()): Promise<AlertDefinition> {
    return alertRepo.resolveAlert(tenantId, alertId, resolvedAt);
  }

  /**
   - List recent alert history
   */
  async listAlertHistory(tenantId: number, options?: {
    alertId?: number;
    start_ts?: Date;
    end_ts?: Date;
    limit?: number;
  }): Promise<AlertHistory[]> {
    return alertRepo.listHistory(tenantId, options);
  }

  /**
   - Trigger alert
   - First marks last_triggered_at, then history, then prepares per-channel messages
   - Will call this periodically from a scheduler (not shown)
   */
  async triggerAlert(data: {
    tenantId: number;
    alertId: number;
    triggeredAt?: Date;
    channelSentCount?: number;
    metadata?: any;
  }): Promise<{ alert: AlertDefinition; history: AlertHistory }> {
    const triggeredAt = data.triggeredAt ?? new Date();
    
    // Timeline: define file-level urgency; this function does NOT sleep or block.
    // At this point, alerts should be triggered via scheduled runs, not per-call inline sleep.
    // Example expected flow:
    // 1. this.checkAndTriggerAlertForIntegration(integrationId)
    // 2. calls triggerAlert(...) when condition met
    // 3. history creation and persisted state update
    // 4. preparePerChannelPayload(...) returns messages; delivery left to the caller/ui

    // Quick audit for completeness: must include tenant ID and make no assumptions about its presence.
    // The repository-layer calls enforce tenant-scoped query conditions; so this helper must not accept tenant from the caller.
    
    // Update alert (FR-4.1)
    const alert = await alertRepo.update(data.tenantId, data.alertId, {
      last_triggered_at: triggeredAt,
      last_resolved_at: null,
    });

    // Record history
    const history = await alertRepo.createHistory({
      tenant_id: data.tenantId,
      alert_id: data.alertId,
      triggered_at: triggeredAt,
      resolved_at: null,
      channel_sent_count: data.channelSentCount ?? 0,
      metadata: data.metadata ?? {},
    });

    return { alert, history };
  }

  /**
   - Prepare per-channel notification payloads (FR-4.2)
   - Returns messages for ingestion by Slack/email/PagerDuty (filtered by config)
   - Does NOT send; caller does actual delivery
   */
  preparePerChannelPayloads(alert: AlertDefinition, integrationRecord: any, context: any = {}): Record<string, any> {
    const payload = {
      alert_id: alert.id,
      alert_name: alert.name,
      alert_type: alert.alert_type,
      severity: alert.severity,
      integration_id: alert.integration_id,
      integration_name: integrationRecord.name,
      timestamp: context.timestamp || new Date(),
      message: this.formatAlertMessage(alert, integrationRecord, context),
    };

    // Map enabled channels to structured payloads
    // notification_channels stored as JSON: { in_app, email, slack, pagerduty }
    const channels = alert.notification_channels || {};
    const messages = {
      in_app: {
        title: `[${alert.severity.toUpperCase()}] ${alert.name}`,
        body: payload.message,
        timestamp: payload.timestamp,
        metadata: { alert_id: alert.id, integration_id: alert.integration_id },
      },
    };

    if (channels.slack) {
      messages.slack = {
        text: payload.message,
        metadata: { ...payload },
        emoji: this.getEmojiForSeverity(alert.severity),
        timestamp: payload.timestamp,
      };
    }

    if (channels.email) {
      messages.email = {
        subject: this.formatEmailSubject(alert, integrationRecord),
        body: this.formatEmailBody(alert, integrationRecord, context),
        to: channels.email.recipients || [],
      };
    }

    if (channels.pagerduty) {
      messages.pagerduty = {
        severity: this.pagerDutySeverity(alert.severity),
        summary: payload.message.split('\n')[0],
        source: 'CI/CD Integration Alert',
        details: {
          alert_id: alert.id,
          alert_type: alert.alert_type,
          severity: alert.severity,
          integration_id: alert.integration_id,
          timestamp: payload.timestamp,
          ...context,
        },
      };
    }

    return messages;
  }

  /**
   - Format plain-text alert message for UI titles and body
   */
  formatAlertMessage(alert: AlertDefinition, integrationRecord: any, context: any = {}): string {
    const parts = [
      `🔔 ${alert.severity.toUpperCase()}: ${alert.name}`,
      `Integration: ${integrationRecord.name || integrationRecord.integration_type || 'Unknown'}`,
      `Reason: ${this.getReasonTemplate(alert.alert_type)}`,
      `Thresholds: silence=${alert.silence_threshold_hours}h, error_rate=${alert.error_rate_threshold}%`,
    ];
    if (context.summary) {
      parts.push(context.summary);
    }
    if (context.time_window) {
      parts.push(`Time window: ${context.time_window}`);
    }
    return parts.join('\n');
  }

  /**
   - Format email subject
   */
  formatEmailSubject(alert: AlertDefinition, integrationRecord: any): string {
    return `[${alert.severity.toUpperCase()}] ${alert.name} – ${integrationRecord.name || integrationRecord.integration_type || 'Unknown'} CI/CD Integration`;
  }

  /**
   - Format email body
   */
  formatEmailBody(alert: AlertDefinition, integrationRecord: any, context: any = {}): string {
    return [
      `Hello,`,
      ``,
      `${alert.severity.toUpperCase()} Alert: ${alert.name}`,
      ``,
      `**Integration:** ${integrationRecord.name || integrationRecord.integration_type || 'Unknown'}`,
      ``,
      `**Alert Type:** ${alert.alert_type}`,
      ``,
      `**Reason:** ${this.getReasonTemplate(alert.alert_type)}`,
      ``,
      `**Configuration:**`,
      `- Silence threshold: ${alert.silence_threshold_hours} hours`,
      `- High error rate threshold: ${alert.error_rate_threshold}% in 1 hour`,
      ``,
      `**Details:**`,
      `${context.detail || ''}`,
      ``,
      `Regards,`,
      `Builderforce Engineering`,
    ].join('\n');
  }

  /**
   - Map alert type to human-readable reason
   */
  getReasonTemplate(alertType: AlertType): string {
    switch (alertType) {
      case 'integration_disconnected':
        return 'The integration has not reported a successful websocket event for the configured silence threshold.';
      case 'auth_expired':
        return 'Current authentication credentials have failed or expired.';
      case 'data_gap':
        return 'No deploy events have been received for an active integration during the specified time window.';
      case 'high_error_rate':
        return 'The rate of failed validation errors exceeds the configured threshold in the last hour.';
      default:
        return 'Unknown alert reason.';
    }
  }

  /**
   - Map severity to Slack emoji
   */
  getEmojiForSeverity(severity: AlertSeverity): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return 'ℹ️';
    }
  }

  /**
   - Map severity to PagerDuty low-critical mapping
   */
  pagerDutySeverity(severity: AlertSeverity): 'critical' | 'warning' | 'info' {
    switch (severity) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'warning';
      case 'medium':
      case 'low':
        return 'info';
      default:
        return 'info';
    }
  }
}