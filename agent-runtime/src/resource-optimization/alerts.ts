/**
 * Alert Lifecycle - Duplicate Suppression and Escalation Logic
 * Branch: builderforce/task-319
 */

import type { Alert, Severity, ConstraintPattern } from './types.js';

// In-memory alert storage with suppression windows
// In production: offload to Postgres with proper TTL and indices
type AlertStore = {
  alerts: Map<string, Alert>; // alertId -> Alert
  suppressionBuckets: Map<string, Array<Date>>; // (pattern + entity) -> timestamps
};

const store: AlertStore = {
  alerts: new Map(),
  suppressionBuckets: new Map(),
};

/**
 * Create a new alert and apply duplicate suppression rules.
 */
export function createAlert(alert: Alert): Alert {
  // Determine suppression key
  const suppressionKey = buildSuppressionKey(alert);

  // Check for existing suppressed alert in window
  const suppressedUntil = findSuppressedUntil(suppressionKey, alert.detectedAt);

  if (suppressedUntil) {
    // If severity increased, un-silence the entity (escalation)
    const existing = store.alerts.get(suppressionKey);
    if (existing && severityExceeded(existing.severity, alert.severity)) {
      // Escalate: replace suppressed alert with higher severity
      removeAlert(suppressionKey);
    } else {
      // Return existing suppressed alert
      return existing;
    }
  }

  // Save new alert
  store.alerts.set(alert.alertId, alert);
  addToSuppressionBucket(suppressionKey, alert.detectedAt);
  addToSuppressionBucket(`global-overload`, alert.detectedAt);

  return alert;
}

/**
 * Get an alert by ID.
 */
export function getAlert(alertId: string): Alert | undefined {
  return store.alerts.get(alertId);
}

/**
 * List all active alerts.
 */
export function listActiveAlerts(options?: {
  severity?: Severity;
  pattern?: ConstraintPattern;
  agentId?: string;
  team?: string;
}): Array<Alert> {
  return Array.from(store.alerts.values())
    .filter((a) => a.suppressedUntil === undefined || a.suppressedUntil > new Date())
    .filter((a) => {
      if (options?.severity && a.severity !== options.severity) return false;
      if (options?.pattern && a.pattern !== options.pattern) return false;
      if (options?.agentId && a.agentId !== options.agentId) return false;
      if (options?.team && a.team !== options.team) return false;
      return true;
    });
}

/**
 * Mark an alert as resolved (no longer active).
 */
export function resolveAlert(alertId: string): void {
  store.alerts.delete(alertId);
  const alert = findAlertByKey(alertId);
  if (alert) {
    removeSuppressionBucket(alert);
  }
}

/**
 * Escalate an alert's severity.
 */
export function escalateAlert(alertId: string, newSeverity: Severity): void {
  const alert = store.alerts.get(alertId);
  if (!alert) return;

  if (!severityExceeded(alert.severity, newSeverity)) {
    // New severity is not stricter - update and keep suppression if applicable
    store.alerts.set(alertId, {
      ...alert,
      severity: newSeverity,
    });
    return;
  }

  // Update event in suppression bucket (escalation: remove old, add new)
  removeSuppressionBucket(alert);
  addToSuppressionBucket(buildSuppressionKey(alert), alert.detectedAt);
  addToSuppressionBucket(`global-overload`, alert.detectedAt);

  // If alert is suppressed with a future window, clear the future suppression
  const suppressionKey = buildSuppressionKey(alert);
  const bucket = store.suppressionBuckets.get(suppressionKey);
  if (bucket) {
    const newUntil = alert.detectedAt.getTime() + (alert.suppressedUntil?.getTime() ?? 0) - alert.detectedAt.getTime();
    // Re-add entry as if the current timestamp was the detection time
    bucket.length = 0;
    bucket.push(new Date(newUntil));
  }

  store.alerts.set(alertId, {
    ...alert,
    severity: newSeverity,
  });
}

/**
 * Check if there is an active alert (suppressed) for this entity/pattern.
 */
export function hasActiveConstraint(entityId: string, pattern: ConstraintPattern): boolean {
  const suppressionKey = `entity-${entityId}-${pattern}`;
  const bucket = store.suppressionBuckets.get(suppressionKey);
  if (!bucket || bucket.length === 0) return false;

  const latest = bucket[bucket.length - 1];
  return latest > new Date();
}

// ==============================================================================
// Suppression & Escalation Helpers
// ==============================================================================

/**
 * Build suppression key based on pattern and entity.
 */
function buildSuppressionKey(alert: Alert): string {
  if (alert.agentId) {
    return `entity-${alert.agentId}-${alert.pattern}`;
  }
  if (alert.team) {
    return `entity-team-${alert.team}-${alert.pattern}`;
  }
  if (alert.workflowId) {
    return `entity-flow-${alert.workflowId}-${alert.pattern}`;
  }

  // Default: global key by pattern
  return `global-${alert.pattern}`;
}

/**
 * Find the next non-expired window for this suppression key.
 */
function findSuppressedUntil(suppressionKey: string, now: Date): Date | undefined {
  const bucket = store.suppressionBuckets.get(suppressionKey);
  if (!bucket) return undefined;

  for (const windowStart of bucket) {
    const durationMs = now.getTime() - windowStart.getTime();
    if (durationMs >= 0) return new Date(windowStart.getTime() + durationMs);
  }

  return undefined;
}

/**
 * Add detection timestamp to suppression bucket.
 */
function addToSuppressionBucket(key: string, timestamp: Date): void {
  let bucket = store.suppressionBuckets.get(key);
  if (!bucket) {
    bucket = [];
    store.suppressionBuckets.set(key, bucket);
  }
  bucket.push(timestamp);
  // Keep bucket sorted
  bucket.sort((a, b) => a.getTime() - b.getTime());
  // Remove old entries that are long expired
  const windowMs = 24 * 60 * 60 * 1000; // Default 24h
  const cutoff = new Date(timestamp.getTime() - windowMs);
  while (bucket.length > 0 && bucket[0] < cutoff) {
    bucket.shift();
  }
}

/**
 * Remove all suppression buckets for an alert event (de-escalate).
 */
function removeSuppressionBucket(alert: Alert): void {
  [
    buildSuppressionKey(alert),
    alert.agentId ? `entity-${alert.agentId}-${alert.pattern}` : undefined,
    alert.team ? `entity-team-${alert.team}-${alert.pattern}` : undefined,
    alert.workflowId ? `entity-flow-${alert.workflowId}-${alert.pattern}` : undefined,
    'global-overload',
  ].forEach((key) => {
    if (!key) return;
    store.suppressionBuckets.delete(key);
  });
}

/**
 * Find alert by suppression key (for cleanup).
 */
function findAlertByKey(key: string): Alert | undefined {
  for (const alert of store.alerts.values()) {
    if (buildSuppressionKey(alert) === key) return alert;
  }
  return undefined;
}

/**
 * Check if new severity is stricter than existing.
 */
function severityExceeded(oldSeverity: Severity, newSeverity: Severity): boolean {
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  const oldIndex = order.indexOf(oldSeverity);
  const newIndex = order.indexOf(newSeverity);
  return newIndex < oldIndex; // Strictly higher
}