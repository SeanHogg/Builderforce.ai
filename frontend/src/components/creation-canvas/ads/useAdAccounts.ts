'use client';

import { useEffect, useState } from 'react';
import { adsApi, type AdAccount, type AdNetworkOption } from '@/lib/adsApi';
import {
  getOrSetClientCached, invalidateClientCache, readClientCached,
} from '@/infrastructure/http/readThrough';

/**
 * THE client read of this workspace's ad accounts — every paid-media surface asks here.
 *
 * The panel used to hold this in its own state and pass the list down, which is why the
 * ad-set and ad levels could not be their own components: they need the network's
 * CAPABILITIES (which targeting dimensions it can place, whether an ad must promote
 * existing content) and the only way to get them was a prop drilled from the panel.
 * Reading through one shared cache instead means a tier component can answer that
 * question itself — the test that it can be dropped into a second surface with zero
 * edits — while N consumers mounting in the same commit still cost ONE request.
 *
 * Accounts and networks are read TOGETHER under one key: they are two projections of the
 * same registry, every surface that wants one wants the other, and caching them apart
 * makes "connected" and "connectable" disagree for one render.
 *
 * WRITES INVALIDATE. Connecting or disconnecting an account calls
 * {@link invalidateAdAccounts}, which is the client half of the rule `adsService` keeps
 * with `invalidateCached` — the alternative is disconnecting an account and still being
 * offered it as a launch target.
 */

const KEY = 'ads:accounts';

export interface AdAccountsRead {
  accounts: AdAccount[];
  networks: AdNetworkOption[];
}

const subscribers = new Set<(read: AdAccountsRead) => void>();

function load(): Promise<AdAccountsRead> {
  return getOrSetClientCached<AdAccountsRead>(KEY, async () => {
    const [accountRead, networkRead] = await Promise.all([adsApi.accounts(), adsApi.networks()]);
    return { accounts: accountRead.accounts, networks: networkRead.networks };
  }).then((read) => {
    for (const notify of subscribers) notify(read);
    return read;
  });
}

/** Drop the held accounts and re-read. Call after any write that changes which accounts
 *  exist or what they can do. Every mounted consumer updates, not just the one that
 *  performed the write — a panel with a list open in one tab and a connect form in
 *  another is the normal case, not the exception. */
export function invalidateAdAccounts(): Promise<AdAccountsRead> {
  invalidateClientCache(KEY);
  return load();
}

export interface AdAccountsState extends AdAccountsRead {
  /** The accounts that can actually spend. What every launch target picker offers. */
  ready: AdAccount[];
  loading: boolean;
  /** Why the read failed, if it did. Null while it is merely in flight. */
  error: string | null;
}

export function useAdAccounts(): AdAccountsState {
  const cached = readClientCached<AdAccountsRead>(KEY);
  const [read, setRead] = useState<AdAccountsRead>(cached ?? { accounts: [], networks: [] });
  const [loading, setLoading] = useState(cached == null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const notify = (next: AdAccountsRead) => { if (live) setRead(next); };
    subscribers.add(notify);
    load()
      .then(notify)
      .catch((failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; subscribers.delete(notify); };
  }, []);

  return {
    ...read,
    ready: read.accounts.filter((account) => account.ready),
    loading,
    error,
  };
}

/**
 * One account by its connection id, or null while the read is in flight / it is gone.
 *
 * This is what lets a tier component know what its network can PLACE without being told:
 * it holds a connection id, which is the handle it already needs for every call.
 */
export function useAdAccount(connectionId: string): AdAccount | null {
  const { accounts } = useAdAccounts();
  return accounts.find((account) => account.id === connectionId) ?? null;
}
