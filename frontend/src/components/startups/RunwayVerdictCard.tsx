'use client';

/**
 * A runway verdict, rendered — months, net burn, the cash-out date and the
 * health band. The ONE presentation of `RunwayVerdict`, used by the marketing
 * calculator, the founder's finance step, the listing summary and the CFO's
 * runway view, so the same numbers never read four different ways.
 *
 * `provenance` names where the inputs came from and is rendered every time:
 * a runway computed from typed numbers must say so beside the figure, not in a
 * footnote (PRD 19 §9.7 rule 5).
 */

import { useTranslations } from 'next-intl';
import type { RunwayVerdict } from '@builderforce/creation-canvas-contract';
import { useFormat } from '@/i18n/useFormat';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { useStartupLabels } from './useStartupLabels';
import { runwayHealthTone } from './startupStyles';

export function RunwayVerdictCard({
  verdict,
  provenance,
  compact = false,
}: {
  verdict: RunwayVerdict | null;
  provenance: 'declared' | 'observed';
  compact?: boolean;
}) {
  const t = useTranslations('startups.runway');
  const labels = useStartupLabels();
  const fmt = useFormat();
  const { formatMoney } = useMoneyFormat();

  if (!verdict) {
    return (
      <div className="ui-surface ui-surface--pad-md" style={{ display: 'grid', gap: 6 }}>
        <span className="ui-eyebrow">{t('title')}</span>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('notDeclared')}</p>
      </div>
    );
  }

  const tone = runwayHealthTone[verdict.health];
  const months = verdict.runwayMonths;

  return (
    <div className="ui-surface ui-surface--pad-md" style={{ display: 'grid', gap: 8, borderLeft: `4px solid ${tone.ink}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className="ui-eyebrow">{t('title')}</span>
        <span className="ui-badge" style={{ color: tone.ink, background: tone.bg, borderColor: 'transparent' }}>{labels.health(verdict.health)}</span>
      </div>
      <div style={{ fontSize: compact ? 'var(--font-size-card-title)' : 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>
        {months === null ? t('unlimited') : t('months', { count: Math.round(months * 10) / 10 })}
      </div>
      {!compact && (
        <div style={{ display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
          <span>{t('netBurn', { amount: formatMoney({ amount: Math.max(0, verdict.netBurn), currency: 'USD' }, { compact: false }) })}</span>
          {verdict.zeroCashDate && <span>{t('zeroCash', { date: fmt.date(new Date(verdict.zeroCashDate)) })}</span>}
        </div>
      )}
      <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
        {provenance === 'declared' ? t('declaredNotice') : t('observedNotice')}
      </span>
    </div>
  );
}
