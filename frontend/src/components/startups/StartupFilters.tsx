'use client';

/**
 * The directory's filters — a stage row a person can press, then the narrower
 * controls. Owns no fetching and no state: the parent holds the query and reacts
 * to `onChange`, the same contract BurnRateOS's `BusinessDirectoryFilterControls`
 * kept and the one that lets the marketing teaser reuse the grid without the bar.
 *
 * The stage chips are the vocabulary, iterated — a ninth stage is a row in the
 * contract package and appears here without an edit.
 */

import { useTranslations } from 'next-intl';
import {
  BUSINESS_STAGES,
  DIRECTORY_SORTS,
  FUNDING_STAGES,
  STARTUP_SECTORS,
  type DirectorySort,
} from '@builderforce/creation-canvas-contract';
import { Select } from '@/components/Select';
import type { DirectoryQuery } from '@/lib/startupDirectory';
import { useStartupLabels } from './useStartupLabels';
import { startupFilterChipActiveStyle, startupFilterChipStyle } from './startupStyles';

const controlStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 12px',
  fontSize: 'var(--font-size-small)',
  minHeight: 36,
};

export function StartupFilters({ query, onChange }: { query: DirectoryQuery; onChange: (next: DirectoryQuery) => void }) {
  const t = useTranslations('startups.filters');
  const labels = useStartupLabels();
  const stages = query.stages ?? [];

  const toggleStage = (stage: string) => {
    const next = stages.includes(stage) ? stages.filter((s) => s !== stage) : [...stages, stage];
    onChange({ ...query, stages: next, page: 1 });
  };

  const active = Boolean(stages.length || query.sectors?.length || query.businessStages?.length || query.seekingInvestment === true);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div role="group" aria-label={t('stageGroup')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FUNDING_STAGES.map((stage) => {
          const on = stages.includes(stage);
          return (
            <button key={stage} type="button" aria-pressed={on} style={on ? startupFilterChipActiveStyle : startupFilterChipStyle} onClick={() => toggleStage(stage)}>
              {labels.stage(stage)}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={query.seekingInvestment === true}
          style={query.seekingInvestment === true ? startupFilterChipActiveStyle : startupFilterChipStyle}
          onClick={() => onChange({ ...query, seekingInvestment: query.seekingInvestment === true ? null : true, page: 1 })}
        >
          {t('raising')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          aria-label={t('sector')}
          value={query.sectors?.[0] ?? ''}
          onChange={(e) => onChange({ ...query, sectors: e.target.value ? [e.target.value] : [], page: 1 })}
          style={controlStyle}
        >
          <option value="">{t('anySector')}</option>
          {STARTUP_SECTORS.map((sector) => <option key={sector} value={sector}>{labels.sector(sector)}</option>)}
        </Select>
        <Select
          aria-label={t('businessStage')}
          value={query.businessStages?.[0] ?? ''}
          onChange={(e) => onChange({ ...query, businessStages: e.target.value ? [e.target.value] : [], page: 1 })}
          style={controlStyle}
        >
          <option value="">{t('anyBusinessStage')}</option>
          {BUSINESS_STAGES.map((stage) => <option key={stage} value={stage}>{labels.businessStage(stage)}</option>)}
        </Select>
        <Select
          aria-label={t('sort')}
          value={query.sort ?? 'newest'}
          onChange={(e) => onChange({ ...query, sort: e.target.value as DirectorySort, page: 1 })}
          style={controlStyle}
        >
          {DIRECTORY_SORTS.map((sort) => <option key={sort} value={sort}>{labels.sort(sort)}</option>)}
        </Select>
        {active && (
          <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={() => onChange({ q: query.q, sort: query.sort, page: 1 })}>
            {t('clear')}
          </button>
        )}
      </div>
    </div>
  );
}
