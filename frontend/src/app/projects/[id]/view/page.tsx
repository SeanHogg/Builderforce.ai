'use client';

import { useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { statusBadgeStyle, formattedLastUpdated } from '@/components/statusHelpers';
import { CapabilityRollup } from '@/types/capabilities';
import { CapabilityRow } from '@/components/capabilities/CapabilityRow';

/**
 * Projects > Capabilities view (/projects/:id/view).
 * - Uses /insights/capabilities as the underpinning dashboard.
 * - Exposes tabbed sections to Notes and Resources; currently global Capabilities is not exposed here.
 */
export default function ProjectViewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params?.id);
  const [scope, setScope] = useState<'overview' | 'notes' | 'resources'>('overview');

  if (isNaN(id) || id <= 0) {
    router.replace('/projects?tab=projects');
    return null;
  }

  return (
    <div style={{ padding: 'var(--gap)', maxWidth: 'var(--max-content-width)', margin: '0 auto' }}>
      {/* Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Link href="/projects?tab=projects" style={{ color: 'var(--text-secondary)' }}>
          Projects
        </Link>
        <span style={{ color: 'var(--text-muted)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>Project {id}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Project {id}</h1>
      </div>

      {/* Tabbed layout */}
      <div style={{ display: 'flex', gap: 'var(--gap)', marginBottom: 'var(--gap)', flexWrap: 'wrap' }}>
        {(['overview', 'notes', 'resources'] as const).map((btn) => (
          <button
            key={btn}
            type="button"
            onClick={() => setScope(btn)}
            style={{
              padding: 'var(--gap) var(--gap-lg)',
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              transition: 'background 0.2s',
            }}
            data-tab={btn}
            aria-selected={scope === btn}
          >
            {btn.charAt(0).toUpperCase() + btn.slice(1)}
          </button>
        ))}
      </div>

      {scope === 'overview' && (
        <div style={{ background: 'var(--bg-base)' }}>
          {/* TODO: Provide an overview tab with scope-/entity-aware widgets + Notes / Resources */}
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 12 }}>
            Overview tab — upcoming: scope-/entity-aware widgets + Notes + Resources.
          </p>
        </div>
      )}

      {scope === 'notes' && (
        <div style={{ background: 'var(--bg-base)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 12 }}>
            Notes tab — upcoming: per-project notes grid.
          </p>
        </div>
      )}

      {scope === 'resources' && (
        <div style={{ background: 'var(--bg-base)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 12 }}>
            Resources tab — upcoming: per-entity resource attachments.
          </p>
        </div>
      )}
    </div>
  );
}