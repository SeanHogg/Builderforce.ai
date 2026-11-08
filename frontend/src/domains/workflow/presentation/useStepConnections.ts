import { useCallback, useEffect, useRef, useState } from 'react';
import { connectorsApi, type ConnectorConnection } from '@/lib/connectorsApi';

/**
 * The tenant's enabled connections for ONE connector (`connector_connections`), via
 * the existing `connectorsApi.listConnections` the connectors gallery uses. `reload`
 * is handed to the embedded connect flow so a connection made there appears here.
 */
export interface UseStepConnections {
  connections: ConnectorConnection[];
  loading: boolean;
  loadFailed: boolean;
  reload: () => void;
}

export function useStepConnections(connectorKey: string): UseStepConnections {
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Same stale-response guard as `useStepCredentials`.
  const current = useRef(connectorKey);
  current.current = connectorKey;

  const reload = useCallback(() => {
    const asked = connectorKey;
    const live = () => current.current === asked;
    setLoading(true);
    setLoadFailed(false);
    connectorsApi
      .listConnections(asked)
      .then((rows) => { if (live()) setConnections(rows.filter((r) => r.enabled)); })
      .catch(() => { if (live()) setLoadFailed(true); })
      .finally(() => { if (live()) setLoading(false); });
  }, [connectorKey]);

  useEffect(() => { reload(); }, [reload]);

  return { connections, loading, loadFailed, reload };
}
