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
 *
 * It decides its own AUTH the same way, and must: `/marketplace` is a page anyone
 * may browse, while everything this panel reads is tenant-scoped and behind the
 * workspace JWT. Asking without one is not a read that might fail — it is a
 * guaranteed 401 that raises the global error toast and files a support ticket
 * about a logged-out stranger looking at the shop. Gating on `hasTenant` (not
 * merely "signed in") also covers the authenticated-but-tenantless freelancer,
 * which is the same reason the page's other tenant-scoped fetches gate on it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
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
  const { hasTenant } = useAuth();
  const [listings, setListings] = useState<CreationListing[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [configuredTakeRateBps, setConfiguredTakeRateBps] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    // No workspace token, no request. See the note at the top of the file: this
    // is the difference between "the seller has nothing" and a 401 on a public page.
    if (!hasTenant) {
      setListings([]);
      setEarnings(null);
      setLoaded(true);
      return;
    }
    try {
      const [mine, money] = await Promise.all([
        creationListingApi.mine(),
        creationListingApi.earnings(),
      ]);
      setListings(mine);
      setEarnings(money.earnings);
      setConfiguredTakeRateBps(money.configuredTakeRateBps);
    } catch {
      // An unentitled visitor simply has no seller surface; this panel is
      // additive and must never become the reason the page errors.
      setListings([]);
    } finally {
      setLoaded(true);
    }
  }, [hasTenant]);

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
          {earnings.maintenanceCostCents > 0 && (
            <Stat label={t('maintenanceCost')} value={formatListingPrice(earnings.maintenanceCostCents)} />
          )}
        </div>
      )}

      {earnings && earnings.maintenanceCostCents > 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('maintenanceCostNote', { amount: formatListingPrice(earnings.maintenanceCostCents) })}
        </p>
      )}

      {earnings && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {earnings.takeRate.underThreshold
            // The single most persuasive fact for a seller under the threshold: the
            // platform is taking NOTHING right now, and this is the number that
            // proves it rather than an internal constant nobody outside this panel
            // ever reads.
            ? t('takeRateZero', {
              rate: bpsToRate(configuredTakeRateBps),
              threshold: formatListingPrice(earnings.takeRate.thresholdCents),
              remaining: formatListingPrice(
                Math.max(0, earnings.takeRate.thresholdCents - earnings.takeRate.lifetimeCents),
              ),
            })
            : t('takeRateNote', { rate: bpsToRate(earnings.takeRate.bps) })}
        </p>
      )}

      {/* The rate, the threshold and the balance are this panel's summary; the
          per-transaction history — what the fee WAS on each past sale, and every
          movement behind the three numbers above — is the statement. Linked rather
          than inlined: a shop panel that grows a ledger stops being a shop panel, and
          the statement already exists as its own destination for the for-hire accounts
          that have no marketplace listings at all. */}
      <Link href="/freelancer/earnings" style={{
        color: 'var(--cyan-bright)', fontSize: 'var(--font-size-small)',
      }}>{t('viewStatement')}</Link>

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

/** Basis points as a trimmed percentage string — whole for a round rate, two
 *  decimals otherwise, so "1500" reads "15" and "1050" reads "10.50". */
function bpsToRate(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
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
