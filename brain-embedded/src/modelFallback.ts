/**
 * THE hand-off from the routing step to a host's UI when Hybrid's pick failed and the
 * turn was answered with Auto (`createHostModelStream`'s `onFallback`). The stream runs
 * where the host builds it (a config module, the extension host, Rovr's worker), not
 * inside the component that shows the notice, so the event crosses through a channel:
 * the stream's `onFallback` is the channel's `report`, and the surface subscribes.
 *
 * One channel per host; it keeps the latest event until dismissed, so a notice raised
 * before the surface mounted is still shown.
 */
import type { ModelFallbackEvent } from './hostModelStream';

export interface ModelFallbackChannel {
  /** Pass as `createHostModelStream({ onFallback })`. */
  report: (event: ModelFallbackEvent) => void;
  /** Called on every report and on `clear`. */
  subscribe: (listener: () => void) => () => void;
  /** The latest undismissed event, or null. */
  latest: () => ModelFallbackEvent | null;
  /** Dismiss the notice. */
  clear: () => void;
}

export function createModelFallbackChannel(): ModelFallbackChannel {
  let current: ModelFallbackEvent | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  return {
    report: (event) => { current = event; notify(); },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    latest: () => current,
    clear: () => {
      if (current === null) return;
      current = null;
      notify();
    },
  };
}

/** The notice's one line: the host's localized template with its `{model}` token filled. */
export function modelFallbackText(template: string, event: Pick<ModelFallbackEvent, 'from'>): string {
  return template.replace('{model}', event.from);
}

/** English default — every host passes its own localized template. */
export const DEFAULT_MODEL_FALLBACK_TEMPLATE = 'Your pick {model} failed; answered with Auto.';
