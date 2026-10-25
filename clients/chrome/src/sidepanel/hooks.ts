/**
 * The panel's small React bindings over the services — the run store (the SAME store
 * every Brain surface reads), the device record and the subscriptions behind them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getRunSnapshot, inferenceModeForModelPick, subscribeRun, type BrainRunSnapshot } from '@seanhogg/builderforce-brain-embedded';
import { inferenceModeOption, type PromptOptionsInferenceMode } from '@seanhogg/builderforce-brain-ui';
import type { PanelServices } from '../host/panelServices';
import type { RovrInferenceModeState } from '../platform/policy';
import type { RovrSettings } from '../platform/settings';
import { onSyncStatsChanged, type SyncStats } from '../sync/runtimeMessages';
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

/** Where models run (Local only · Hybrid · Specific), kept current across contexts. */
export function useInferenceModeState(): RovrInferenceModeState {
  const { policy } = useServices();
  return useSyncExternalStore(
    (listener) => policy.subscribeMode(listener),
    () => policy.inferenceMode(),
  );
}

/** The composer's `/` menu wiring for the mode — and the first-run question, asked of
 *  anyone who has not chosen (signed in or not): brain-ui's ONE wiring
 *  (`inferenceModeOption`), the rule the web and the editor ask by too. Undefined until
 *  the policy's first read has landed: the control renders nothing rather than the
 *  refused placeholder (Local only). */
export function useInferenceModeOption(): PromptOptionsInferenceMode | undefined {
  const { policy } = useServices();
  const state = useInferenceModeState();
  return useMemo<PromptOptionsInferenceMode | undefined>(
    () => (state.loaded
      ? inferenceModeOption({ value: state.mode, chosen: state.chosen, onChange: (mode) => policy.setInferenceMode(mode) })
      : undefined),
    [policy, state],
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
 *  routing — the ONE pin Settings → Model, the `/` Model tab and Kimi connect all set.
 *
 *  `choose` sets the pin and nothing else: the `/` menu's own pick (brain-ui `ModelPane` moves
 *  the mode itself) and a pin the panel clears on its own (a removed model). `pick` is a
 *  person's pick from a picker OUTSIDE the menu: the inference mode moves with it
 *  (brain-embedded `inferenceModeForModelPick`), so the model picked is the model that runs. */
export function usePinnedModel(): [string | null, (ref: string | null) => void, (ref: string | null) => void] {
  const { settings, policy } = useServices();
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
  const pick = useCallback(
    (ref: string | null) => {
      const state = policy.inferenceMode();
      const mode = state.loaded
        ? inferenceModeForModelPick(state.mode, ref ? { mode: 'model', model: ref } : { mode: 'auto' }, { undecided: !state.chosen })
        : null;
      if (mode) policy.setInferenceMode(mode).catch(() => undefined);
      choose(ref);
    },
    [policy, choose],
  );
  return [optimistic ? optimistic.ref : stored, choose, pick];
}

/** What is waiting to sync — read once, then kept current by the worker's change
 *  broadcasts (`rovr.sync.changed`); null until the first answer. */
export function useSyncStats(): SyncStats | null {
  const { sendRuntime } = useServices();
  const [stats, setStats] = useState<SyncStats | null>(null);
  useEffect(() => {
    let live = true;
    const off = onSyncStatsChanged((next) => live && setStats(next));
    sendRuntime({ type: 'rovr.sync.stats' })
      .then((s) => live && setStats((current) => current ?? (s as SyncStats)))
      .catch(() => undefined);
    return () => {
      live = false;
      off();
    };
  }, [sendRuntime]);
  return stats;
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
