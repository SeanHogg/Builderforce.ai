'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { tasksApi, type AutoRunDiagnostic, type AutoRunReason } from '@/lib/builderforceApi';

/** Minimal ticket shape the triage control needs from the board. */
export interface TriageTask {
  id: number;
  key?: string;
  title: string;
  assignedAgentRef?: string | null;
  assignedAgentHostId?: number | null;
}

interface Props {
  /** Tasks currently sitting in this lane. */
  tasks: TriageTask[];
  /** True when the task already has a live (pending/running) execution. */
  isActive: (taskId: number) => boolean;
  /** Called after a Run-now dispatch so the board refreshes its run chips. */
  onDispatched: () => void;
}

/** Reason → theme tone (drives the chip colour, both light + dark via tokens). */
const REASON_TONE: Record<AutoRunReason, 'ok' | 'warn' | 'muted' | 'info'> = {
  will_run: 'ok',
  already_running: 'info',
  human_gate: 'warn',
  capability_mismatch: 'warn',
  no_agent: 'muted',
  no_board: 'muted',
  no_lane: 'muted',
  terminal_lane: 'muted',
};

const TONE_COLOR: Record<'ok' | 'warn' | 'muted' | 'info', string> = {
  ok: 'var(--success, #16a34a)',
  warn: 'var(--warning, #d97706)',
  info: 'var(--coral-bright, #f97316)',
  muted: 'var(--text-muted)',
};

/**
 * Per-swimlane TRIAGE control: explains why each agent-assigned ticket in the lane
 * is or isn't auto-running, and lets a human dispatch it now. Self-deciding
 * visibility — renders nothing unless the lane holds at least one agent-owned
 * ticket without a live run (so empty/human-only lanes stay clean).
 */
export function SwimlaneTriageButton({ tasks, isActive, onDispatched }: Props) {
  const t = useTranslations('board.triage');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Map<number, AutoRunDiagnostic>>(new Map());
  const [running, setRunning] = useState<Set<number>>(new Set());

  // Candidates = tickets assigned to an agent (cloud ref or on-prem host) that
  // are NOT already running. These are the only ones worth triaging.
  const candidates = tasks.filter(
    (tk) => (tk.assignedAgentRef || tk.assignedAgentHostId != null) && !isActive(tk.id),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(
        candidates.map(async (tk) => {
          try {
            return [tk.id, await tasksApi.autorunDiagnostics(tk.id)] as const;
          } catch {
            return [tk.id, null] as const;
          }
        }),
      );
      setDiagnostics(new Map(entries.filter((e): e is readonly [number, AutoRunDiagnostic] => e[1] !== null)));
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  }, [candidates, t]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }, [open, load]);

  const runOne = useCallback(
    async (taskId: number) => {
      setRunning((prev) => new Set(prev).add(taskId));
      try {
        await tasksApi.runNow(taskId);
        onDispatched();
        // Re-read this ticket's verdict (now it should reflect "already running").
        try {
          const d = await tasksApi.autorunDiagnostics(taskId);
          setDiagnostics((prev) => new Map(prev).set(taskId, d));
        } catch { /* keep the prior verdict */ }
      } catch {
        /* surfaced by the unchanged verdict; the board toast covers hard errors */
      } finally {
        setRunning((prev) => {
          const n = new Set(prev);
          n.delete(taskId);
          return n;
        });
      }
    },
    [onDispatched],
  );

  const runAll = useCallback(async () => {
    const eligible = candidates.filter((tk) => {
      const d = diagnostics.get(tk.id);
      return d?.candidate && !d.liveExecution;
    });
    for (const tk of eligible) await runOne(tk.id);
  }, [candidates, diagnostics, runOne]);

  if (candidates.length === 0) return null;

  const eligibleCount = candidates.filter((tk) => {
    const d = diagnostics.get(tk.id);
    return d?.candidate && !d.liveExecution;
  }).length;

  const btnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    border: `1px solid ${open ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" style={btnStyle} onClick={toggle} aria-expanded={open} title={t('title')}>
        ⚑ {t('button')} {candidates.length}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('title')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 30,
            width: 'min(320px, 80vw)',
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--surface, #1a1a1a)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</span>
            <button
              type="button"
              disabled={eligibleCount === 0 || running.size > 0}
              onClick={() => void runAll()}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: eligibleCount > 0 ? 'var(--coral-bright)' : 'var(--bg-elevated)',
                color: eligibleCount > 0 ? '#fff' : 'var(--text-muted)',
                cursor: eligibleCount > 0 ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              {t('runAll', { count: eligibleCount })}
            </button>
          </div>

          {loading && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 2px' }}>{t('loading')}</div>}
          {error && <div style={{ fontSize: 11, color: 'var(--danger, #dc2626)', padding: '6px 2px' }}>{error}</div>}

          {!loading && !error && candidates.map((tk) => {
            const d = diagnostics.get(tk.id);
            const reason = d?.reason;
            const tone = reason ? REASON_TONE[reason] : 'muted';
            const isRunning = running.has(tk.id);
            const canRun = !!d?.candidate && !d.liveExecution;
            return (
              <div
                key={tk.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 4px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tk.key ? `${tk.key} · ` : ''}{tk.title}
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: TONE_COLOR[tone], flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {reason ? t(`reason.${reason}`) : '—'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canRun || isRunning}
                  onClick={() => void runOne(tk.id)}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: canRun && !isRunning ? 'var(--coral-bright)' : 'var(--bg-elevated)',
                    color: canRun && !isRunning ? '#fff' : 'var(--text-muted)',
                    cursor: canRun && !isRunning ? 'pointer' : 'not-allowed',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {isRunning ? t('running') : t('run')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
