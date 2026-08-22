import { getTranslations } from 'next-intl/server';
import { ProjectHealthPanel } from '@/components/project360/ProjectHealthPanel';
import { ProjectSpendWidget } from '@/components/project360/ProjectSpendWidget';

export const runtime = 'edge';

/**
 * Project 360 — the web surface for the whole-picture project health view. A child
 * route of `/projects/[id]` (the bare `/projects/[id]` still redirects into the IDE;
 * this deeper segment renders on its own).
 *
 * A server component: the id comes from route params, so the page itself has no
 * reason to run in the browser; the two panels below are the client leaves.
 */
export default async function Project360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id)) {
    const t = await getTranslations('projectRedirect');
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>{t('invalidProject')}</div>;
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
