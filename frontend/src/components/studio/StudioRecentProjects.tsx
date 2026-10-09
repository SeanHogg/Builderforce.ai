// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fetchProjects } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { studioProjectPath } from '@/lib/studio/studioHost';
import { StudioCardList, type StudioCard } from './StudioCardList';

const SHOWN = 12;

/**
 * The visitor's DURABLE Studio projects — the ones the Studio IDE (`/studio/project/<id>`)
 * opens. "Build it" no longer makes these (it starts a canvas session; see `StudioApps`),
 * so this is the way back to projects made before, and renders nothing for someone who has
 * none: an empty "your projects will appear here" would promise a list nothing now fills.
 * The list read is the shared, client-cached `fetchProjects`.
 */
export function StudioRecentProjects() {
  const t = useTranslations('studio.home');
  const { hasTenant } = useAuth();
  const [cards, setCards] = useState<StudioCard[]>([]);

  useEffect(() => {
    if (!hasTenant) return undefined;
    let cancelled = false;
    fetchProjects()
      .then((all) => {
        if (cancelled) return;
        setCards(all
          .filter((project) => project.origin === 'studio')
          .map((project) => ({ key: String(project.id), href: studioProjectPath(project.id), title: project.name, updatedAt: project.updated_at ?? project.updatedAt ?? null }))
          .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))
          .slice(0, SHOWN));
      })
      .catch(() => { if (!cancelled) setCards([]); });
    return () => { cancelled = true; };
  }, [hasTenant]);

  return <StudioCardList id="studio-recent-title" title={t('recentTitle')} cards={hasTenant ? cards : []} />;
}
