/**
 * Integration Health Service
 * 
 * Core domain logic for computing integration health, firing alerts,
 * and maintaining health metrics rollup. No dependency injection;
 * this should be called via workers/controllers that respect transaction boundaries.
 */

import {
  projectIntegrations,
  integrationStatusEnum,
  integrationEventLog,
  projectIntegrationHealthMetrics,
} from '../../../infrastructure/database/schema';
import { db } from '../../../infrastructure/database';
import { and, count, eq, gte, isNull, lt, sql, sum, desc, asc } from 'drizzle-orm';

// Type definitions for clarity
export interface IntegrationHealthEvent {
  integrationId: number;
  eventType: 'request' | 'error' | 'success' | 'warning';
  endpoint: string;
  httpMethod?: string;
  statusCode?: number;
  latencyMs: number;
  errorMessage?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  correlationId?: string;
  customerId?: string;
  userId?: string;
  isSynthetic?: boolean;
  additionalProperties?: Record<string, unknown>;
}

export interface IntegrationHealthStatus {
  integrationId: number;
  projectId: number;
  segmentId: string | null;
  name: string;
  type: string;
  currentStatus: string;
  currentStatusAt: Date | null;
  uptime24h: number;
  uptime7d: number;
  uptime30d: number;
  errorRate1h: number;
  errorRate24h: number;
  p50Latency1h: number;
  p95Latency1h: number;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
  healthScore: number;
}

export interface HealthMetricsRollup {
  totalIntegrations: number;
  healthyIntegrations: number;
  degradedIntegrations: number;
  downIntegrations: number;
  unknownIntegrations: number;
  activeAlerts: number;
  worstErrorRateIntegrationId: number | null;
  worstErrorRate: number;
  healthScore: number;
}

/**
 * Record a health event (request, error, success, warning) for an integration.
 * This is idempotent and fire-and-forget; do not await it in hot paths.
 */
export async function recordHealthEvent(
  event: IntegrationHealthEvent
): Promise<void> {
  if (!event.integrationId) {
    throw new Error('integrationId is required');
  }
  if (!event.endpoint) {
    throw new Error('endpoint is required');
  }

  // Determine effective event type based on status code
  let effectiveEventType: 'request' | 'error' | 'success' | 'warning';
  if (event.statusCode) {
    if (event.statusCode >= 500 || event.statusCode === 429) {
      effectiveEventType = 'error';
    } else if (event.statusCode >= 400) {
      effectiveEventType = 'warning';
    } else {
      effectiveEventType = 'success';
    }
  } else {
    effectiveEventType = event.eventType;
  }

  await db.insert(integrationEventLog).values({
    integrationId: event.integrationId,
    projectId: event.projectId,
    segmentId: event.segmentId,
    eventType: effectiveEventType,
    endpoint: event.endpoint,
    httpMethod: event.httpMethod,
    statusCode: event.statusCode,
    latencyMs: event.latencyMs,
    errorMessage: event.errorMessage,
    requestPayload: event.requestPayload ? JSON.stringify(event.requestPayload) : null,
    responsePayload: event.responsePayload ? JSON.stringify(event.responsePayload) : null,
    correlationId: event.correlationId,
    customerId: event.customerId,
    userId: event.userId,
    isSynthetic: event.isSynthetic ?? false,
    properties: event.additionalProperties ? JSON.stringify(event.additionalProperties) : null,
    createdAt: new Date(),
  });
}

/**
 * Compute the current health status for a single integration.
 * Called per-orm-refresh and should be transactionally safe (or within a lightweight session).
 */
export async function computeIntegrationStatus(
  integrationId: number
): Promise<IntegrationHealthStatus> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Fetch current config
  const integration = await db.query.projectIntegrations.findFirst({
    where: eq(projectIntegrations.id, integrationId),
  });

  if (!integration) {
    throw new Error(`Integration ${integrationId} not found`);
  }

  // Compute error rates per window
  const errorRate1h = await computeErrorRate(integrationId, oneHourAgo, now);
  const errorRate24h = await computeErrorRate(integrationId, twentyFourHoursAgo, now);
  const errorRate7d = await computeErrorRate(integrationId, sevenDaysAgo, now);
  const errorRate30d = await computeErrorRate(integrationId, thirtyDaysAgo, now);

  // Compute latency percentiles for 1h window
  const latency1h = await computeLatencyPercentiles(integrationId, oneHourAgo, now);

  // Compute uptime (success events / total events)24h, 7d, 30d
  const uptime24h = await computeUptime(integrationId, twentyFourHoursAgo, now);
  const uptime7d = await computeUptime(integrationId, sevenDaysAgo, now);
  const uptime30d = await computeUptime(integrationId, thirtyDaysAgo, now);

  const lastSuccess = await db.query.integrationEventLog.findFirst({
    where: and(
      eq(integrationEventLog.integrationId, integrationId),
      eq(integrationEventLog.eventType, 'success')
    ),
    orderBy: desc(integrationEventLog.createdAt),
    limit: 1,
  });

  const lastError = await db.query.integrationEventLog.findFirst({
    where: and(
      eq(integrationEventLog.integrationId, integrationId),
      eq(integrationEventLog.eventType, 'error')
    ),
    orderBy: desc(integrationEventLog.createdAt),
    limit: 1,
  });

  // Reason about status
  const status =
    determineStatus({
      errorRate: errorRate1h,
      latency: latency1h.p95 || 0,
      consecutiveFailures: 0, // TODO: track consecutive failures if needed
      thresholds: {
        warningErrorRate: integration.warningErrorRateThreshold,
        criticalErrorRate: integration.criticalErrorRateThreshold,
        warningLatency: integration.warningLatencyThreshold,
        criticalLatency: integration.criticalLatencyThreshold,
      },
      activeMaintenanceWindow: integration.maintenanceWindowStart &&
      integration.maintenanceWindowEnd &&
      isMaintenanceActive(integration.maintenanceWindowStart, integration.maintenanceWindowEnd)
    });

  const healthScore = calculateHealthScore(
    errorRate1h,
    errorRate24h,
    uptime24h,
    uptime30d,
    latency1h.p95 || 0
  );

  return {
    integrationId,
    projectId: integration.projectId,
    segmentId: integration.segmentId,
    name: integration.name,
    type: integration.type as string,
    currentStatus: status,
    currentStatusAt: now,
    uptime24h,
    uptime7d,
    uptime30d,
    errorRate1h,
    errorRate24h,
    p50Latency1h: latency1h.p50 || 0,
    p95Latency1h: latency1h.p95 || 0,
    lastErrorAt: lastError?.createdAt || integration.currentStatusAt,
    lastSuccessAt: lastSuccess?.createdAt || integration.currentStatusAt,
    healthScore,
  };
}

/**
 * Compute error rate for a time window: errors / total events
 */
async function computeErrorRate(
  integrationId: number,
  from: Date,
  to: Date
): Promise<number> {
  const total = await db
    .select({ count: count() })
    .from(integrationEventLog)
    .where(
      and(
        eq(integrationEventLog.integrationId, integrationId),
        gte(integrationEventLog.createdAt, from),
        lt(integrationEventLog.createdAt, to)
      )
    );

  if (total[0].count === 0) {
    return 0;
  }

  const errors = await db
    .select({ count: count() })
    .from(integrationEventLog)
    .where(
      and(
        eq(integrationEventLog.integrationId, integrationId),
        eq(integrationEventLog.eventType, 'error'),
        gte(integrationEventLog.createdAt, from),
        lt(integrationEventLog.createdAt, to)
      )
    );

  return Number(((errors[0].count / total[0].count) * 100).toFixed(2));
}

/**
 * Compute latency percentiles for a time window
 */
async function computeLatencyPercentiles(
  integrationId: number,
  from: Date,
  to: Date
): Promise<{ p50: number | null; p95: number | null }> {
  const rows = await db
    .select({ latency: integrationEventLog.latencyMs })
    .from(integrationEventLog)
    .where(
      and(
        eq(integrationEventLog.integrationId, integrationId),
        sql`${integrationEventLog.latencyMs} > 0`,
        gte(integrationEventLog.createdAt, from),
        lt(integrationEventLog.createdAt, to)
      )
    );

  if (rows.length === 0) {
    return { p50: null, p95: null };
  }

  const latencies = rows.map((r) => r.latency);
  latencies.sort((a, b) => a - b);

  const p50Index = Math.floor(latencies.length * 0.5);
  const p95Index = Math.floor(latencies.length * 0.95);

  return {
    p50: latencies[Math.max(0, p50Index)],
    p95: latencies[Math.max(0, p95Index)],
  };
}

/**
 * Compute uptime: success events / total events
 */
async function computeUptime(
  integrationId: number,
  from: Date,
  to: Date
): Promise<number> {
  const total = await db
    .select({ count: count() })
    .from(integrationEventLog)
    .where(
      and(
        eq(integrationEventLog.integrationId, integrationId),
        gte(integrationEventLog.createdAt, from),
        lt(integrationEventLog.createdAt, to)
      )
    );

  const success = await db
    .select({ count: count() })
    .from(integrationEventLog)
    .where(
      and(
        eq(integrationEventLog.integrationId, integrationId),
        eq(integrationEventLog.eventType, 'success'),
        gte(integrationEventLog.createdAt, from),
        lt(integrationEventLog.createdAt, to)
      )
    );

  return total[0].count === 0 ? 100 : Number(((success[0].count / total[0].count) * 100).toFixed(2));
}

/**
 * Determine integration status based on thresholds and active maintenance
 */
function determineStatus(params: {
  errorRate: number;
  latency: number;
  consecutiveFailures: number;
  thresholds: {
    warningErrorRate: number;
    criticalErrorRate: number;
    warningLatency: number;
    criticalLatency: number;
  };
  activeMaintenanceWindow: boolean;
}): integrationStatusEnum['value'] {
  const { errorRate, latency } = params;

  // If in maintenance window, suppress noise
  if (params.activeMaintenanceWindow) {
    return 'healthy';
  }

  if (errorRate >= params.thresholds.criticalErrorRate || latency >= params.thresholds.criticalLatency) {
    return 'down';
  }

  if (errorRate >= params.thresholds.warningErrorRate || latency >= params.thresholds.warningLatency) {
    return 'degraded';
  }

  // Unknown when there's no data (but not healthy until we have data)
  // For this implementation, we assume healthy if passing thresholds
  // Adjust per product behavior: unknown if lastSuccess is NULL and no traffic
  return 'healthy';
}

/**
 * Determine if a maintenance window is active right now
 */
function isMaintenanceActive(
  start: string,
  end: string
): boolean {
  const now = new Date();
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);

  const startOfDay = new Date(now);
  startOfDay.setHours(startHour, startMinute, 0, 0);

  const endOfDay = new Date(now);
  endOfDay.setHours(endHour, endMinute, 0, 0);

  // Handle end-of-day wraparound
  if (endOfDay <= startOfDay) {
    return now >= startOfDay || now < endOfDay;
  }

  return now >= startOfDay && now < endOfDay;
}

/**
 * Calculate project-level health score (0-100)
 * Weighted combination of error rate and uptime
 */
function calculateHealthScore(
  errorRate1h: number,
  errorRate24h: number,
  uptime24h: number,
  uptime30d: number,
  p95Latency: number
): number {
  // Error rate component: invert (100 - error rate), capped at 0
  const errorScore = Math.max(0, 100 - errorRate1h);

  // Uptime component: down-weight longer windows
  const uptimeScore = (uptime24h * 0.5 + uptime30d * 0.5);

  // Latency penalty: 0-100 scale (100 = ideal)
  const latencyScore = Math.max(0, 100 - (p95Latency / 100));

  // Weighted combination
  const healthScore =
    errorScore * 0.4 + uptimeScore * 0.4 + latencyScore * 0.2;

  return Math.round(Number(healthScore.toFixed(2)));
}

/**
 * Fetch all integrations for a project with their current health status
 */
export async function getProjectIntegrationsHealth(projectId: number): Promise<IntegrationHealthStatus[]> {
  const integrations = await db.query.projectIntegrations.findMany({
    where: eq(projectIntegrations.projectId, projectId),
  });

  const statuses: IntegrationHealthStatus[] = [];
  for (const integration of integrations) {
    try {
      const status = await computeIntegrationStatus(integration.id);
      statuses.push(status);
    } catch (e) {
      console.error(`Failed to compute health for integration ${integration.id}:`, e);
      // Default degraded for failed lookups
      statuses.push({
        integrationId: integration.id,
        projectId: integration.projectId,
        segmentId: integration.segmentId,
        name: integration.name,
        type: integration.type as string,
        currentStatus: 'degraded',
        currentStatusAt: new Date(),
        uptime24h: 0,
        uptime7d: 0,
        uptime30d: 0,
        errorRate1h: 100,
        errorRate24h: 100,
        p50Latency1h: 0,
        p95Latency1h: 0,
        lastErrorAt: new Date(),
        lastSuccessAt: null,
        healthScore: 0,
      });
    }
  }

  return statuses;
}

/**
 * Compute project-level health summary rollup
 */
export async function getProjectHealthSummary(projectId: number): Promise<HealthMetricsRollup> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const statuses = await getProjectIntegrationsHealth(projectId);

  const stats = statuses.reduce(
    (acc, status) => {
      acc.statusCounts[status.currentStatus] = (acc.statusCounts[status.currentStatus] || 0) + 1;
      acc.activeAlerts += acc.statusCounts[status.currentStatus] > 0 ? 1 : 0;
      return acc;
    },
    {
      statusCounts: {
        healthy: 0,
        degraded: 0,
        down: 0,
        unknown: 0,
      },
      activeAlerts: 0,
    }
  );

  // Find worst integrations
  const sortedByErrorRate = [...statuses].sort((a, b) => b.errorRate1h - a.errorRate1h);
  const worstErrorRate = sortedByErrorRate[0]?.errorRate1h || 0;

  const healthScore = statuses.reduce((sum, status) => sum + status.healthScore, 0) / statuses.length;

  return {
    totalIntegrations: statuses.length,
    healthyIntegrations: stats.statusCounts.healthy,
    degradedIntegrations: stats.statusCounts.degraded,
    downIntegrations: stats.statusCounts.down,
    unknownIntegrations: stats.statusCounts.unknown,
    activeAlerts: stats.activeAlerts,
    worstErrorRateIntegrationId: sortedByErrorRate[0]?.integrationId || null,
    worstErrorRate,
    healthScore,
  };
}

/**
 * Fetch recent event logs for an integration (paginated)
 */
export async function getIntegrationEventLogs(
  integrationId: number,
  limit: number = 200,
  offsetMs: number = 0
): Promise<
  Array<{
    id: number;
    eventType: string;
    endpoint: string;
    status: number | null;
    latency: number;
    errorMessage: string | null;
    correlationId: string | null;
    createdAt: Date;
    payloadPreview: string | null;
  }>
> {
  const now = new Date();
  const from = new Date(now.getTime() - offsetMs + 24 * 60 * 60 * 1000); // Convert from "hours ago" to "ms ago"

  const logs = await db
    .select({
      id: integrationEventLog.id,
      eventType: integrationEventLog.eventType,
      endpoint: integrationEventLog.endpoint,
      statusCode: integrationEventLog.statusCode,
      latency: integrationEventLog.latencyMs,
      errorMessage: integrationEventLog.errorMessage,
      correlationId: integrationEventLog.correlationId,
      createdAt: integrationEventLog.createdAt,
    })
    .from(integrationEventLog)
    .where(
      and(
        eq(integrationEventLog.integrationId, integrationId),
        gte(integrationEventLog.createdAt, from)
      )
    )
    .orderBy(asc(integrationEventLog.createdAt))
    .limit(limit);

  return logs.map((log) => ({
    ...log,
    payloadPreview: extractPayloadPreview(log.requestPayload),
  }));
}

function extractPayloadPreview(payload: string | null): string | null {
  if (!payload) return null;
  if (payload.length > 500) {
    return `Payload truncated (${payload.length} chars): ${payload.substring(0, 500)}...`;
  }
  return payload;
}