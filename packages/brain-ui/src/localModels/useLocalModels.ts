/**
 * The React binding over a host's local model store (brain-embedded's
 * `createLocalModelStore`): the catalog rows with their live state, and the three
 * actions a person takes on one — download (cancellable), remove, retry after a failure.
 *
 * The component that renders the rows never learns which host it is in: the web page,
 * the editor's webview and Rovr's side panel each hand over THEIR store, and this hook is
 * all that reads it.
 *
 * Two lifetimes matter:
 *  - a download outlives the list that started it — the picker is a popover that closes
 *    while a gigabyte is still arriving, so the cancel handles live per STORE (module
 *    scope), not per mount, and a reopened picker can still cancel;
 *  - progress fires many times a second, and each re-list asks the engines for device
 *    support and cache state, so re-lists are coalesced: one in flight, at most one queued.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalModelRow, LocalModelStore } from '@seanhogg/builderforce-brain-embedded';

export interface LocalModelsState {
  /** The catalog rows, or null until the store first answers. Empty without a store. */
  rows: LocalModelRow[] | null;
  /** Refs whose last download failed (cleared when retried). */
  failed: ReadonlySet<string>;
  download(ref: string): void;
  cancel(ref: string): void;
  remove(ref: string): void;
}

/** In-flight downloads' abort handles, per store — see the module header. */
const controllersByStore = new WeakMap<LocalModelStore, Map<string, AbortController>>();

function controllersOf(store: LocalModelStore): Map<string, AbortController> {
  let map = controllersByStore.get(store);
  if (!map) {
    map = new Map();
    controllersByStore.set(store, map);
  }
  return map;
}

const NO_ROWS: LocalModelRow[] = [];

export function useLocalModels(store: LocalModelStore | undefined): LocalModelsState {
  const [rows, setRows] = useState<LocalModelRow[] | null>(store ? null : NO_ROWS);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    if (!store) {
      setRows(NO_ROWS);
      return () => {
        live.current = false;
      };
    }
    setRows(null);
    let running = false;
    let queued = false;
    const refresh = (): void => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      void store
        .listLocalModels()
        .then(
          (next) => {
            if (live.current) setRows(next);
          },
          () => {
            if (live.current) setRows((prev) => prev ?? NO_ROWS);
          },
        )
        .finally(() => {
          running = false;
          if (queued && live.current) {
            queued = false;
            refresh();
          }
        });
    };
    refresh();
    const unsubscribe = store.subscribe(refresh);
    return () => {
      live.current = false;
      unsubscribe();
    };
  }, [store]);

  const download = useCallback(
    (ref: string) => {
      if (!store) return;
      const controllers = controllersOf(store);
      if (controllers.has(ref)) return;
      const controller = new AbortController();
      controllers.set(ref, controller);
      setFailed((prev) => {
        if (!prev.has(ref)) return prev;
        const next = new Set(prev);
        next.delete(ref);
        return next;
      });
      void store
        .download(ref, undefined, controller.signal)
        .catch(() => {
          // A cancel is the person's own act, not a failure to report.
          if (!controller.signal.aborted && live.current) setFailed((prev) => new Set(prev).add(ref));
        })
        .finally(() => {
          if (controllers.get(ref) === controller) controllers.delete(ref);
        });
    },
    [store],
  );

  const cancel = useCallback(
    (ref: string) => {
      if (store) controllersOf(store).get(ref)?.abort();
    },
    [store],
  );

  const remove = useCallback(
    (ref: string) => {
      if (store) void store.remove(ref).catch(() => undefined);
    },
    [store],
  );

  return { rows, failed, download, cancel, remove };
}
