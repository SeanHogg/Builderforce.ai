'use client';

/**
 * RUNNING somebody else's creation.
 *
 * ── THE ONE SECURITY INVARIANT ON THIS PAGE ──────────────────────────────────────
 * A game's document is HTML a language model wrote from a free-text brief, and it
 * is about to execute in a visitor's browser on our origin's page. The frame is
 * `sandbox="allow-scripts"` and NEVER `allow-same-origin`, and it is fed by
 * `srcDoc` rather than a blob URL. Either relaxation lets that code reach the
 * app's session — the same invariant `gameNode.test.tsx` pins on the canvas, held
 * here too because this is the surface where the code is a STRANGER's.
 *
 * ── WHY THE PRIMARY BUTTON IS NOT A BRANCH PER KIND ──────────────────────────────
 * `launch.mode` arrives from the server, derived from the listing's kind in the
 * shared registry. Five modes, five renderers, and a sixth sellable kind adds a
 * registry entry rather than a case here.
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
        .mpl-stage { border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
                     background: var(--surface-card); overflow: hidden; }
        .mpl-frame { display: block; width: 100%; height: min(70vh, 640px); border: 0;
                     background: var(--bg-base); }
        .mpl-objects { display: grid; gap: 10px; padding: 16px;
                       grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
        .mpl-object { border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
                      padding: 12px 14px; background: var(--bg-base); min-width: 0; }
        .mpl-object h3 { margin: 0 0 4px; font-size: var(--font-size-small);
                         color: var(--text-primary); }
        .mpl-object pre { margin: 0; font-size: var(--font-size-eyebrow); color: var(--text-secondary);
                          white-space: pre-wrap; word-break: break-word; max-height: 140px;
                          overflow: auto; }
        .mpl-note { margin: 0; font-size: var(--font-size-small); color: var(--text-secondary); }
        .mpl-error { margin: 0; padding: 10px 14px; border-radius: var(--radius-md);
                     background: var(--tone-danger-bg); color: var(--tone-danger-ink);
                     border-left: 3px solid var(--tone-danger-mark);
                     font-size: var(--font-size-small); }
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

      {launch && <LaunchStage launch={launch} listing={listing} />}

      {launch && !launch.entitled && (
        <p className="mpl-note">{t('previewOnly')}</p>
      )}
    </section>
  );
}

/** One renderer per launch mode. The mode is data; this is the only place that
 *  turns it into pixels. */
function LaunchStage({ launch, listing }: { launch: LaunchPayload; listing: CreationListing }) {
  const t = useTranslations('marketplaceListing');

  if (launch.mode === 'play' && launch.document) {
    return (
      <div className="mpl-stage">
        {/* allow-scripts and NOTHING else. `allow-same-origin` beside it would
            give model-authored code from a stranger's brief the run of this
            origin — the session included. */}
        <iframe
          className="mpl-frame"
          title={t('playFrameTitle', { name: listing.name })}
          sandbox="allow-scripts"
          srcDoc={launch.document}
        />
      </div>
    );
  }

  if (launch.mode === 'open' && launch.url) {
    return (
      <div className="mpl-stage">
        <iframe
          className="mpl-frame"
          title={t('siteFrameTitle', { name: listing.name })}
          sandbox="allow-scripts allow-forms allow-popups"
          src={launch.url}
        />
      </div>
    );
  }

  if (launch.objects?.length) {
    return (
      <div className="mpl-stage">
        <div className="mpl-objects">
          {launch.objects.slice(0, 12).map((object) => (
            <article key={object.id} className="mpl-object">
              <h3>{object.kind}</h3>
              <pre>{summarise(object.canvasData)}</pre>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return <p className="mpl-note">{t('nothingToShow')}</p>;
}

/** A short, readable digest of a canvas card for the preview grid. Bounded on
 *  purpose — this is a shop window, not a data dump. */
function summarise(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const entries = Object.entries(data as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .slice(0, 6);
  return entries.map(([key, value]) => `${key}: ${String(value).slice(0, 80)}`).join('\n');
}
