'use client';

import { DeadlineStatus } from '@/lib/deadlines/client';

const HEALTH_COLORS: Record<DeadlineStatus, { bg: string; text: string; label: string }> = {
  on_track: { bg: 'var(--green-elevated)', text: 'var(--green-on-elevated)', label: 'On Track' },
  at_risk: { bg: '#ffc107', text: '#000', label: 'At Risk' },
  off_track: { bg: '#dc3545', text: '#fff', label: 'Off Track' },
  missed: { bg: 'var(--coral-bright)', text: '#fff', label: 'Missed' },
};

interface HealthBadgeProps {
  status: DeadlineStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  overrideActive?: boolean;
}

export function HealthBadge({ status, size = 'sm', showLabel = false, overrideActive }: HealthBadgeProps) {
  const colors = HEALTH_COLORS[status];
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses[size]}`}
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {overrideActive && <span className="mr-1.5">🛡️</span>}
      {showLabel ? colors.label : status.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
    </span>
  );
}

export { HEALTH_COLORS };