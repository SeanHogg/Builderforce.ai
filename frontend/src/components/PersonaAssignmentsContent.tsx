'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  artifactAssignments,
  type ArtifactAssignment,
} from '@/lib/builderforceApi';
import { BUILTIN_PERSONAS, type Persona } from '@/lib/marketplaceData';

export interface PersonaAssignmentsContentProps {
  scope: 'tenant' | 'claw' | 'project' | 'task';
  scopeId: number;
  className?: string;
  style?: React.CSSProperties;
}

export function PersonaAssignmentsContent({ scope, scopeId, className, style }: PersonaAssignmentsContentProps) {
  const [assigned, setAssigned] = useState<ArtifactAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await artifactAssignments.list(scope, scopeId, 'persona').catch(() => []);
      setAssigned(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId]);

  useEffect(() => { load(); }, [load]);

  const assignedSlugs = new Set(assigned.map((a) => a.artifactSlug));

  const handleAssign = async (slug: string) => {
    setError(null);
    try {
      await artifactAssignments.assign('persona', slug, scope, scopeId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    }
  };

  const handleUnassign = async (slug: string) => {
    setError(null);
    try {
      await artifactAssignments.unassign('persona', slug, scope, scopeId);
      setAssigned((prev) => prev.filter((a) => a.artifactSlug !== slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unassign failed');
    }
  };

  const unassigned = BUILTIN_PERSONAS.filter(
    (p) => !assignedSlugs.has(p.name) && (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Personas ({assigned.length})</div>
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
          {showAdd ? 'Done' : '+ Assign Persona'}
        </button>
      </div>

      {error && <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : showAdd ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            placeholder="Search personas…"
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
          {unassigned.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>No additional personas to assign</div>
          ) : (
            unassigned.slice(0, 20).map((p) => (
              <div
                key={p.name}
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
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAssign(p.name)}
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
          No personas assigned. Click &quot;+ Assign Persona&quot; to add personas.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {assigned.map((a) => {
            const info: Persona | undefined = BUILTIN_PERSONAS.find((p) => p.name === a.artifactSlug);
            return (
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
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{info?.name ?? a.artifactSlug}</div>
                  {info?.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{info.description}</div>}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
