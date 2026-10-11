/**
 * Web vitals as `webvital` interaction events (LCP, CLS, INP/FID, TTFB).
 */

import type { ReplayChunkEvent } from '@builderforce/interaction-contract';

export function observeVitals(emit: (event: ReplayChunkEvent) => void): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const observers: PerformanceObserver[] = [];

  function observe(type: string, handler: (entry: PerformanceEntry) => void): void {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) handler(entry);
      });
      obs.observe({ type, buffered: true } as PerformanceObserverInit);
      observers.push(obs);
    } catch {
      /* unsupported entry type */
    }
  }

  observe('largest-contentful-paint', (entry) => {
    emit({ t: Math.round(entry.startTime), kind: 'webvital', key: 'LCP', value: entry.startTime });
  });
  observe('layout-shift', (entry) => {
    const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
    if (shift.hadRecentInput) return;
    emit({ t: Math.round(entry.startTime), kind: 'webvital', key: 'CLS', value: shift.value ?? 0 });
  });
  observe('event', (entry) => {
    const e = entry as PerformanceEntry & { duration?: number };
    emit({ t: Math.round(entry.startTime), kind: 'webvital', key: 'INP', value: e.duration ?? 0 });
  });
  observe('first-input', (entry) => {
    const e = entry as PerformanceEntry & { processingStart?: number };
    const delay = (e.processingStart ?? entry.startTime) - entry.startTime;
    emit({ t: Math.round(entry.startTime), kind: 'webvital', key: 'FID', value: delay });
  });

  const nav = performance.getEntriesByType?.('navigation')[0] as
    | (PerformanceNavigationTiming & { responseStart?: number })
    | undefined;
  if (nav && typeof nav.responseStart === 'number') {
    emit({ t: 0, kind: 'webvital', key: 'TTFB', value: nav.responseStart });
  }

  return () => {
    for (const obs of observers) obs.disconnect();
  };
}
