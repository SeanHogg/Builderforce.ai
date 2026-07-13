'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  analyticsApi,
  type ActivityCalendar,
  type CalendarCell,
  type ContributorCalendar,
} from '@/lib/builderforceApi';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { TenantActivityPanel } from './TenantActivityPanel';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

// GitHub-style intensity palettes. Humans = green, agents = purple, so the
// activity calendar visibly distinguishes people from agentHosts.
const GREEN = ['#0e4429', '#006d32', '#26a641', '#39d353'];
const PURPLE = ['#3a2063', '#5b2da6', '#8a4be0', '#b388ff'];
const EMPTY = 'var(--border-subtle)';

const CELL = 11;
const GAP = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cellColor(cell: CalendarCell | null, kind: 'human' | 'agent'): string {
  if (!cell || cell.level <= 0) return EMPTY;
  const pal = kind === 'agent' ? PURPLE : GREEN;
  return pal[Math.min(cell.level, 4) - 1];
}

interface Week {
  days: Array<{ date: string; cell: CalendarCell | null; inRange: boolean }>;
  monthLabel: string | null;
}

function buildWeeks(from: Date, to: Date, cells: CalendarCell[]): Week[] {
  const map = new Map(cells.map((c) => [c.date, c]));
  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back to Sunday
  const end = new Date(to);

  const weeks: Week[] = [];
  const cur = new Date(start);
  let lastMonth = -1;
  while (cur <= end) {
    const days: Week['days'] = [];
    let monthLabel: string | null = null;
    for (let d = 0; d < 7; d++) {
      const ds = cur.toISOString().slice(0, 10);
      const inRange = cur >= from && cur <= end;
      if (d === 0) {
        const m = cur.getUTCMonth();
        if (m !== lastMonth && cur.getUTCDate() <= 7) { monthLabel = MONTHS[m]; lastMonth = m; }
      }
      days.push({ date: ds, cell: map.get(ds) ?? null, inRange });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push({ days, monthLabel });
  }
  return weeks;
}

function Heatmap({ from, to, cells, kind }: { from: Date; to: Date; cells: CalendarCell[]; kind: 'human' | 'agent' }) {
  const t = useTranslations('contributors');
  const weeks = useMemo(() => buildWeeks(from, to, cells), [from, to, cells]);
  const width = weeks.length * (CELL + GAP) + 30;
  const height = 7 * (CELL + GAP) + 20;

  return (
    <svg width={width} height={height} role="img" aria-label={t('calendarAria')} style={{ display: 'block' }}>
      {/* Weekday labels */}
      {['Mon', 'Wed', 'Fri'].map((lbl, i) => (
        <text key={lbl} x={0} y={20 + (i * 2 + 1) * (CELL + GAP) + CELL} fontSize={9} fill="var(--text-muted)">{lbl}</text>
      ))}
      {weeks.map((week, wi) => (
        <g key={wi} transform={`translate(${30 + wi * (CELL + GAP)}, 18)`}>
          {week.monthLabel && <text x={0} y={-6} fontSize={9} fill="var(--text-muted)">{week.monthLabel}</text>}
          {week.days.map((day, di) =>
            day.inRange ? (
              <rect
                key={day.date}
                x={0}
                y={di * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                fill={cellColor(day.cell, kind)}
                stroke="rgba(0,0,0,0.06)"
              >
                <title>{t('tileTitle', { date: day.date, count: day.cell?.count ?? 0 })}</title>
              </rect>
            ) : null,
          )}
        </g>
      ))}
    </svg>
  );
}

function KindBadge({ kind }: { kind: 'human' | 'agent' }) {
  const t = useTranslations('contributors');
  const isAgent = kind === 'agent';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
      color: isAgent ? '#b388ff' : '#39d353',
      background: isAgent ? 'rgba(138,75,224,0.12)' : 'rgba(38,166,65,0.12)',
      border: `1px solid ${isAgent ? 'rgba(138,75,224,0.4)' : 'rgba(38,166,65,0.4)'}`,
    }}>
      {isAgent ? `🤖 ${t('badge.agent')}` : `👤 ${t('badge.human')}`}
    </span>
  );
}

/**
 * Contributors → whole-team activity calendar (humans via git/PR activity, AI
 * agents via BuilderForce telemetry). Self-contained content surface: owns its
 * own data fetch, sync action, and leaderboard; the host page supplies the
 * heading chrome. Rendered standalone and as the activity half of the
 * Performance tab. Profile consolidation now lives on the Workforce directory
 * (checkbox-select members → merge), so this surface is activity-only.
 */
export function ContributorsView() {
  const t = useTranslations('contributors');
  const [data, setData] = useState<ActivityCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null); // null = whole team
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  const load = () => {
    setLoading(true);
    setError(null);
    analyticsApi.activityCalendar()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const syncAgents = async () => {
    setSyncing(true);
    try {
      await analyticsApi.syncAgents();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const from = data ? new Date(data.range.from) : new Date();
  const to = data ? new Date(data.range.to) : new Date();

  const selectedContributor: ContributorCalendar | null =
    selected != null ? data?.contributors.find((c) => c.id === selected) ?? null : null;

  const teamCells = selectedContributor ? selectedContributor.days : data?.calendar ?? [];
  const teamKind: 'human' | 'agent' = selectedContributor?.kind ?? 'human';

  const humans = data?.contributors.filter((c) => c.kind === 'human') ?? [];
  const agents = data?.contributors.filter((c) => c.kind === 'agent') ?? [];
  const totalContributions = data?.calendar.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 12, marginBottom: 20 }}>
        <button
          onClick={syncAgents}
          disabled={syncing}
          style={{
            flexShrink: 0,
            fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: syncing ? 'default' : 'pointer',
            background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? t('syncing') : t('syncAgents')}
        </button>
      </div>

      <TenantActivityPanel />

      {loading && <div style={cardStyle}>{t('loading')}</div>}
      {error && <div style={{ ...cardStyle, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

      {data && !loading && (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Stat label={t('stat.contributions')} value={totalContributions.toLocaleString()} />
            <Stat label={t('stat.teamMembers')} value={String(data.contributors.length)} />
            <Stat label={t('stat.humans')} value={String(humans.length)} accent="#39d353" />
            <Stat label={t('stat.agents')} value={String(agents.length)} accent="#b388ff" />
          </div>

          {/* Team / selected calendar */}
          <div style={{ ...cardStyle, marginBottom: 20, overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {selectedContributor ? selectedContributor.displayName : t('wholeTeam')}
              </h2>
              {selectedContributor && (
                <button onClick={() => setSelected(null)} style={linkBtn}>{t('backToTeam')}</button>
              )}
            </div>
            <Heatmap from={from} to={to} cells={teamCells} kind={teamKind} />
            <Legend />
          </div>

          {/* Per-contributor rows */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{t('leaderboard')}</h2>
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
            {data.contributors.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: 8 }}>
                {t('empty')}
              </div>
            ) : viewMode === 'card' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.contributors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 8,
                      background: selected === c.id ? 'var(--bg-hover, rgba(255,255,255,0.04))' : 'transparent',
                      border: '1px solid transparent', cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}
                  >
                    <span style={{ flex: '0 0 180px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.displayName}</span>
                    </span>
                    <KindBadge kind={c.kind} />
                    <span style={{ flex: 1 }} />
                    {c.jobTitle && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.jobTitle}</span>}
                    <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.total.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ ...tableWrapStyle, overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={theadRowStyle}>
                      <th style={thStyle}>{t('col.rank')}</th>
                      <th style={thStyle}>{t('col.contributor')}</th>
                      <th style={thStyle}>{t('col.type')}</th>
                      <th style={thStyle}>{t('col.role')}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{t('col.contributions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.contributors].sort((a, b) => b.total - a.total).map((c, i) => (
                      <tr
                        key={c.id}
                        style={{
                          ...trStyle,
                          cursor: 'pointer',
                          background: selected === c.id ? 'var(--bg-hover, rgba(255,255,255,0.04))' : 'transparent',
                        }}
                        onClick={() => setSelected(c.id)}
                      >
                        <td style={{ ...tdMutedStyle, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{c.displayName}</td>
                        <td style={tdStyle}><KindBadge kind={c.kind} /></td>
                        <td style={tdMutedStyle}>{c.jobTitle ?? '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? 'inherit' }}>{value}</div>
    </div>
  );
}

function Legend() {
  const t = useTranslations('contributors');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
      <span>{t('legend.less')}</span>
      {[EMPTY, ...GREEN].map((c, i) => (
        <span key={i} style={{ width: CELL, height: CELL, borderRadius: 2, background: c, display: 'inline-block' }} />
      ))}
      <span>{t('legend.more')}</span>
      <span style={{ marginLeft: 12 }}>{t('legend.agents')}</span>
      {PURPLE.map((c, i) => (
        <span key={i} style={{ width: CELL, height: CELL, borderRadius: 2, background: c, display: 'inline-block' }} />
      ))}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: 13, padding: 0,
};
