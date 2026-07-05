'use client';

/**
 * Shared primitives for the Platform Admin panels.
 *
 * The admin area is one nav destination whose sub-views are TABS in the shell's
 * <SectionTabs> bar (see navGroups `admin`). Each tab body lives in its own
 * self-fetching panel under `components/admin/panels/` — this module is the
 * single source of truth for the chrome + data-loading pattern they all share,
 * so no panel re-invents (and drifts on) the loading / error / header shell.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
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
            <button type="button" className="btn-ghost" onClick={onRefresh}>↻ Refresh</button>
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
              borderRadius: 6,
              fontSize: 12,
              background: m.available ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)',
              color: m.available ? 'var(--success-text)' : 'var(--error-text)',
            }}
            title={m.cooldownUntil ? `Cooldown until ${new Date(m.cooldownUntil).toLocaleString()}` : m.available ? 'Available' : 'Unavailable (rate limit or error)'}
          >
            {m.preferred ? '★ ' : ''}{m.model}
            {m.cooldownUntil && !m.available ? ' (cooldown)' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** mailto: builder shared by the billing panel's invoice / reminder links. */
export function composeMailto(email: string, subject: string, body: string): string {
  const q = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(email)}?${q.toString()}`;
}
