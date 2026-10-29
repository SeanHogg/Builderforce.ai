'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fetchProjects } from '@/lib/api';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { openedBoardHref } from '@/lib/openedBoardHref';
import { KNOWLEDGE_INTENT_PARAMS } from '@builderforce/agent-tools/prefetch';

/**
 * A Project opens as live context in the user's most recent Creation Session.
 * The id arrives from the server page's route params, so this leaf does not need
 * `useParams()` — it only needs the browser for the authenticated lookup.
 */
export function ProjectCanvasRedirect({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations('projectRedirect');

  useEffect(() => {
    if (!id) { router.replace('/projects'); return; }
    let active = true;
    void fetchProjects().then((projects) => {
      const project = projects.find((candidate) => String(candidate.id) === id || String(candidate.publicId ?? '') === id);
      if (!project) throw new Error('Project not found');
      return creationSessionsApi.openProject(project.id);
    }).then((opened) => {
      // A link may name the surface to land on (`?surface=knowledge` — an on-prem run's
      // "show me the graph", a chat's knowledge chip — with what it opens on); the board
      // validates it (`CreationSessionClient`).
      const query = new URLSearchParams(window.location.search);
      const intent = Object.fromEntries(KNOWLEDGE_INTENT_PARAMS.map((key) => [key, query.get(key)]));
      if (active) router.replace(openedBoardHref(opened, { surface: query.get('surface'), ...intent }));
    })
      .catch(() => { if (active) router.replace('/projects'); });
    return () => { active = false; };
  }, [id, router]);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-secondary)',
        gap: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ fontSize: '2.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}><Icon source="⚡" size="1em" /></div>
      <p>{t('opening')}</p>
    </div>
  );
}
