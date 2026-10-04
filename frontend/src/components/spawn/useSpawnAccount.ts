// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ApiRequestError } from '@/lib/apiClient';
import {
  completeSpawnMembership,
  completeSpawnTokens,
  confirmSpawnAge,
  fetchSpawnAccount,
  startSpawnMembership,
  startSpawnTokens,
  type SpawnAccount,
} from '@/lib/spawn/spawnApi';

/** The refusal codes the account page has a sentence for (`spawn.errors.<code>`). */
const KNOWN_CODES = new Set([
  'age_required', 'too_young', 'membership_required', 'insufficient_tokens', 'pack_not_found',
  'payments_unavailable', 'payment_not_found', 'payment_not_paid', 'payment_wrong_kind',
  'payment_not_yours', 'payment_short',
]);

/** A refusal as the key of its sentence; anything unrecognised is `generic`. */
export function spawnErrorKey(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  return code && KNOWN_CODES.has(code) ? code : 'generic';
}

export type SpawnNotice = 'joined' | 'tokensAdded' | 'cancelled' | null;

/**
 * The account page's state and actions: load the account, settle a checkout the
 * processor just returned from (`?joined=` / `?tokens=`), and start the three
 * things a player does here — say their age, join, buy tokens. Purchases navigate
 * to the processor's hosted page; nothing here takes a card.
 */
export function useSpawnAccount(enabled: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [account, setAccount] = useState<SpawnAccount | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<SpawnNotice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const settled = useRef(false);

  const reload = useCallback(async () => {
    try {
      setAccount(await fetchSpawnAccount());
      setErrorKey(null);
    } catch (error) {
      setErrorKey(spawnErrorKey(error));
    }
  }, []);

  useEffect(() => {
    if (!enabled || settled.current) return;
    settled.current = true;
    const joined = params.get('joined');
    const tokens = params.get('tokens');
    const settle = async () => {
      if (joined === 'cancelled' || tokens === 'cancelled') setNotice('cancelled');
      else if (joined) { await completeSpawnMembership(joined); setNotice('joined'); }
      else if (tokens) { await completeSpawnTokens(tokens); setNotice('tokensAdded'); }
    };
    void settle()
      .catch((error) => setErrorKey(spawnErrorKey(error)))
      .finally(() => {
        if (joined || tokens) router.replace(pathname);
        void reload();
      });
  }, [enabled, params, pathname, router, reload]);

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
  const join = useCallback(() =>
    run('join', async () => { window.location.href = await startSpawnMembership(); }), [run]);
  const buy = useCallback((packId: string) =>
    run(packId, async () => { window.location.href = await startSpawnTokens(packId); }), [run]);

  return { account, errorKey, notice, busy, confirmAge, join, buy };
}
