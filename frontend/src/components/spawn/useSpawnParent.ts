// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  completeSpawnParentMembership,
  completeSpawnParentTokens,
  fetchSpawnParent,
  startSpawnParentMembership,
  startSpawnParentTokens,
  type SpawnParentView,
} from '@/lib/spawn/spawnApi';
import { spawnErrorKey, useSpawnCheckoutReturn, type CheckoutNotice } from './useSpawnCheckoutReturn';

/**
 * The grown-up's page state. `t` is the signed link from the trial emails — the
 * page's only credential — so every call carries it, and a missing one is the
 * same refusal as an expired one.
 */
export function useSpawnParent(t: string | null) {
  const [view, setView] = useState<SpawnParentView | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(t ? null : 'parent_link_invalid');
  const [notice, setNotice] = useState<CheckoutNotice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!t) return;
    try {
      setView(await fetchSpawnParent(t));
    } catch (error) {
      setErrorKey(spawnErrorKey(error));
    }
  }, [t]);

  useEffect(() => { void reload(); }, [reload]);

  const settle = useMemo(() => ({
    joined: (sessionId: string) => completeSpawnParentMembership(t ?? '', sessionId),
    tokens: (sessionId: string) => completeSpawnParentTokens(t ?? '', sessionId),
  }), [t]);
  const settled = useCallback((result: { notice: CheckoutNotice; errorKey: string | null }) => {
    setNotice(result.notice);
    if (result.errorKey) setErrorKey(result.errorKey);
    void reload();
  }, [reload]);
  useSpawnCheckoutReturn(Boolean(t), settle, settled);

  const go = useCallback(async (key: string, open: () => Promise<string>) => {
    setBusy(key);
    setErrorKey(null);
    try {
      window.location.href = await open();
    } catch (error) {
      setErrorKey(spawnErrorKey(error));
      setBusy(null);
    }
  }, []);

  const join = useCallback(() => { if (t) void go('join', () => startSpawnParentMembership(t)); }, [go, t]);
  const buy = useCallback((packId: string) => { if (t) void go(packId, () => startSpawnParentTokens(t, packId)); }, [go, t]);

  return { view, errorKey, notice, busy, join, buy };
}
