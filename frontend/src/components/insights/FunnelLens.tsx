'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { innovationApi, pmoApi, type FunnelMetrics, type InnovationIdea, type FunnelStage, type Initiative } from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard, ProgressBar, StatusPill } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { KpiGrid } from './LensShell';
import { pct, days as dDays } from './format';
import { useProjectScope } from '@/lib/ProjectScopeContext';

const FUNNEL_ORDER: FunnelStage[] = ['idea', 'validated', 'in_build', 'shipped', 'measured'];

/** Map the compact link-picker value into the idea's link fields (both cleared
 *  unless one is chosen — an idea links to at most one of project / initiative). */
function linkBody(link: string): { linkedProjectId: number | null; initiativeId: string | null } {
  if (link.startsWith('project:')) return { linkedProjectId: Number(link.slice(8)), initiativeId: null };
  if (link.startsWith('initiative:')) return { linkedProjectId: null, initiativeId: link.slice(11) };
  return { linkedProjectId: null, initiativeId: null };
}

/** Current link of an idea → the picker value. */
function linkValue(idea: InnovationIdea): string {
  if (idea.linkedProjectId != null) return `project:${idea.linkedProjectId}`;
  if (idea.initiativeId) return `initiative:${idea.initiativeId}`;
  return 'none';
}

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8,
  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};
const btnStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
};
const ghostBtn: React.CSSProperties = { ...btnStyle, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' };

function nextStage(stage: string): FunnelStage | null {
  const i = FUNNEL_ORDER.indexOf(stage as FunnelStage);
  return i >= 0 && i < FUNNEL_ORDER.length - 1 ? FUNNEL_ORDER[i + 1]! : null;
}

/** LENS #5 — innovation funnel: idea→validated→in_build→shipped→measured
 *  conversion + the idea pipeline manager (the CEO "is innovation working" view). */
export function FunnelLens() {
  const t = useTranslations('insights');
  const { currentProjectId } = useProjectScope();
  const [busy, setBusy] = useState(false);
  const [newIdea, setNewIdea] = useState('');
  const [newLink, setNewLink] = useState('none');
  const [projects, setProjects] = useState<Project[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const funnelQ = usePmData<FunnelMetrics>(() => innovationApi.funnel(undefined, currentProjectId), [currentProjectId]);
  const ideasQ = usePmData<InnovationIdea[]>(() => innovationApi.ideas.list(currentProjectId), [currentProjectId]);

  useEffect(() => {
    setNewLink(currentProjectId == null ? 'none' : `project:${currentProjectId}`);
  }, [currentProjectId]);

  // Link targets: a project OR an initiative an idea can be tied to.
  useEffect(() => {
    let alive = true;
    fetchProjects().then((p) => { if (alive) setProjects(p); }).catch(() => {});
    pmoApi.initiatives.list().then((i) => { if (alive) setInitiatives(i); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /** Shared link <Select> (used on create and per-idea). */
  const linkSelect = (value: string, onChange: (v: string) => void, ariaLabel: string) => (
    <Select style={{ ...inputStyle, flex: 'none', maxWidth: 170 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {currentProjectId == null && <option value="none">{t('funnel.linkNone')}</option>}
      {projects.length > 0 && (
        <optgroup label={t('funnel.linkProjects')}>
          {projects.filter((p) => currentProjectId == null || p.id === currentProjectId).map((p) => <option key={`p${p.id}`} value={`project:${p.id}`}>{p.name}</option>)}
        </optgroup>
      )}
      {currentProjectId == null && initiatives.length > 0 && (
        <optgroup label={t('funnel.linkInitiatives')}>
          {initiatives.map((i) => <option key={`i${i.id}`} value={`initiative:${i.id}`}>{i.name}</option>)}
        </optgroup>
      )}
    </Select>
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); funnelQ.reload(); ideasQ.reload(); } finally { setBusy(false); }
  };

  if (funnelQ.error) return <PmError message={funnelQ.error} />;
  if (!funnelQ.data) return <PmEmpty message={t('loading')} />;
  const f = funnelQ.data;
  const ideas = (ideasQ.data ?? []).filter((idea) => currentProjectId == null || idea.linkedProjectId === currentProjectId);
  const stageLabel = (s: string) => t(`funnel.stage.${s}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <KpiGrid>
        <StatCard label={t('funnel.total')} value={String(f.totalIdeas)} sub={t('funnel.activeSub', { n: f.activeIdeas })} />
        <StatCard label={t('funnel.ideaToShip')} value={pct(f.ideaToShipPct)} sub={t('funnel.ideaToShipSub')} />
        <StatCard label={t('funnel.timeToValue')} value={dDays(f.avgIdeaToShipDays)} sub={t('funnel.timeToValueSub')} />
        <StatCard label={t('funnel.killed')} value={String(f.killedCount)} sub={t('funnel.killedSub')} />
      </KpiGrid>

      <PmCard title={t('funnel.conversion')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {f.stages.map((s) => (
            <div key={s.stage} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85rem' }}>
                <span style={{ fontWeight: 600 }}>{stageLabel(s.stage)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {t('funnel.reached', { n: s.reached })}
                  {s.conversionFromPrevPct != null ? ` · ${pct(s.conversionFromPrevPct)}` : ''}
                  {s.avgDaysInStage != null ? ` · ${dDays(s.avgDaysInStage)}` : ''}
                </span>
              </div>
              <ProgressBar value={f.activeIdeas > 0 ? s.reached / f.activeIdeas : 0} />
            </div>
          ))}
        </div>
      </PmCard>

      <PmCard
        title={t('funnel.ideas')}
        action={
          <div style={{ display: 'flex', gap: 8, minWidth: 320, flexWrap: 'wrap' }}>
            <input style={inputStyle} placeholder={t('funnel.newIdea')} value={newIdea} onChange={(e) => setNewIdea(e.target.value)} />
            {linkSelect(newLink, setNewLink, t('funnel.link'))}
            <button
              type="button" style={btnStyle} disabled={busy || !newIdea.trim()}
              onClick={() => run(async () => { await innovationApi.ideas.create({ title: newIdea.trim(), stage: 'idea', ...linkBody(newLink) }); setNewIdea(''); setNewLink('none'); })}
            >
              {t('funnel.addIdea')}
            </button>
          </div>
        }
      >
        {ideas.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('funnel.noIdeas')}</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ideas.map((idea) => {
              const next = idea.stage !== 'killed' ? nextStage(idea.stage) : null;
              return (
                <div key={idea.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: '0.84rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idea.title}</span>
                  <StatusPill value={idea.stage === 'killed' ? 'blocked' : idea.stage === 'shipped' || idea.stage === 'measured' ? 'done' : 'in_progress'} />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', minWidth: 70 }}>{stageLabel(idea.stage)}</span>
                  {linkSelect(linkValue(idea), (v) => run(() => innovationApi.ideas.update(idea.id, linkBody(v))), t('funnel.link'))}
                  {next && (
                    <button type="button" style={ghostBtn} disabled={busy} onClick={() => run(() => innovationApi.ideas.update(idea.id, { stage: next }))}>
                      {t('funnel.advanceTo', { stage: stageLabel(next) })}
                    </button>
                  )}
                  {idea.stage !== 'killed' && idea.stage !== 'measured' && (
                    <button type="button" style={ghostBtn} disabled={busy} onClick={() => run(() => innovationApi.ideas.update(idea.id, { stage: 'killed' }))}>
                      {t('funnel.kill')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PmCard>
    </div>
  );
}
