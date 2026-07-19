'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { invalidateLlmModels } from '@/lib/useLlmModels';
import { invalidateConsumption } from '@/lib/useConsumption';
import { cardValidationApi } from '@/lib/builderforceApi';

/**
 * Start card validation — the ONE client-side implementation of "add and validate
 * a card", shared by every surface that can hit the `validate_card` unlock step
 * (the premium-model CTA, the chat error banner).
 *
 * There is no `/billing` route to send someone to: validation is a $0 SetupIntent
 * that either redirects to the processor's hosted page or resolves synchronously
 * on a manual provider. Duplicating that branch per surface is how one of them
 * ends up linking to a page that doesn't exist — so it lives here, together with
 * the cache invalidations that make the new entitlement visible without a reload
 * hunt.
 */
export function useStartCardValidation(): {
  start: () => Promise<void>;
  busy: boolean;
  /** null = no failure. A non-empty string is the SERVER's message (already
   *  user-facing); an empty string means "failed with nothing quotable" — the
   *  consumer supplies its own localized fallback, since this hook has no
   *  translation scope of its own. */
  error: string | null;
} {
  const { tenant } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `Tenant.id` is a string on the client but the API is numeric — same coercion
  // the pricing/dashboard pages use.
  const tenantId = tenant?.id != null && tenant.id !== '' ? Number(tenant.id) : null;

  const start = useCallback(async () => {
    if (tenantId == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cardValidationApi.start(tenantId);
      if (res.checkoutUrl) {
        // Hosted provider — the card is entered on the processor's page. The tenant
        // returns via successUrl and the `card.validated` webhook flips entitlement.
        window.location.href = res.checkoutUrl;
        return;
      }
      // Manual provider validated synchronously — drop the cached entitlement so the
      // premium group and the plan chip reflect it immediately.
      invalidateLlmModels();
      invalidateConsumption();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '');
      setBusy(false);
    }
  }, [tenantId]);

  return { start, busy, error };
}
