'use client';

/**
 * The résumé workbench — the ONE client boundary the career-AI surface spends.
 *
 * Everything under `components/career/` is imported from here and carries no directive of
 * its own: a module imported by a client module is client code either way, and adding the
 * directive would change nothing except the frontend-architecture count. The route root
 * (`page.tsx`) stays a Server Component and reads its heading through `getTranslations`,
 * so this feature costs one client file and zero client-rooted pages — the shape that
 * ratchet's changelog has accepted every time it was argued.
 *
 * The tab is the only state held here. Each panel owns its own input and its own request,
 * because the four are genuinely independent questions and sharing a résumé buffer
 * between them would mean the merge tool silently inheriting the grader's text.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Surface } from '@/components/ui';
import { GradePanel } from '@/components/career/GradePanel';
import { MergeBulletsPanel } from '@/components/career/MergeBulletsPanel';
import { ResumeReviewNote } from '@/components/career/careerAiIntro';
import { ReviewQueuePanel } from '@/components/career/ReviewQueuePanel';
import { RewriteBulletsPanel } from '@/components/career/RewriteBulletsPanel';

const TABS = ['rewrite', 'merge', 'grade', 'reviews'] as const;
type Tab = (typeof TABS)[number];

export default function CareerAiClient() {
  const t = useTranslations('careerAi');
  const [tab, setTab] = useState<Tab>('rewrite');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div role="tablist" aria-label={t('title')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((candidate) => (
          <Button
            key={candidate}
            role="tab"
            aria-selected={tab === candidate}
            variant={tab === candidate ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTab(candidate)}
          >
            {t(`tab.${candidate}`)}
          </Button>
        ))}
      </div>

      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', maxWidth: '70ch' }}>
        {t(`tabLede.${tab}`)}
      </p>

      <Surface tone="panel" padding="lg">
        {tab === 'rewrite' && <RewriteBulletsPanel />}
        {tab === 'merge' && <MergeBulletsPanel />}
        {tab === 'grade' && <GradePanel />}
        {tab === 'reviews' && <ReviewQueuePanel />}
      </Surface>

      <ResumeReviewNote />
    </div>
  );
}
