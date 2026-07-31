'use client';

/**
 * AgentUtilizationPanel — FR-4: Agent Utilization.
 *
 * Real-time agent status, queue depth, error surfacing, idle-with-queue alerts,
 * and a 7-day / 30-day utilisation toggle chart.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentHealth, HealthScoreConfig } from '@/lib/teamHealthTypes';
import { CollapsibleSection } from './CollapsibleSection';

interface Props {
  agents: AgentHealth[];
  config: HealthScoreConfig;
}

const DAY_MS = 86_400_000;

export function AgentUtilizationPanel({ agents, config }: Props) {
  const t = useTranslations('teamHealth');
  const [chartDays, setChartDays] = useState<7 | 30>(7);

  const errorCount = useMemo(() => agents.filter((a) => a.agentStatus === 'error').length, [agents]);
  const idleWithQueue = useMemo(
    () =>
      agents.filter(
        (a) =>
          a.agentStatus === 'idle' &&
          a.queueDepth > 0 &&
          a.lastKeepAlive &&
          (Date.now() - a.lastKeepAlive) / 60_000 >= config.thresholds.agentIdleQueueThresholdMin,
      ),
    [agents, config],
  );

  // Synthetic 7/30-day utilisation data (driven by completedSinceRestart + avgDuration)
  const utilisationBars = useMemo(() => {
    const bars = chartDays;
    return agents.map((agent) => {
      const hourlyCapacity = bars * 8; // 8 working hours/day
      const activeHours = Math.min(
        (agent.completedSinceRestart * agent.avgTaskDurationSeconds) / 3600,
        hourlyCapacity,
      );
      const activePct = hourlyCapacity > 0 ? Math.round((activeHours / hourlyCapacity) * 100) : 0;
      return {
        agent,
        activePct: Math.max(5, Math.min(100, activePct)), // floor at 5% for visibility
      };
    });
  }, [agents, chartDays]);

  return (
    <CollapsibleSection
      title={t('sectionAgents')}
      badge={errorCount > 0 ? `${errorCount} ${t('errors')}` : idleWithQueue.length > 0 ? t('idleWithQueue') : undefined}
      badgeTone={errorCount > 0 ? 'critical' : idleWithQueue.length > 0 ? 'warning' : 'ok'}
    >
      {agents.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '20px 0' }}>
          {t('noAgents')}
        </p>
      ) : (
        <>
          {/* Idle-with-queue alert */}
          {idleWithQueue.length > 0 && (
            <p style={{
              margin: '0 0 10px', fontSize: '0.74rem', fontWeight: 600,
              color: 'var(--th-aging)', padding: '6px 12px',
              background: 'rgba(201,133,0,0.08)', borderRadius: 8,
            }}>
              {t('idleQueueAlert', {
                count: idleWithQueue.length,
                threshold: config.thresholds.agentIdleQueueThresholdMin,
              })}
            </p>
          )}

          {/* Error surfacing */}
          {agents.filter((a) => a.agentStatus === 'error').map((a) => (
            <div
              key={a.agentHostId}
              style={{
                margin: '0 0 8px', padding: '8px 12px',
                background: 'rgba(230,103,103,0.08)',
                border: '1px solid rgba(230,103,103,0.25)',
                borderRadius: 8, fontSize: '0.78rem',
              }}
            >
              <strong style={{ color: 'var(--th-blocker)' }}>{a.name}</strong>
              {': '}
              <span style={{ color: 'var(--text-secondary)' }}>
                {a.lastError ?? t('unknownError')}
              </span>
            </div>
          ))}

          {/* Agent table */}
          <div className="th-table-wrap" style={{ marginBottom: 16 }}>
            <table className="th-table">
              <thead>
                <tr>
                  <th>{t('colAgent')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colQueue')}</th>
                  <th>{t('colCompleted')}</th>
                  <th>{t('colAvgDuration')}</th>
                  <th>{t('colLastActive')}</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agentHostId}>
                    <td style={{ fontWeight: 600 }}>{a.name}</td>
                    <td>
                      <AgentStatusPill status={a.agentStatus} />
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {a.queueDepth}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {a.completedSinceRestart}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                      {formatDuration(a.avgTaskDurationSeconds)}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      {a.lastKeepAlive ? relativeTime(a.lastKeepAlive) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Utilisation chart (7d / 30d toggle) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                {t('utilization')}
              </span>
              {([7, 30] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="th-action-btn"
                  style={{ fontWeight: chartDays === d ? 700 : 400 }}
                  onClick={() => setChartDays(d)}
                >
                  {t('lastDays', { count: d })}
                </button>
              ))}
            </div>

            {utilisationBars.map(({ agent, activePct }) => (
              <div
                key={agent.agentHostId}
                style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}
              >
                <span style={{ fontSize: '0.7rem', fontWeight: 600, width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent.name}
                </span>
                <div className="th-capacity-bar" style={{ height: 14 }}>
                  <div
                    className="th-capacity-fill th-capacity-ok"
                    style={{ width: `${activePct}%`, background: 'var(--th-agent)', minWidth: 4 }}
                  />
                </div>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', width: 36, textAlign: 'right' }}>
                  {activePct}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}

/* ── Agent status pill ─────────────────────────────────────────────────── */

function AgentStatusPill({ status }: { status: string }) {
  const classMap: Record<string, string> = {
    idle: 'th-status-idle',
    running: 'th-status-running',
    waiting_on_human: 'th-status-waiting',
    blocked: 'th-status-blocked',
    error: 'th-status-error',
  };
  const cssClass = classMap[status] ?? 'th-status-idle';
  const dot = status === 'running' ? '●' : status === 'error' ? '⚠' : '○';
  return (
    <span className={`th-agent-status ${cssClass}`}>
      <span aria-hidden>{dot}</span> {status.replace(/_/g, ' ')}
    </span>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '<1m ago';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
