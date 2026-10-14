import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayPackDto } from '@builderforce/interaction-contract';
import { SectionLoading } from '@/components/ui';
import { RoleGate } from '@/components/RoleGate';
import { capabilityApi, packCheckoutReturnUrl } from '@/lib/capabilityApi';
import { formatCents } from '@/lib/canvasMoney';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import styles from './capability.module.css';

/**
 * The credit packs on sale (D4), each a button that starts the one-off checkout
 * and leaves for the processor's hosted page. The buyer comes back to the app
 * with the plan panel open on its packs tab; the credit lands when the processor
 * confirms payment, never because this page was revisited.
 */
export function PackList({ appPath }: { appPath: string }) {
  const t = useTranslations('marketplace.capability.plan');
  const errorMessage = useErrorMessage();
  const [packs, setPacks] = useState<ReplayPackDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    capabilityApi.packs()
      .then((ladder) => { if (live) setPacks(ladder); })
      .catch(() => { if (live) setPacks([]); });
    return () => { live = false; };
  }, []);

  const buy = async (pack: ReplayPackDto) => {
    setBusy(pack.id);
    setError(null);
    try {
      const url = await capabilityApi.startPackCheckout(pack.id, packCheckoutReturnUrl(window.location.origin, appPath));
      window.location.assign(url);
    } catch (cause) {
      setError(errorMessage(cause) ?? t('checkoutFailed'));
      setBusy(null);
    }
  };

  if (packs === null) return <SectionLoading label={t('loadingPacks')} />;
  if (packs.length === 0) return <p className={styles.body}>{t('noPacks')}</p>;

  return (
    <div className={styles.stack}>
      <RoleGate capability="insights.manageSites" variant="block">
      <div className={styles.packs} data-testid="pack-list">
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={styles.pack}
            disabled={busy !== null}
            onClick={() => void buy(pack)}
            aria-label={t('buyAria', { units: pack.units.toLocaleString(), price: formatCents(pack.amountCents) })}
            data-pack={pack.id}
          >
            <span className={styles.packUnits}>{t('packUnits', { units: pack.units.toLocaleString() })}</span>
            <span>{busy === pack.id ? t('redirecting') : formatCents(pack.amountCents, { maximumFractionDigits: 0 })}</span>
          </button>
        ))}
      </div>
      </RoleGate>
      <p className={styles.listMeta}>{t('packTerms')}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
