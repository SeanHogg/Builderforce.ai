import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { getTicketCoordination, releaseLease, type Lease, type TicketCoordination } from '@/lib/agentOpsApi';
import { button, card, emptyState, input, muted, sectionTitle } from './agentOpsStyles';
import { leasesDescriptor, notesDescriptor } from './agentOpsDescriptors';
import { useFormat } from "@/i18n/useFormat";
import { faultMessage } from '@/lib/apiClient';
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
  const fmt = useFormat();
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
      setError(faultMessage(e, t('genericError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(taskInput);
    if (Number.isFinite(id) && id > 0) void load(id);
  };

  const onRelease = useCallback(async (lease: Lease) => {
    if (!state) return;
    const ok = await confirm({
      title: t('coordination.releaseTitle'),
      message: t('coordination.releaseConfirm', { resource: lease.resource, holder: lease.holder }),
      confirmLabel: t('coordination.release'),
    });
    if (!ok) return;
    await releaseLease(state.taskId, lease.resource);
    await load(state.taskId);
  }, [state, confirm, t, load]);

  const leases = useMemo(() => leasesDescriptor(t, (l) => void onRelease(l)), [t, onRelease]);
  const notes = useMemo(() => notesDescriptor(t, fmt), [t, fmt]);

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

      {error && <div style={{ ...emptyState, color: 'var(--danger)' }}>{error}</div>}

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
              <LocalCollection descriptor={leases} rows={state.leases} searchText={(l) => `${l.resource} ${l.holder} ${l.reason ?? ''}`} />
            )}
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>{t('coordination.notesTitle')}</h2>
            {state.notes.length === 0 ? (
              <p style={muted}>{t('coordination.noNotes')}</p>
            ) : (
              <LocalCollection descriptor={notes} rows={state.notes} searchText={(n) => `${n.key} ${n.author} ${n.content}`} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
