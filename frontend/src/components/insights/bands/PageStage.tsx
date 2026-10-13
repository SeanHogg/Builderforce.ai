/**
 * Page stage band (PRD 33 §4.1, 34% column): the route the selected issue
 * lives on, seen through one lens at a time. Lenses are `PAGE_STAGE_LENSES`.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useInsightsScope } from '../insightsScope';
import { PAGE_STAGE_LENSES } from './pageStageLenses';

export function PageStage() {
  const t = useTranslations('insights');
  const { siteId, route } = useInsightsScope();
  const [lensId, setLensId] = useState(PAGE_STAGE_LENSES[0]?.id ?? '');
  const lens = PAGE_STAGE_LENSES.find((row) => row.id === lensId) ?? PAGE_STAGE_LENSES[0];

  return (
    <section aria-labelledby="insights-stage-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minHeight: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h3 id="insights-stage-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)', overflowWrap: 'anywhere' }}>
          {route ?? t('overview.stageTitle')}
        </h3>
        <div role="tablist" aria-label={t('overview.lensesAria')} style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {PAGE_STAGE_LENSES.map((row) => (
            <button
              key={row.id}
              type="button"
              role="tab"
              aria-selected={row.id === lens?.id}
              className={row.id === lens?.id ? 'btn-secondary' : 'btn-ghost'}
              style={{ minHeight: 44 }}
              onClick={() => setLensId(row.id)}
            >
              {t(`lenses.${row.labelKey}`)}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" style={{ minHeight: 0, overflow: 'auto' }}>
        {route && lens ? (
          <lens.Component siteId={siteId} route={route} />
        ) : (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('overview.stageEmpty')}</p>
        )}
      </div>
    </section>
  );
}
