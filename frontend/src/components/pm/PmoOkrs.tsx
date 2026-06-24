'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pmoApi, type PmoRollup as PmoRollupData, type PmoScopeKind } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, ProgressBar } from './pmShared';

/**
 * OKR lens — objectives + key results for the selected portfolio, initiative, or
 * workspace. Reads progress from the same /api/pmo/rollup the dashboard uses (one
 * source of truth for the OKR math) and writes through the key-results /
 * objectives tracker clients, reloading after each mutation. Manager-gated
 * server-side. Fully localized.
 */
const inputStyle: React.CSSProperties = {
  padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};
const btnStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
};
const ghostBtn: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
};

export function PmoOkrs({ scope }: { scope: { kind: PmoScopeKind; id: string } }) {
  const t = useTranslations('pmo');
  const { data, error, reload } = usePmData<PmoRollupData>(
    () => pmoApi.rollup(scope.kind, scope.id),
    [scope.kind, scope.id],
  );
  const [busy, setBusy] = useState(false);
  const [newObjective, setNewObjective] = useState('');
  const [newPeriod, setNewPeriod] = useState('');
  const [krDraft, setKrDraft] = useState<Record<string, { title: string; target: string }>>({});
  const [valueDraft, setValueDraft] = useState<Record<string, string>>({});

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reload(); } finally { setBusy(false); }
  };

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loadingOkrs')} />;

  const createObjective = () =>
    run(async () => {
      const attach =
        scope.kind === 'portfolio' ? { portfolioId: scope.id }
          : scope.kind === 'initiative' ? { initiativeId: scope.id }
            : {}; // workspace: org-level objective, attached to neither
      await pmoApi.objectives.create({
        title: newObjective.trim(),
        period: newPeriod.trim() || undefined,
        ...attach,
      });
      setNewObjective(''); setNewPeriod('');
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PmCard
        title={t('okr.newObjective')}
        action={
          <div style={{ display: 'flex', gap: 8, minWidth: 360 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder={t('okr.objectivePlaceholder')} value={newObjective} onChange={(e) => setNewObjective(e.target.value)} />
            <input style={{ ...inputStyle, width: 90 }} placeholder={t('okr.periodPlaceholder')} value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} />
            <button type="button" style={btnStyle} disabled={busy || !newObjective.trim()} onClick={createObjective}>{t('okr.add')}</button>
          </div>
        }
      >
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {t('okr.objectiveHint', { scope: t(`scopeWord.${scope.kind}`) })}
        </span>
      </PmCard>

      {data.okr.objectives.length === 0 && (
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('okr.noObjectives')}</span>
      )}

      {data.okr.objectives.map((o) => {
        const draft = krDraft[o.id] ?? { title: '', target: '' };
        return (
          <PmCard
            key={o.id}
            title={o.title}
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {o.period && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{o.period}</span>}
                <button type="button" style={ghostBtn} disabled={busy}
                  onClick={() => { if (window.confirm(t('structure.confirmDeleteObjective'))) run(() => pmoApi.objectives.remove(o.id)); }}>
                  {t('okr.deleteObjective')}
                </button>
              </div>
            }
          >
            <div style={{ marginBottom: 12 }}><ProgressBar value={o.progress} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {o.keyResults.map((kr) => (
                <div key={kr.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: '0.85rem' }}>
                    <span>{kr.title}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                      {kr.startValue} → {kr.targetValue}{kr.unit ? ` ${kr.unit}` : ''}
                    </span>
                  </div>
                  <ProgressBar value={kr.progress} />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number"
                      style={{ ...inputStyle, width: 110 }}
                      placeholder={t('okr.current')}
                      value={valueDraft[kr.id] ?? String(kr.currentValue)}
                      onChange={(e) => setValueDraft((s) => ({ ...s, [kr.id]: e.target.value }))}
                    />
                    <button type="button" style={ghostBtn} disabled={busy}
                      onClick={() => run(() => pmoApi.keyResults.update(kr.id, { currentValue: Number(valueDraft[kr.id] ?? kr.currentValue) }))}>
                      {t('okr.update')}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                placeholder={t('okr.newKeyResult')}
                value={draft.title}
                onChange={(e) => setKrDraft((s) => ({ ...s, [o.id]: { ...draft, title: e.target.value } }))}
              />
              <input
                type="number"
                style={{ ...inputStyle, width: 100 }}
                placeholder={t('okr.target')}
                value={draft.target}
                onChange={(e) => setKrDraft((s) => ({ ...s, [o.id]: { ...draft, target: e.target.value } }))}
              />
              <button
                type="button"
                style={btnStyle}
                disabled={busy || !draft.title.trim()}
                onClick={() => run(async () => {
                  await pmoApi.keyResults.create({
                    objectiveId: o.id,
                    title: draft.title.trim(),
                    targetValue: draft.target.trim() ? Number(draft.target) : 100,
                  });
                  setKrDraft((s) => ({ ...s, [o.id]: { title: '', target: '' } }));
                })}
              >
                {t('okr.addKr')}
              </button>
            </div>
          </PmCard>
        );
      })}
    </div>
  );
}
