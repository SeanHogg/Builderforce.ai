'use client';

/**
 * THE ADS INSIDE ONE AD SET — the creative a person actually sees.
 *
 * The bottom of the three levels, and the one where attribution is decided. The
 * destination URL is UTM-tagged SERVER-SIDE, from the campaign's own stored tag, before
 * any network adapter sees it — so what this component shows after a create is the REAL
 * destination, not what was typed into the box. That is why `utmCampaign` is echoed
 * rather than assumed: a person can read the tag their clicks will carry now, instead of
 * discovering it a month later as a gap in a report.
 *
 * Self-contained. It is given a connection and an ad set id and answers every other
 * question itself — including whether this network can author copy at all, which it
 * reads from the account rather than being told. Pinterest and X can only promote
 * something that already exists, so on those the form asks for a creative reference and
 * does not offer a headline the adapter would have to invent a place for.
 *
 * ── WHY EDITING AN AD IS ONLY A RENAME ──────────────────────────────────────
 * On every one of these networks a live ad's copy and destination are immutable: a
 * changed creative is re-reviewed, which makes it a new ad rather than an edit. Offering
 * an "edit copy" box that silently did nothing would be worse than not offering one.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { adSetsApi, type AdCreative } from '@/lib/adSetsApi';
import { usePanelTask } from '@/hooks/usePanelTask';
import { useAdAccount } from '@/lib/ads/useAdAccounts';

export interface AdTierProps {
  /** The ad account's connector connection — the handle every call takes. */
  connectionId: string;
  /** The network's own id for the ad set these ads belong to. */
  adSetExternalId: string;
}

interface Draft {
  name: string;
  headline: string;
  body: string;
  callToAction: string;
  destinationUrl: string;
  creativeRef: string;
}

const EMPTY_DRAFT: Draft = {
  name: '', headline: '', body: '', callToAction: '', destinationUrl: '', creativeRef: '',
};

export function AdTier({ connectionId, adSetExternalId }: AdTierProps) {
  const t = useTranslations('canvas.ads.adTier');
  const account = useAdAccount(connectionId);
  const { busy, error, notice, run, clear } = usePanelTask();

  const [creatives, setCreatives] = useState<AdCreative[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [launchNow, setLaunchNow] = useState(false);
  /** The tag the last created ad's clicks will carry. Shown because it is the only
   *  moment attribution is visible before it starts mattering. */
  const [taggedAs, setTaggedAs] = useState<string | null>(null);

  const load = useCallback(async () => {
    const read = await run(
      () => adSetsApi.ads({ connectionId, adSetId: adSetExternalId }),
      { failure: t('loadFailed') },
    );
    if (read) setCreatives(read.ads);
  }, [adSetExternalId, connectionId, run, t]);

  useEffect(() => {
    void load();
    // Re-reads when the ad set changes. Not cached: this is the read performed
    // immediately after a write, and a held value would show the state before it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, adSetExternalId]);

  const submit = useCallback(async () => {
    const created = await run(
      () => adSetsApi.createAd({
        connectionId,
        adSetId: adSetExternalId,
        name: draft.name.trim(),
        ...(draft.headline.trim() ? { headline: draft.headline.trim() } : {}),
        ...(draft.body.trim() ? { body: draft.body.trim() } : {}),
        ...(draft.callToAction.trim() ? { callToAction: draft.callToAction.trim() } : {}),
        ...(draft.destinationUrl.trim() ? { destinationUrl: draft.destinationUrl.trim() } : {}),
        ...(draft.creativeRef.trim() ? { creativeRef: draft.creativeRef.trim() } : {}),
        ...(launchNow ? { launch: true } : {}),
      }),
      {
        success: launchNow ? t('launched', { name: draft.name.trim() }) : t('drafted', { name: draft.name.trim() }),
        failure: t('createFailed'),
      },
    );
    if (!created) return;
    setTaggedAs(created.utmCampaign);
    setDraft(EMPTY_DRAFT);
    setLaunchNow(false);
    setComposing(false);
    await load();
  }, [adSetExternalId, connectionId, draft, launchNow, load, run, t]);

  const setStatus = useCallback(async (ad: AdCreative, status: 'active' | 'paused') => {
    const done = await run(
      () => adSetsApi.updateAd(ad.externalId, { connectionId, status }),
      {
        success: status === 'paused' ? t('paused', { name: ad.name }) : t('resumed', { name: ad.name }),
        failure: t('updateFailed'),
      },
    );
    if (done) await load();
  }, [connectionId, load, run, t]);

  const field = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  // Networks that can only promote EXISTING content take a reference to it instead of
  // copy. Asked from the account, not passed in — see the header.
  const promotesExisting = account?.requiresCreativeRef ?? false;

  return (
    <div className={styles.adTier}>
      <p className={styles.adTierHeading}>{t('heading')}</p>

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}
      {notice && <p className={styles.driveNotice} role="status">{notice}</p>}
      {taggedAs && <p className={styles.driveNotice} role="status">{t('taggedAs', { tag: taggedAs })}</p>}

      <div className={styles.driveList} role="list">
        {creatives === null && <p className={styles.driveEmpty}>{t('loading')}</p>}
        {creatives?.length === 0 && <p className={styles.driveEmpty}>{t('none')}</p>}
        {creatives?.map((ad) => (
          <div key={ad.externalId} className={styles.socialAccountRow} role="listitem">
            <span className={styles.driveRowMain}>
              <span className={styles.driveRowName}>{ad.name}</span>
              <small>{t(`status.${ad.status}`)}</small>
            </span>
            {ad.status === 'active'
              ? <button type="button" disabled={busy} onClick={() => void setStatus(ad, 'paused')}>{t('pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void setStatus(ad, 'active')}>{t('resume')}</button>}
          </div>
        ))}
      </div>

      {!composing && (
        <div className={styles.driveConnect}>
          <button type="button" disabled={busy} onClick={() => setComposing(true)}>{t('newAd')}</button>
        </div>
      )}

      {composing && (
        <form
          className={styles.socialForm}
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <label>
            <span>{t('name')}</span>
            <input value={draft.name} onChange={field('name')} required />
          </label>

          {promotesExisting ? (
            <label>
              <span>{t('creativeRef')}</span>
              <input value={draft.creativeRef} onChange={field('creativeRef')} required />
              <small>{t('creativeRefHelp', { network: account?.networkLabel ?? '' })}</small>
            </label>
          ) : (
            <>
              <label>
                <span>{t('headline')}</span>
                <input value={draft.headline} onChange={field('headline')} />
              </label>
              <label>
                <span>{t('body')}</span>
                <textarea value={draft.body} onChange={field('body')} />
              </label>
              <label>
                <span>{t('callToAction')}</span>
                <input value={draft.callToAction} onChange={field('callToAction')} />
              </label>
              <label>
                <span>{t('destinationUrl')}</span>
                <input type="url" inputMode="url" value={draft.destinationUrl} onChange={field('destinationUrl')} />
                {/* Stated up front rather than discovered afterwards: the URL that goes
                    live is not byte-for-byte the one typed here. */}
                <small>{t('destinationUrlHelp')}</small>
              </label>
            </>
          )}

          <label className={styles.socialInlineCheck}>
            <input type="checkbox" checked={launchNow} onChange={(event) => setLaunchNow(event.target.checked)} />
            <span>{t('launchNow')}</span>
          </label>
          {launchNow && <p className={styles.driveNotice} role="status">{t('launchWarning')}</p>}

          <div className={styles.socialFormActions}>
            <button type="submit" disabled={busy || !draft.name.trim()}>
              {busy ? t('working') : launchNow ? t('createAndLaunch') : t('createPaused')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setComposing(false); setDraft(EMPTY_DRAFT); setLaunchNow(false); clear(); }}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
