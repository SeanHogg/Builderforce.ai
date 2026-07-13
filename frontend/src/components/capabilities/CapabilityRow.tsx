'use client';

import type { Capability } from '@/types/capabilities';
import { StatusBadge } from '@/components/StatusBadge';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface CapabilityRowProps {
  capability: Capability;
  showLink?: boolean;
}

export function CapabilityRow({ capability, showLink = false }: CapabilityRowProps) {
  const healthColor =
    capability.healthScore >= 80 ? '#22c55e' : capability.healthScore >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1.2fr 120px 140px',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: '0.9rem',
        backgroundColor: 'var(--bg-base)',
      }}
    >
      <div
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={capability.name}
      >
        {showLink ? (
          <Link
            href={`/insights/capabilities/${capability.id}`}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {capability.name}
          </Link>
        ) : (
          capability.name
        )}
      </div>
      <StatusBadge status={capability.status} />
      <div
        style={{
          color: 'var(--text-secondary)',
          fontSize: '0.85rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {capability.categoryDisplay || capability.category}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '0.85rem',
        }}
      >
        <div
          style={{
            width: 60,
            height: 8,
            background: 'var(--border-subtle)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${capability.healthScore}%`,
              height: '100%',
              background: healthColor,
              borderRadius: 4,
            }}
          />
        </div>
        <span>{capability.healthScore}</span>
      </div>
      <div
        style={{
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
        }}
      >
        {formatDistanceToNow(new Date(capability.lastUpdated), {
          addSuffix: true,
        })}
      </div>
    </div>
  );
}