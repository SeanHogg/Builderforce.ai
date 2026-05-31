'use client';

import { useEffect, useState } from 'react';
import { fetchProjects } from '@/lib/api';
import { PRDsContent } from '@/components/PRDsContent';
import type { Project } from '@/lib/types';

/**
 * PRDs & Specs embed surface. PRDsContent is project-scoped (needs projectId +
 * projectName), but an embed has no ambient project, so this resurfaces the
 * existing component behind a lightweight project picker. Auto-selects when the
 * tenant has exactly one project.
 */
export function EmbedPrdSurface() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((ps) => {
        if (cancelled) return;
        setProjects(ps);
        if (ps.length === 1) setSelectedId(ps[0].id);
      })
      .catch(() => !cancelled && setError('Could not load projects.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div style={{ color: '#64748b' }}>Loading projects…</div>;
  if (error) return <div role="alert" style={{ color: '#dc2626' }}>{error}</div>;
  if (projects.length === 0) {
    return <div style={{ color: '#64748b' }}>No projects yet — create one in BuilderForce to manage its PRDs &amp; specs.</div>;
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label htmlFor="embed-prd-project" style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)' }}>Project</label>
        <select
          id="embed-prd-project"
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          style={{
            fontSize: 13, padding: '4px 8px', borderRadius: 6,
            border: '1px solid var(--border-subtle, #e2e8f0)',
            background: 'var(--bg-base, #fff)', color: 'var(--text-primary, #0f172a)',
          }}
        >
          <option value="">Select a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {selected ? (
        <PRDsContent projectId={selected.id} projectName={selected.name} />
      ) : (
        <div style={{ color: '#64748b' }}>Select a project to view its PRDs &amp; specs.</div>
      )}
    </div>
  );
}
