'use client';

/**
 * RUNNING somebody else's creation.
 *
 * ── WHAT IS HERE AND WHAT IS NOT ─────────────────────────────────────────────────
 * This is the BUYING half — price, sign in, acquire, come back from the processor,
 * install. Rendering the thing itself is `LaunchStage` in `lib/creationListings.
 * launch.tsx`, shared with the creator's landing page and with Stage in the canvas,
 * because a preview that is a second renderer is a preview that AGREES WITH the
 * product rather than one that IS it. That module also carries the sandbox invariant
 * that governs running a stranger's HTML.
 *
 * ── PREVIEW VS PRODUCT ───────────────────────────────────────────────────────────
 * The server decides which one this visitor gets and says so in `entitled`. This
 * component never re-derives that from the price — a client that decides its own
 * entitlement is a client that can be told to decide differently.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import {
  DeclaredLimits,
  HostedStatusNote,
  LAUNCH_STAGE_CSS,
  LaunchStage,
} from '@/lib/creationListings.launch';
import {
  creationListingApi,
  formatListingPrice,
  publicListingApi,
  type CreationListing,
  type LaunchPayload,
} from '@/lib/creationListings';

export function ListingLaunch({ listing }: { listing: CreationListing }) {
  const t = useTranslations('marketplaceListing');
  const router = useRouter();
  const { user } = useAuth();
  const signedIn = !!user;
  const [launch, setLaunch] = useState<LaunchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [owned, setOwned] = useState(false);
  const free = listing.priceCents === 0;

  const load = useCallback(async () => {
    setError(null);
    try {
      setLaunch(await publicListingApi.launch(listing.slug, signedIn));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [listing.slug, signedIn]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Take it.
   *
   * A free listing grants on the spot. A priced one leaves for the processor's
   * hosted checkout — this page never sees a card number, and the grant happens
   * on the way back, in `complete` below, against what the processor says.
   */
  const acquire = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (free) {
        await creationListingApi.acquire(listing.slug);
        setOwned(true);
        // Re-launch rather than flipping a local flag: the server decides what a
        // buyer may now see, and asking it again is the only way to be right.
        await load();
      } else {
        const url = await creationListingApi.checkout(listing.slug, window.location.href);
        window.location.assign(url);
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [free, listing.slug, load]);

  /**
   * Come back from the processor and settle up.
   *
   * The id in the URL is not proof of anything — the server re-reads the session
   * from the processor before granting. What this does is make sure the round
   * trip finishes even if the buyer closes the tab and returns to the link later,
   * and it strips the parameter afterwards so a refresh is not a second attempt.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (!checkout || checkout === 'cancelled' || !signedIn) return;
    let live = true;
    setBusy(true);
    creationListingApi.completeCheckout(checkout)
      .then(async () => {
        if (!live) return;
        setOwned(true);
        await load();
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!live) return;
        setBusy(false);
        params.delete('checkout');
        const query = params.toString();
        router.replace(`${window.location.pathname}${query ? `?${query}` : ''}`);
      });
    return () => { live = false; };
  }, [signedIn, load, router]);

  /** Take a copy onto a board of my own, and go straight to it — an install that
   *  ends on a confirmation the buyer has to act on is an install nobody finishes. */
  const install = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const installed = await creationListingApi.install(listing.slug);
      router.push(`/create/${installed.sessionId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }, [listing.slug, router]);

  const entitled = launch?.entitled ?? false;

  return (
    <section className="mpl-launch" aria-label={t('launchSection')}>
      <style>{`
        .mpl-launch { display: grid; gap: 16px; }
        .mpl-cta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .mpl-price { font-family: var(--font-display); font-weight: 700;
                     font-size: var(--font-size-card-title); color: var(--text-primary); }
        .mpl-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px;
                   border: 0; border-radius: var(--radius-lg); font-weight: 600;
                   font-size: var(--font-size-body); text-decoration: none; cursor: pointer;
                   background: linear-gradient(135deg, var(--coral-bright), var(--error));
                   color: var(--text-on-accent); }
        .mpl-btn[disabled] { opacity: .55; cursor: not-allowed; }
        .mpl-btn-ghost { background: var(--surface-card); color: var(--text-primary);
                         border: 1px solid var(--border-subtle); }
        .mpl-note { margin: 0; font-size: var(--font-size-small); color: var(--text-secondary); }
        .mpl-error { margin: 0; padding: 10px 14px; border-radius: var(--radius-md);
                     background: var(--tone-danger-bg); color: var(--tone-danger-ink);
                     border-left: 3px solid var(--tone-danger-mark);
                     font-size: var(--font-size-small); }
        ${LAUNCH_STAGE_CSS}
      `}</style>

      <div className="mpl-cta">
        <span className="mpl-price">
          {free ? t('free') : formatListingPrice(listing.priceCents, listing.currency)}
        </span>
        {!signedIn ? (
          <Link className="mpl-btn" href={signInHref(`/marketplace/listing/${listing.slug}`)}>
            {free ? t('signInToInstall') : t('signInToBuy')}
          </Link>
        ) : owned || entitled ? (
          <span className="mpl-note">{t('youOwnIt')}</span>
        ) : (
          <button type="button" className="mpl-btn" onClick={acquire} disabled={busy}>
            {busy ? t('working') : free ? t('install') : t('buy')}
          </button>
        )}
        {(owned || entitled) && signedIn && (
          <button type="button" className="mpl-btn mpl-btn-ghost" onClick={install} disabled={busy}>
            {t('openInCanvas')}
          </button>
        )}
      </div>

      {error && <p className="mpl-error" role="alert">{error}</p>}

      {/* Before the product, because it is the thing a buyer needs to know BEFORE
          they subscribe: whether what they would be paying for is still running. */}
      <HostedStatusNote hosted={launch?.hosted} />

      {launch && <LaunchStage launch={launch} name={listing.name} />}

      {launch && !launch.entitled && (
        <p className="mpl-note">{t('previewOnly')}</p>
      )}

      {/* What the seller was told in Stage and shipped with. Declared here so it is
          not something the buyer finds out afterwards. Decides its own visibility. */}
      <DeclaredLimits checks={listing.declared} />
    </section>
  );
}
