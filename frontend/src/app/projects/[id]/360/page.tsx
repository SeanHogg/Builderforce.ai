import { getTranslations } from 'next-intl/server';
import { ProjectAnalyticsPanel } from '@/components/project360/ProjectAnalyticsPanel';

export const runtime = 'edge';

/**
 * Project 360 / Analytics — the single consolidated Analytics surface
 * (PRD: consolidate Analytics with Diagnostics; the page stays "Analytics",
 * the diagnostics capabilities are retained on the same page).
 *
 * The page itself is a thin server shell: the id comes from route params, so
 * there is no reason to run it in the browser. The whole composition — health
 * pulse + insights, the five dimension bars, the diagnostics scoreboard, run
 * deltas, spend, and the full interactive health wheel — lives in the single
 * {@link ProjectAnalyticsPanel} client component, so every Analytics signal
 * renders from one place and the leaf components can't drift between surfaces.
 */
export default async function Project360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id)) {
    const t = await getTranslations('projectRedirect');
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>{t('invalidProject')}</div>;
  }
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-base)' }}>
      <ProjectAnalyticsPanel projectId={id} />
    </div>
  );
}
