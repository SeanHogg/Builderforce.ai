/**
 * What I have published, what it earned, and getting the money out.
 *
 * ── WHY THE THREE NUMBERS ARE SHOWN SEPARATELY ───────────────────────────────────
 * Earned, paid and available are three different facts and a seller needs all
 * three: "earned" is what the shop did, "paid" is what has already left, and
 * "available" is the only one the payout button acts on. Showing a single balance
 * is how somebody concludes a payout silently failed when it had simply already
 * happened.
 *
 * The payout AMOUNT is never sent from here. The server computes the available
 * balance and pays that — a button that posted a number would be a button someone
 * could post a different number through.
 *
 * Renders nothing at all for a visitor who has published nothing: an empty
 * earnings panel on a marketplace is furniture, and this component decides that
 * for itself rather than taking a `hasListings` prop from the page.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  creationListingApi,
  formatListingPrice,
  type CreationListing,
  type SellerEarnings as Earnings,
} from '@/lib/creationListings';

export function SellerEarnings() {
  const t = useTranslations('marketplaceCreations');
  const confirm = useConfirm();
  const [listings, setListings] = useState<CreationListing[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [takeRateBps, setTakeRateBps] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, money] = await Promise.all([
        creationListingApi.mine(),
        creationListingApi.earnings(),
      ]);
      setListings(mine);
      setEarnings(money.earnings);
      setTakeRateBps(money.takeRateBps);
    } catch {
      // A signed-out or unentitled visitor simply has no seller surface; this
      // panel is additive and must never become the reason the page errors.
      setListings([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const payout = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await creationListingApi.payout();
      setNotice(result.ok
        ? t('payoutSent', { amount: formatListingPrice(result.amountCents) })
        : result.error ?? t('payoutFailed'));
      if (result.ok) await load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  const withdraw = useCallback(async (listing: CreationListing) => {
    // Removing a product from sale is irreversible for anyone mid-purchase, so it
    // is one of the few things that earns a centred confirmation.
    const ok = await confirm({
      title: t('withdrawTitle'),
      message: t('withdrawBody', { name: listing.name }),
      confirmLabel: t('withdrawConfirm'),
      destructive: true,
    });
    if (!ok) return;
    await creationListingApi.unpublish(listing.id);
    await load();
  }, [confirm, load, t]);

  if (!loaded || listings.length === 0) return null;

  return (
    <section aria-label={t('sellerHeading')} style={{
      display: 'grid', gap: 14, padding: 18, borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
    }}>
      <h2 style={{
        margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
        color: 'var(--text-primary)',
      }}>{t('sellerHeading')}</h2>

      {earnings && (
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))',
        }}>
          <Stat label={t('earned')} value={formatListingPrice(earnings.earnedCents)} />
          <Stat label={t('paidOut')} value={formatListingPrice(earnings.paidCents)} />
          <Stat label={t('available')} value={formatListingPrice(earnings.availableCents)} />
          <Stat label={t('sales')} value={String(earnings.salesCount)} />
        </div>
      )}

      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
        {t('takeRateNote', { rate: (takeRateBps / 100).toFixed(takeRateBps % 100 === 0 ? 0 : 2) })}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={payout}
          disabled={busy || !earnings?.availableCents}
        >
          {busy ? t('working') : t('payOutNow')}
        </button>
        <Link href="/settings/payouts" style={{
          color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)',
        }}>
          {t('payoutDestination')}
        </Link>
      </div>

      {notice && (
        <p role="status" style={{
          margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)',
        }}>{notice}</p>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {listings.map((listing) => (
          <li key={listing.id} style={{
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
            padding: '10px 12px', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
          }}>
            <span aria-hidden>{listing.icon}</span>
            <Link href={`/marketplace/listing/${listing.slug}`} style={{
              color: 'var(--text-primary)', fontWeight: 600,
              fontSize: 'var(--font-size-small)', minWidth: 0, flex: '1 1 160px',
            }}>{listing.name}</Link>
            <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
              v{listing.version} · {t('installs', { count: listing.installCount })} ·{' '}
              {listing.priceCents === 0
                ? t('free')
                : formatListingPrice(listing.priceCents, listing.currency)}
            </span>
            {listing.visibility === 'public' ? (
              <button type="button" className="btn btn-secondary" onClick={() => withdraw(listing)}>
                {t('withdraw')}
              </button>
            ) : (
              <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
                {t('withdrawn')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <span style={{
        fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600,
      }}>{label}</span>
      <strong style={{
        fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)',
        fontFamily: 'var(--font-display)',
      }}>{value}</strong>
    </div>
  );
}
