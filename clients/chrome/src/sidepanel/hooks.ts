/**
 * The panel's small React bindings over the services — the run store (the SAME store
 * every Brain surface reads), the device record and the subscriptions behind them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getRunSnapshot, subscribeRun, type BrainRunSnapshot } from '@seanhogg/builderforce-brain-embedded';
import type { PanelServices } from '../host/panelServices';
import type { RovrSettings } from '../platform/settings';
import { originOf } from '../tools/safety';

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
export function useLoaded<T>(load: () => Promise<T>, initial: T, deps: unknown[], subscribe?: (reload: () => void) => () => void): [T, () => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [nonce, setNonce] = useState(0);
  /** The first read has landed — until then `value` is only `initial` (a list shows "Loading…", not "empty"). */
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    void load().then((v) => {
      if (!live) return;
      setValue(v);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  useEffect(() => (subscribe ? subscribe(reload) : undefined), [subscribe, reload]);
  return [value, reload, loaded];
}

/** Whether the session is signed in, kept current across contexts. */
export function useSignedIn(): boolean {
  const { session } = useServices();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.isSignedIn(),
  );
}

/** One device setting, kept current as it changes in any context (Settings, another panel). */
export function useSetting<T>(read: (settings: RovrSettings) => Promise<T>, initial: T): T {
  const { settings } = useServices();
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let live = true;
    const load = () => void read(settings).then((v) => live && setValue(v));
    load();
    const off = settings.subscribe(load);
    return () => {
      live = false;
      off();
    };
    // `read` is a selector over the one settings object — re-run only when that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);
  return value;
}

/** The model pinned for every turn (`local/<runtime>/<model>` or a gateway id), or null for automatic
 *  routing — and the one way to change it (Settings → Model and the `/` Model tab). */
export function usePinnedModel(): [string | null, (ref: string | null) => void] {
  const { settings } = useServices();
  const stored = useSetting((s) => s.pinnedModel(), null);
  const [optimistic, setOptimistic] = useState<{ ref: string | null } | null>(null);
  useEffect(() => setOptimistic(null), [stored]);
  const choose = useCallback(
    (ref: string | null) => {
      setOptimistic({ ref });
      void settings.setPinnedModel(ref);
    },
    [settings],
  );
  return [optimistic ? optimistic.ref : stored, choose];
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

/** The site Rovr is acting on — the working tab's host (`example.com`), or null for a
 *  page that is not a web page (a new tab, browser settings) or no tab at all. */
export function useWorkingSite(): string | null {
  const { working } = useServices();
  const url = useSyncExternalStore(working.subscribe, () => working.current()?.url ?? null);
  return useMemo(() => {
    const origin = originOf(url);
    return origin ? new URL(origin).host : null;
  }, [url]);
}
