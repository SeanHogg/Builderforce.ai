import { useTranslations } from 'next-intl';
import { useStudioSyncStatus } from '@/lib/localFirst/useStudioSyncStatus';
import type { WebSyncState } from '@/lib/localFirst/webSyncDriver';

/** The dot's colour per state — theme tokens only, so it reads in either theme. */
const TONE: Record<WebSyncState, string> = {
  idle: 'var(--success)',
  syncing: 'var(--accent)',
  held: 'var(--warning)',
  offline: 'var(--warning)',
  denied: 'var(--error)',
  unbound: 'var(--text-muted)',
  busy: 'var(--text-muted)',
};

export interface StudioSyncStatusProps {
  state: WebSyncState;
  /** Events still owed to the server (held ones included). */
  pending: number;
}

/**
 * Where this device's work stands with the server — saved, sending, held, offline, refused, or
 * kept on this device only. Presentation only: the driver's status goes in, a short sentence and
 * a pending count come out. An outage is a calm state here, never an error: the work is saved on
 * this device and is sent when it can be.
 */
export function StudioSyncStatus({ state, pending }: StudioSyncStatusProps) {
  const t = useTranslations('creationCanvas.sync');
  /** The one sentence for a state. A switch of literal keys, so the catalog guard can see every one. */
  const label = (): string => {
    switch (state) {
      case 'idle': return t('state.idle');
      case 'syncing': return t('state.syncing');
      case 'held': return t('state.held');
      case 'offline': return t('state.offline');
      case 'denied': return t('state.denied');
      case 'unbound': return t('state.unbound');
      case 'busy': return t('state.busy');
    }
  };
  return (
    <span
      role="status"
      aria-live="polite"
      data-state={state}
      className="ui-text-small"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
        maxWidth: 'calc(100vw - 32px)', minWidth: 0,
        padding: '4px 10px', borderRadius: 'var(--radius-full)',
        border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
      }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 'var(--radius-full)', background: TONE[state] }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label()}
        {pending > 0 && ` · ${t('pending', { count: pending })}`}
      </span>
    </span>
  );
}

/** The live one: reads the shared Studio sync driver. Renders nothing where the device cannot hold the store. */
export function StudioSyncIndicator() {
  const status = useStudioSyncStatus();
  return status ? <StudioSyncStatus state={status.state} pending={status.pending} /> : null;
}
