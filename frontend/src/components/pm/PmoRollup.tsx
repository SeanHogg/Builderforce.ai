'use client';

import { useTranslations } from 'next-intl';
import { pmoApi, type PmoRollup as PmoRollupData, type PmoScopeKind } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { PmCard, PmEmpty, PmError, StatCard, ProgressBar } from './pmShared';
import { DeckDownloadButton } from './DeckDownloadButton';

/**
 * PMO rollup lens — composes the live /api/pmo/rollup for a portfolio,
 * initiative, or the org-level workspace: delivery, agent spend, DORA, AI
 * effectiveness, OKR attainment, and the dependency/critical-path view. Read-only;
 * the gate is the page's RoleGate. Fully localized.
 */
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(0)}%`);
const hrs = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}h`);

const blockedPill: React.CSSProperties = {
  display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem',
  fontWeight: 700, color: '#fff', background: '#dc2626', whiteSpace: 'nowrap',
};

export function PmoRollup({ scope }: { scope: { kind: PmoScopeKind; id: string } }) {
  const t = useTranslations('pmo');
  const { data, error } = usePmData<PmoRollupData>(
    () => pmoApi.rollup(scope.kind, scope.id),
    [scope.kind, scope.id],
  );

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loadingRollup')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DeckDownloadButton />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <StatCard label={t('stat.projects')} value={String(data.projectCount)} sub={scope.kind === 'portfolio' || scope.kind === 'workspace' ? t('stat.initiativesCount', { count: data.initiativeCount }) : t('stat.inInitiative')} />
        <StatCard label={t('stat.completed')} value={String(data.delivery.completedCount)} sub={t('stat.openCount', { count: data.delivery.openCount })} />
        <StatCard label={t('stat.avgCycle')} value={hrs(data.delivery.avgCycleTimeHours)} sub={t('stat.startToDone')} />
        <StatCard label={t('stat.throughput')} value={t('stat.throughputValue', { count: data.delivery.throughputPerWeek })} sub={t('stat.last7days')} />
        <StatCard label={t('stat.agentSpend')} value={usd(data.spend.agentLlmCostUsd)} sub={t('stat.attributedToScope')} />
        <StatCard label={t('stat.okrProgress')} value={pct(data.okr.avgProgress * 100)} sub={t('stat.objectivesCount', { count: data.okr.objectives.length })} />
        <StatCard label={t('stat.outcomeScore')} value={data.outcomes.runs ? data.outcomes.avgScore.toFixed(2) : '—'} sub={t('stat.scoredRuns', { count: data.outcomes.runs })} />
        <StatCard label={t('stat.mergeRate')} value={pct(data.outcomes.mergedRatePct)} sub={t('stat.ofScoredRuns')} />
      </div>

      <PmCard title={t('dora.title', { days: data.dora.windowDays })}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <StatCard label={t('dora.deployFreq')} value={t('dora.deployFreqValue', { value: data.dora.deploymentFrequencyPerDay.toFixed(2) })} sub={t('dora.deploysCount', { count: data.dora.totalDeployments })} />
          <StatCard label={t('dora.leadTime')} value={hrs(data.dora.leadTimeHours)} sub={t('dora.commitToShip')} />
          <StatCard label={t('dora.changeFailure')} value={pct(data.dora.changeFailureRatePct)} sub={t('dora.failedOverTotal')} />
          <StatCard label={t('dora.mttr')} value={hrs(data.dora.mttrHours)} sub={t('dora.timeToRestore')} />
        </div>
      </PmCard>

      {(scope.kind === 'portfolio' || scope.kind === 'workspace') && (data.criticalPath.length > 0 || data.cycleDetected) && (
        <PmCard title={t('section.criticalPath')}>
          {data.cycleDetected && (
            <div style={{ fontSize: '0.82rem', color: '#dc2626', fontWeight: 600, marginBottom: 10 }}>{t('cycleWarning')}</div>
          )}
          {data.criticalPath.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
              {data.criticalPath.map((c, i) => (
                <span key={c.initiativeId} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ padding: '4px 10px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', fontWeight: 600 }}>{c.name}</span>
                  {i < data.criticalPath.length - 1 && <span style={{ color: 'var(--text-muted)' }}>→</span>}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('criticalPathEmpty')}</div>
          )}
        </PmCard>
      )}

      {scope.kind === 'initiative' && (data.blockedBy.length > 0 || data.blocks.length > 0) && (
        <PmCard title={t('section.dependencies')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.86rem' }}>
            {data.blockedBy.length > 0 && (
              <div><strong>{t('blockedBy')}:</strong> {data.blockedBy.map((b) => b.name).join(', ')}</div>
            )}
            {data.blocks.length > 0 && (
              <div><strong>{t('blocks')}:</strong> {data.blocks.map((b) => b.name).join(', ')}</div>
            )}
          </div>
        </PmCard>
      )}

      {data.okr.objectives.length > 0 && (
        <PmCard title={t('section.objectives')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.okr.objectives.map((o) => (
              <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.88rem' }}>
                  <span style={{ fontWeight: 600 }}>{o.title}</span>
                  {o.period && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{o.period}</span>}
                </div>
                <ProgressBar value={o.progress} />
              </div>
            ))}
          </div>
        </PmCard>
      )}

      {scope.kind === 'workspace' && data.byPortfolio.length > 0 && (
        <PmCard title={t('section.byPortfolio')}>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('col.portfolio')}</th>
                  <th style={thStyle}>{t('col.initiatives')}</th>
                  <th style={thStyle}>{t('col.projects')}</th>
                  <th style={thStyle}>{t('col.completed')}</th>
                  <th style={thStyle}>{t('col.agentSpend')}</th>
                  <th style={thStyle}>{t('col.okrProgress')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byPortfolio.map((p) => (
                  <tr key={p.portfolioId ?? 'unassigned'} style={trStyle}>
                    <td style={tdStyle}>{p.portfolioId ? p.name : t('unassignedPortfolio')}</td>
                    <td style={tdMutedStyle}>{p.initiativeCount}</td>
                    <td style={tdMutedStyle}>{p.projectCount}</td>
                    <td style={tdMutedStyle}>{p.completedCount}</td>
                    <td style={tdMutedStyle}>{usd(p.agentLlmCostUsd)}</td>
                    <td style={{ ...tdMutedStyle, minWidth: 140 }}><ProgressBar value={p.avgProgress} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PmCard>
      )}

      {(scope.kind === 'portfolio' || scope.kind === 'workspace') && data.byInitiative.length > 0 && (
        <PmCard title={t('section.byInitiative')}>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('col.initiative')}</th>
                  <th style={thStyle}>{t('col.projects')}</th>
                  <th style={thStyle}>{t('col.completed')}</th>
                  <th style={thStyle}>{t('col.agentSpend')}</th>
                  <th style={thStyle}>{t('col.okrProgress')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byInitiative.map((i) => (
                  <tr key={i.initiativeId} style={trStyle}>
                    <td style={tdStyle}>
                      {i.name}
                      {i.isBlocked && <span style={{ ...blockedPill, marginLeft: 8 }}>{t('blocked')}</span>}
                    </td>
                    <td style={tdMutedStyle}>{i.projectCount}</td>
                    <td style={tdMutedStyle}>{i.completedCount}</td>
                    <td style={tdMutedStyle}>{usd(i.agentLlmCostUsd)}</td>
                    <td style={{ ...tdMutedStyle, minWidth: 140 }}><ProgressBar value={i.avgProgress} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PmCard>
      )}
    </div>
  );
}
