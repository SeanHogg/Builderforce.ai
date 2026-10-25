/**
 * Connecting the workspace's Kimi account from Rovr — the ONE hook both places that offer
 * it use (Settings → Model, and the Connect card a Kimi turn raises in the chat).
 *
 * Order matters: Chrome grants an optional origin only from inside a user gesture, so the
 * Kimi API origin request is the FIRST await of the click. Then THE shared reconnect flow
 * (brain-ui `useProviderReconnect`, the same one the composer's Connected accounts runs, so
 * a connect started in either place shows in both): the gateway starts a device grant,
 * Kimi's approval page opens in a tab, the flow waits for the approval, and the short-lived
 * access token is fetched and persisted in `chrome.storage.local`. The connection itself
 * lands in the workspace's integrations, where the web app and the editor see it too.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useProviderReconnect, type ReconnectFailure } from '@seanhogg/builderforce-brain-ui';
import type { LocalCredential } from '@builderforce/provider-connect';
import { t } from '../i18n/t';
import { KIMI_CODE_API_HOST } from '@builderforce/kimi-oauth';
import { KIMI_API_ORIGINS, KIMI_PROVIDER } from '../inference/connectedAccount';
import { useServices } from './hooks';

export type KimiConnectState =
  | { phase: 'idle' }
  | { phase: 'connecting'; userCode: string | null }
  | { phase: 'failed'; message: string };

function failureMessage(failure: ReconnectFailure): string {
  if (failure.reason === 'denied') return t('kimiDenied');
  if (failure.reason === 'expired') return t('kimiExpired');
  return t('kimiFailed', failure.detail ?? failure.reason);
}

export function useKimiConnect(): {
  /** The last known credential (endpoint + models), or null when not connected here. */
  credential: LocalCredential | null;
  state: KimiConnectState;
  /** Run the whole connect from a click. Resolves true once a credential is in hand. */
  connect(): Promise<boolean>;
  cancel(): void;
} {
  const { kimi, connections } = useServices();
  const credential = useSyncExternalStore(kimi.store.subscribe, kimi.store.snapshot);
  const flow = useProviderReconnect(connections.client, KIMI_PROVIDER, {
    openUrl: connections.openUrl,
    // A connect finished from the composer's Status tab: fetch this browser's token too.
    onConnected: () => { void kimi.store.resolve(); },
  });
  /** The steps around the shared flow — the origin grant and the local token. */
  const [around, setAround] = useState<KimiConnectState>({ phase: 'idle' });

  const connect = useCallback(async (): Promise<boolean> => {
    setAround({ phase: 'idle' });
    // First, inside the gesture: without the origin Rovr cannot call Kimi at all.
    const granted = await chrome.permissions.request({ origins: KIMI_API_ORIGINS }).catch(() => false);
    if (!granted) {
      setAround({ phase: 'failed', message: t('kimiOriginDenied', KIMI_CODE_API_HOST) });
      return false;
    }
    // Already connected in the workspace (from the web or the editor) — just fetch the token.
    const existing = await kimi.store.resolve();
    if (existing.kind === 'credential') return true;
    if (existing.kind === 'unavailable') {
      setAround({ phase: 'failed', message: t('kimiFailed', existing.detail) });
      return false;
    }
    if (!(await flow.start())) return false;
    const after = await kimi.store.resolve();
    if (after.kind !== 'credential') {
      setAround({ phase: 'failed', message: t('kimiFailed', after.kind === 'unavailable' || after.kind === 'reconnect' ? after.detail : after.kind) });
      return false;
    }
    return true;
  }, [kimi, flow.start]);

  // The connect's own state is the shared flow's; a failure in the steps around it wins.
  const state: KimiConnectState = around.phase === 'failed'
    ? around
    : flow.phase === 'starting' || flow.phase === 'device'
      ? { phase: 'connecting', userCode: flow.userCode }
      : flow.failure
        ? { phase: 'failed', message: failureMessage(flow.failure) }
        : { phase: 'idle' };

  return { credential, state, connect, cancel: flow.cancel };
}
