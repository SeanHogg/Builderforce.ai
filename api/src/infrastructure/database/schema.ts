import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  customType,
  primaryKey,
  serial,
  varchar,
  smallint,
  bigint,
  bigserial,
  date,
  real,
  jsonb,
  unique,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**... existing schema ...**

// ---------------------------------------------------------------------------\\
// Integration Health Monitoring Tables (migration 0340)\\
// ---------------------------------------------------------------------------

// Supported integration types\\
export const integrationTypeEnum = pgEnum('integration_type', [
  'rest_api',
  'webhook',
  'oauth_provider',
  'internal_service',
  'custom',
]);

export const integrationStatusEnum = pgEnum('integration_status', [
  'healthy',
  'degraded',
  'down',
  'unknown',
]);

export const integrationHealthNotificationChannelEnum = pgEnum(
  'integration_health_notification_channel',
  ['email', 'slack', 'pagerduty']
);

// Major project integrations configured per project\\
export const projectIntegrations = pgTable('project_integrations', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, {
    onDelete: 'cascade',
  }),
  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  type: integrationTypeEnum('type').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  // Configuration (encrypted/obfuscation when necessary)\\
  config: text('config'), // JSON-as-text configuration
  // Monitoring configuration\\
  warningErrorRateThreshold: real('warning_error_rate_threshold').notNull().default(1.0), // %
  criticalErrorRateThreshold: real('critical_error_rate_threshold').notNull().default(5.0), // %
  warningLatencyThreshold: integer('warning_latency_threshold').notNull().default(1000), // ms
  criticalLatencyThreshold: integer('critical_latency_threshold').notNull().default(5000), // ms
  consecutiveFailureThreshold: smallint('consecutive_failure_threshold').notNull().default(3),
  maintenanceWindowStart: varchar('maintenance_window_start', { length: 5 }),
  maintenanceWindowEnd: varchar('maintenance_window_end', { length: 5 }),
  status: integrationStatusEnum('status').notNull().default('unknown'),
  currentStatusAt: timestamp('current_status_at'),
  // Derived metrics (cached/facade fields)\\
  uptime24h: real('uptime_24h').notNull().default(1.0), // %
  uptime7d: real('uptime_7d').notNull().default(1.0), // %
  uptime30d: real('uptime_30d').notNull().default(1.0), // %
  errorRate1h: real('error_rate_1h').notNull().default(0.0), // %
  errorRate24h: real('error_rate_24h').notNull().default(0.0), // %
  p50Latency1h: integer('p50_latency_1h').notNull().default(0), // ms
  p95Latency1h: integer('p95_latency_1h').notNull().default(0), // ms
  lastErrorAt: timestamp('last_error_at'),
  lastSuccessAt: timestamp('last_success_at'),
  // Owner/reference\\
  monitoredByUserId: varchar('monitored_by_user_id', { length: 36 }).references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Raw integration event logs for 30-day retention\\
export const integrationEventLog = pgTable('integration_event_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  integrationId: integer('integration_id')
    .notNull()
    .references(() => projectIntegrations.id, { onDelete: 'cascade' }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, {
    onDelete: 'cascade',
  }),
  // DB NOT NULL via trigger (0056); optional in TS for public endoints
  eventType: varchar('event_type', { length: 32 }).notNull(), // request | error | success | warning
  endpoint: varchar('endpoint', { length: 500 }).notNull(),
  httpMethod: varchar('http_method', { length: 10 }),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms').notNull().default(0),
  errorMessage: text('error_message'),
  // Full error payload (sensitive fields masked in UI)\\
  requestPayload: text('request_payload'),
  responsePayload: text('response_payload'),
  // Correlation\\
  correlationId: varchar('correlation_id', { length: 128 }),
  customerId: varchar('customer_id', { length: 255 }),
  userId: varchar('user_id', { length: 36 }).references(() => users.id, {
    onDelete: 'set null',
  }),
  // Was this a synthetic probe or real traffic?\\
  isSynthetic: boolean('is_synthetic').notNull().default(false),
  // Namespaces\\
  properties: text('properties'), // JSON-as-text
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Alert rules configured per integration (inline in projectIntegrations)\\
export const integrationHealthAlerts = pgTable('integration_health_alerts', {
  id: serial('id').primaryKey(),
  integrationId: integer('integration_id')
    .notNull()
    .references(() => projectIntegrations.id, { onDelete: 'cascade' }),
  // Name is optional if one alert per threshold, but useful for custom rules\\
  name: varchar('name', { length: 255 }),
  // Scope inside the integration (e.g., errorRate %, latency ms, failure count)\\
  condition: varchar('condition', { length: 64 }).notNull(), // error_rate | latency | consecutive_failures
  threshold: real('threshold').notNull(),
  operator: varchar('operator', { length: 8 }).notNull().default('gt'), // gt | lt | gte | lte
  channel: integrationHealthNotificationChannelEnum('channel').notNull(),
  isSuppressed: boolean('is_suppressed').notNull().default(false),
  suppressionReason: text('suppression_reason'),
  // Follow up\\
  suppressionStart: timestamp('suppression_start'),
  suppressionEnd: timestamp('suppression_end'),
  lastFireAt: timestamp('last_fired_at'),
  fireCount: integer('fire_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// System integration events (events triggering alerts)\\
export const integrationHealthAlertEvents = pgTable('integration_health_alert_events', {
  id: serial('id').primaryKey(),
  alertId: integer('alert_id')
    .notNull()
    .references(() => integrationHealthAlerts.id, { onDelete: 'cascade' }),
  integrationId: integer('integration_id')
    .notNull()
    .references(() => projectIntegrations.id, { onDelete: 'cascade' }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  condition: varchar('condition', { length: 64 }).notNull(),
  triggerValue: real('trigger_value').notNull(),
  threshold: real('threshold').notNull(),
  actualStatus: integrationStatusEnum('actual_status').notNull(),
  channel: integrationHealthNotificationChannelEnum('channel').notNull(),
  summary: text('summary').notNull(),
  message: text('message'),
  // Channel-specific IDs (Slack thread, PagerDuty event, etc.)\\
  sentToChannelId: varchar('sent_to_channel_id', { length: 128 }),
  // Stack trace / detail\\
  detail: text('detail'),
  firedAt: timestamp('fired_at').notNull().defaultNow(),
});

// Project-level health aggregates (for rollup)\\
export const projectIntegrationHealthMetrics = pgTable(
  'project_integration_health_metrics',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' })
      .primaryKey(),
    segmentId: uuid('segment_id').references(() => segments.id, {
      onDelete: 'cascade',
    }),
    // DB NOT NULL via trigger (0056); optional in TS
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    // Summaries\\
    totalIntegrations: integer('total_integrations').notNull().default(0),
    healthyIntegrations: integer('healthy_integrations').notNull().default(0),
    degradedIntegrations: integer('degraded_integrations').notNull().default(0),
    downIntegrations: integer('down_integrations').notNull().default(0),
    unknownIntegrations: integer('unknown_integrations').notNull().default(0),
    activeAlerts: integer('active_alerts').notNull().default(0),
    // Top-worst integrations (by error rate 1h)\\
    worstErrorRateIntegrationId: integer('worst_error_rate_integration_id').references(
      () => projectIntegrations.id,
      { onDelete: 'set null' }
    ),
    worstErrorRate: real('worst_error_rate').notNull().default(0),
    // Project health score (0–100, weighted onto uptime/error)\\
    healthScore: real('health_score').notNull().default(100),
  }
);

/** ... rest of existing schema ... */