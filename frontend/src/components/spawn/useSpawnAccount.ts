// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useCallback, useState } from 'react';
import {
  completeSpawnMembership,
  completeSpawnTokens,
  confirmSpawnAge,
  fetchSpawnAccount,
  startSpawnMembership,
  startSpawnTokens,
  startSpawnTrial,
  type SpawnAccount,
} from '@/lib/spawn/spawnApi';
import { spawnErrorKey, useSpawnCheckoutReturn, type CheckoutNotice, type SpawnNotice } from './useSpawnCheckoutReturn';

const SETTLE = { joined: completeSpawnMembership, tokens: completeSpawnTokens };

/**
 * The account page's state and actions: load the account, settle a checkout the
 * processor just returned from, and start the things a player does here — say
 * their age, start the free week, join, buy tokens. Purchases navigate to the
 * processor's hosted page; nothing here takes a card.
 */
export function useSpawnAccount(enabled: boolean) {
  const [account, setAccount] = useState<SpawnAccount | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<SpawnNotice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setAccount(await fetchSpawnAccount());
      setErrorKey(null);
    } catch (error) {
      setErrorKey(spawnErrorKey(error));
    }
  }, []);

  const settled = useCallback((result: { notice: CheckoutNotice; errorKey: string | null }) => {
    setNotice(result.notice);
    void reload().then(() => { if (result.errorKey) setErrorKey(result.errorKey); });
  }, [reload]);
  useSpawnCheckoutReturn(enabled, SETTLE, settled);

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setErrorKey(null);
    try {
      await action();
    } catch (error) {
      setErrorKey(spawnErrorKey(error));
    } finally {
      setBusy(null);
    }
  }, []);

  const confirmAge = useCallback((year: number, month: number) =>
    run('age', async () => { await confirmSpawnAge(year, month); await reload(); }), [run, reload]);
  const startTrial = useCallback((parentEmail: string) =>
    run('trial', async () => { await startSpawnTrial(parentEmail); setNotice('trialStarted'); await reload(); }), [run, reload]);
  const join = useCallback(() =>
    run('join', async () => { window.location.href = await startSpawnMembership(); }), [run]);
  const buy = useCallback((packId: string) =>
    run(packId, async () => { window.location.href = await startSpawnTokens(packId); }), [run]);

  return { account, errorKey, notice, busy, confirmAge, startTrial, join, buy };
}
