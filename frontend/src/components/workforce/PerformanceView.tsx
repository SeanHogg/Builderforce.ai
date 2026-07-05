'use client';

import { useTranslations } from 'next-intl';
import { WorkforceMetricsContent } from './WorkforceMetricsContent';
import { ContributorsView } from '@/components/contributors/ContributorsView';
import { AuditTrailPanel } from '@/components/contributors/AuditTrailPanel';

/**
 * Performance tab — the merged effectiveness/engagement scorecards (formerly the
 * Performance tab) and the whole-team contribution activity (formerly the
 * Contributors tab) on one surface. Two sub-sections under one tab so managers
 * read delivery quality and raw contribution volume side by side. Profile
 * consolidation moved to the Workforce directory, so this view is read-only
 * analytics.
 */
export function PerformanceView() {
  const t = useTranslations('workforce.performance');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <section>
        <WorkforceMetricsContent />
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-strong)', margin: '0 0 4px' }}>
          {t('activityTitle')}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>{t('activitySub')}</p>
        <ContributorsView />
      </section>

      <section>
        <AuditTrailPanel />
      </section>
    </div>
  );
}
