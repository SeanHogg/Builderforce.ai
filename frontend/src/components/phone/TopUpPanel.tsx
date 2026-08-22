'use client';

// The directive is REQUIRED here, not incidental to `PhoneConsole`. These cards
// are mounted from canvas surfaces and embedded apps as well as from the console,
// and several of those hosts are server components — a card that relies on an
// ancestor having already opened the client boundary cannot be dropped into one
// of them without an edit, which is the reuse contract this component is built to.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/canvasMoney';
import { completeTopUp, fetchTopUpPacks, startTopUp, type TopUpPack } from '@/lib/phoneApi';
import { usePhone } from '@/lib/usePhone';
import styles from './phone.module.css';

/**
 * Buying credit — and settling the payment the processor redirected back with.
 *
 * ── WHY THE SETTLEMENT LIVES HERE AND NOT ON THE PAGE ────────────────────────
 * `?topup=<session id>` arrives on the URL of whatever page the buyer was sent
 * back to. Putting the settle in the page would mean the page owns money, and a
 * second surface that also sells credit would need its own copy of it. This
 * component owns the whole round trip — open checkout, come back, settle,
 * refresh the shared balance — so it can be dropped onto any surface and the
 * purchase completes there.
 *
 * The settle is idempotent server-side (the ledger reference is the payment
 * intent), so a buyer who refreshes the success URL is credited once. `settled`
 * guards the double-invoke React does in development, which would otherwise fire
 * two requests for one visible outcome.
 */
export function TopUpPanel() {
  const t = useTranslations('phone');
  const locale = useLocale();
  const { overview, refresh } = usePhone();
  const sessionId = useSearchParams().get('topup');

  const [packs, setPacks] = useState<TopUpPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settled, setSettled] = useState(false);

  useEffect(() => { void fetchTopUpPacks().then(setPacks).catch(() => setPacks([])); }, []);

  useEffect(() => {
    if (!sessionId || sessionId === 'cancelled' || settled) return;
    setSettled(true);
    completeTopUp(sessionId)
      .then(async (result) => {
        setNotice(t('topUp.credited', { amount: formatCents(result.creditedCents, { locale }) }));
        await refresh();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t('topUp.failed')));
  }, [sessionId, settled, refresh, t, locale]);

  const buy = useCallback(async (packId: string) => {
    setBusy(packId);
    setError('');
    try {
      // The client navigates rather than the API client doing it, so a caller that
      // wants to open checkout in a new tab can.
      window.location.assign(await startTopUp(packId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('topUp.failed'));
      setBusy(null);
    }
  }, [t]);

  // No tenant session, or nothing to sell.
  if (!overview || packs.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="phone-topup-heading">
      <h3 id="phone-topup-heading" className={styles.cardTitle}>{t('topUp.title')}</h3>
      <p className={styles.cardHint}>{t('topUp.intro')}</p>

      <div className={styles.buttonRow}>
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => void buy(pack.id)}
          >
            {formatCents(pack.cents, { locale })}
          </button>
        ))}
      </div>

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {sessionId === 'cancelled' && !notice && (
        <p className={styles.cardHint} role="status">{t('topUp.cancelled')}</p>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
