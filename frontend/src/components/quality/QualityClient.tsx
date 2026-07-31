'use client';

import { useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { feedbackApi, type FeedbackStatus, type FeedbackSubmission } from '@/lib/feedbackApi';
import { FeedbackTriage } from '@/components/feedback/FeedbackTriage';
import { FeedbackCollectorManager } from '@/components/feedback/FeedbackCollectorManager';
import { QualityDashboard } from './QualityDashboard';
import { QualityCollectorsManager } from './QualityCollectorsManager';

/**
 * Quality surface shell — owns the auth guard, header, and tab routing (the shell
 * tab bar is rendered globally from navGroups; here we read `?tab=` to pick the
 * body). The page body is gated by <RoleGate quality.view> (disable, never hide).
 *
 * Two collector pillars live here: `collectors` gathers machine ERRORS, and
 * `feedback` gathers human REQUESTS. Both are snippets embedded in an
 * application; they differ in what they collect and where it lands.
 */
export default function QualityClient() {
  const t = useTranslations('quality');
  const tFeedback = useTranslations('feedback');
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const tab = useSearchParams().get('tab') ?? '';

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  const isSetup = tab === 'collectors';
  const isFeedback = tab === 'feedback';

  let heading = t('title');
  let subheading = t('subtitle');
  let body = <QualityDashboard />;
  if (isFeedback) {
    heading = tFeedback('page.title');
    subheading = tFeedback('page.subtitle');
    body = <FeedbackPanelBody />;
  } else if (isSetup) {
    heading = t('setup.title');
    subheading = t('setup.subtitle');
    body = <QualityCollectorsManager />;
  }

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{heading}</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{subheading}</p>
      </div>
      <RoleGate capability="quality.view" variant="block">
        {body}
      </RoleGate>
    </PageContainer>
  );
}

/** The feedback tab body: the project's snippet setup above its triage queue. */
function FeedbackPanelBody() {
  const { currentProjectId } = useProjectScope();

  const load = useCallback(
    (status: FeedbackStatus | null) => feedbackApi.queue({ projectId: currentProjectId, status }),
    [currentProjectId],
  );
  const review = useCallback(
    (submission: FeedbackSubmission, decision: 'approved' | 'declined') =>
      feedbackApi.review(submission.id, decision),
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <FeedbackCollectorManager />
      <FeedbackTriage load={load} review={review} refreshKey={currentProjectId} />
    </div>
  );
}
