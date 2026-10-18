/**
 * Connecting the workspace's Kimi account from Rovr — the ONE hook both places that offer
 * it use (Settings → Model, and the Connect card a Kimi turn raises in the chat).
 *
 * Order matters: Chrome grants an optional origin only from inside a user gesture, so the
 * `api.kimi.com` request is the FIRST await of the click. Then the shared connect flow
 * (`@builderforce/provider-connect`): the gateway starts a device grant, Kimi's approval
 * page opens in a tab, the hook waits for the approval, and the short-lived access token
 * is fetched and persisted in `chrome.storage.local`. The connection itself lands in the
 * workspace's integrations, where the web app and the editor see it too.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ProviderConnectError,
  awaitDeviceApproval,
  startProviderConnect,
  type LocalCredential,
} from '@builderforce/provider-connect';
import { t } from '../i18n/t';
import { KIMI_API_ORIGINS, KIMI_PROVIDER } from '../inference/connectedAccount';
import { useServices } from './hooks';

export type KimiConnectState =
  | { phase: 'idle' }
  | { phase: 'connecting'; userCode: string | null }
  | { phase: 'failed'; message: string };

function failureMessage(error: unknown): string {
  const reason = error instanceof ProviderConnectError ? error.reason : 'failed';
  if (reason === 'denied') return t('kimiDenied');
  if (reason === 'expired') return t('kimiExpired');
  return t('kimiFailed', error instanceof Error ? error.message : String(error));
}

export function useKimiConnect(): {
  /** The last known credential (endpoint + models), or null when not connected here. */
  credential: LocalCredential | null;
  state: KimiConnectState;
  /** Run the whole connect from a click. Resolves true once a credential is in hand. */
  connect(): Promise<boolean>;
  cancel(): void;
} {
  const { kimi } = useServices();
  const credential = useSyncExternalStore(kimi.store.subscribe, kimi.store.snapshot);
  const [state, setState] = useState<KimiConnectState>({ phase: 'idle' });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const connect = useCallback(async (): Promise<boolean> => {
    // First, inside the gesture: without the origin Rovr cannot call Kimi at all.
    const granted = await chrome.permissions.request({ origins: KIMI_API_ORIGINS }).catch(() => false);
    if (!granted) {
      setState({ phase: 'failed', message: t('kimiOriginDenied') });
      return false;
    }
    // Already connected in the workspace (from the web or the editor) — just fetch the token.
    const existing = await kimi.store.resolve();
    if (existing.kind === 'credential') {
      setState({ phase: 'idle' });
      return true;
    }
    if (existing.kind === 'unavailable') {
      setState({ phase: 'failed', message: t('kimiFailed', existing.detail) });
      return false;
    }

    const controller = new AbortController();
    abort.current = controller;
    try {
      const start = await startProviderConnect(kimi.request, KIMI_PROVIDER);
      setState({ phase: 'connecting', userCode: start.userCode });
      await chrome.tabs.create({ url: start.authorizeUrl });
      await awaitDeviceApproval(kimi.request, KIMI_PROVIDER, start, {
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
        signal: controller.signal,
      });
      const after = await kimi.store.resolve();
      if (after.kind !== 'credential') {
        setState({ phase: 'failed', message: t('kimiFailed', after.kind === 'unavailable' || after.kind === 'reconnect' ? after.detail : after.kind) });
        return false;
      }
      setState({ phase: 'idle' });
      return true;
    } catch (error) {
      setState(error instanceof ProviderConnectError && error.reason === 'cancelled'
        ? { phase: 'idle' }
        : { phase: 'failed', message: failureMessage(error) });
      return false;
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, [kimi]);

  const cancel = useCallback(() => abort.current?.abort(), []);
  return { credential, state, connect, cancel };
}
