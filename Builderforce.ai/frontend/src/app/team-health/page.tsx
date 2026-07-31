'use client';

/**
 * Team Health Dashboard page — FR-5.
 * Composes all four panels with a health score header.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  TeamHealthData,
  ContributorLoad,
  Blocker,
  AgingWip,
  AgentHealth,
  HealthScoreConfig,
  HealthScoreBreakdown,
} from '@/lib/teamHealthTypes';
import { computeHealthScore } from '@/lib/teamHealthUtils';
import { WorkloadPanel } from './WorkloadPanel';
import { BlockersPanel } from './BlockersPanel';
import { AgingWipPanel } from './AgingWipPanel';
import { AgentUtilizationPanel } from './AgentUtilizationPanel';
import './team-health.css';

const REFRESH_MS = 60_000;

const DEFAULT_CONFIG: HealthScoreConfig = {
  thresholds: {
    blockingExpiryAgeDays: 7,
    blockerAgeThresholds: { urgent: 24, high: 72, medium: 120, low: 168, unknown: 72 },
    agingWipThresholdDays: 3,
    agingWipEpicThresholdDays: 7,
    agentIdleQueueThresholdMin: 15,
  },
  weights: {
    blockerCount: 0.35,
    overCapacityPct: 0.30,
    agingWipCount: 0.20,
    agentErrorRate: 0.15,
  },
};

export default function TeamHealthPage() {
  const t = useTranslations('teamHealth');
  const [data, setData] = useState<TeamHealthData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config] = useState<HealthScoreConfig>(DEFAULT_CONFIG);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/team-health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json as TeamHealthData);
      setLastUpdated(Date.now());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contributors = useMemo<ContributorLoad[]>(
    () =>
      (data?.contributors ?? []).map((c) => ({
        ...c,
        activeTaskCount: c.activeTaskCount ?? 0,
        storyPoints: c.storyPoints ?? 0,
        capacity: c.capacity ?? 0,
      })),
    [data],
  );
  const blockers = useMemo<Blocker[]>(() => data?.blockers ?? [], [data]);
  const agingWip = useMemo<AgingWip[]>(() => data?.agingWip ?? [], [data]);
  const agents = useMemo<AgentHealth[]>(() => data?.agents ?? [], [data]);

  const score = useMemo<HealthScoreBreakdown>(
    () => computeHealthScore(contributors, blockers, agingWip, agents, config),
    [contributors, blockers, agingWip, agents, config],
  );

  return (
    <main className="th-dashboard">
      {/* Header */}
      <header className="th-header">
        <h1 className="th-heading">{t('title')}</h1>
        <div className="th-header-actions">
          <button type="button" className="th-action-btn" onClick={fetchData} disabled={false}>
            {t('refresh')}
          </button>
          {lastUpdated && (
            <span className="th-last-updated">
              {t('lastUpdated', {
                time: new Date(lastUpdated).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }),
              })}
            </span>
          )}
        </div>
      </header>

      {/* Health Score */}
      <section className="th-score-section">
        <div className="th-score-card">
          <span className="th-score-value" style={{ color: scoreColor(score.overall) }}>
            {score.overall}
          </span>
          <span className="th-score-label">{t('healthScore')}</span>
        </div>
        <div className="th-score-breakdown">
          {score.breakdown.map((b) => (
            <div key={b.label} className="th-score-dimension">
              <span className="th-score-dim-label">{b.label}</span>
              <div className="th-score-dim-bar">
                <div
                  className="th-score-dim-fill"
                  style={{ width: `${b.score}%`, background: scoreColor(b.score) }}
                />
              </div>
              <span className="th-score-dim-value">{b.score}%</span>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <p className="th-error-banner">
          {t('fetchError', { error })}
        </p>
      )}

      {/* Panels */}
      <div className="th-panels">
        <WorkloadPanel contributors={contributors} config={config} />
        <BlockersPanel blockers={blockers} config={config} />
        <AgingWipPanel items={agingWip} config={config} />
        <AgentUtilizationPanel agents={agents} config={config} />
      </div>
    </main>
  );
}

function scoreColor(v: number): string {
  if (v >= 80) return 'var(--th-ok)';
  if (v >= 50) return 'var(--th-aging)';
  return 'var(--th-blocker)';
}
