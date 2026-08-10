'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimeApi, type ActiveRun } from '@/lib/builderforceApi';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';

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
  cloud: { label: 'CLOUD', bg: 'rgba(124,131,253,0.15)', fg: 'var(--indigo-bright, var(--indigo-bright))' },
  'on-prem': { label: 'ON-PREM', bg: 'rgba(0,229,204,0.15)', fg: 'var(--cyan-bright, var(--cyan-bright))' },
};

export function ActiveRunsPanel() {
  const confirm = useConfirm();
  const [runs, setRuns] = useState<ActiveRun[] | null>(null);
  const [cancelling, setCancelling] = useState<Set<number>>(new Set());
  const [stoppingAll, setStoppingAll] = useState(false);
  const [error, setError] = useState('');
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

  const stopAll = useCallback(async () => {
    if (!runs?.length || !(await confirm({
      title: 'Stop all agents?',
      message: `This will immediately cancel all ${runs.length} queued or running agent ${runs.length === 1 ? 'job' : 'jobs'} in this workspace.`,
      confirmLabel: 'Stop all agents',
      destructive: true,
    }))) return;
    setStoppingAll(true);
    setError('');
    try {
      const result = await runtimeApi.cancelAll();
      if (result.failed.length > 0) {
        setError(`${result.failed.length} run${result.failed.length === 1 ? '' : 's'} could not be stopped. Try again.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop all agents.');
    } finally {
      setStoppingAll(false);
    }
  }, [confirm, load, runs]);

  // Idle fleet (or first load) → render nothing; this component owns its visibility.
  if (!runs || runs.length === 0) return null;

  return (
    <div
      style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--coral-bright)', boxShadow: '0 0 0 3px rgba(244,114,94,0.2)' }}
          />
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            Agents working now <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({runs.length})</span>
          </div>
        </div>
        <RoleGate capability="runtime.execute">
          <button
            type="button"
            onClick={() => void stopAll()}
            disabled={stoppingAll}
            aria-label="Stop all running agents"
            style={{
              minHeight: 36, padding: '7px 12px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--coral-bright)',
              background: 'rgba(244,114,94,0.1)', color: 'var(--coral-bright)',
              fontSize: 12, fontWeight: 700, cursor: stoppingAll ? 'default' : 'pointer',
              opacity: stoppingAll ? 0.6 : 1,
            }}
          >
            {stoppingAll ? 'Stopping all…' : '■ Stop all agents'}
          </button>
        </RoleGate>
      </div>

      {error && <div role="alert" style={{ color: 'var(--error-text)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

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
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)',
              }}
            >
              <span
                style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-sm)',
                  background: pill.bg, color: pill.fg, flexShrink: 0,
                }}
              >
                {pill.label}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                <span
                  style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={r.taskTitle}
                >
                  {r.taskTitle}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.agentName ?? (r.kind === 'on-prem' ? `AgentHost ${r.agentHostId}` : r.cloudAgentRef ?? 'Cloud agent')} · {r.projectName}
                </span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{r.status}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {fmtElapsed(r.elapsedMs)}
              </span>
              {/* Watching the fleet is a read; CANCELLING a run is dispatch-tier
                  (requireRole(DEVELOPER) on /api/runtime/executions/:id/cancel). */}
              <RoleGate capability="runtime.execute" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => void cancel(r.id)}
                  disabled={cancelling.has(r.id)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
                    color: 'var(--coral-bright)',
                    cursor: cancelling.has(r.id) ? 'default' : 'pointer', opacity: cancelling.has(r.id) ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  {cancelling.has(r.id) ? 'Cancelling…' : 'Cancel'}
                </button>
              </RoleGate>
            </div>
          );
        })}
      </div>
    </div>
  );
}
