'use client';

export const runtime = 'edge';

import { useParams } from 'next/navigation';
import { ProjectHealthPanel } from '@/components/project360/ProjectHealthPanel';

/**
 * Project 360 — the web surface for the whole-picture project health view. A child
 * route of `/projects/[id]` (the bare `/projects/[id]` still redirects into the IDE;
 * this deeper segment renders on its own). Reuses the shared <Project360View>.
 */
export default function Project360Page() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  if (!Number.isFinite(id)) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Invalid project.</div>;
  }
  return (
    <div style={{ height: '100dvh', background: 'var(--bg-base)' }}>
      <ProjectHealthPanel projectId={id} />
    </div>
  );
}
