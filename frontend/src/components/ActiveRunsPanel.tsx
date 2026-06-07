'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimeApi, type ActiveRun } from '@/lib/builderforceApi';

/**
 * Fleet "what's running right now": every non-terminal execution across the
 * tenant, on-prem and cloud, with elapsed time and a working Cancel. This is the
 * live fleet view the dashboard's rolled-up counts couldn't provide, and the only
 * place a cloud agent shows as actively running (cloud agents are stateless
 * server-side, so "running" is derived from in-flight executions).
 *
 * Self-contained: polls on a 4s cadence (matching the rest of the observability
 * surfaces) and renders nothing when the fleet is idle, so callers can drop it in
 * without gating on entitlement or run state.
 */

const POLL_MS = 4000;

function fmtElapsed(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const KIND_PILL: Record<ActiveRun['kind'], { label: string; bg: string; fg: string }> = {
  cloud: { label: 'CLOUD', bg: 'rgba(124,131,253,0.15)', fg: 'var(--indigo-bright, #7c83fd)' },
  'on-prem': { label: 'ON-PREM', bg: 'rgba(0,229,204,0.15)', fg: 'var(--cyan-bright, #00e5cc)' },
};

export function ActiveRunsPanel() {
  const [runs, setRuns] = useState<ActiveRun[] | null>(null);
  const [cancelling, setCancelling] = useState<Set<number>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const { active } = await runtimeApi.listActive();
      setRuns(active);
    } catch {
      setRuns((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = setInterval(() => void load(), POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const cancel = useCallback(async (id: number) => {
    setCancelling((prev) => new Set(prev).add(id));
    try {
      await runtimeApi.cancel(id);
      await load();
    } catch {
      /* surfaced on next poll */
    } finally {
      setCancelling((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [load]);

  // Idle fleet (or first load) → render nothing; this component owns its visibility.
  if (!runs || runs.length === 0) return null;

  return (
    <div
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span
          style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--coral-bright, #f4726e)', boxShadow: '0 0 0 3px rgba(244,114,94,0.2)' }}
        />
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
          Active runs <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({runs.length})</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {runs.map((r) => {
          const pill = KIND_PILL[r.kind];
          return (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--bg-elevated)',
              }}
            >
              <span
                style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  background: pill.bg, color: pill.fg, flexShrink: 0,
                }}
              >
                {pill.label}
              </span>
              <span
                style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={r.taskTitle}
              >
                {r.taskTitle}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{r.status}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {fmtElapsed(r.elapsedMs)}
              </span>
              <button
                type="button"
                onClick={() => void cancel(r.id)}
                disabled={cancelling.has(r.id)}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
                  color: 'var(--coral-bright, #f4726e)',
                  cursor: cancelling.has(r.id) ? 'default' : 'pointer', opacity: cancelling.has(r.id) ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                {cancelling.has(r.id) ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
