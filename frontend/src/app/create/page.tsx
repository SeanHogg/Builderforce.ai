'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { DashboardCreationLauncher, DashboardCreationSessions } from '@/components/dashboard/DashboardCreationSessions';
import { PendingDraftsNotice } from '@/components/workspace/PendingDraftsNotice';
import { startGuestCreationSession } from '@/lib/guestPromptCapture';
import { Button } from '@/components/ui';
import styles from './CreateLibrary.module.css';

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
 *
 * SIGNED OUT, it still renders. It used to bounce to `/login`, which made the
 * library the one place a guest's own boards were guaranteed NOT to be visible —
 * the exact opposite of what the notice below is for. What a guest has is local
 * drafts and a way to start another; the workspace library needs a workspace, so
 * that half is simply absent rather than teased.
 */
export default function CanvasLibraryPage() {
  const t = useTranslations('canvasLibrary');
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [creating, setCreating] = useState(false);

  const newLocalCanvas = useCallback(() => {
    setCreating(true);
    router.push(`/create/${startGuestCreationSession('', { surface: 'brain' })}`);
  }, [router]);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 'clamp(16px, 3vw, 28px)', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
      {!isAuthenticated && (
        <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '62ch' }}>
            {t('signedOutSubtitle')}
          </p>
        </header>
      )}

      {/* Account-less boards held in THIS browser that were never claimed — the
          library is the one place they are guaranteed to be visible. */}
      <PendingDraftsNotice />

      {isAuthenticated ? (
        <div className={styles.layout}>
          <div className={styles.creationsColumn}>
            <DashboardCreationSessions />
          </div>
          <aside className={styles.launcherColumn}>
            <DashboardCreationLauncher />
          </aside>
        </div>
      ) : (
        <div style={{ display: 'flex' }}>
          <Button variant="primary" loading={creating} onClick={newLocalCanvas}>
            {t('startLocalCanvas')}
          </Button>
        </div>
      )}
    </main>
  );
}
