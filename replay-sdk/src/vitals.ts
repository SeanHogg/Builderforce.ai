/**
 * Core Web Vitals as `vital` marks, one per metric, taken at pagehide
 * (PRD 33 §8 S2). Values are in the `VITAL_BUCKETS` unit: LCP and INP in
 * ms, CLS × 1000.
 *
 * - LCP: the last `largest-contentful-paint` entry.
 * - CLS: the largest session window of `layout-shift` entries without recent
 *   input (gap < 1 s, window < 5 s).
 * - INP: the longest `event` entry with an interaction id.
 */

import type { ReplayMark, VitalMetric } from '@builderforce/interaction-contract';

export interface VitalsHandle {
  /** The marks for this page load, once; later calls return only metrics that changed. */
  take(atMs: number): ReplayMark[];
  stop(): void;
}

type ShiftEntry = PerformanceEntry & { value?: number; hadRecentInput?: boolean };
type EventEntry = PerformanceEntry & { interactionId?: number };

export function observeVitals(): VitalsHandle {
  const values: Partial<Record<VitalMetric, number>> = {};
  const sent: Partial<Record<VitalMetric, number>> = {};
  const observers: PerformanceObserver[] = [];

  let windowValue = 0;
  let windowStart = 0;
  let lastShift = 0;

  function observe(type: string, handler: (entry: PerformanceEntry) => void, extra: Record<string, unknown> = {}): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) handler(entry);
      });
      obs.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      observers.push(obs);
    } catch {
      /* unsupported entry type */
    }
  }

  observe('largest-contentful-paint', (entry) => {
    values.LCP = entry.startTime;
  });
  observe('layout-shift', (entry) => {
    const shift = entry as ShiftEntry;
    if (shift.hadRecentInput || typeof shift.value !== 'number') return;
    const t = entry.startTime;
    if (windowValue > 0 && t - lastShift < 1_000 && t - windowStart < 5_000) {
      windowValue += shift.value;
    } else {
      windowValue = shift.value;
      windowStart = t;
    }
    lastShift = t;
    values.CLS = Math.max(values.CLS ?? 0, windowValue);
  });
  observe(
    'event',
    (entry) => {
      const e = entry as EventEntry;
      if (!e.interactionId) return;
      values.INP = Math.max(values.INP ?? 0, entry.duration);
    },
    { durationThreshold: 40 },
  );

  return {
    take(atMs) {
      const marks: ReplayMark[] = [];
      for (const metric of ['LCP', 'CLS', 'INP'] as const) {
        const raw = values[metric];
        if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
        const value = Math.round(metric === 'CLS' ? raw * 1000 : raw);
        if (sent[metric] === value) continue;
        sent[metric] = value;
        marks.push({ kind: 'vital', key: metric, atMs, value });
      }
      return marks;
    },
    stop() {
      for (const obs of observers) obs.disconnect();
      observers.length = 0;
    },
  };
}
