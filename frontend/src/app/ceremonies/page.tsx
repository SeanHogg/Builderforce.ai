'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import PageContainer from '@/components/PageContainer';
import { CeremonyStage, type CeremonyMode } from '@/components/ceremony/CeremonyStage';

/**
 * Ceremonies — the live standup / planning round-table, scoped to a project.
 * Pick a board, choose Standup or Planning, and gather the team (humans + agents)
 * around the table. Also available as a full-screen overlay from the Tasks board.
 */
export default function CeremoniesPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [mode, setMode] = useState<CeremonyMode>('standup');

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login?next=/ceremonies');
    else if (!hasTenant) router.replace('/tenants?next=/ceremonies');
  }, [isAuthenticated, hasTenant, router]);

  useEffect(() => {
    fetchProjects()
      .then((p) => {
        setProjects(p);
        setProjectId((cur) => cur ?? p[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <PageContainer style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Ceremonies</h1>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={String(p.id)}>{p.name}</option>
          ))}
        </select>
      </div>

      {projectId == null ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Select a project to start a ceremony.</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <CeremonyStage projectId={projectId} mode={mode} onModeChange={setMode} />
        </div>
      )}
    </PageContainer>
  );
}
