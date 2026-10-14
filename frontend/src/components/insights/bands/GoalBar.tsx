/** Goal band (PRD 33 §4.1): which outcome the numbers below are read against. */

import { useTranslations } from 'next-intl';
import { INSIGHT_GOALS } from '../insightGoals';
import { useInsightsScope } from '../insightsScope';

export function GoalBar() {
  const t = useTranslations('insights');
  const { goal, setGoal } = useInsightsScope();
  return (
    <div role="group" aria-label={t('overview.goalLabel')} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-1)' }}>
      <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginRight: 'var(--space-1)' }}>{t('overview.goalLabel')}</span>
      {INSIGHT_GOALS.map((row) => (
        <button
          key={row.id}
          type="button"
          aria-pressed={goal === row.id}
          className={goal === row.id ? 'btn-secondary' : 'btn-ghost'}
          style={{ minHeight: 44 }}
          onClick={() => setGoal(row.id)}
        >
          {t(row.labelKey)}
        </button>
      ))}
    </div>
  );
}
