'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import {
  pmoApi,
  type ObjectiveProgress,
  type PmoTree,
  type SpineResult,
  type CostClass,
} from '@/lib/builderforceApi';
import { COST_CLASS_COLORS } from '@/lib/pm/costClass';
import { PmCard, ProgressBar } from './pmShared';
import { useConfirm } from '@/components/ConfirmProvider';

/**
 * One objective's full editor — owner (portfolio/initiative/project) reassignment,
 * date span, CAPEX/OPEX class, delivery lineage links, and key results — as a
 * self-contained card. It owns its own draft state (so the parent list needn't
 * thread per-row maps) and exposes a drag handle so it can be dragged onto a
 * portfolio drop-zone in the unified Structure view. Every mutation runs through
 * the parent's `run` (busy + reload). Fully localized; theme-token styled.
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
export function periodFromDate(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
/** ISO timestamp → yyyy-mm-dd for <input type=date>. */
const toDateInput = (iso: string | null): string => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

/** The current owner axis of an objective, encoded as "kind:id" ('' = org-level). */
export const objectiveOwnerValue = (o: ObjectiveProgress): string =>
  o.portfolioId ? `portfolio:${o.portfolioId}`
    : o.initiativeId ? `initiative:${o.initiativeId}`
      : o.projectId != null ? `project:${o.projectId}`
        : '';

export interface ObjectiveCardProps {
  o: ObjectiveProgress;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
  portfolios: PmoTree['portfolios'];
  initiatives: PmoTree['initiatives'];
  projects: PmoTree['projects'];
  epics: SpineResult['nodes'];
  looseTasks: SpineResult['nodes'];
  /** Drag-source wiring (unified Structure view). Omit for a static card. */
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function ObjectiveCard({ o, busy, run, portfolios, initiatives, projects, epics, looseTasks, dragging, onDragStart, onDragEnd }: ObjectiveCardProps) {
  const t = useTranslations('pmo');
  const confirm = useConfirm();
  const [kr, setKr] = useState<{ title: string; target: string }>({ title: '', target: '' });
  const [valueDraft, setValueDraft] = useState<Record<string, string>>({});
  const [linkDraft, setLinkDraft] = useState('');

  const setClass = (costClass: CostClass | null) => run(() => pmoApi.setCostClass('objective', o.id, costClass, 'manual'));
  const span = o.startDate || o.endDate
    ? `${toDateInput(o.startDate) || '…'} → ${toDateInput(o.endDate) || '…'}`
    : t('okr.noDates');

  const assignOwner = (sel: string) =>
    run(() => {
      const [kind, id] = sel.split(':');
      return pmoApi.objectives.update(o.id, {
        portfolioId: kind === 'portfolio' ? id : null,
        initiativeId: kind === 'initiative' ? id : null,
        projectId: kind === 'project' ? Number(id) : null,
      });
    });

  const addLink = () =>
    run(async () => {
      if (!linkDraft) return;
      const [kind, refId] = linkDraft.split(':');
      if (kind === 'initiative') await pmoApi.objectives.addLink(o.id, { linkKind: 'initiative', initiativeId: refId });
      else await pmoApi.objectives.addLink(o.id, { linkKind: kind as 'epic' | 'task', taskId: Number(refId) });
      setLinkDraft('');
    });

  return (
    <div style={{ opacity: dragging ? 0.5 : 1 }}>
      <PmCard
        title={o.title}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {onDragStart && (
              <span
                aria-hidden="true"
                draggable={!busy}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); onDragStart(); }}
                onDragEnd={() => onDragEnd?.()}
                title={t('okr.dragHint')}
                style={{ color: 'var(--text-muted)', cursor: busy ? 'default' : 'grab', userSelect: 'none' }}
              >⠿</span>
            )}
            <Select
              style={{ ...inputStyle, minWidth: 190 }}
              value={objectiveOwnerValue(o)}
              disabled={busy}
              title={t('okr.owner')}
              onChange={(e) => assignOwner(e.target.value)}
            >
              <option value="">{t('okr.ownerWorkspace')}</option>
              {portfolios.length > 0 && (
                <optgroup label={t('okr.ownerPortfolio')}>
                  {portfolios.map((p) => <option key={p.id} value={`portfolio:${p.id}`}>{p.name}</option>)}
                </optgroup>
              )}
              {initiatives.length > 0 && (
                <optgroup label={t('okr.ownerInitiative')}>
                  {initiatives.map((i) => <option key={i.id} value={`initiative:${i.id}`}>{i.name}</option>)}
                </optgroup>
              )}
              {projects.length > 0 && (
                <optgroup label={t('okr.ownerProject')}>
                  {projects.map((p) => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}
                </optgroup>
              )}
            </Select>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{span}</span>
            {o.period && <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{o.period}</span>}
            <button type="button" style={ghostBtn} disabled={busy}
              title={t('okr.convertToEpicHint')}
              onClick={async () => { if (await confirm({ message: t('okr.convertToEpicConfirm'), destructive: false })) run(() => pmoApi.objectives.convertType(o.id, 'epic')); }}>
              {t('okr.convertToEpic')}
            </button>
            <button type="button" style={ghostBtn} disabled={busy}
              onClick={async () => { if (await confirm(t('structure.confirmDeleteObjective'))) run(() => pmoApi.objectives.remove(o.id)); }}>
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
            <Select style={{ ...inputStyle, minWidth: 220 }} value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)}>
              <option value="">{t('okr.pickItem')}</option>
              <optgroup label={t('okr.linkKind.initiative')}>
                {initiatives.map((i) => <option key={i.id} value={`initiative:${i.id}`}>{i.name}</option>)}
              </optgroup>
              <optgroup label={t('okr.linkKind.epic')}>
                {epics.map((n) => <option key={n.key} value={`epic:${n.id}`}>{n.title}</option>)}
              </optgroup>
              <optgroup label={t('okr.linkKind.task')}>
                {looseTasks.map((n) => <option key={n.key} value={`task:${n.id}`}>{n.title}</option>)}
              </optgroup>
            </Select>
            <button type="button" style={ghostBtn} disabled={busy || !linkDraft} onClick={addLink}>{t('okr.addLink')}</button>
          </div>
        </div>

        {/* Key results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {o.keyResults.map((k) => (
            <div key={k.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: '0.85rem' }}>
                <span>{k.title}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                  {k.startValue} → {k.targetValue}{k.unit ? ` ${k.unit}` : ''}
                </span>
              </div>
              <ProgressBar value={k.progress} />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number"
                  style={{ ...inputStyle, width: 110 }}
                  placeholder={t('okr.current')}
                  value={valueDraft[k.id] ?? String(k.currentValue)}
                  onChange={(e) => setValueDraft((s) => ({ ...s, [k.id]: e.target.value }))}
                />
                <button type="button" style={ghostBtn} disabled={busy}
                  onClick={() => run(() => pmoApi.keyResults.update(k.id, { currentValue: Number(valueDraft[k.id] ?? k.currentValue) }))}>
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
            value={kr.title}
            onChange={(e) => setKr((s) => ({ ...s, title: e.target.value }))}
          />
          <input
            type="number"
            style={{ ...inputStyle, width: 100 }}
            placeholder={t('okr.target')}
            value={kr.target}
            onChange={(e) => setKr((s) => ({ ...s, target: e.target.value }))}
          />
          <button
            type="button"
            style={btnStyle}
            disabled={busy || !kr.title.trim()}
            onClick={() => run(async () => {
              await pmoApi.keyResults.create({ objectiveId: o.id, title: kr.title.trim(), targetValue: kr.target.trim() ? Number(kr.target) : 100 });
              setKr({ title: '', target: '' });
            })}
          >
            {t('okr.addKr')}
          </button>
        </div>
      </PmCard>
    </div>
  );
}
