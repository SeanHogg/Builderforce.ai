'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { CeremonyStage, type CeremonyMode } from '@/components/ceremony/CeremonyStage';

/**
 * The live standup / planning round-table, scoped to a project. Extracted from
 * the old standalone /ceremonies page so it can render as the "Ceremonies" tab
 * of Projects (its conceptual home) — pick a board, then gather the team. The
 * page-level auth guard + container live in the Projects page that hosts it.
 */
export function CeremoniesContent() {
  const t = useTranslations('ceremonies');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [mode, setMode] = useState<CeremonyMode>('standup');

  useEffect(() => {
    fetchProjects()
      .then((p) => {
        setProjects(p);
        setProjectId((cur) => cur ?? p[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          aria-label={t('selectProject')}
          style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
        >
          {projects.length === 0 && <option value="">{t('noProjects')}</option>}
          {projects.map((p) => (
            <option key={p.id} value={String(p.id)}>{p.name}</option>
          ))}
        </select>
      </div>

      {projectId == null ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('selectProject')}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <CeremonyStage projectId={projectId} mode={mode} onModeChange={setMode} />
        </div>
      )}
    </div>
  );
}
