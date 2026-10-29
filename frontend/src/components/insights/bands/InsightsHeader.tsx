/**
 * Header band (PRD 33 §4.1): title, the filter-bar slot, the window, the
 * release to compare, and the way into Live.
 *
 * `HEADER_SLOTS` holds the query bar (`ReplayFilterSlot`: `ReplayFilterBar` +
 * saved segments, S4c) and the proof chip (S4d), which draws itself only while
 * the site's project has a live proof — a row each, not an edit to this layout.
 */

import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import { replayApi, REPLAY_WINDOWS, type ReplayWindow } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { ReplayFilterSlot } from '@/components/replay/filter/ReplayFilterSlot';
import { ProofChip } from './ProofChip';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';

export const HEADER_SLOTS: ReadonlyArray<{ id: string; Component: ComponentType }> = [
  { id: 'filter', Component: ReplayFilterSlot },
  { id: 'proof', Component: ProofChip },
];

export function InsightsHeader() {
  const t = useTranslations('insights.overview');
  const { siteId, days, setDays, compare, setCompare } = useInsightsScope();
  const { push } = usePanel();
  const { data: releases } = useAdminData(() => replayApi.listReleases(siteId), [siteId]);

  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-section)', color: 'var(--text-primary)' }}>{t('title')}</h2>
      <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {HEADER_SLOTS.map(({ id, Component }) => <Component key={id} />)}
      </div>
      <div role="group" aria-label={t('periodLabel')} style={{ display: 'flex', gap: 'var(--space-1)' }}>
        {REPLAY_WINDOWS.map((span: ReplayWindow) => (
          <button
            key={span}
            type="button"
            className={span === days ? 'btn-secondary' : 'btn-ghost'}
            aria-pressed={span === days}
            aria-label={t('windowAria', { days: span })}
            style={{ minHeight: 44 }}
            onClick={() => setDays(span)}
          >
            {t('window', { days: span })}
          </button>
        ))}
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        <span>{t('compare')}</span>
        <select
          className="input"
          value={compare ?? ''}
          onChange={(event) => setCompare(event.currentTarget.value || null)}
          style={{ minHeight: 44, maxWidth: 200 }}
        >
          <option value="">{t('compareNone')}</option>
          {(releases ?? []).map((release) => (
            <option key={release.releaseKey} value={release.releaseKey}>
              {release.label ?? t('releaseOrdinal', { n: release.ordinal })}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => push({ kind: 'live', id: '' })}>
        {t('live')}
      </button>
    </header>
  );
}
