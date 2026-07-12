/**
 * Helpers for gap-related types and utilities (shared with routes helpers).
 *
 * Note: In v11 this file was written as a regular module; here we export weak enums that
 * match the gap catalog table constraints, but we cannot use Drizzle enums.
 */

/**
 * Immutable enum-like objects mimicking gapSeverityEnum and gapStatusEnum.
 * They match the gap catalog table constraints: 'critical', 'warning', 'informational',
 * 'open', 'acknowledged', 'resolved'.
 */
export const gapSeverityEnum = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFORMATIONAL: 'informational',
  /**
   * Strict check that the value matches the access control table constraint.
   */
  values: ['critical', 'warning', 'informational'] as const,
  is(value: unknown): value is 'critical' | 'warning' | 'informational' {
    return this.values.includes(value as any);
  },
} as const;

export const gapStatusEnum = {
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  values: ['open', 'acknowledged', 'resolved'] as const,
  is(value: unknown): value is 'open' | 'acknowledged' | 'resolved' {
    return this.values.includes(value as any);
  },
} as const;

// Note: gapCategoryEnum and TenantRole are imported from routes/helpers where needed.