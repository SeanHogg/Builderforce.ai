// No `'use client'`: this module exports a hook and a helper, not a component, so a directive marks no boundary.

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ApiRequestError } from '@/lib/apiClient';

/** The refusal codes Spawn's pages have a sentence for (`spawn.account.errors.<code>`). */
const KNOWN_CODES = new Set([
  'age_required', 'too_young', 'membership_required', 'insufficient_tokens', 'pack_not_found',
  'payments_unavailable', 'payment_not_found', 'payment_not_paid', 'payment_wrong_kind',
  'payment_not_yours', 'payment_short', 'trial_used', 'parent_email_invalid', 'parent_link_invalid',
]);

/** A refusal as the key of its sentence; anything unrecognised is `generic`. */
export function spawnErrorKey(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  return code && KNOWN_CODES.has(code) ? code : 'generic';
}

/** What a returning checkout can report. */
export type CheckoutNotice = 'joined' | 'tokensAdded' | 'cancelled' | null;
/** Everything the account page can announce: a checkout's result, or the free week starting. */
export type SpawnNotice = CheckoutNotice | 'trialStarted';

/**
 * Settle a Spawn checkout the processor just returned from — `?joined=<session>` or
 * `?tokens=<session>` — once, then take those parameters off the address (keeping
 * any others, such as the parent page's `t`) and hand back what happened.
 *
 * The player's account page and the grown-up's page both land here; they differ
 * only in which calls settle a session, so those are the arguments.
 */
export function useSpawnCheckoutReturn(
  enabled: boolean,
  settle: { joined: (sessionId: string) => Promise<unknown>; tokens: (sessionId: string) => Promise<unknown> },
  done: (result: { notice: CheckoutNotice; errorKey: string | null }) => void,
) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    const joined = params.get('joined');
    const tokens = params.get('tokens');
    const run = async (): Promise<CheckoutNotice> => {
      if (joined === 'cancelled' || tokens === 'cancelled') return 'cancelled';
      if (joined) { await settle.joined(joined); return 'joined'; }
      if (tokens) { await settle.tokens(tokens); return 'tokensAdded'; }
      return null;
    };
    void run()
      .then((notice) => done({ notice, errorKey: null }), (error) => done({ notice: null, errorKey: spawnErrorKey(error) }))
      .finally(() => {
        if (!joined && !tokens) return;
        const rest = new URLSearchParams(params.toString());
        rest.delete('joined');
        rest.delete('tokens');
        const query = rest.toString();
        router.replace(query ? `${pathname}?${query}` : pathname);
      });
  }, [enabled, params, pathname, router, settle, done]);
}
