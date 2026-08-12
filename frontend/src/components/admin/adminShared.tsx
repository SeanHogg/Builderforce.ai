'use client';

/**
 * Shared primitives for the Platform Admin panels.
 *
 * The admin area is one nav destination whose sub-views are TABS in the shell's
 * <ShellIndex> (see navGroups `admin`). Each tab body lives in its own
 * self-fetching panel under `components/admin/panels/` — this module is the
 * single source of truth for the chrome + data-loading pattern they all share,
 * so no panel re-invents (and drifts on) the loading / error / header shell.
 */

import { Icon } from '@/components/ui/Icon';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LlmModelStatus } from '@/lib/adminApi';

/** Normalize any thrown value to a display string. */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtNum(n: number | string): string {
  return Number(n).toLocaleString();
}

/**
 * Read-through data hook for an admin panel: runs `fetcher` on mount (and when
 * `deps` change), and exposes `{ data, loading, error, reload, setData }`. This
 * is the one place loading/error state is managed, so every panel is a thin
 * self-contained view instead of a branch of a 3.5k-line god component.
 *
 * `reload` is stable for the current deps and is what action handlers call after
 * a mutation. `setData` lets a panel patch its own list optimistically.
 */
export function useAdminData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
  setError: (msg: string) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  // Hold the latest fetcher in a ref so the effect below can call it without
  // listing `fetcher` (a new closure each render) as a dependency — the fetch
  // re-runs only when the caller's `deps` change or `reload()` bumps the nonce.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  /** Stable manual-refresh trigger (call after a mutation). */
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetcherRef.current()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(errText(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `deps` is the caller's parameterization; `nonce` is the manual-refresh bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { data, loading, error, reload, setData, setError };
}

/** Inline error banner — one look for every panel. Renders nothing when empty. */
export function AdminError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
      {message}
    </div>
  );
}

/** Muted "Loading…" line shared by every panel. */
export function AdminLoading() {
  const t = useTranslations('admin');
  return <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>;
}

/**
 * Standard panel header: a title (+ optional subtitle / count) on the left and
 * an actions slot on the right, with an optional built-in Refresh button. Every
 * admin tab opens with this row, so it lives here rather than being re-inlined.
 */
export function AdminPanelHeader({
  title,
  subtitle,
  count,
  onRefresh,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  count?: React.ReactNode;
  onRefresh?: () => void;
  actions?: React.ReactNode;
}) {
  const t = useTranslations('admin.common');
  return (
    <div
      style={{
        marginBottom: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text-strong)' }}>{title}</h2>
        {subtitle && <p className="text-muted" style={{ fontSize: 12, margin: '4px 0 0' }}>{subtitle}</p>}
        {count != null && <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>{count}</div>}
      </div>
      {(actions || onRefresh) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {actions}
          {onRefresh && (
            <button type="button" className="btn-ghost" onClick={onRefresh}>↻ {t('refresh')}</button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One labelled grid of model badges for a pool (Free or Premium). `available`
 * drives colour, `cooldownUntil` drives the tooltip + an inline "(cooldown)"
 * tag. Returns null when the pool is empty so callers don't have to gate it.
 */
export function ModelPoolBadges({
  label,
  keyPrefix,
  models,
}: {
  label: string;
  keyPrefix: string;
  models: ReadonlyArray<LlmModelStatus>;
}) {
  const t = useTranslations('admin');
  if (models.length === 0) return null;
  return (
    <div>
      <div className="health-label" style={{ marginBottom: 8 }}>{label} ({models.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {models.map((m) => (
          <span
            key={`${keyPrefix}-${m.model}`}
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              background: m.available ? 'var(--success-bg)' : 'var(--error-bg)',
              color: m.available ? 'var(--success-text)' : 'var(--error-text)',
            }}
            title={m.cooldownUntil ? t('common.cooldownUntil', { time: new Date(m.cooldownUntil).toLocaleString() }) : m.available ? t('common.available') : t('common.unavailable')}
          >
            {m.preferred ? <Icon source="★" size="1em" /> : ''}{m.model}
            {m.cooldownUntil && !m.available ? ` (${t('common.cooldown')})` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Sortable table headers.
 *
 * Admin tables are long — the adoption-sessions list alone is unbounded in
 * visitors — and a long table with a fixed order answers only the question its
 * default sort happens to be about. Sorting is therefore chrome, like the
 * loading and error shells above, and it lives here for the same reason: five
 * columns in one table already means five copies of the same aria-sort wiring,
 * and a second panel that wanted it would make ten.
 *
 * The COMPARATORS stay with the caller. Only the panel knows whether "Engagement"
 * means messages or tokens, and a generic value-extractor would have to be told
 * anyway — so this owns the toggle, the accessible state and the indicator, and
 * nothing about the data.
 * ------------------------------------------------------------------------- */

export type SortDirection = 'asc' | 'desc';

export interface TableSort<K extends string> {
  key: K;
  direction: SortDirection;
}

/**
 * Sort `rows` by the active column, and toggle direction when the active column
 * is clicked again.
 *
 * A comparator is written ASCENDING once and reversed here, so a column cannot
 * end up sorting one way correctly and the other way by accident. Clicking a NEW
 * column starts at `defaultDirection` (descending for the numeric and date
 * columns that dominate these tables — "most recent" and "most active" are what
 * a click on them is asking for) rather than inheriting the previous column's
 * direction, which reads as a broken sort.
 */
export function useTableSort<K extends string, T>(
  rows: readonly T[],
  comparators: Record<K, (a: T, b: T) => number>,
  initial: TableSort<K>,
  defaultDirection: SortDirection = 'desc',
): {
  sort: TableSort<K>;
  toggle: (key: K) => void;
  sorted: T[];
} {
  const [sort, setSort] = useState<TableSort<K>>(initial);

  const toggle = useCallback((key: K) => {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: defaultDirection }
    ));
  }, [defaultDirection]);

  const sorted = useMemo(() => {
    const compare = comparators[sort.key];
    if (!compare) return [...rows];
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compare(a, b) * factor);
    // `comparators` is rebuilt each render by every caller (they close over
    // nothing that changes), so it is deliberately not a dependency — the sort
    // re-runs when the rows or the active column change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.key, sort.direction]);

  return { sort, toggle, sorted };
}

/**
 * One sortable column header. Renders a real `<button>` inside the `<th>` so the
 * column is reachable and toggleable by keyboard, and carries `aria-sort` so a
 * screen reader is told the order rather than being left to infer it from an
 * arrow it cannot see.
 */
export function SortableTh<K extends string>({
  columnKey,
  label,
  sort,
  onSort,
  sortLabel,
  style,
}: {
  columnKey: K;
  label: React.ReactNode;
  sort: TableSort<K>;
  onSort: (key: K) => void;
  /** Accessible name for the control, e.g. "Sort by Last seen". */
  sortLabel: string;
  style?: React.CSSProperties;
}) {
  const active = sort.key === columnKey;
  return (
    <th
      className="th-sortable"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={style}
    >
      <button
        type="button"
        className={active ? 'th-sort th-sort--active' : 'th-sort'}
        onClick={() => onSort(columnKey)}
        aria-label={sortLabel}
        title={sortLabel}
      >
        <span>{label}</span>
        <span
          className="th-sort__arrow"
          aria-hidden="true"
          style={{ transform: active && sort.direction === 'asc' ? 'rotate(180deg)' : undefined }}
        >
          <Icon name="chevron-down" size={13} />
        </span>
      </button>
    </th>
  );
}

/** mailto: builder shared by the billing panel's invoice / reminder links. */
export function composeMailto(email: string, subject: string, body: string): string {
  const q = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(email)}?${q.toString()}`;
}
