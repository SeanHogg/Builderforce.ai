import { useMemo, useState, useCallback } from 'react';
import {
  DEFAULT_TRACKING_LABELS,
  type TrackedItem,
  type TrackedStatus,
  type TrackedRiskLevel,
  type TrackingGroup,
  type TrackingLabels,
  type TrackingPageData,
  type TrackingFilter,
  type TrackingSort,
} from './types';

/** ─── Color tokens for risk-level cells (FR-3) ─── */
const RISK_COLORS: Record<TrackedRiskLevel, string> = {
  Low: 'var(--bf-risk-low, #22c55e)',
  Medium: 'var(--bf-risk-medium, #eab308)',
  High: 'var(--bf-risk-high, #f97316)',
  Critical: 'var(--bf-risk-critical, #ef4444)',
};

/** ─── Severity order for sorting (FR-4) ─── */
const RISK_ORDER: Record<TrackedRiskLevel, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

/** Status order (optional — useful when grouping) */
const STATUS_ORDER: Record<TrackedStatus, number> = {
  'Not Started': 0,
  'In Progress': 1,
  Blocked: 2,
  'In Review': 3,
  Complete: 4,
};

/** ─── Helpers ─── */

function applyFilter(items: TrackedItem[], filter?: TrackingFilter): TrackedItem[] {
  if (!filter) return items;
  return items.filter((it) => {
    if (filter.statusFilters && filter.statusFilters.size > 0 && !filter.statusFilters.has(it.status)) return false;
    if (filter.riskFilters && filter.riskFilters.size > 0 && !filter.riskFilters.has(it.riskLevel)) return false;
    return true;
  });
}

function applySort(items: TrackedItem[], sort?: TrackingSort): TrackedItem[] {
  if (!sort) return items;
  return [...items].sort((a, b) => {
    if (sort.riskLevel === 'desc') {
      const cmp = RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
      if (cmp !== 0) return cmp; // lower number = higher severity → first
    }
    if (sort.completionPct) {
      const cmp = a.completionPct - b.completionPct;
      return sort.completionPct === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

/** ─── CSV / Markdown export (FR-5) ─── */
function toCsv(row: TrackedItem): string {
  const esc = (s: string | null) => {
    if (s == null) return '';
    const v = s.replace(/"/g, '""');
    return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v}"` : v;
  };
  return [row.key, row.title, row.status, String(row.completionPct), row.riskLevel, esc(row.keyBlocker), esc(row.nextAction)].join(',');
}

function toMdRow(row: TrackedItem): string {
  const esc = (s: string | null) => (s ?? '').replace(/\|/g, '\\|');
  return `| ${esc(row.key)} | ${esc(row.title)} | ${esc(row.status)} | ${row.completionPct}% | ${esc(row.riskLevel)} | ${esc(row.keyBlocker)} | ${esc(row.nextAction)} |`;
}

/** ─── Component props ─── */

export interface TrackingListViewProps {
  data: TrackingPageData | null;
  loading?: boolean;
  error?: string | null;
  labels?: Partial<TrackingLabels>;
  /** Called when user taps a Next Action field to edit it inline */
  onEditNextAction?: (taskId: number, currentNextAction: string) => void;
  /** Called when user taps a Key Blocker field to edit it inline */
  onEditKeyBlocker?: (taskId: number, currentKeyBlocker: string | null) => void;
  /** Called with the currently visible (filtered) items for export */
  onExport?: (items: TrackedItem[]) => void;
}

/**
 * <TrackingListView> — the presentational surface for the project-status tracking
 * feature. Displays a sortable, filterable table of tracked items with progress
 * bars, color-coded risk cells, and an export button. Themed via `--bf-*` CSS
 * variables → works in dark/light and reflows to one column on narrow panels.
 *
 * Implements:
 *   FR-1: Five fields displayed (status, completionPct, riskLevel, keyBlocker, nextAction)
 *   FR-3: Progress bar inside cell; risk color; Blocked row accent
 *   FR-4: Filter by status / riskLevel (AND); sort by completionPct / riskLevel
 *   FR-5: CSV + Markdown export buttons (respects active filters)
 *   AC-2: Risk WCAG AA contrast using --bf-risk-* tokens (host token set determines)
 */
export function TrackingListView({
  data,
  loading,
  error,
  labels,
  onEditNextAction,
  onEditKeyBlocker,
  onExport,
}: TrackingListViewProps) {
  const L = useMemo<TrackingLabels>(() => ({ ...DEFAULT_TRACKING_LABELS, ...(labels ?? {}) }), [labels]);
  const [activeFilters, setActiveFilters] = useState<TrackingFilter>({});
  const [activeSort, setActiveSort] = useState<TrackingSort>({});

  /** Derive all items (flat) from data */
  const allItems = useMemo<TrackedItem[]>(() => {
    if (!data) return [];
    if (data.items) return data.items;
    if (data.groups) return data.groups.flatMap((g) => g.items);
    return [];
  }, [data]);

  /** Apply local filter/sort */
  const visibleItems = useMemo(() => applySort(applyFilter(allItems, activeFilters), activeSort), [allItems, activeFilters, activeSort]);

  /** ─── Filter chip toggling ─── */
  const toggleStatusFilter = useCallback((s: TrackedStatus) => {
    setActiveFilters((prev) => {
      const cur = new Set(prev.statusFilters ?? []);
      if (cur.has(s)) cur.delete(s);
      else cur.add(s);
      return { ...prev, statusFilters: cur.size > 0 ? cur : undefined };
    });
  }, []);

  const toggleRiskFilter = useCallback((r: TrackedRiskLevel) => {
    setActiveFilters((prev) => {
      const cur = new Set(prev.riskFilters ?? []);
      if (cur.has(r)) cur.delete(r);
      else cur.add(r);
      return { ...prev, riskFilters: cur.size > 0 ? cur : undefined };
    });
  }, []);

  const clearFilters = useCallback(() => setActiveFilters({}), []);

  const toggleSortCompletionPct = useCallback(() => {
    setActiveSort((prev) => {
      if (prev.completionPct === 'asc') return { ...prev, completionPct: 'desc' };
      if (prev.completionPct === 'desc') return { ...prev, completionPct: undefined };
      return { ...prev, completionPct: 'asc' };
    });
  }, []);

  const toggleSortRisk = useCallback(() => {
    setActiveSort((prev) => {
      if (prev.riskLevel === 'desc') return { ...prev, riskLevel: undefined };
      return { ...prev, riskLevel: 'desc' };
    });
  }, []);

  /** ─── Export handlers ─── */
  const handleCsvExport = useCallback(() => {
    const lines = [
      // HEADER row + timestamp comment
      '# key,title,status,completion_pct,risk_level,key_blocker,next_action',
      `# Exported: ${new Date().toISOString()}`,
    ];
    for (const it of visibleItems) lines.push(toCsv(it));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracking-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [visibleItems]);

  const handleMdExport = useCallback(() => {
    const lines = [`# Tracking Export — ${new Date().toISOString()}`, ''];
    // GFM table header
    lines.push('| Key | Title | Status | Progress | Risk | Blocker | Next Action |');
    lines.push('|-----|-------|--------|----------|------|---------|-------------|');
    for (const it of visibleItems) lines.push(toMdRow(it));
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {
      // fallback: put into a temporary textarea and copy (polyfill for older browsers)
      const ta = document.createElement('textarea');
      ta.value = lines.join('\n');
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* fail silently */ }
      document.body.removeChild(ta);
    });
  }, [visibleItems]);

  /** ─── Render ─── */

  const filterChips = (
    <div className="bf-tracking-chips">
      {/* Status filters */}
      {(['Not Started', 'In Progress', 'Blocked', 'In Review', 'Complete'] as const).map((s) => (
        <button
          key={s}
          className={`bf-chip ${activeFilters.statusFilters?.has(s) ? 'bf-chip--active' : ''}`}
          onClick={() => toggleStatusFilter(s)}
        >
          {s === 'Blocked' ? L.statusBlocked : s}
        </button>
      ))}
      <span className="bf-chip-sep" />
      {/* Risk filters */}
      {(['Critical', 'High', 'Medium', 'Low'] as const).map((r) => (
        <button
          key={r}
          className={`bf-chip bf-chip--risk ${activeFilters.riskFilters?.has(r) ? 'bf-chip--active' : ''}`}
          style={{ '--bf-chip-color': RISK_COLORS[r] } as React.CSSProperties}
          onClick={() => toggleRiskFilter(r)}
        >
          {r === 'Critical' ? L.riskCritical : r === 'High' ? L.riskHigh : r === 'Medium' ? L.riskMedium : L.riskLow}
        </button>
      ))}
      {activeFilters.statusFilters || activeFilters.riskFilters ? (
        <button className="bf-chip bf-chip--clear" onClick={clearFilters}>
          {L.clearFiltersLabel}
        </button>
      ) : null}
    </div>
  );

  const sortControls = (
    <div className="bf-tracking-sort">
      <button
        className={`bf-btn-sort ${activeSort.completionPct ? 'bf-btn-sort--active' : ''}`}
        onClick={toggleSortCompletionPct}
        title="Sort by progress"
      >
        {L.completionPctLabel} {activeSort.completionPct === 'asc' ? '▲' : activeSort.completionPct === 'desc' ? '▼' : ''}
      </button>
      <button
        className={`bf-btn-sort ${activeSort.riskLevel ? 'bf-btn-sort--active' : ''}`}
        onClick={toggleSortRisk}
        title="Sort by risk (highest first)"
      >
        {L.riskLevelLabel} {activeSort.riskLevel ? '▼' : ''}
      </button>
    </div>
  );

  const toolbar = (
    <div className="bf-tracking-toolbar">
      <div className="bf-tracking-toolbar__left">
        {filterChips}
        {sortControls}
      </div>
      <div className="bf-tracking-toolbar__right">
        <button className="bf-btn" onClick={handleCsvExport} title="Export CSV">{L.exportLabel} CSV</button>
        <button className="bf-btn" onClick={handleMdExport} title="Copy Markdown table">{L.exportLabel} MD</button>
      </div>
    </div>
  );

  const header = (
    <header className="bf-tracking-head">
      <div className="bf-tracking-head__id">
        <span className="bf-tracking-head__title">{data?.title ?? L.title ?? ''}</span>
        {visibleItems.length > 0 && <span className="bf-tracking-head__count">{visibleItems.length} {L.items}</span>}
      </div>
      {(data?.subtitle) && <div className="bf-tracking-head__sub">{data.subtitle}</div>}
      {toolbar}
    </header>
  );

  // ── error / loading / empty states ──

  if (error) {
    return (
      <div className="bf-tracking">
        {header}
        <div className="bf-360-state">
          <div className="bf-360-state__title">{L.loadError}</div>
          <div className="bf-360-state__hint">{error}</div>
        </div>
      </div>
    );
  }

  if (!data || loading) {
    return (
      <div className="bf-tracking">
        {header}
        <div className="bf-360-state"><div className="bf-360-spinner" />{L.connecting}</div>
      </div>
    );
  }

  if (visibleItems.length === 0) {
    return (
      <div className="bf-tracking">
        {header}
        <div className="bf-360-state">
          <div className="bf-360-state__title">{L.empty}</div>
          {L.emptyHint && <div className="bf-360-state__hint">{L.emptyHint}</div>}
        </div>
      </div>
    );
  }

  // ── Table body (FR-3) ──
  return (
    <div className="bf-tracking">
      {header}
      <div className="bf-tracking-table-wrap">
        <table className="bf-tracking-table">
          <thead>
            <tr>
              <th>{L.tableHeaders.key}</th>
              <th>{L.tableHeaders.title}</th>
              <th>{L.tableHeaders.status}</th>
              {/* FR-3: completion_pct rendered as numeric + progress bar */}
              <th>{L.tableHeaders.completionPct}</th>
              {/* FR-3: riskLevel color-coded */}
              <th>{L.tableHeaders.riskLevel}</th>
              <th>{L.tableHeaders.keyBlocker}</th>
              <th>{L.tableHeaders.nextAction}</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((it) => (
              <tr
                key={it.taskId}
                // FR-3: Blocked rows get a left-border accent
                className={it.status === 'Blocked' ? 'bf-tracking-row--blocked' : ''}
              >
                <td className="bf-td-key"><code>{it.key}</code></td>
                <td className="bf-td-title">{it.title}</td>
                <td>
                  <span className={`bf-status-badge bf-status--${it.status.replace(/\s+/g, '-').toLowerCase()}`}>
                    {it.status}
                  </span>
                </td>
                {/* FR-3: completionPct as numeric + progress bar */}
                <td className="bf-td-pct">
                  <div className="bf-pct-bar-wrap" role="progressbar" aria-valuenow={it.completionPct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="bf-pct-bar" style={{ width: `${Math.min(100, Math.max(0, it.completionPct))}%` }} />
                  </div>
                  <span className="bf-pct-label">{it.completionPct}%</span>
                </td>
                {/* FR-3: riskLevel color coded */}
                <td>
                  <span className="bf-risk-badge" style={{ color: RISK_COLORS[it.riskLevel] }}>
                    {it.riskLevel}
                  </span>
                </td>
                {/* FR-3: keyBlocker (nullable) */}
                <td className="bf-td-blocker">
                  {it.keyBlocker ? (
                    <button
                      className="bf-link-btn"
                      onClick={() => onEditKeyBlocker?.(it.taskId, it.keyBlocker)}
                      title={it.keyBlocker}
                    >
                      {it.keyBlocker}
                    </button>
                  ) : (
                    <button className="bf-link-btn bf-link-btn--null" onClick={() => onEditKeyBlocker?.(it.taskId, null)}>
                      —
                    </button>
                  )}
                </td>
                {/* FR-3: nextAction (required) */}
                <td className="bf-td-action">
                  <button className="bf-link-btn" onClick={() => onEditNextAction?.(it.taskId, it.nextAction)} title={it.nextAction}>
                    {it.nextAction}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* FR-5 export buttons also present in toolbar above; leave secondary one here for convenience */}
      <div className="bf-tracking-export-bar">
        <span className="bf-tracking-export-bar__count">{visibleItems.length} {L.items}</span>
        <div className="bf-tracking-export-bar__actions">
          <button className="bf-btn bf-btn--sm" onClick={handleCsvExport}>{L.exportLabel} CSV</button>
          <button className="bf-btn bf-btn--sm" onClick={handleMdExport}>{L.exportLabel} MD</button>
        </div>
      </div>
    </div>
  );
}
