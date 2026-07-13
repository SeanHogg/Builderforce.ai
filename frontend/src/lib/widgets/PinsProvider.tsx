'use client';

/**
 * App-wide pin state. Mounted once near the app root so ANY surface can show a
 * pin control on a widget and have it reflect/update the user's personal home
 * dashboard. Loads the user's pins once per session, then mutates optimistically
 * (the server is the source of truth; the UI never blocks on the round-trip).
 *
 * No-ops cleanly on logged-out / no-tenant routes (the provider wraps the whole
 * app, including marketing pages) — it simply holds an empty set until a tenant
 * is present.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { pinsApi, type WidgetPin } from './pinsApi';

interface PinsApi {
  /** Pinned widget ids in display order. */
  pinned: string[];
  isPinned: (widgetKey: string) => boolean;
  pin: (widgetKey: string) => void;
  unpin: (widgetKey: string) => void;
  toggle: (widgetKey: string) => void;
  reorder: (order: string[]) => void;
  loading: boolean;
}

const PinsContext = createContext<PinsApi | null>(null);

export function PinsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, hasTenant } = useAuth();
  const [pinned, setPinned] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedFor = useRef<boolean | null>(null);

  useEffect(() => {
    const active = isAuthenticated && hasTenant;
    if (!active) { setPinned([]); loadedFor.current = null; return; }
    if (loadedFor.current === true) return; // already loaded for this tenant session
    loadedFor.current = true;
    setLoading(true);
    let alive = true;
    pinsApi.list()
      .then((r) => { if (alive) setPinned(r.pins.sort((a, b) => a.position - b.position).map((p) => p.widgetKey)); })
      .catch(() => { /* empty home is a valid state */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isAuthenticated, hasTenant]);

  const pin = useCallback((widgetKey: string) => {
    setPinned((prev) => (prev.includes(widgetKey) ? prev : [...prev, widgetKey]));
    pinsApi.pin(widgetKey).catch(() => setPinned((prev) => prev.filter((k) => k !== widgetKey)));
  }, []);

  const unpin = useCallback((widgetKey: string) => {
    let snapshot: string[] = [];
    setPinned((prev) => { snapshot = prev; return prev.filter((k) => k !== widgetKey); });
    pinsApi.unpin(widgetKey).catch(() => setPinned(snapshot));
  }, []);

  const reorder = useCallback((order: string[]) => {
    setPinned(order);
    pinsApi.reorder(order).catch(() => { /* best-effort; next load reconciles */ });
  }, []);

  const api = useMemo<PinsApi>(() => ({
    pinned,
    isPinned: (k) => pinned.includes(k),
    pin,
    unpin,
    toggle: (k) => (pinned.includes(k) ? unpin(k) : pin(k)),
    reorder,
    loading,
  }), [pinned, pin, unpin, reorder, loading]);

  return <PinsContext.Provider value={api}>{children}</PinsContext.Provider>;
}

export function usePins(): PinsApi {
  const ctx = useContext(PinsContext);
  if (!ctx) throw new Error('usePins must be used within a PinsProvider');
  return ctx;
}

/** Non-throwing variant for optional consumers. */
export function useOptionalPins(): PinsApi | null {
  return useContext(PinsContext);
}

export type { WidgetPin };
