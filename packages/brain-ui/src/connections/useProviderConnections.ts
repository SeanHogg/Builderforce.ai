/**
 * The connected accounts and their health, read when the section opens and re-read after a
 * reconnect. A row's Test repaints that row from the probe's own verdict, so the section
 * never shows "Working" next to a probe that just failed.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProviderConnection, ProviderConnectionsPort } from './types';

export type ConnectionsState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'failed' }
  | { kind: 'ready'; rows: ProviderConnection[] };

export interface ProviderConnectionsView {
  state: ConnectionsState;
  reload: () => Promise<void>;
  /** Replace one row (after a probe) without another list read. */
  patch: (provider: string, change: Partial<ProviderConnection>) => void;
}

export function useProviderConnections(client: ProviderConnectionsPort): ProviderConnectionsView {
  const [state, setState] = useState<ConnectionsState>({ kind: 'loading' });

  const reload = useCallback(async () => {
    try {
      const rows = await client.list();
      setState(rows === null ? { kind: 'unavailable' } : { kind: 'ready', rows });
    } catch {
      setState({ kind: 'failed' });
    }
  }, [client]);

  useEffect(() => { void reload(); }, [reload]);

  const patch = useCallback((provider: string, change: Partial<ProviderConnection>) => {
    setState((prev) => prev.kind === 'ready'
      ? { kind: 'ready', rows: prev.rows.map((row) => (row.provider === provider ? { ...row, ...change } : row)) }
      : prev);
  }, []);

  return { state, reload, patch };
}
