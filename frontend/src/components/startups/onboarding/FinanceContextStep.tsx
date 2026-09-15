'use client';

/**
 * Step 2 — your startup's numbers. Cash on hand, monthly spend, team cost and
 * monthly revenue, with the runway computed as you type by the ONE calculator.
 * Declared inputs, and the card says so.
 */

import { useTranslations } from 'next-intl';
import { RunwayCalculator, type RunwayInputs } from '../RunwayCalculator';

export function FinanceContextStep({ value, onChange }: { value: RunwayInputs; onChange: (next: RunwayInputs) => void }) {
  const t = useTranslations('investor.listing.finance');
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{t('title')}</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('blurb')}</p>
      </div>
      <RunwayCalculator value={value} onChange={onChange} withTeamCost idPrefix="lst-fin" />
      <p style={{ margin: 0, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('privacy')}</p>
    </div>
  );
}
