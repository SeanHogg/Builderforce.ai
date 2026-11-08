'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { creationListingApi } from './creationListings';
import { isPurchaseRequiredError } from './planLimitError';

/**
 * A priced kanban template is a marketplace listing, so installing / applying one the
 * workspace has not bought answers 402 (`PurchaseRequiredError` carrying the listing
 * slug). This hook turns that into the ordinary listing checkout:
 *
 *  - `handlePurchaseRequired(error, templateId)` — call it from the apply/install
 *    `catch`. When the error is a template purchase it starts the checkout, redirects
 *    to the processor and resolves to a localized "redirecting" message; for any other
 *    error it resolves to null so the caller shows its own message.
 *  - the return leg — the processor redirects back with `?checkout=<session>`; the
 *    hook completes it (the server re-reads the session; the webhook grants the same
 *    licence if this leg is missed) and calls `onGranted(templateId)` so the caller can
 *    retry the apply/install, which now succeeds.
 */
const PENDING_PREFIX = 'bf.kanbanTemplateCheckout:';

/** One pending entry PER consumer, so only the surface that started the checkout resumes it. */
const pendingKey = (consumer: string): string => `${PENDING_PREFIX}${consumer}`;

function readPending(consumer: string): string | null {
  try { return window.sessionStorage.getItem(pendingKey(consumer)); } catch { return null; }
}
function writePending(consumer: string, templateId: string | null): void {
  try {
    if (templateId) window.sessionStorage.setItem(pendingKey(consumer), templateId);
    else window.sessionStorage.removeItem(pendingKey(consumer));
  } catch { /* storage unavailable: the webhook still grants the licence */ }
}

/** This page's path + query, so the `?checkout=` return lands on the same view. */
export function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function useKanbanTemplateCheckout(consumer: string, handlers: {
  onGranted?: (templateId: string) => void;
  onFailed?: (message: string) => void;
} = {}) {
  const t = useTranslations('kanbanTemplateCheckout');
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const templateId = readPending(consumer);
    if (!templateId || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const session = url.searchParams.get('checkout');
    if (!session || session === 'cancelled') {
      if (session === 'cancelled') writePending(consumer, null);
      return;
    }
    writePending(consumer, null);
    url.searchParams.delete('checkout');
    window.history.replaceState(null, '', url.toString());
    creationListingApi.completeCheckout(session)
      .then(() => latest.current.onGranted?.(templateId))
      .catch(() => latest.current.onFailed?.(t('completeFailed')));
  }, [t, consumer]);

  return useCallback(async (error: unknown, templateId: string): Promise<string | null> => {
    if (!isPurchaseRequiredError(error) || !error.listingSlug) return null;
    try {
      const checkoutUrl = await creationListingApi.checkout(
        error.listingSlug, window.location.href, currentReturnPath(),
      );
      writePending(consumer, templateId);
      window.location.assign(checkoutUrl);
      return t('redirecting', { name: error.listingName ?? '' });
    } catch {
      return t('checkoutFailed');
    }
  }, [t, consumer]);
}
