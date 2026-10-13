/**
 * The pieces of THE fix card (PRD 33 §5.1, D13) — presentational, no I/O:
 * the area chip, the finding's title (rendered from `replay.prescription.rule.
 * <ruleId>` over `finding.params`), the cited evidence, the drafted change as a
 * before → after, the impact range (no point estimate on low confidence) and
 * the measured verdict. `PrescriptionCard` composes them; nothing else does.
 */

import { useTranslations } from 'next-intl';
import type { ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import { useFormat } from '@/i18n/useFormat';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { fmtClock } from '../replayMarks';
import { draftedChange, impactView } from './prescriptionModel';
import type { InsightsLevelOpener } from './useInsightsLevel';

const small = { fontSize: 'var(--font-size-small)' } as const;
const muted = { color: 'var(--text-secondary)', ...small } as const;

export const VERDICT_TONE: Readonly<Record<string, string>> = {
  worked: 'var(--success)',
  worse: 'var(--error)',
  no_effect: 'var(--text-secondary)',
  measuring: 'var(--warning)',
  applied: 'var(--accent)',
  proposed: 'var(--accent)',
  dismissed: 'var(--text-secondary)',
};

export function AreaChip({ area }: { area: ReplayPrescriptionDto['area'] }) {
  const t = useTranslations('replay.prescription');
  return (
    <span
      data-area={area}
      style={{ ...small, padding: '0 var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
    >
      {t(`area.${area}`)}
    </span>
  );
}

export function StatusChip({ status }: { status: ReplayPrescriptionDto['status'] }) {
  const t = useTranslations('replay.prescription');
  return (
    <span data-status={status} style={{ ...small, fontWeight: 600, color: VERDICT_TONE[status] ?? 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
      {t(`status.${status}`)}
    </span>
  );
}

/** The finding in words: the rule's title over its params (an unknown rule falls back to its id). */
export function useFindingTitle(): (p: Pick<ReplayPrescriptionDto, 'ruleId' | 'finding'>, part?: 'title' | 'description') => string {
  const t = useTranslations('replay.prescription');
  return (p, part = 'title') => {
    const key = `rule.${p.ruleId}.${part}`;
    if (t.has(key)) return t(key, p.finding.params);
    return part === 'title' ? t('rule.fallback', { ruleId: p.ruleId }) : '';
  };
}

export function EvidenceLinks({ p, opener }: { p: ReplayPrescriptionDto; opener: InsightsLevelOpener }) {
  const t = useTranslations('replay.prescription');
  if (p.finding.evidence.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-1)' }}>
      <span style={muted}>{t('evidenceTitle')}</span>
      {p.finding.evidence.map((item, index) => {
        const seconds = Math.floor(item.atMs / 1000);
        const level: InsightPanelLevel = { kind: 'recording', id: item.recordingId, tab: 'replay', t: seconds };
        const label = t('evidenceItem', { n: index + 1, time: fmtClock(item.atMs) });
        const aria = t('evidenceAria', { n: index + 1, time: fmtClock(item.atMs) });
        const style = { minHeight: 44, display: 'inline-flex', alignItems: 'center' } as const;
        return opener.push ? (
          <button key={`${item.recordingId}:${item.atMs}`} type="button" className="btn-ghost" style={style} aria-label={aria} onClick={() => opener.push?.(level)}>
            {label}
          </button>
        ) : (
          <a key={`${item.recordingId}:${item.atMs}`} className="btn-ghost" style={style} aria-label={aria} href={opener.href(level)}>
            {label}
          </a>
        );
      })}
    </div>
  );
}

/** The drafted change as before → after: what visitors meet now, and what the fix changes. */
export function ChangeView({ p, before }: { p: ReplayPrescriptionDto; before: string }) {
  const t = useTranslations('replay.prescription');
  if (p.change == null) return null;
  const change = draftedChange(p.change);
  if (!change) return <p style={{ margin: 0, ...muted }}>{t('change.unknown')}</p>;
  const kindKey = `changeKind.${change.kind}`;
  const row = { display: 'grid', gridTemplateColumns: 'minmax(56px, auto) minmax(0, 1fr)', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)', overflowWrap: 'anywhere' } as const;
  return (
    <section aria-label={t('change.title')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'baseline' }}>
        <strong style={small}>{t('change.title')}</strong>
        {change.kind && t.has(kindKey) && <span style={muted}>{t(kindKey)}</span>}
        {change.target && <code style={{ ...small, overflowWrap: 'anywhere' }}>{t('change.target', { target: change.target })}</code>}
      </div>
      <div data-testid="prescription-diff" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', ...small }}>
        <div style={{ ...row, background: 'var(--surface)', color: 'var(--text-secondary)' }}>
          <span aria-hidden="true">−</span>
          <span><span className="sr-only">{t('change.before')}: </span>{before}</span>
        </div>
        <div style={{ ...row, borderTop: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          <span aria-hidden="true">+</span>
          <span><span className="sr-only">{t('change.after')}: </span>{change.description}</span>
        </div>
      </div>
    </section>
  );
}

/** "≈ +38 conversions in 30 days (22–51) · medium confidence" — never a point estimate on low confidence. */
export function ImpactLine({ impact }: { impact: ReplayPrescriptionDto['impact'] }) {
  const t = useTranslations('replay.prescription');
  const fmt = useFormat();
  const view = impactView(impact);
  const unitKey = `unit.${impact.unit}`;
  const unit = t.has(unitKey) ? t(unitKey) : impact.unit;
  const approx = impact.estimated ? 'Approx' : 'Exact';
  let text: string;
  if (view.kind === 'estimate') {
    text = view.low != null && view.high != null
      ? t(`impact.estimate${approx}`, { value: fmt.number(view.estimate), unit, days: impact.horizonDays, low: fmt.number(view.low), high: fmt.number(view.high) })
      : t(`impact.point${approx}`, { value: fmt.number(view.estimate), unit, days: impact.horizonDays });
  } else if (view.kind === 'range') {
    text = t(`impact.range${approx}`, { low: fmt.number(view.low), high: fmt.number(view.high), unit, days: impact.horizonDays });
  } else {
    text = t('impact.none');
  }
  return (
    <p data-testid="prescription-impact" data-confidence={impact.confidence} style={{ margin: 0, ...small }}>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{text}</span>
      {' · '}
      <span style={{ color: 'var(--text-secondary)' }}>{t(`confidence.${impact.confidence}`)}</span>
    </p>
  );
}

/** The measured verdict: before → after on the release that shipped the fix. */
export function MeasuredLine({ p }: { p: Pick<ReplayPrescriptionDto, 'measured' | 'status' | 'dismissReason'> }) {
  const t = useTranslations('replay.prescription');
  const fmt = useFormat();
  if (p.status === 'dismissed') {
    return <p style={{ margin: 0, ...muted, overflowWrap: 'anywhere' }}>{t('dismissedBecause', { reason: p.dismissReason ?? '' })}</p>;
  }
  const m = p.measured;
  if (!m) return null;
  const num = (value: number | null) => (value == null ? '—' : fmt.number(value, { maximumFractionDigits: 3 }));
  return (
    <p data-testid="prescription-measured" data-verdict={m.verdict} style={{ margin: 0, ...small, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
      <span style={{ fontWeight: 600, color: VERDICT_TONE[m.verdict] }}>{t(`verdict.${m.verdict}`)}</span>
      <span>{t('measured.beforeAfter', { before: num(m.before), after: num(m.after) })}</span>
      {m.releaseKey && <span style={{ color: 'var(--text-secondary)' }}>{t('measured.onRelease', { release: m.releaseKey.slice(0, 12) })}</span>}
      <span style={{ color: 'var(--text-secondary)' }}>{t(`measured.source.${m.source}`)}</span>
    </p>
  );
}
