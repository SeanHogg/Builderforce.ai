'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  pmoApi,
  type PmoRollup as PmoRollupData,
  type PmoScopeKind,
  type Initiative,
  type SpineResult,
  type CostClass,
} from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { COST_CLASS_COLORS } from '@/lib/pm/costClass';
import { PmCard, PmEmpty, PmError, ProgressBar } from './pmShared';

/**
 * OKR lens — objectives + key results + lineage for the selected scope. Beyond
 * progress (read from the shared /api/pmo/rollup), an objective now carries a real
 * date span (so it draws on the unified Gantt), a CAPEX/OPEX class that flows down
 * its lineage, and explicit links to the initiatives / epics / tasks that deliver
 * it ("an OKR can have multiple Epics or a task"). Manager-gated server-side.
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
const classBtn = (active: boolean, color: string): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 7, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
  background: active ? color : 'transparent', color: active ? '#fff' : 'var(--text-secondary)',
});

/** Derive a 'YYYY-Qn' period label from an ISO/date string (for reporting/grouping). */
function periodFromDate(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
/** ISO timestamp → yyyy-mm-dd for <input type=date>. */
const toDateInput = (iso: string | null): string => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export function PmoOkrs({ scope }: { scope: { kind: PmoScopeKind; id: string } }) {
  const t = useTranslations('pmo');
  const { data, error, reload } = usePmData<PmoRollupData>(
    () => pmoApi.rollup(scope.kind, scope.id),
    [scope.kind, scope.id],
  );
  const { data: initiatives } = usePmData<Initiative[]>(() => pmoApi.initiatives.list(), []);
  const { data: spine } = usePmData<SpineResult>(() => pmoApi.spine(), []);

  const [busy, setBusy] = useState(false);
  const [newObjective, setNewObjective] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [krDraft, setKrDraft] = useState<Record<string, { title: string; target: string }>>({});
  const [valueDraft, setValueDraft] = useState<Record<string, string>>({});
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({}); // objectiveId -> "kind:refId"

  const epics = useMemo(() => (spine?.nodes ?? []).filter((n) => n.kind === 'epic'), [spine]);
  const looseTasks = useMemo(() => (spine?.nodes ?? []).filter((n) => n.kind === 'task'), [spine]);

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
            : {};
      await pmoApi.objectives.create({
        title: newObjective.trim(),
        startDate: newStart || undefined,
        endDate: newEnd || undefined,
        period: newStart ? periodFromDate(newStart) : undefined,
        ...attach,
      });
      setNewObjective(''); setNewStart(''); setNewEnd('');
    });

  const addLink = (objectiveId: string) =>
    run(async () => {
      const sel = linkDraft[objectiveId];
      if (!sel) return;
      const [kind, refId] = sel.split(':');
      if (kind === 'initiative') await pmoApi.objectives.addLink(objectiveId, { linkKind: 'initiative', initiativeId: refId });
      else await pmoApi.objectives.addLink(objectiveId, { linkKind: kind as 'epic' | 'task', taskId: Number(refId) });
      setLinkDraft((s) => ({ ...s, [objectiveId]: '' }));
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PmCard
        title={t('okr.newObjective')}
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <input style={{ ...inputStyle, minWidth: 200 }} placeholder={t('okr.objectivePlaceholder')} value={newObjective} onChange={(e) => setNewObjective(e.target.value)} />
            <input type="date" style={inputStyle} title={t('okr.startDate')} value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            <input type="date" style={inputStyle} title={t('okr.endDate')} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
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
        const setClass = (costClass: CostClass | null) => run(() => pmoApi.setCostClass('objective', o.id, costClass, 'manual'));
        const span = o.startDate || o.endDate
          ? `${toDateInput(o.startDate) || '…'} → ${toDateInput(o.endDate) || '…'}`
          : t('okr.noDates');
        return (
          <PmCard
            key={o.id}
            title={o.title}
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{span}</span>
                {o.period && <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{o.period}</span>}
                <button type="button" style={ghostBtn} disabled={busy}
                  onClick={() => { if (window.confirm(t('structure.confirmDeleteObjective'))) run(() => pmoApi.objectives.remove(o.id)); }}>
                  {t('okr.deleteObjective')}
                </button>
              </div>
            }
          >
            <div style={{ marginBottom: 12 }}><ProgressBar value={o.progress} /></div>

            {/* Date span + CAPEX/OPEX */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <input type="date" style={inputStyle} value={toDateInput(o.startDate)} disabled={busy}
                onChange={(e) => run(() => pmoApi.objectives.update(o.id, { startDate: e.target.value || null, period: e.target.value ? periodFromDate(e.target.value) : undefined }))} />
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <input type="date" style={inputStyle} value={toDateInput(o.endDate)} disabled={busy}
                onChange={(e) => run(() => pmoApi.objectives.update(o.id, { endDate: e.target.value || null }))} />
              <span style={{ marginLeft: 12, fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t('okr.costClass')}:</span>
              <button type="button" style={classBtn(o.costClass === 'capex', COST_CLASS_COLORS.capex)} disabled={busy} onClick={() => setClass('capex')}>{t('okr.capex')}</button>
              <button type="button" style={classBtn(o.costClass === 'opex', COST_CLASS_COLORS.opex)} disabled={busy} onClick={() => setClass('opex')}>{t('okr.opex')}</button>
              {o.costClass && <button type="button" style={classBtn(false, 'var(--text-muted)')} disabled={busy} onClick={() => setClass(null)}>{t('okr.unset')}</button>}
            </div>

            {/* Lineage links */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('okr.deliveredBy')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {o.links.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('okr.noLinks')}</span>}
                {o.links.map((l) => (
                  <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', fontSize: '0.74rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{t(`okr.linkKind.${l.kind}`)}</span>
                    {l.label}
                    <button type="button" disabled={busy} onClick={() => run(() => pmoApi.objectives.removeLink(o.id, l.id))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }} aria-label={t('okr.removeLink')}>✕</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <select style={{ ...inputStyle, minWidth: 220 }} value={linkDraft[o.id] ?? ''} onChange={(e) => setLinkDraft((s) => ({ ...s, [o.id]: e.target.value }))}>
                  <option value="">{t('okr.pickItem')}</option>
                  <optgroup label={t('okr.linkKind.initiative')}>
                    {(initiatives ?? []).map((i) => <option key={i.id} value={`initiative:${i.id}`}>{i.name}</option>)}
                  </optgroup>
                  <optgroup label={t('okr.linkKind.epic')}>
                    {epics.map((n) => <option key={n.key} value={`epic:${n.id}`}>{n.title}</option>)}
                  </optgroup>
                  <optgroup label={t('okr.linkKind.task')}>
                    {looseTasks.map((n) => <option key={n.key} value={`task:${n.id}`}>{n.title}</option>)}
                  </optgroup>
                </select>
                <button type="button" style={ghostBtn} disabled={busy || !linkDraft[o.id]} onClick={() => addLink(o.id)}>{t('okr.addLink')}</button>
              </div>
            </div>

            {/* Key results */}
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
