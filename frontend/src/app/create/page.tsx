'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { DashboardCreationLauncher, DashboardCreationSessions } from '@/components/dashboard/DashboardCreationSessions';
import { PendingDraftsNotice } from '@/components/workspace/PendingDraftsNotice';

export const runtime = 'edge';

/**
 * The canvas library — everything this workspace has created, and the ways to
 * start something new.
 *
 * This route used to be `redirect('/dashboard')`, which meant the one navigation
 * item named after the work ("✦ Create") took people to a metrics page. Their
 * canvases did exist, but only inside a sub-tab of a dashboard panel positioned
 * ~1,160px down a pannable infinite board — off-screen, and reachable only by
 * panning. A returning user therefore had no findable route back to the thing
 * they came to continue.
 *
 * The launcher and the session list are the SAME components the dashboard tab
 * renders; this page composes them rather than growing a second copy that would
 * drift.
 */
export default function CanvasLibraryPage() {
  const t = useTranslations('canvasLibrary');
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login?next=/create');
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 'clamp(16px, 3vw, 28px)', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(1.4rem, 3vw, 1.9rem)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          {t('title')}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '62ch' }}>{t('subtitle')}</p>
      </header>

      {/* Account-less boards held in THIS browser that were never claimed — the
          library is the one place they are guaranteed to be visible. */}
      <PendingDraftsNotice />

      <DashboardCreationLauncher />
      <DashboardCreationSessions />
    </main>
  );
}
