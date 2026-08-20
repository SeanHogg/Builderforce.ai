'use client';

export const runtime = 'edge';

import { useParams } from 'next/navigation';
import { ProjectHealthPanel } from '@/components/project360/ProjectHealthPanel';
import { ProjectSpendWidget } from '@/components/project360/ProjectSpendWidget';

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
    <div style={{ minHeight: '100dvh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <ProjectHealthPanel projectId={id} />
      </div>
      {/* Cost belongs on the whole-picture view: "is this project healthy" and "what
          is it costing" are the same question asked twice, and the number was
          previously only reachable from an account-wide FinOps lens. */}
      <div style={{ padding: 16, flex: '0 0 auto' }}>
        <ProjectSpendWidget projectId={id} />
      </div>
    </div>
  );
}
