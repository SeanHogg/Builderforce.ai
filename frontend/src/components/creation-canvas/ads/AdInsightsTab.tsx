'use client';

/**
 * MEASURE what it cost and returned — the third of the panel's three jobs.
 *
 * Reads the workspace's own stored ledger rather than the networks, which is why it is
 * fast and still answers when a grant has expired. "Refresh from networks" is the act
 * that repopulates it; the two are deliberately separate, so looking at last week's
 * numbers never costs nine upstream calls.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { adsApi, formatMoney, type AdInsightsRead } from '@/lib/adsApi';
import { NETWORK_GLYPHS } from '@/lib/networkGlyph';
import { useFormat } from '@/i18n/useFormat';
import { usePanelTask } from '@/hooks/usePanelTask';

/** How many daily rows the panel renders. The ledger holds a 28-day window across every
 *  campaign on every network, which is thousands of rows in a 300px column — the tiles
 *  above carry the totals, so the list is a recent sample, not the archive. */
const VISIBLE_ROWS = 60;

export function AdInsightsTab() {
  const t = useTranslations('canvas.ads');
  const locale = useLocale();
  const fmt = useFormat();
  const { busy, error, notice, run } = usePanelTask();

  const [insights, setInsights] = useState<AdInsightsRead | null>(null);

  const load = useCallback(async () => {
    const read = await run(() => adsApi.insights(), { failure: t('loadFailed') });
    if (read) setInsights(read);
  }, [run, t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = useCallback(async () => {
    const result = await run(() => adsApi.sync(), {
      failure: t('syncFailed'),
    });
    if (!result) return;
    // The count is reported from the SYNC, then the ledger is re-read — showing the
    // pre-sync numbers under a "refreshed" notice is the one outcome worth avoiding.
    const read = await run(() => adsApi.insights(), { success: t('synced', { count: result.synced }), failure: t('loadFailed') });
    if (read) setInsights(read);
  }, [run, t]);

  const totals = insights?.totals;
  const currency = insights?.rows[0]?.currency ?? 'USD';

  return (
    <>
      <div className={styles.driveConnect}>
        <button type="button" disabled={busy} onClick={() => void sync()}>
          {busy ? t('syncing') : t('syncNow')}
        </button>
      </div>

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}
      {notice && <p className={styles.driveNotice} role="status">{notice}</p>}

      {insights && (
        <>
          <p className={styles.driveEmpty}>{t('window', { since: insights.window.since, until: insights.window.until })}</p>
          <dl className={styles.socialStats}>
            <div><dt>{t('spend')}</dt><dd>{formatMoney(totals?.spendCents ?? 0, currency, locale)}</dd></div>
            <div><dt>{t('impressions')}</dt><dd>{fmt.number(totals?.impressions ?? 0)}</dd></div>
            <div><dt>{t('clicks')}</dt><dd>{fmt.number(totals?.clicks ?? 0)}</dd></div>
            <div><dt>{t('conversions')}</dt><dd>{fmt.number(totals?.conversions ?? 0)}</dd></div>
            {/* A null rate means the denominator was zero — shown as an em dash rather
                than 0, because "no clicks yet" and "free per click" are different. */}
            <div><dt>{t('costPerClick')}</dt><dd>{formatMoney(totals?.costPerClickCents, currency, locale)}</dd></div>
            <div><dt>{t('costPerConversion')}</dt><dd>{formatMoney(totals?.costPerConversionCents, currency, locale)}</dd></div>
          </dl>

          <div className={styles.driveList} role="list">
            {insights.rows.length === 0 && <p className={styles.driveEmpty}>{t('noInsights')}</p>}
            {insights.rows.slice(0, VISIBLE_ROWS).map((row) => (
              <div key={`${row.campaignId}:${row.date}`} className={styles.socialAccountRow} role="listitem">
                <span className={styles.driveRowMain}>
                  <span aria-hidden>{NETWORK_GLYPHS[row.platform]}</span>
                  <span className={styles.driveRowName}>{row.campaignName}</span>
                  <small>{t('insightRow', {
                    date: row.date,
                    spend: formatMoney(row.spendCents, row.currency, locale),
                    clicks: fmt.number(row.clicks),
                    conversions: fmt.number(row.conversions),
                  })}</small>
                </span>
              </div>
            ))}
            {insights.rows.length > VISIBLE_ROWS && (
              <p className={styles.driveEmpty}>{t('rowsTruncated', {
                shown: VISIBLE_ROWS, total: insights.rows.length,
              })}</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
