/**
 * The `fixes` panel kind (PRD 33 §4.1 "View all" from Do next): every
 * prescription for the site and the home's filter, ranked by the API, with area
 * chips that narrow it and a page at a time (the API answers one bounded list;
 * it is paged here, client-side). Each row is THE fix card, compact; a row opens
 * the `fix` kind. The level id, when set, is the area to open on.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { REPLAY_PRESCRIPTION_AREAS, type ReplayPrescriptionArea } from '@builderforce/interaction-contract';
import { PrescriptionCard } from '@/components/replay/prescriptions/PrescriptionCard';
import { usePrescriptionsFor } from '@/components/replay/prescriptions/usePrescriptionsFor';
import { useInsightsScope } from '../insightsScope';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';

export const FIXES_PAGE_SIZE = 20;

const isArea = (value: string): value is ReplayPrescriptionArea => (REPLAY_PRESCRIPTION_AREAS as readonly string[]).includes(value);

export function FixesKind({ siteId, id, push }: InsightPanelKindProps) {
  const t = useTranslations('insights.fixes');
  const tRx = useTranslations('replay.prescription');
  const { filter } = useInsightsScope();
  const { items, loading, error } = usePrescriptionsFor({ siteId, filter });
  const [area, setArea] = useState<ReplayPrescriptionArea | null>(isArea(id) ? id : null);
  const [shown, setShown] = useState(FIXES_PAGE_SIZE);
  const counts = useMemo(() => {
    const out = new Map<ReplayPrescriptionArea, number>();
    for (const p of items) out.set(p.area, (out.get(p.area) ?? 0) + 1);
    return out;
  }, [items]);
  const visible = area ? items.filter((p) => p.area === area) : items;
  const chips: Array<{ id: ReplayPrescriptionArea | null; label: string }> = [
    { id: null, label: t('areaAll', { count: items.length }) },
    ...REPLAY_PRESCRIPTION_AREAS.filter((a) => counts.has(a)).map((a) => ({ id: a, label: t('areaChip', { area: tRx(`area.${a}`), count: counts.get(a) ?? 0 }) })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <div role="tablist" aria-label={t('areaAria')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {chips.map((chip) => (
          <button
            key={chip.id ?? 'all'}
            type="button"
            role="tab"
            aria-selected={area === chip.id}
            className={area === chip.id ? 'btn-secondary' : 'btn-ghost'}
            style={{ minHeight: 44 }}
            onClick={() => { setArea(chip.id); setShown(FIXES_PAGE_SIZE); }}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <PanelPending loading={loading && items.length === 0} error={error} />
      {!loading && !error && visible.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {visible.slice(0, shown).map((p) => (
          <li key={p.id}><PrescriptionCard compact siteId={siteId} prescription={p} push={push} /></li>
        ))}
      </ol>
      {visible.length > shown && (
        <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => setShown((n) => n + FIXES_PAGE_SIZE)}>
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
