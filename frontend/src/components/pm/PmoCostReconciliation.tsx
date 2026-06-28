'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { pmoApi, type CostClass, type SpineNode, type SpineResult } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { COST_CLASS_COLORS, formatUsd } from '@/lib/pm/costClass';
import { PmCard, PmEmpty, PmError } from './pmShared';

/**
 * CAPEX/OPEX reconciliation stage (0225) — the PM verification step. Each work
 * item shows its EFFECTIVE class (inherited from its objective/initiative unless
 * overridden), an agent suggestion, and any anomaly (a child whose declared class
 * contradicts its parent). PMs verify or recategorise here; the agent can
 * pre-classify everything unverified in one click. Reads /api/pmo/spine — the
 * same source as the Gantt, so the books and the timeline never disagree.
 */
const chip = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem',
  fontWeight: 700, color: '#fff', background: color, whiteSpace: 'nowrap',
});
const btn = (active: boolean, color: string): React.CSSProperties => ({
  padding: '4px 9px', borderRadius: 7, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
  background: active ? color : 'transparent', color: active ? '#fff' : 'var(--text-secondary)',
});
const primaryBtn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
};

const KIND_ICON: Record<SpineNode['kind'], string> = {
  portfolio: '📁', objective: '🎯', initiative: '🚩', epic: '🧩', task: '▫️', roadmap: '📍',
};

export function PmoCostReconciliation() {
  const t = useTranslations('reconcile');
  const { data, error, reload } = usePmData<SpineResult>(() => pmoApi.spine(), []);
  const [busy, setBusy] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(true);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); } finally { setBusy(false); }
  };

  // Keep tree order (parents before children) for a readable, indented list.
  const ordered = useMemo(() => {
    const byParent = new Map<string | null, SpineNode[]>();
    const present = new Set((data?.nodes ?? []).map((n) => n.key));
    for (const n of data?.nodes ?? []) {
      const parent = n.parentKey && present.has(n.parentKey) ? n.parentKey : null;
      (byParent.get(parent) ?? byParent.set(parent, []).get(parent)!).push(n);
    }
    const out: SpineNode[] = [];
    const walk = (n: SpineNode) => { out.push(n); for (const c of byParent.get(n.key) ?? []) walk(c); };
    for (const r of byParent.get(null) ?? []) walk(r);
    // Roadmap items aren't capitalizable work — exclude from CAPEX/OPEX reconcile.
    return out.filter((n) => n.kind !== 'roadmap');
  }, [data]);

  const needsAttention = (n: SpineNode) =>
    n.anomaly || ((n.kind === 'task' || n.kind === 'epic') && !n.costClassVerified) || n.effectiveCostClass == null;

  const rows = attentionOnly ? ordered.filter(needsAttention) : ordered;

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const setClass = (n: SpineNode, costClass: CostClass | null) =>
    run(() => pmoApi.setCostClass(n.kind, n.id, costClass, 'manual'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PmCard
        title={t('title')}
        action={
          <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}
            onClick={() => run(() => pmoApi.classifyCostClasses(true))}>
            {t('classifyAgent')}
          </button>
        }
      >
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <span>{t('summaryAnomalies', { count: data.anomalyCount })}</span>
          <span>{t('summaryUnverified', { count: data.unverifiedCount })}</span>
          <span>{t('capex')}: {formatUsd(data.totals.capexUsd)}</span>
          <span>{t('opex')}: {formatUsd(data.totals.opexUsd)}</span>
          <label style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
            {t('attentionOnly')}
          </label>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>{t('hint')}</p>
      </PmCard>

      {rows.length === 0 ? (
        <PmEmpty message={t('allClear')} />
      ) : (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
          {rows.map((n) => {
            const cls = n.effectiveCostClass;
            const inheritedConflict = n.anomaly;
            return (
              <div key={n.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 240, flex: 1, paddingLeft: n.depth * 14, overflow: 'hidden' }}>
                  <span style={{ fontSize: '0.72rem' }} title={t(`kind.${n.kind}`)}>{KIND_ICON[n.kind]}</span>
                  <span title={n.title} style={{ fontSize: '0.82rem', fontWeight: n.kind === 'task' ? 400 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                  {inheritedConflict && <span style={{ color: 'var(--coral-bright)', fontWeight: 700 }} title={t('anomalyTip', { declared: t(n.declaredCostClass ?? 'unclassified'), inherited: t(n.inheritedCostClass ?? 'unclassified') })}>⚠</span>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
                  {cls ? <span style={chip(COST_CLASS_COLORS[cls])}>{t(cls)}</span> : <span style={{ ...chip('var(--text-muted)'), background: 'transparent', color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)' }}>{t('unclassified')}</span>}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t(`source.${n.costClassSource}`)}</span>
                  {(n.kind === 'task' || n.kind === 'epic') && n.costClassVerified && <span title={t('verified')} style={{ color: '#16a34a' }}>✓</span>}
                </div>

                {n.cost.totalUsd > 0 && (
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>{formatUsd(n.cost.totalUsd)}</span>
                )}

                {n.suggestion && !n.costClassVerified && n.costClassSource !== 'manual' && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} title={n.suggestion.rationale}>
                    {t('suggests', { class: t(n.suggestion.costClass) })}
                  </span>
                )}

                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" disabled={busy} style={btn(n.declaredCostClass === 'capex', COST_CLASS_COLORS.capex)} onClick={() => setClass(n, 'capex')}>{t('capex')}</button>
                  <button type="button" disabled={busy} style={btn(n.declaredCostClass === 'opex', COST_CLASS_COLORS.opex)} onClick={() => setClass(n, 'opex')}>{t('opex')}</button>
                  {n.declaredCostClass && (
                    <button type="button" disabled={busy} style={btn(false, 'var(--text-muted)')} onClick={() => setClass(n, null)} title={t('clearTip')}>✕</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
