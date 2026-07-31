'use client';

/**
 * TeamHealthDashboard — the full Team Health dashboard page.
 *
 * Single scrollable view with four collapsible sections:
 *   Workload | Blockers | Aging WIP | Agent Utilization
 *
 * A top-level Team Health Score ring (0–100) summarises the four dimensions.
 * Data auto-refreshes every 60 s per FR-5.3 with a manual-refresh button and
 * last-updated timestamp. All theme colours are driven by CSS custom properties
 * so light and dark mode work from the global theme (WCAG 2.1 AA target).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TeamHealthData } from '@/lib/teamHealthTypes';
import { fetchTeamHealth, clearTeamHealthCache } from '@/lib/teamHealthApi';
import { HealthScoreRing } from './HealthScoreRing';
import { WorkloadPanel } from './WorkloadPanel';
import { BlockersPanel } from './BlockersPanel';
import { AgingWipPanel } from './AgingWipPanel';
import { AgentUtilizationPanel } from './AgentUtilizationPanel';

const REFRESH_INTERVAL_MS = 60_000; // FR-5.3

export function TeamHealthDashboard({ projectId }: { projectId: number }) {
  const t = useTranslations('teamHealth');
  const [data, setData] = useState<TeamHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const d = await fetchTeamHealth(projectId, ctrl.signal);
      if (!ctrl.signal.aborted) {
        setData(d);
        setError(false);
        setLastRefresh(Date.now());
      }
    } catch {
      if (!ctrl.signal.aborted) setError(true);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Auto-refresh
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [load]);

  const manualRefresh = useCallback(() => {
    clearTeamHealthCache(projectId);
    void load();
  }, [projectId, load]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastRefresh) return '';
    const d = new Date(lastRefresh);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [lastRefresh]);

  if (loading) {
    return (
      <div className="th-dashboard" style={rootStyle}>
        <style>{DASHBOARD_CSS}</style>
        <div style={centeredStyle}>{t('loading')}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="th-dashboard" style={rootStyle}>
        <style>{DASHBOARD_CSS}</style>
        <div style={{ ...centeredStyle, color: '#f87171' }}>
          <span>{t('error')}</span>
          <button
            type="button"
            onClick={manualRefresh}
            className="th-retry-btn"
            style={retryBtnStyle}
          >
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  const { healthScore, contributors, blockers, agingWip, agents } = data;

  return (
    <div className="th-dashboard" style={rootStyle}>
      <style>{DASHBOARD_CSS}</style>

      {/* ── Header row: title, score ring, refresh ─────────────────────── */}
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{t('title')}</h1>
          <p style={subtitleStyle}>{t('subtitle')}</p>
        </div>
        <div style={headerRightStyle}>
          <HealthScoreRing score={healthScore.overall} />
          <div style={refreshGroupStyle}>
            <button
              type="button"
              onClick={manualRefresh}
              className="th-refresh-btn"
              style={refreshBtnStyle}
              aria-label={t('refresh')}
            >
              {t('refreshLabel')}
            </button>
            {lastUpdatedLabel && (
              <span style={lastUpdatedStyle}>
                {t('lastUpdated')}: {lastUpdatedLabel}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Component score summary bar ────────────────────────────────── */}
      <div style={componentBarStyle}>
        <ScoreChip
          label={t('sectionBlockers')}
          value={Math.round((1 - healthScore.components.blockers) * 100)}
          color="var(--th-blocker)"
        />
        <ScoreChip
          label={t('sectionWorkload')}
          value={Math.round((1 - healthScore.components.overload) * 100)}
          color="var(--th-overload)"
        />
        <ScoreChip
          label={t('sectionAgingWip')}
          value={Math.round((1 - healthScore.components.aging) * 100)}
          color="var(--th-aging)"
        />
        <ScoreChip
          label={t('sectionAgents')}
          value={Math.round((1 - healthScore.components.agentErrors) * 100)}
          color="var(--th-agent)"
        />
      </div>

      {/* ── Sections ───────────────────────────────────────────────────── */}
      <div style={sectionsStyle}>
        <WorkloadPanel contributors={contributors} config={healthScore.config} />
        <BlockersPanel blockers={blockers} config={healthScore.config} />
        <AgingWipPanel items={agingWip} config={healthScore.config} />
        <AgentUtilizationPanel agents={agents} config={healthScore.config} />
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

function ScoreChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="th-score-chip" style={scoreChipStyle}>
      <div className="th-score-chip-ring" style={{ ...scoreChipRingStyle, borderColor: color }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      <span style={scoreChipLabelStyle}>{label}</span>
    </div>
  );
}

/* ── Static styles ───────────────────────────────────────────────────────── */

const rootStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 20,
  padding: '20px 24px', minHeight: '100%',
  background: 'var(--bg-surface)', color: 'var(--text-primary)',
};

const centeredStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 12, flex: 1, minHeight: 400,
  fontSize: '0.9rem', color: 'var(--text-muted)',
};

const retryBtnStyle: React.CSSProperties = {
  background: 'transparent', color: 'inherit', border: '1px solid currentColor',
  borderRadius: 6, padding: '4px 14px', fontSize: '0.8rem', cursor: 'pointer',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
  flexWrap: 'wrap', gap: 16, flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700,
  fontSize: '1.4rem', lineHeight: 1.2,
};

const subtitleStyle: React.CSSProperties = {
  margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)',
  maxWidth: 480, lineHeight: 1.5,
};

const headerRightStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0,
};

const refreshGroupStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4,
};

const refreshBtnStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 8,
  padding: '6px 16px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
};

const lastUpdatedStyle: React.CSSProperties = {
  fontSize: '0.65rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
};

const componentBarStyle: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap', flexShrink: 0,
};

const scoreChipStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
  borderRadius: 10, padding: '8px 14px', minWidth: 0,
};

const scoreChipRingStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  border: '3px solid', display: 'flex', alignItems: 'center',
  justifyContent: 'center', flexShrink: 0,
};

const scoreChipLabelStyle: React.CSSProperties = {
  fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
};

const sectionsStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0,
};

/* ── Shared CSS (animations, utility classes) ──────────────────────────── */

const DASHBOARD_CSS = `
.th-dashboard {
  --th-blocker: #e66767;
  --th-overload: #d95926;
  --th-aging: #c98500;
  --th-agent: #3987e5;
  --th-green: #22c55e;
}
:root[data-theme='light'] .th-dashboard {
  --th-blocker: #e34948;
  --th-overload: #eb6834;
  --th-aging: #eda100;
  --th-agent: #2a78d6;
  --th-green: #16a34a;
}

/* Section panel shared */
.th-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  overflow: hidden;
}
.th-panel-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; cursor: pointer; user-select: none;
  font-weight: 700; font-size: 0.95rem;
  border-bottom: 1px solid var(--border-subtle);
}
.th-panel-header:hover { background: var(--bg-elevated); }
.th-panel-body { padding: 16px 18px; }

/* Capacity bar */
.th-capacity-bar { height: 10px; border-radius: 5px; background: var(--bg-elevated); overflow: hidden; flex: 1; min-width: 80px; }
.th-capacity-fill { height: 100%; border-radius: 5px; transition: width 0.4s ease; }
.th-capacity-ok { background: var(--th-green); }
.th-capacity-warning { background: var(--th-overload); }
.th-capacity-critical { background: var(--th-blocker); }

/* Agent status pills */
.th-agent-status { display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; }
.th-status-idle { background: var(--bg-elevated); color: var(--text-muted); }
.th-status-running { background: rgba(34,197,94,0.15); color: var(--th-green); }
.th-status-blocked { background: rgba(201,133,0,0.15); color: var(--th-aging); }
.th-status-error { background: rgba(230,103,103,0.15); color: var(--th-blocker); }
.th-status-waiting { background: rgba(57,135,229,0.15); color: var(--th-agent); }

/* Aging severity stripes */
.th-aging-yellow { border-left: 3px solid var(--th-aging); }
.th-aging-orange { border-left: 3px solid var(--th-overload); }
.th-aging-red { border-left: 3px solid var(--th-blocker); }

/* Buttons */
.th-action-btn {
  background: transparent; border: 1px solid var(--border-subtle);
  border-radius: 6px; padding: 3px 10px; font-size: 0.72rem;
  cursor: pointer; color: var(--text-secondary);
}
.th-action-btn:hover { background: var(--bg-elevated); }

.th-retry-btn { background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 6px; padding: 4px 14px; font-size: 0.78rem; cursor: pointer; }

/* Scrollable table */
.th-table-wrap { overflow-x: auto; }
.th-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.th-table th { text-align: left; padding: 8px 12px; font-weight: 700; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); white-space: nowrap; }
.th-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
.th-table tr:last-child td { border-bottom: none; }

/* Util chart */
.th-util-chart { display: flex; align-items: flex-end; gap: 3px; height: 60px; }
.th-util-bar { flex: 1; border-radius: 3px 3px 0 0; min-width: 8px; }
.th-util-active { background: var(--th-agent); }
.th-util-idle { background: var(--bg-elevated); }

@media (max-width: 900px) {
  .th-dashboard header { flex-direction: column; }
}
`;
