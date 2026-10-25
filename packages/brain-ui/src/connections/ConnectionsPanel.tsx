/**
 * The `/` menu Status tab's "Connected accounts" — every provider account the workspace
 * connected, whether it is working, and Test / Reconnect for each, on every chat surface
 * (web, canvas, VS Code, Rovr). A person who is told mid-chat that their Claude or Grok
 * account was refused can check it and sign in again without leaving the conversation.
 *
 * Self-contained: it reads and acts through the host's port. A caller the gateway refuses
 * the list is told so in place — the section explains itself rather than vanishing.
 */
import { ConnectionRow } from './ConnectionRow';
import { connectionsLabels, type ComposerConnections, type ConnectionsLabels } from './types';
import { useProviderConnections } from './useProviderConnections';

export interface ConnectionsPanelProps {
  connections: ComposerConnections;
  labels?: Partial<ConnectionsLabels>;
}

export function ConnectionsPanel({ connections, labels: overrides }: ConnectionsPanelProps) {
  const labels = connectionsLabels(overrides);
  const { state, reload, patch } = useProviderConnections(connections.client);
  return (
    <section className="bf-conn" aria-label={labels.heading}>
      <div className="bf-pmenu__group">{labels.heading}</div>
      {state.kind === 'loading' && <div className="bf-pmenu__desc bf-conn__pad">…</div>}
      {state.kind === 'failed' && <div className="bf-pmenu__desc bf-conn__pad">{labels.loadFailed}</div>}
      {state.kind === 'unavailable' && <div className="bf-pmenu__desc bf-conn__pad">{labels.unavailable}</div>}
      {state.kind === 'ready' && state.rows.length === 0 && <div className="bf-pmenu__desc bf-conn__pad">{labels.empty}</div>}
      {state.kind === 'ready' && state.rows.map((row) => (
        <ConnectionRow
          key={row.provider}
          row={row}
          connections={connections}
          labels={labels}
          onChanged={(change) => patch(row.provider, change)}
          onReconnected={() => void reload()}
        />
      ))}
    </section>
  );
}
