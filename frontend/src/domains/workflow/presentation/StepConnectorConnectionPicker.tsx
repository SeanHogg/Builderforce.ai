import { ConnectorConnectionManager } from '@/components/connectors/ConnectorsGallery';
import { canManageIntegrations } from '@/components/integrations/canManageIntegrations';
import { getStoredTenant } from '@/lib/auth';
import { StepConnectionSelect, type StepConnectionSource } from './StepConnectionSelect';
import { useStepConnections } from './useStepConnections';

/**
 * WHICH CONNECTION A `connector` STEP RUNS THROUGH — stored as `config.connectionId`.
 *
 * Adapts `connector_connections` to the shared `StepConnectionSelect`. "Connect new"
 * embeds the connectors gallery's own connection manager (the same form Creation
 * Canvas embeds); a connection made there is picked up on reload and chosen from the
 * list. Leaving it on "automatic" stores nothing and the server uses the tenant's
 * oldest enabled connection for the connector.
 */
export interface StepConnectorConnectionPickerProps {
  connectorKey: string;
  /** The picked connection id; '' = automatic. */
  value: string;
  onChange: (connectionId: string) => void;
}

export function StepConnectorConnectionPicker({ connectorKey, value, onChange }: StepConnectorConnectionPickerProps) {
  const { connections, loading, loadFailed, reload } = useStepConnections(connectorKey);
  const canConnect = canManageIntegrations(getStoredTenant()?.role);

  const source: StepConnectionSource = {
    options: connections.map((c) => ({ id: c.id, name: c.name })),
    loading,
    loadFailed,
    connect: canConnect
      ? (done) => (
        <ConnectorConnectionManager
          connectorKey={connectorKey}
          onChanged={() => { reload(); done(); }}
        />
      )
      : null,
  };

  return <StepConnectionSelect source={source} value={value} onChange={onChange} />;
}
