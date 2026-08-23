'use client';

/**
 * ONE AD SET — what it targets, what it costs, and the ads inside it.
 *
 * The row states the AUDIENCE, not just the name. An ad set aimed at under-25s in
 * Germany and one aimed at everyone on Earth spend the same budget very differently, and
 * a list that shows only names cannot tell them apart — which is the failure
 * `adTargeting.ts` was written to prevent, arriving one layer up.
 *
 * Two disclosures, both closed by default because a panel is 300px wide: the AUDIENCE
 * editor and the ADS inside. Opening either is a deliberate act, and neither costs a
 * request until it is opened — the ads under an unopened set are never fetched.
 *
 * ── WHY RE-TARGETING IS A REPLACEMENT ───────────────────────────────────────
 * The editor is seeded with the spec the network reported and submits the whole thing.
 * Every network REPLACES rather than merges here, so a partial patch drops whatever it
 * omits — showing the current spec and sending it back entire is the only shape that
 * cannot silently widen an audience.
 */

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { adSetsApi, type AdSet, type AdTargeting } from '@/lib/adSetsApi';
import { formatMoney } from '@/lib/adsApi';
import { usePanelTask } from '@/hooks/usePanelTask';
import { AdTargetingFields } from './AdTargetingFields';
import { AdTargetingSummary } from './AdTargetingSummary';
import { AdTier } from './AdTier';
import { useAdAccount } from './useAdAccounts';

export interface AdSetRowProps {
  connectionId: string;
  adSet: AdSet;
  /** Re-read the list. Called only after the network accepted a change. */
  onChanged: () => void | Promise<void>;
}

export function AdSetRow({ connectionId, adSet, onChanged }: AdSetRowProps) {
  const t = useTranslations('canvas.ads.adSets');
  const locale = useLocale();
  const account = useAdAccount(connectionId);
  const { busy, error, notice, run, clear } = usePanelTask();

  const [editing, setEditing] = useState(false);
  const [showAds, setShowAds] = useState(false);
  const [targeting, setTargeting] = useState<AdTargeting>(adSet.targeting);

  const setStatus = useCallback(async (status: 'active' | 'paused') => {
    const done = await run(
      () => adSetsApi.updateAdSet(adSet.externalId, { connectionId, status }),
      {
        success: status === 'paused' ? t('paused', { name: adSet.name }) : t('resumed', { name: adSet.name }),
        failure: t('updateFailed'),
      },
    );
    if (done) await onChanged();
  }, [adSet.externalId, adSet.name, connectionId, onChanged, run, t]);

  const saveTargeting = useCallback(async () => {
    const done = await run(
      () => adSetsApi.updateAdSet(adSet.externalId, { connectionId, targeting }),
      { success: t('retargeted', { name: adSet.name }), failure: t('updateFailed') },
    );
    if (!done) return;
    setEditing(false);
    await onChanged();
  }, [adSet.externalId, adSet.name, connectionId, onChanged, run, t, targeting]);

  const openEditor = useCallback(() => {
    // Seeded from the network's own report every time it opens, so an editor left
    // closed since before someone else's change never submits a stale spec.
    setTargeting(adSet.targeting);
    setEditing(true);
  }, [adSet.targeting]);

  return (
    <div className={styles.adSetRow} role="listitem">
      <div className={styles.socialAccountRow}>
        <span className={styles.driveRowMain}>
          <span className={styles.driveRowName}>{adSet.name}</span>
          <small>{t('meta', {
            status: t(`status.${adSet.status}`),
            budget: formatMoney(adSet.dailyBudgetCents, adSet.currency, locale),
          })}</small>
        </span>
        {adSet.status === 'active'
          ? <button type="button" disabled={busy} onClick={() => void setStatus('paused')}>{t('pause')}</button>
          : <button type="button" disabled={busy} onClick={() => void setStatus('active')}>{t('resume')}</button>}
      </div>

      <p className={styles.adSetAudience}>
        <span>{t('audience')}</span>
        <AdTargetingSummary targeting={adSet.targeting} nativeTargeting={adSet.nativeTargeting} />
      </p>

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}
      {notice && <p className={styles.driveNotice} role="status">{notice}</p>}

      <div className={styles.adSetActions}>
        <button
          type="button"
          aria-expanded={editing}
          disabled={busy}
          onClick={() => { if (editing) { setEditing(false); clear(); } else openEditor(); }}
        >
          {editing ? t('cancel') : t('editAudience')}
        </button>
        <button type="button" aria-expanded={showAds} onClick={() => setShowAds((open) => !open)}>
          {showAds ? t('hideAds') : t('showAds')}
        </button>
      </div>

      {editing && (
        <form
          className={styles.socialForm}
          onSubmit={(event) => { event.preventDefault(); void saveTargeting(); }}
        >
          <AdTargetingFields
            value={targeting}
            onChange={setTargeting}
            dimensions={account?.targetingDimensions ?? []}
            disabled={busy}
          />
          {/* Said plainly, because it is the difference between narrowing an audience
              and replacing it: what is on screen IS what the ad set will target. */}
          <p className={styles.driveEmpty}>{t('replaceWarning')}</p>
          <div className={styles.socialFormActions}>
            <button type="submit" disabled={busy}>{busy ? t('working') : t('saveAudience')}</button>
          </div>
        </form>
      )}

      {showAds && <AdTier connectionId={connectionId} adSetExternalId={adSet.externalId} />}
    </div>
  );
}
