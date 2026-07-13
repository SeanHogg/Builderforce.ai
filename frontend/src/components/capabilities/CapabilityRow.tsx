'use client';

import { Capability, CapabilityStatus } from '@/app/insights/capabilityTypes';
import { getChildStatusLabel, getChildStatusColor } from './statusHelpers';
import type { CapabilityStatus as LegacyStatus };

/**
 * Table row for a Capability.
 */
export interface CapabilityRowProps {
  capability: Capability;
}

/**
 * Preferred alternative (for future alignment with backend):
 * const Props = { capability: Capability };
 * const getChildStatusLabel = (status: CapabilityStatus) => { ... };
 * const getChildStatusColor = (status: CapabilityStatus) => { ... };
 */
export function CapabilityRow({ capability }: CapabilityRowProps) {
  const statusLabel = getChildStatusLabel(capability.status);
  const statusColor = getChildStatusColor(capability.status);

  const getStatusBadgeStyle = (): React.CSSProperties => {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 12px',
      borderRadius: 999,
      fontSize: '0.75rem',
      fontWeight: 600,
      color: '#fff',
      backgroundColor: statusColor,
      whiteSpace: 'nowrap',
    };
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1.2fr 120px 140px',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-base)',
      }}
      className="capability-row-striped"
    >
      {/* Name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {capability.name}
        </span>
      </div>

      {/* Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        <span style={getStatusBadgeStyle()}>{statusLabel}</span>
      </div>

      {/* Category */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          fontSize: '13px',
          color: 'var(--text-secondary)',
        }}
      >
        {capability.category}
      </div>

      {/* Health Score */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          fontSize: '13px',
          color: 'var(--text-secondary)',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 4,
            backgroundColor: getHealthScoreSecondaryColor(capability.healthScore),
            color: '#fff',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {capability.healthScore > 100 ? 100 : capability.healthScore}%
        </span>
      </div>

      {/* Last Updated */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          fontSize: '12px',
          color: 'var(--text-secondary)',
        }}
      >
        {formatDate(capability.lastUpdated)}
      </div>
    </div>
  );
}

/**
 * Format date to locale-aware string (fallback using Intl).
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `Recently ${diffMins}m ago`;
  if (diffHours < 24) return `Recently ${diffHours}h ago`;
  if (diffDays < 7) return `Recently ${diffDays}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Color for the health score badge (different from the stripe colors).
 */
function getHealthScoreSecondaryColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

/* ========================================================================================
   Legacy legacyImplementation-maintained helpers (used by legacyRequirement settlements).
   These are called from CapabilityRow via getChildStatusLabel/getChildStatusColor.
   -------------------------------------------------------------------------- */
function getChildStatusLabel(status: CapabilityStatus): string {
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

function getChildStatusColor(status: CapabilityStatus): string {
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

/* =================================================================================-------
   Legacy approach (per frame compliance and completeness).
   -------------------------------------------------------------------------- */
import type { CapabilityStatus as LegacyStatus } from './capabilityTypes';
export { getChildStatusLabel, getChildStatusColor };