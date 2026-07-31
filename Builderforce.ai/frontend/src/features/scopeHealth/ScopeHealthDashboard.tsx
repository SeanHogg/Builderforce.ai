/**
 * Scope Health Dashboard
 *
 * Self-contained component. Displays the three core Scope Health metrics:
 *   1. Scope Creep Indicator (with sparkline placeholder)
 *   2. New vs Completed Work Ratio (dual-bar chart + drill-down)
 *   3. Epic Completion Table with derived status (sortable / filterable)
 *
 * Also renders the composite Scope Health Summary Panel and a tabbed detail
 * area. Embeddable via iframe by passing ?embed=1.
 *
 * All metrics are computed reactively by the useScopeHealth hook — no API
 * calls, no external UI library dependencies.
 */

import React, { useMemo, useState } from 'react';
import { useScopeHealth } from './hooks/useScopeHealth';
import type {
  Task,
  Period,
  CalculationMode,
  EpicCompletion,
  ScopeHealthScore,
  ScopeCreepScore,
  NewVsCompletedRatio,
  CreepStatus,
  RatioStatus,
  EpicStatus,
  DrillDownItem,
} from './types';

/* ── Props ──────────────────────────────────────────────────────────────── */

export interface ScopeHealthDashboardProps {
  tasks: Task[];
  projectId?: string;
  baselineLockedAt?: string;
  calculationMode?: CalculationMode;
}

/* ── Status colour tokens ───────────────────────────────────────────────── */

const CREEP_COLORS: Record<CreepStatus, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};

const RATIO_COLORS: Record<RatioStatus, string> = {
  normal: '#22c55e',
  warning: '#ef4444',
};

const EPIC_COLORS: Record<EpicStatus, string> = {
  on_track: '#22c55e',
  at_risk: '#eab308',
  off_track: '#ef4444',
};

/* ── Tiny helpers ───────────────────────────────────────────────────────── */

/** Download a string as a CSV file. */
function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Escape a CSV field value. */
function csvField(v: unknown): string {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/** Days between two ISO date strings. */
function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.ceil((db - da) / (1000 * 60 * 60 * 24));
}

/** Sort direction toggle helper. */
function nextSortDir(
  current: 'asc' | 'desc' | undefined,
): 'asc' | 'desc' | undefined {
  if (!current) return 'asc';
  if (current === 'asc') return 'desc';
  return undefined;
}

/* ── Mini Sparkline (inline SVG) ────────────────────────────────────────── */

const Sparkline: React.FC<{ data: number[]; color: string; height?: number }> = ({
  data,
  color,
  height = 32,
}) => {
  if (!data.length)
    return <div style={{ height, opacity: 0.5 }}>No data yet</div>;
  const w = 120;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * w},${
          height - ((v - min) / range) * (height - 2) - 1
        }`,
    )
    .join(' ');
  return (
    <svg width={w} height={height} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
};

/* ── Dual-bar chart (inline) ────────────────────────────────────────────── */

const DualBarChart: React.FC<{
  added: number;
  completed: number;
  addedColor?: string;
  completedColor?: string;
}> = ({
  added,
  completed,
  addedColor = '#ef4444',
  completedColor = '#22c55e',
}) => {
  const max = Math.max(added, completed, 1);
  const w = 180;
  const barH = 14;
  const gap = 8;
  const h = barH * 2 + gap + 20;
  return (
    <svg
      width={w}
      height={h}
      style={{ display: 'block', font: '10px sans-serif' }}
    >
      <text x={0} y={10} fill="#666">
        Added
      </text>
      <rect
        x={50}
        y={2}
        width={(added / max) * (w - 60)}
        height={barH}
        fill={addedColor}
        rx={2}
      />
      <text x={w - 30} y={10} fill="#666" textAnchor="end">
        {added}
      </text>

      <text x={0} y={10 + barH + gap} fill="#666">
        Done
      </text>
      <rect
        x={50}
        y={2 + barH + gap}
        width={(completed / max) * (w - 60)}
        height={barH}
        fill={completedColor}
        rx={2}
      />
      <text x={w - 30} y={10 + barH + gap} fill="#666" textAnchor="end">
        {completed}
      </text>
    </svg>
  );
};

/* ── Status badge ───────────────────────────────────────────────────────── */

const Badge: React.FC<{
  label: string;
  color?: string;
  bg?: string;
}> = ({ label, color = '#fff', bg = '#6b7280' }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      color,
      background: bg,
      textTransform: 'capitalize',
    }}
  >
    {label.replace(/_/g, ' ')}
  </span>
);

/* ── Toggle ─────────────────────────────────────────────────────────────── */

const Toggle: React.FC<{
  label: string;
  checked: boolean;
  onChange: () => void;
}> = ({ label, checked, onChange }) => (
  <label
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 13,
      cursor: 'pointer',
    }}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={{ margin: 0 }}
    />
    {label}
  </label>
);

/* ── Tab bar ────────────────────────────────────────────────────────────── */

const Tabs: React.FC<{
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div
    style={{
      display: 'flex',
      gap: 0,
      borderBottom: '2px solid #e5e7eb',
      marginBottom: 16,
    }}
  >
    {tabs.map((t) => (
      <button
        key={t.id}
        onClick={() => onChange(t.id)}
        style={{
          padding: '8px 16px',
          background: 'none',
          border: 'none',
          borderBottom:
            t.id === active ? '2px solid #2563eb' : '2px solid transparent',
          marginBottom: -2,
          fontWeight: t.id === active ? 600 : 400,
          color: t.id === active ? '#2563eb' : '#6b7280',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        {t.label}
      </button>
    ))}
  </div>
);

/* ── Notification callout ───────────────────────────────────────────────── */

const NotificationCallout: React.FC<{
  title: string;
  message: string;
  onView?: () => void;
}> = ({ title, message, onView }) => (
  <div
    style={{
      background: '#fef3c7',
      border: '1px solid #f59e0b',
      borderRadius: 8,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}
  >
    <div>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#92400e' }}>
        {message}
      </p>
    </div>
    {onView && (
      <button
        onClick={onView}
        style={{
          padding: '6px 12px',
          background: '#f59e0b',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        View Details
      </button>
    )}
  </div>
);

/* ── Metric card ────────────────────────────────────────────────────────── */

const MetricCard: React.FC<{
  title: string;
  value: string;
  color: string;
  description: string;
  children?: React.ReactNode;
}> = ({ title, value, color, description, children }) => (
  <div
    style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 20,
      boxShadow: '0 1px 3px rgba(0,0,0,.05)',
    }}
  >
    <h4
      style={{
        margin: 0,
        fontSize: 13,
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '.5px',
      }}
    >
      {title}
    </h4>
    <div style={{ fontSize: 32, fontWeight: 700, color, margin: '8px 0' }}>
      {value}
    </div>
    <p style={{ margin: '0 0 12px', fontSize: 12, color: '#9ca3af' }}>
      {description}
    </p>
    {children}
  </div>
);

/* ── Drill-down table (FR-2.4) ──────────────────────────────────────────── */

const DrillDownTable: React.FC<{ items: DrillDownItem[] }> = ({ items }) => {
  if (items.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>
        No items in this window.
      </p>
    );
  }
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
      }}
    >
      <thead>
        <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
          <th style={thStyle}>ID</th>
          <th style={thStyle}>Title</th>
          <th style={thStyle}>Type</th>
          <th style={thStyle}>Status</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Points</th>
          <th style={thStyle}>Creator</th>
          <th style={thStyle}>Added</th>
          <th style={thStyle}>Completed</th>
          <th style={thStyle}>Epic</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={tdStyle}>{item.id}</td>
            <td style={tdStyle}><strong>{item.title}</strong></td>
            <td style={tdStyle}>{item.type}</td>
            <td style={tdStyle}>
              <Badge label={item.status.replace(/-/g, ' ')} />
            </td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>
              {item.storyPoints || '—'}
            </td>
            <td style={tdStyle}>{item.creator || '—'}</td>
            <td style={tdStyle}>{item.addedDate}</td>
            <td style={tdStyle}>{item.completedDate || '—'}</td>
            <td style={tdStyle}>{item.epicName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/* ── Filter input ───────────────────────────────────────────────────────── */

const FilterInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder = 'Filter...' }) => (
  <input
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      padding: '6px 10px',
      borderRadius: 6,
      border: '1px solid #d1d5db',
      fontSize: 13,
      width: 200,
    }}
  />
);

/* ══════════════════════════════════════════════════════════════════════════
   EPIC COMPLETION TABLE (FR-3.2)
   Sortable columns: Name, Owner, Status, Completion%, Total, Due Date, Days
   ══════════════════════════════════════════════════════════════════════════ */

type EpicSortKey =
  | 'name'
  | 'owner'
  | 'completion'
  | 'status'
  | 'total'
  | 'dueDate'
  | 'daysLeft';

const EpicCompletionTable: React.FC<{
  epicCompletions: EpicCompletion[];
  embedMode: boolean;
}> = ({ epicCompletions, embedMode }) => {
  const [sortKey, setSortKey] = useState<EpicSortKey | undefined>(undefined);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | undefined>(undefined);
  const [filter, setFilter] = useState('');

  const handleSort = (key: EpicSortKey) => {
    if (sortKey === key) {
      const next = nextSortDir(sortDir);
      setSortDir(next);
      if (!next) setSortKey(undefined);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    let list = [...epicCompletions];

    // Filter
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (e) =>
          e.epic.title.toLowerCase().includes(q) ||
          (e.epic.owner ?? '').toLowerCase().includes(q),
      );
    }

    // Sort
    if (sortKey && sortDir) {
      list.sort((a, b) => {
        let va: number | string = 0;
        let vb: number | string = 0;
        switch (sortKey) {
          case 'name':
            va = a.epic.title.toLowerCase();
            vb = b.epic.title.toLowerCase();
            return sortDir === 'asc'
              ? (va as string).localeCompare(vb as string)
              : (vb as string).localeCompare(va as string);
          case 'owner':
            va = (a.epic.owner ?? '').toLowerCase();
            vb = (b.epic.owner ?? '').toLowerCase();
            return sortDir === 'asc'
              ? (va as string).localeCompare(vb as string)
              : (vb as string).localeCompare(va as string);
          case 'completion':
            va = a.completionPercentage;
            vb = b.completionPercentage;
            break;
          case 'status':
            va = a.status;
            vb = b.status;
            return sortDir === 'asc'
              ? (va as string).localeCompare(vb as string)
              : (vb as string).localeCompare(va as string);
          case 'total':
            va = a.epic.totalItems;
            vb = b.epic.totalItems;
            break;
          case 'dueDate':
            va = a.epic.dueDate ?? '9999';
            vb = b.epic.dueDate ?? '9999';
            return sortDir === 'asc'
              ? (va as string).localeCompare(vb as string)
              : (vb as string).localeCompare(va as string);
          case 'daysLeft': {
            const now = new Date().toISOString().slice(0, 10);
            va = a.epic.dueDate ? daysBetween(now, a.epic.dueDate) : 99999;
            vb = b.epic.dueDate ? daysBetween(now, b.epic.dueDate) : 99999;
            break;
          }
        }
        if (typeof va === 'number' && typeof vb === 'number') {
          return sortDir === 'asc' ? va - vb : vb - va;
        }
        return 0;
      });
    }
    return list;
  }, [epicCompletions, sortKey, sortDir, filter]);

  const sortIndicator = (key: EpicSortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        padding: 24,
        overflowX: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          Epic Completion
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FilterInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter epics..."
          />
          {!embedMode && (
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              {sorted.length} of {epicCompletions.length} epics
            </span>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>
          {filter ? 'No epics match filter.' : 'No epics found'}
        </p>
      ) : (
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <SortTh
                active={sortKey === 'name'}
                onClick={() => handleSort('name')}
              >
                Epic Name{sortIndicator('name')}
              </SortTh>
              <SortTh
                active={sortKey === 'owner'}
                onClick={() => handleSort('owner')}
              >
                Owner{sortIndicator('owner')}
              </SortTh>
              <SortTh
                active={sortKey === 'status'}
                onClick={() => handleSort('status')}
              >
                Status{sortIndicator('status')}
              </SortTh>
              <SortTh
                active={sortKey === 'completion'}
                align="right"
                onClick={() => handleSort('completion')}
              >
                Completion{sortIndicator('completion')}
              </SortTh>
              <SortTh
                active={sortKey === 'total'}
                align="right"
                onClick={() => handleSort('total')}
              >
                Total{sortIndicator('total')}
              </SortTh>
              <th style={{ ...thStyle, textAlign: 'right' }}>Completed</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Expected</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Delta</th>
              <SortTh
                active={sortKey === 'dueDate'}
                onClick={() => handleSort('dueDate')}
              >
                Due Date{sortIndicator('dueDate')}
              </SortTh>
              <SortTh
                active={sortKey === 'daysLeft'}
                align="right"
                onClick={() => handleSort('daysLeft')}
              >
                Days Until Due{sortIndicator('daysLeft')}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const now = new Date().toISOString().slice(0, 10);
              const daysLeft = e.epic.dueDate
                ? daysBetween(now, e.epic.dueDate)
                : null;
              return (
                <tr
                  key={e.epic.id}
                  style={{ borderBottom: '1px solid #f3f4f6' }}
                >
                  <td style={tdStyle}>
                    <strong>{e.epic.title}</strong>
                  </td>
                  <td style={tdStyle}>{e.epic.owner || '—'}</td>
                  <td style={tdStyle}>
                    <Badge label={e.status} bg={EPIC_COLORS[e.status]} color="#fff" />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {e.completionPercentage.toFixed(1)}%
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {e.epic.totalItems}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {e.epic.completedItems}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {e.expectedCompletionPercentage.toFixed(1)}%
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      color: e.deltaPercentage > 0 ? '#ef4444' : '#22c55e',
                    }}
                  >
                    {e.deltaPercentage > 0 ? '+' : ''}
                    {e.deltaPercentage.toFixed(1)}%
                  </td>
                  <td style={tdStyle}>
                    {e.epic.dueDate
                      ? new Date(e.epic.dueDate).toLocaleDateString()
                      : '—'}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      color:
                        daysLeft !== null && daysLeft < 0
                          ? '#ef4444'
                          : daysLeft !== null && daysLeft <= 3
                            ? '#eab308'
                            : '#374151',
                    }}
                  >
                    {daysLeft !== null ? daysLeft : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!embedMode && (
        <p style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>
          Status is derived from actual vs expected completion based on each
          epic's own timeline. At Risk: 10–25 pts behind; Off Track: &gt;25 pts
          behind.
        </p>
      )}
    </div>
  );
};

/* ── Sortable table header ──────────────────────────────────────────────── */

const SortTh: React.FC<{
  children: React.ReactNode;
  active?: boolean;
  align?: 'left' | 'right';
  onClick: () => void;
}> = ({ children, active, align = 'left', onClick }) => (
  <th
    onClick={onClick}
    style={{
      ...thStyle,
      textAlign: align,
      cursor: 'pointer',
      color: active ? '#2563eb' : '#6b7280',
      fontWeight: active ? 700 : 600,
    }}
  >
    {children}
  </th>
);

/* ══════════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════════════════════════ */

export const ScopeHealthDashboard: React.FC<ScopeHealthDashboardProps> = ({
  tasks,
  projectId,
  baselineLockedAt,
  calculationMode = 'item_count',
}) => {
  const [mode, setMode] = useState<CalculationMode>(calculationMode);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>({
    windowStart: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    windowEnd: new Date().toISOString(),
    label: 'Last 14 Days',
  });
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const [drillDownView, setDrillDownView] = useState<
    'added' | 'completed' | null
  >(null);

  const embedMode =
    typeof window !== 'undefined' &&
    window.location.search.includes('embed=1');

  /* ── Period presets ─────────────────────────────────────────────────── */
  const periods: Period[] = useMemo(
    () => [
      {
        windowStart: new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        windowEnd: new Date().toISOString(),
        label: 'Last 7 Days',
      },
      {
        windowStart: new Date(
          Date.now() - 14 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        windowEnd: new Date().toISOString(),
        label: 'Last 14 Days',
      },
      {
        windowStart: new Date(
          Date.now() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        windowEnd: new Date().toISOString(),
        label: 'Last 30 Days',
      },
      {
        windowStart: new Date(
          Date.now() - 90 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        windowEnd: new Date().toISOString(),
        label: 'Last Quarter',
      },
    ],
    [],
  );

  /* ── Compute metrics ────────────────────────────────────────────────── */
  const { scopeCreep, ratio, epicCompletions, compositeScore } =
    useScopeHealth({
      tasks,
      period: selectedPeriod,
      mode,
      baselineInfo: baselineLockedAt
        ? {
            id: 'baseline',
            lockedAt: baselineLockedAt,
            itemCount: tasks.length,
            totalStoryPoints: tasks.reduce(
              (s, t) => s + (t.storyPoints ?? 0),
              0,
            ),
          }
        : undefined,
    });

  /* ── Build drill-down items from ratio data ─────────────────────────── */
  const epicById = useMemo(
    () => new Map(epicCompletions.map((e) => [e.epic.id, e.epic.title])),
    [epicCompletions],
  );

  const addedDrillDown: DrillDownItem[] = useMemo(
    () =>
      ratio.addedInWindow.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type ?? 'task',
        status: t.status,
        storyPoints: t.storyPoints ?? 0,
        creator: t.creator ?? '',
        addedDate: (t.createdAt ?? '').slice(0, 10),
        completedDate: (t.completedAt ?? '').slice(0, 10),
        epicName: t.parentTaskId
          ? (epicById.get(String(t.parentTaskId)) ?? '')
          : '',
      })),
    [ratio.addedInWindow, epicById],
  );

  const completedDrillDown: DrillDownItem[] = useMemo(
    () =>
      ratio.completedInWindow.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type ?? 'task',
        status: t.status,
        storyPoints: t.storyPoints ?? 0,
        creator: t.creator ?? '',
        addedDate: (t.createdAt ?? '').slice(0, 10),
        completedDate: (t.completedAt ?? '').slice(0, 10),
        epicName: t.parentTaskId
          ? (epicById.get(String(t.parentTaskId)) ?? '')
          : '',
      })),
    [ratio.completedInWindow, epicById],
  );

  /* ── At-risk detection ──────────────────────────────────────────────── */
  const atRiskCount = useMemo(
    () =>
      epicCompletions.filter(
        (e) => e.status === 'at_risk' || e.status === 'off_track',
      ).length,
    [epicCompletions],
  );

  /* ── Export CSV (FR-2.5 / AC-6) ─────────────────────────────────────── */
  const handleExport = () => {
    const rows = [...ratio.addedInWindow, ...ratio.completedInWindow];
    // dedup by id
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    let csv =
      'ID,Title,Type,Status,Points,Added Date,Completed Date,Epic\n';
    for (const t of unique) {
      const epicName = t.parentTaskId
        ? (epicById.get(String(t.parentTaskId)) ?? '')
        : '';
      csv +=
        [
          csvField(t.id),
          csvField(t.title),
          csvField(t.type ?? 'task'),
          csvField(t.status),
          csvField(t.storyPoints ?? 0),
          csvField((t.createdAt ?? '').slice(0, 10)),
          csvField((t.completedAt ?? '').slice(0, 10)),
          csvField(epicName),
        ].join(',') + '\n';
    }

    downloadCSV(
      csv,
      `scope-health-${selectedPeriod.label.replace(/\s+/g, '-')}.csv`,
    );
  };

  /* ── Composite status word ──────────────────────────────────────────── */
  const healthLabel =
    compositeScore.value >= 70
      ? 'Healthy'
      : compositeScore.value >= 45
        ? 'At Risk'
        : 'Critical';

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div
      style={{
        fontFamily:
          '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        ...(embedMode ? { minHeight: '100vh' } : {}),
        padding: embedMode ? 16 : 24,
        background: '#f9fafb',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      {!embedMode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: '#111827',
            }}
          >
            Scope Health Dashboard
          </h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <Toggle
              label="Item Count"
              checked={mode === 'item_count'}
              onChange={() => setMode('item_count')}
            />
            <Toggle
              label="Story Points"
              checked={mode === 'story_points'}
              onChange={() => setMode('story_points')}
            />
            <select
              value={selectedPeriod.label}
              onChange={(e) => {
                const p = periods.find((p) => p.label === e.target.value);
                if (p) setSelectedPeriod(p);
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: 13,
              }}
            >
              {periods.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleExport}
              disabled={!tasks.length}
              style={{
                padding: '6px 14px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: tasks.length ? 'pointer' : 'not-allowed',
                opacity: tasks.length ? 1 : 0.5,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Export CSV
            </button>
          </div>
        </div>
      )}

      {/* ── At-risk alert ────────────────────────────────────────────── */}
      {!embedMode && !dismissedAlert && atRiskCount > 0 && (
        <div style={{ marginBottom: 20 }}>
          <NotificationCallout
            title="Scope Health Alert"
            message={`${atRiskCount} epic(s) are at risk or off track.`}
            onView={() => {
              setDismissedAlert(true);
              setActiveTab('epics');
            }}
          />
        </div>
      )}

      {/* ── Summary Panel (FR-4.1) ───────────────────────────────────── */}
      <SummaryPanel
        scopeCreep={scopeCreep}
        ratio={ratio}
        compositeScore={compositeScore}
        healthLabel={healthLabel}
        embedMode={embedMode}
      />

      {/* ── Metric cards ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
          marginTop: 24,
        }}
      >
        {/* Scope Creep */}
        <MetricCard
          title="Scope Creep Score"
          value={`${scopeCreep.value.toFixed(1)}%`}
          color={CREEP_COLORS[scopeCreep.status]}
          description={`${scopeCreep.itemsAddedPostBaseline} items added post-baseline (${scopeCreep.baselineItemCount} baseline)`}
        >
          {!embedMode && (
            <Sparkline
              data={[scopeCreep.value, scopeCreep.value]}
              color={CREEP_COLORS[scopeCreep.status]}
            />
          )}
          <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
            Baseline lock:{' '}
            {baselineLockedAt
              ? new Date(baselineLockedAt).toLocaleDateString()
              : 'Not locked'}
          </div>
        </MetricCard>

        {/* New vs Done */}
        <MetricCard
          title="New / Completed Ratio"
          value={
            Number.isFinite(ratio.value) ? ratio.value.toFixed(2) : '—'
          }
          color={RATIO_COLORS[ratio.status]}
          description={`${
            mode === 'item_count' ? ratio.addedItems : ratio.addedStoryPoints
          } added / ${
            mode === 'item_count'
              ? ratio.completedItems
              : ratio.completedStoryPoints
          } completed`}
        >
          {!embedMode && (
            <DualBarChart
              added={
                mode === 'item_count'
                  ? ratio.addedItems
                  : ratio.addedStoryPoints
              }
              completed={
                mode === 'item_count'
                  ? ratio.completedItems
                  : ratio.completedStoryPoints
              }
            />
          )}
          {ratio.value > 1.0 && (
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 12,
                fontWeight: 600,
                color: '#ef4444',
              }}
            >
              ⚠ More work added than completed
            </p>
          )}
          {/* Drill-down buttons */}
          {!embedMode && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                onClick={() =>
                  setDrillDownView(
                    drillDownView === 'added' ? null : 'added',
                  )
                }
                style={{
                  padding: '4px 12px',
                  background:
                    drillDownView === 'added' ? '#2563eb' : '#f3f4f6',
                  color: drillDownView === 'added' ? '#fff' : '#374151',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                View Added ({addedDrillDown.length})
              </button>
              <button
                onClick={() =>
                  setDrillDownView(
                    drillDownView === 'completed' ? null : 'completed',
                  )
                }
                style={{
                  padding: '4px 12px',
                  background:
                    drillDownView === 'completed' ? '#2563eb' : '#f3f4f6',
                  color: drillDownView === 'completed' ? '#fff' : '#374151',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                View Completed ({completedDrillDown.length})
              </button>
            </div>
          )}
        </MetricCard>

        {/* Composite */}
        <MetricCard
          title="Composite Health"
          value={compositeScore.value.toFixed(1)}
          color={
            compositeScore.value >= 70
              ? '#22c55e'
              : compositeScore.value >= 45
                ? '#eab308'
                : '#ef4444'
          }
          description={`Status: ${healthLabel}`}
        >
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                background: '#e5e7eb',
                borderRadius: 999,
                height: 8,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(compositeScore.value, 100)}%`,
                  height: '100%',
                  background:
                    compositeScore.value >= 70
                      ? '#22c55e'
                      : compositeScore.value >= 45
                        ? '#eab308'
                        : '#ef4444',
                  borderRadius: 999,
                  transition: 'width .3s',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                fontSize: 11,
                color: '#6b7280',
              }}
            >
              <span>
                Creep: {compositeScore.breakdown.scopeCreep.toFixed(1)}
              </span>
              <span>
                Ratio: {compositeScore.breakdown.ratio.toFixed(1)}
              </span>
              <span>
                Epic:{' '}
                {compositeScore.breakdown.epicCompletion.toFixed(1)}
              </span>
            </div>
          </div>
        </MetricCard>
      </div>

      {/* ── Drill-down panel ─────────────────────────────────────────── */}
      {!embedMode && drillDownView && (
        <div
          style={{
            marginTop: 24,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            padding: 24,
            overflowX: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {drillDownView === 'added'
                ? 'Items Added in Window'
                : 'Items Completed in Window'}
            </h4>
            <button
              onClick={() => setDrillDownView(null)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 18,
                color: '#6b7280',
              }}
            >
              ✕
            </button>
          </div>
          <DrillDownTable
            items={
              drillDownView === 'added'
                ? addedDrillDown
                : completedDrillDown
            }
          />
        </div>
      )}

      {/* ── Tabbed detail area ────────────────────────────────────────── */}
      {!embedMode && (
        <div style={{ marginTop: 32 }}>
          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'epics', label: 'Epic Completion' },
              { id: 'exports', label: 'Exports' },
            ]}
            active={activeTab}
            onChange={setActiveTab}
          />

          {activeTab === 'overview' && (
            <div
              style={{
                background: '#fff',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
                padding: 24,
              }}
            >
              <h4
                style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}
              >
                Scope Health Overview
              </h4>
              <p style={{ color: '#6b7280', fontSize: 14 }}>
                This dashboard tracks three signals:{' '}
                <strong>Scope Creep</strong> (items added after baseline
                lock), <strong>New/Done Ratio</strong> (work added vs
                completed in the window), and{' '}
                <strong>Epic Completion</strong> (how close each epic is to
                being done vs time elapsed). Use the tabs above to drill into
                epic details or export data.
              </p>
            </div>
          )}

          {activeTab === 'epics' && (
            <EpicCompletionTable
              epicCompletions={epicCompletions}
              embedMode={embedMode}
            />
          )}

          {activeTab === 'exports' && (
            <div
              style={{
                background: '#fff',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
                padding: 24,
              }}
            >
              <h4
                style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}
              >
                Export Data
              </h4>
              <button
                onClick={handleExport}
                disabled={!tasks.length}
                style={{
                  padding: '10px 24px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: tasks.length ? 'pointer' : 'not-allowed',
                  opacity: tasks.length ? 1 : 0.5,
                  fontWeight: 600,
                }}
              >
                Export New/Completed Ratio (CSV)
              </button>
              <p
                style={{ color: '#6b7280', fontSize: 12, marginTop: 8 }}
              >
                Downloads one row per work item in the selected period (
                {selectedPeriod.label}). Columns: ID, Title, Type, Status,
                Points, Added Date, Completed Date, Epic.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Embed footer ──────────────────────────────────────────────── */}
      {embedMode && (
        <div
          style={{
            textAlign: 'center',
            padding: '8px 0',
            fontSize: 11,
            color: '#9ca3af',
            borderTop: '1px solid #e5e7eb',
            marginTop: 48,
          }}
        >
          Scope Health Dashboard · BuilderForce.AI
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ══════════════════════════════════════════════════════════════════════════ */

/** Top-of-page summary banner. */
const SummaryPanel: React.FC<{
  scopeCreep: ScopeCreepScore;
  ratio: NewVsCompletedRatio;
  compositeScore: ScopeHealthScore;
  healthLabel: string;
  embedMode: boolean;
}> = ({ scopeCreep, ratio, compositeScore, healthLabel, embedMode }) => (
  <div
    style={{
      background: 'linear-gradient(135deg, #2563eb, #4338ca)',
      borderRadius: 16,
      padding: 24,
      color: '#fff',
      boxShadow: '0 4px 14px rgba(0,0,0,.1)',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          Scope Health Score
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.85 }}>
          Based on Scope Creep, New/Done Ratio, and Epic Completion
        </p>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 40, fontWeight: 700 }}>
          {Number.isFinite(compositeScore.value)
            ? compositeScore.value.toFixed(1)
            : '—'}
        </div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>/ 100</div>
      </div>
    </div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
        marginTop: 16,
        fontSize: 13,
      }}
    >
      <div>
        <span style={{ opacity: 0.75 }}>Scope Creep: </span>
        <strong>
          {Number.isFinite(scopeCreep.value)
            ? `${scopeCreep.value.toFixed(1)}%`
            : '—'}
        </strong>
      </div>
      <div>
        <span style={{ opacity: 0.75 }}>New/Done: </span>
        <strong>
          {Number.isFinite(ratio.value)
            ? ratio.value.toFixed(2)
            : '—'}
        </strong>
      </div>
      <div>
        <span style={{ opacity: 0.75 }}>Epic Completion: </span>
        <strong>
          {Number.isFinite(compositeScore.breakdown.epicCompletion)
            ? `${compositeScore.breakdown.epicCompletion.toFixed(1)}%`
            : '—'}
        </strong>
      </div>
    </div>
    {!embedMode && (
      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
        <strong>Status:</strong> {healthLabel}
      </div>
    )}
  </div>
);

/* ── Shared styles ──────────────────────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 600,
  color: '#6b7280',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '.3px',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#374151',
  verticalAlign: 'middle',
};
