'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { innovationApi, type FunnelMetrics, type InnovationIdea, type FunnelStage } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard, ProgressBar, StatusPill } from '@/components/pm/pmShared';
import { KpiGrid } from './LensShell';
import { pct, days as dDays } from './format';

const FUNNEL_ORDER: FunnelStage[] = ['idea', 'validated', 'in_build', 'shipped', 'measured'];

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
  const [busy, setBusy] = useState(false);
  const [newIdea, setNewIdea] = useState('');
  const funnelQ = usePmData<FunnelMetrics>(() => innovationApi.funnel(), []);
  const ideasQ = usePmData<InnovationIdea[]>(() => innovationApi.ideas.list(), []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); funnelQ.reload(); ideasQ.reload(); } finally { setBusy(false); }
  };

  if (funnelQ.error) return <PmError message={funnelQ.error} />;
  if (!funnelQ.data) return <PmEmpty message={t('loading')} />;
  const f = funnelQ.data;
  const ideas = ideasQ.data ?? [];
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
          <div style={{ display: 'flex', gap: 8, minWidth: 320 }}>
            <input style={inputStyle} placeholder={t('funnel.newIdea')} value={newIdea} onChange={(e) => setNewIdea(e.target.value)} />
            <button
              type="button" style={btnStyle} disabled={busy || !newIdea.trim()}
              onClick={() => run(async () => { await innovationApi.ideas.create({ title: newIdea.trim(), stage: 'idea' }); setNewIdea(''); })}
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
