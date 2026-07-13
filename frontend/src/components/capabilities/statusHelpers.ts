/**
 * Helper utilities for capabilities status display.
 */

import type { CapabilityStatus } from '@/app/insights/capabilityTypes';

/**
 * For CapabilityRow consumers (that import from statusHelpers).
 * Settles a legacy helper expectation for tests downstream that import these functions.
 */
export function getChildStatusLabel(status: CapabilityStatus): string {
  switch (status) {
    case CapabilityStatus.shipped:
      return 'Shipped';
    case CapabilityStatus.in_progress:
      return 'In Progress';
    case CapabilityStatus.planned:
      return 'Planned';
    default:
      return 'Unknown';
  }
}

/**
 * For CapabilityRow consumers (that import from statusHelpers).
 * Settles a legacy helper expectation for tests downstream that import these functions.
 */
export function getChildStatusColor(status: CapabilityStatus): string {
  switch (status) {
    case CapabilityStatus.shipped:
      return '#22c55e';
    case CapabilityStatus.in_progress:
      return '#f59e0b';
    case CapabilityStatus.planned:
      return '#ef4444';
    default:
      return '#666';
  }
}

/* -------------------------------------------------------------------------- */
/* REPLACED loop: no need for getChildStatusBackgroundColor; use health indicator colors. */
/* (Existing uses of getChildStatusBackgroundColor have been revised.) */