'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { getTicketCoordination, releaseLease, type TicketCoordination } from '@/lib/agentOpsApi';
import { button, card, chip, emptyState, input, mono, muted, sectionTitle, table, tableScroll, td, th } from './agentOpsStyles';

/**
 * Coordination — what several agents working ONE ticket are doing to each other.
 *
 * Scoped to a ticket rather than to the workspace because that is the unit of
 * contention: a swimlane stage dispatches its agents together, they share one git
 * branch, and a lease is taken per path within that ticket. A workspace-wide list of
 * every lease would be noise; "who is holding src/app.ts on ticket 412, and why" is
 * the question an operator actually has.
 */
export function CoordinationPanel() {
  const t = useTranslations('agentOps');
  const confirm = useConfirm();
  const [taskInput, setTaskInput] = useState('');
  const [state, setState] = useState<TicketCoordination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (taskId: number) => {
    setLoading(true);
    setError(null);
    try {
      setState(await getTicketCoordination(taskId));
    } catch (e) {
      setState(null);
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(taskInput);
    if (Number.isFinite(id) && id > 0) void load(id);
  };

  const onRelease = async (resource: string, holder: string) => {
    if (!state) return;
    const ok = await confirm({
      title: t('coordination.releaseTitle'),
      message: t('coordination.releaseConfirm', { resource, holder }),
      confirmLabel: t('coordination.release'),
    });
    if (!ok) return;
    await releaseLease(state.taskId, resource);
    await load(state.taskId);
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <form onSubmit={onSubmit} style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
          <span style={muted}>{t('coordination.ticketLabel')}</span>
          <input
            style={input}
            inputMode="numeric"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder={t('coordination.ticketPlaceholder')}
            aria-label={t('coordination.ticketLabel')}
          />
        </label>
        <button type="submit" style={button('primary')} disabled={loading}>
          {loading ? t('loading') : t('coordination.inspect')}
        </button>
      </form>

      {error && <div style={{ ...emptyState, color: 'var(--danger, #dc2626)' }}>{error}</div>}

      {!state && !error && <div style={emptyState}>{t('coordination.empty')}</div>}

      {state && (
        <>
          <div style={card}>
            <h2 style={sectionTitle}>
              {t('coordination.leasesTitle')} · #{state.taskId} {state.taskTitle}
            </h2>
            {state.leases.length === 0 ? (
              <p style={muted}>{t('coordination.noLeases')}</p>
            ) : (
              <div style={tableScroll}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>{t('coordination.resource')}</th>
                      <th style={th}>{t('coordination.holder')}</th>
                      <th style={th}>{t('coordination.mode')}</th>
                      <th style={th}>{t('coordination.reason')}</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {state.leases.map((l) => (
                      <tr key={l.resource}>
                        <td style={{ ...td, ...mono }}>{l.resource}</td>
                        <td style={td}>{l.holder}</td>
                        <td style={td}>
                          <span style={chip(l.mode === 'exclusive' ? 'warn' : 'neutral')}>
                            {l.mode === 'exclusive' ? t('coordination.exclusive') : t('coordination.shared')}
                          </span>
                        </td>
                        <td style={td}>{l.reason ?? '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <RoleGate capability="agents.manage">
                            <button type="button" style={button('danger')} onClick={() => void onRelease(l.resource, l.holder)}>
                              {t('coordination.release')}
                            </button>
                          </RoleGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>{t('coordination.notesTitle')}</h2>
            {state.notes.length === 0 ? (
              <p style={muted}>{t('coordination.noNotes')}</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {state.notes.map((n) => (
                  <li key={n.key} style={{ borderLeft: '3px solid var(--border, #e5e7eb)', paddingLeft: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{n.key}</strong>
                      <span style={chip('accent')}>{n.author}</span>
                      <span style={muted}>{new Date(n.updatedAt).toLocaleString()}</span>
                    </div>
                    <p style={{ ...muted, marginTop: 4, color: 'var(--text-primary)' }}>{n.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
