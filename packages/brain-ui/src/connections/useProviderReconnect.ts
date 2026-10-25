/**
 * A view onto THE reconnect flow for one account (`reconnectFlow.ts`). The composer's
 * Connected accounts section, the web settings card and Rovr's Kimi connect all render
 * it; the flow outlives each of them, so closing the menu mid-connect loses nothing.
 * `onConnected` fires in a view that is mounted when the connect completes.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { reconnectFlow, type ReconnectFailure, type ReconnectPhase } from './reconnectFlow';
import type { ProviderConnectionsPort } from './types';

export type { ReconnectFailure, ReconnectFailureReason, ReconnectPhase } from './reconnectFlow';

export interface ProviderReconnect {
  phase: ReconnectPhase;
  userCode: string | null;
  code: string;
  setCode: (code: string) => void;
  failure: ReconnectFailure | null;
  /** Resolves true once the connection is stored. */
  start: () => Promise<boolean>;
  finish: () => Promise<void>;
  cancel: () => void;
}

export function useProviderReconnect(
  client: Pick<ProviderConnectionsPort, 'start' | 'completePaste' | 'awaitDevice'>,
  provider: string,
  { openUrl, onConnected }: { openUrl: (url: string) => void; onConnected?: () => void },
): ProviderReconnect {
  const flow = useMemo(() => reconnectFlow(client, provider), [client, provider]);
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
  const seen = useRef(state.connected);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  useEffect(() => {
    if (state.connected === seen.current) return;
    seen.current = state.connected;
    onConnectedRef.current?.();
  }, [state.connected]);

  const openUrlRef = useRef(openUrl);
  openUrlRef.current = openUrl;
  const start = useCallback(() => flow.start((url) => openUrlRef.current(url)), [flow]);

  return {
    phase: state.phase,
    userCode: state.userCode,
    code: state.code,
    failure: state.failure,
    setCode: flow.setCode,
    start,
    finish: flow.finish,
    cancel: flow.cancel,
  };
}
