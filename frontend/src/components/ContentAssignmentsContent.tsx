'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  artifactAssignments,
  type ArtifactAssignment,
} from '@/lib/builderforceApi';
import { contentStorageKey } from '@/lib/marketplaceData';

export interface ContentAssignmentsContentProps {
  scope: 'tenant' | 'claw' | 'project' | 'task';
  scopeId: number;
  /** Tenant ID to look up localStorage content blocks for name resolution. */
  tenantId?: string;
  className?: string;
  style?: React.CSSProperties;
}

interface LocalBlock {
  id: string;
  title: string;
  type: string;
  status: string;
}

function loadLocalBlocks(tenantId: string): LocalBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(contentStorageKey(tenantId)) ?? '[]');
  } catch {
    return [];
  }
}

export function ContentAssignmentsContent({ scope, scopeId, tenantId, className, style }: ContentAssignmentsContentProps) {
  const [assigned, setAssigned] = useState<ArtifactAssignment[]>([]);
  const [localBlocks, setLocalBlocks] = useState<LocalBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await artifactAssignments.list(scope, scopeId, 'content').catch(() => []);
      setAssigned(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId]);

  useEffect(() => {
    if (tenantId) setLocalBlocks(loadLocalBlocks(tenantId));
    load();
  }, [load, tenantId]);

  const assignedSlugs = new Set(assigned.map((a) => a.artifactSlug));

  const handleAssign = async (slug: string) => {
    setError(null);
    try {
      await artifactAssignments.assign('content', slug, scope, scopeId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    }
  };

  const handleUnassign = async (slug: string) => {
    setError(null);
    try {
      await artifactAssignments.unassign('content', slug, scope, scopeId);
      setAssigned((prev) => prev.filter((a) => a.artifactSlug !== slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unassign failed');
    }
  };

  const unassignedBlocks = localBlocks.filter(
    (b) => !assignedSlugs.has(b.id) && (!search || b.title.toLowerCase().includes(search.toLowerCase())),
  );

  const resolveName = (slug: string): string => {
    const block = localBlocks.find((b) => b.id === slug);
    return block?.title ?? slug;
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Content ({assigned.length})</div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--coral-bright)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {showAdd ? 'Done' : '+ Assign Content'}
        </button>
      </div>

      {error && <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : showAdd ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            placeholder="Search content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '8px 10px',
              fontSize: 13,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-deep)',
              color: 'var(--text-primary)',
            }}
          />
          {unassignedBlocks.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>
              No content blocks available. Create content in the Content Manager first.
            </div>
          ) : (
            unassignedBlocks.slice(0, 20).map((b) => (
              <div
                key={b.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{b.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.type} &middot; {b.status}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAssign(b.id)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'var(--coral-bright)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Assign
                </button>
              </div>
            ))
          )}
        </div>
      ) : assigned.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
          No content assigned. Click &quot;+ Assign Content&quot; to add content blocks.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {assigned.map((a) => (
            <div
              key={a.artifactSlug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{resolveName(a.artifactSlug)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Assigned {new Date(a.assignedAt).toLocaleDateString()}</div>
              </div>
              <button
                type="button"
                onClick={() => handleUnassign(a.artifactSlug)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(239,68,68,0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
