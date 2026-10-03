// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { useAuth } from '@/lib/AuthContext';
import { useFormat } from '@/i18n/useFormat';
import { studioProjectPath } from '@/lib/studio/studioHost';

const SHOWN = 12;

/**
 * The visitor's Studio projects, newest first. Renders nothing until there is a
 * workspace to read from (signed out, or still choosing one). The list read is
 * the shared, client-cached `fetchProjects`, so returning home costs nothing.
 */
export function StudioRecentProjects() {
  const t = useTranslations('studio.home');
  const fmt = useFormat();
  const { hasTenant } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    if (!hasTenant) return undefined;
    let cancelled = false;
    fetchProjects()
      .then((all) => {
        if (cancelled) return;
        const studio = all
          .filter((project) => project.origin === 'studio')
          .sort((a, b) => Date.parse(b.updated_at ?? b.updatedAt ?? '') - Date.parse(a.updated_at ?? a.updatedAt ?? ''));
        setProjects(studio.slice(0, SHOWN));
      })
      .catch(() => { if (!cancelled) setProjects([]); });
    return () => { cancelled = true; };
  }, [hasTenant]);

  if (!hasTenant || projects === null) return null;

  return (
    <section aria-labelledby="studio-recent-title" style={{ display: 'grid', gap: 12 }}>
      <h2 id="studio-recent-title" className="ui-text-card-title" style={{ margin: 0 }}>{t('recentTitle')}</h2>
      {projects.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('recentEmpty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))' }}>
          {projects.map((project) => {
            const updated = project.updated_at ?? project.updatedAt;
            return (
              <li key={project.id}>
                <Link
                  href={studioProjectPath(project.id)}
                  style={{ display: 'grid', gap: 4, padding: 14, minHeight: 72, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', textDecoration: 'none' }}
                >
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
                  {updated && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{fmt.dateTime(updated)}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
