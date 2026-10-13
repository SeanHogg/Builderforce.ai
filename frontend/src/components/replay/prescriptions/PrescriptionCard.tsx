/**
 * THE fix card (PRD 33 §5.1, D13, §6 "one of each"): every surface that shows a
 * prescription renders this — Do next and the `fixes` list, the `fix` kind's
 * Change tab, the issue's Fix tab, and the inline entry points (the Overview's
 * top fixes, a funnel step's drop panel, the heatmap's insights, the player, the
 * proof scoreboard's "Why it missed").
 *
 * Full: area · rank · status, the finding (a rule's title over its params), the
 * cited recordings, the AI's prescription, the drafted change as before → after,
 * the impact range with its confidence, the measured verdict, and the actions
 * the DTO's `next` offers. Compact: the finding as before → after, the impact,
 * who makes it, and a link into the `fix` kind for the rest.
 *
 * The card keeps the answer of its own last action (`onChanged`) so it never
 * shows a stale `next`; lists read again on their own (`subscribePrescriptionChanges`).
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { draftedChange, makerOf } from './prescriptionModel';
import { PrescriptionActions } from './PrescriptionActions';
import { AreaChip, ChangeView, EvidenceLinks, ImpactLine, MeasuredLine, StatusChip, useFindingTitle } from './PrescriptionParts';
import { useInsightsLevel } from './useInsightsLevel';

export interface PrescriptionCardProps {
  siteId: string;
  prescription: ReplayPrescriptionDto;
  compact?: boolean;
  /** Push onto the panel; defaults to the panel in scope, else links to `/apps/insights`. */
  push?: (level: InsightPanelLevel) => void;
  onChanged?: (prescription: ReplayPrescriptionDto) => void;
}

export function fixLevel(prescriptionId: string, tab = 'change'): InsightPanelLevel {
  return { kind: 'fix', id: prescriptionId, tab };
}

export function PrescriptionCard({ siteId, prescription, compact = false, push, onChanged }: PrescriptionCardProps) {
  const t = useTranslations('replay.prescription');
  const findingText = useFindingTitle();
  const opener = useInsightsLevel(siteId, push);
  const [p, setP] = useState(prescription);
  useEffect(() => setP(prescription), [prescription]);
  const changed = (next: ReplayPrescriptionDto) => { setP(next); onChanged?.(next); };

  const title = findingText(p);
  const header = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
      <AreaChip area={p.area} />
      <span aria-label={t('rankAria', { rank: p.rank })} style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>#{p.rank}</span>
      {p.source === 'observed' && <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('observed')}</span>}
      <span style={{ marginLeft: 'auto' }}><StatusChip status={p.status} /></span>
    </div>
  );
  const shell = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    padding: compact ? 'var(--space-2)' : 'var(--space-3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-card)',
    color: 'var(--text-primary)',
    minWidth: 0,
  } as const;

  if (compact) {
    const change = draftedChange(p.change);
    const after = change?.description ?? p.prescription;
    const maker = makerOf(p);
    const makerKey = maker ? `maker.${maker}` : '';
    const level = fixLevel(p.id);
    const titleStyle = { fontWeight: 600, overflowWrap: 'anywhere', textAlign: 'left', color: 'var(--text-primary)' } as const;
    return (
      <article data-testid="prescription-card" data-compact="true" data-rule={p.ruleId} aria-label={title} style={shell}>
        {header}
        {opener.push ? (
          <button type="button" className="btn-ghost" style={{ ...titleStyle, minHeight: 44, padding: 0, justifyContent: 'flex-start' }} aria-label={t('openAria', { title })} onClick={() => opener.push?.(level)}>
            {title}
          </button>
        ) : (
          <a href={opener.href(level)} aria-label={t('openAria', { title })} style={{ ...titleStyle, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>{title}</a>
        )}
        {after && (
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>
            <span aria-hidden="true" style={{ color: 'var(--text-secondary)' }}>→ </span>
            <span className="sr-only">{t('change.after')}: </span>
            {after}
          </p>
        )}
        <ImpactLine impact={p.impact} />
        <MeasuredLine p={p} />
        {maker && t.has(makerKey) && <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t(makerKey)}</p>}
      </article>
    );
  }

  const description = findingText(p, 'description');
  return (
    <article data-testid="prescription-card" data-rule={p.ruleId} aria-label={title} style={shell}>
      {header}
      <h4 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', overflowWrap: 'anywhere' }}>{title}</h4>
      {description && <p style={{ margin: 0, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{description}</p>}
      <EvidenceLinks p={p} opener={opener} />
      <section aria-label={t('prescriptionTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('prescriptionTitle')}</strong>
        <p style={{ margin: 0, overflowWrap: 'anywhere', color: p.prescription ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {p.prescription ?? t('drafting')}
        </p>
      </section>
      <ChangeView p={p} before={title} />
      <ImpactLine impact={p.impact} />
      <MeasuredLine p={p} />
      <PrescriptionActions siteId={siteId} prescription={p} onChanged={changed} />
    </article>
  );
}
