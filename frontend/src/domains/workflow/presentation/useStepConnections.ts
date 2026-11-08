import { useCallback, useEffect, useState } from 'react';
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

interface Settled {
  /** The connector and reload count this answer belongs to; an answer for any other is not current. */
  key: string;
  attempt: number;
  connections: ConnectorConnection[];
  failed: boolean;
}

export function useStepConnections(connectorKey: string): UseStepConnections {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    // A slow answer for the PREVIOUS connector (or reload) must not overwrite what is shown now.
    let live = true;
    connectorsApi
      .listConnections(connectorKey)
      .then(
        (rows) => ({ connections: rows.filter((r) => r.enabled), failed: false }),
        () => ({ connections: [] as ConnectorConnection[], failed: true }),
      )
      .then((outcome) => { if (live) setSettled({ key: connectorKey, attempt, ...outcome }); });
    return () => { live = false; };
  }, [connectorKey, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  const current = settled?.key === connectorKey && settled.attempt === attempt ? settled : null;
  const forConnector = settled?.key === connectorKey ? settled : null;
  return {
    connections: forConnector?.connections ?? [],
    loading: current === null,
    loadFailed: current?.failed ?? false,
    reload,
  };
}
