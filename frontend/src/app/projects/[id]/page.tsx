'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchProjects } from '@/lib/api';
import { creationSessionsApi } from '@/lib/builderforceApi';

export const runtime = 'edge';

/**
 * A Project opens as live context in the user's most recent Creation Session.
 * Administrative project lists/details remain available from /projects.
 */
export default function ProjectPageRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  useEffect(() => {
    if (!id) { router.replace('/projects'); return; }
    let active = true;
    void fetchProjects().then((projects) => {
      const project = projects.find((candidate) => String(candidate.id) === id || String(candidate.publicId ?? '') === id);
      if (!project) throw new Error('Project not found');
      return creationSessionsApi.openProject(project.id);
    }).then(({ sessionId, objectId }) => { if (active) router.replace(`/create/${sessionId}?focus=${objectId}`); })
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
      <p>Opening this project on your canvas…</p>
    </div>
  );
}
