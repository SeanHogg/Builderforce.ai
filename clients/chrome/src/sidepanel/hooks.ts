/**
 * The panel's small React bindings over the services — the run store (the SAME store
 * every Brain surface reads), the device record and the subscriptions behind them.
 */
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { getRunSnapshot, subscribeRun, type BrainRunSnapshot } from '@seanhogg/builderforce-brain-embedded';
import type { PanelServices } from '../host/panelServices';

export const ServicesContext = createContext<PanelServices | null>(null);

export function useServices(): PanelServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices outside the panel');
  return services;
}

/** The live run of a chat — re-rendered on every change of the shared run store. */
export function useRun(chatId: number | null): BrainRunSnapshot {
  const subscribe = useCallback((listener: () => void) => (chatId === null ? () => undefined : subscribeRun(chatId, listener)), [chatId]);
  const snapshot = useCallback(() => getRunSnapshot(chatId), [chatId]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** Load something async and reload it when any of `deps` (or a subscription) changes. */
export function useLoaded<T>(load: () => Promise<T>, initial: T, deps: unknown[], subscribe?: (reload: () => void) => () => void): [T, () => void] {
  const [value, setValue] = useState<T>(initial);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    void load().then((v) => {
      if (live) setValue(v);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  useEffect(() => (subscribe ? subscribe(reload) : undefined), [subscribe, reload]);
  return [value, reload];
}

/** Whether the session is signed in, kept current across contexts. */
export function useSignedIn(): boolean {
  const { session } = useServices();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.isSignedIn(),
  );
}

/** The browser's connectivity. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('online', listener);
      window.addEventListener('offline', listener);
      return () => {
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
      };
    },
    () => navigator.onLine,
  );
}
