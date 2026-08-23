'use client';

/**
 * THE AD SETS UNDER ONE CAMPAIGN — the level where an audience is named.
 *
 * A campaign says what is being bought and how much may be spent. It does not say WHO
 * the money is spent on: that is this level, and until now it existed as a service, a
 * table and an HTTP route with no surface above it. `CanvasAdsPanel` could create a
 * campaign and then only ever steer the one default ad set `adsService` composes so a
 * campaign on Reddit or X can deliver at all.
 *
 * Mounted from a campaign row and given nothing but the connection and the campaign, it
 * answers the rest itself — which is what makes it droppable into a second surface (a
 * campaign detail page, an agent's review card) with no edits.
 *
 * On networks that declare `requiresAdSet`, the set beneath a campaign is not optional
 * decoration: a campaign with nothing under it is a funded object that can never spend
 * and never reports a number. So an empty list here says so rather than looking tidy.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { adSetsApi, type AdSet } from '@/lib/adSetsApi';
import type { AdObjective } from '@/lib/adsApi';
import { usePanelTask } from '@/hooks/usePanelTask';
import { AdSetCreateForm } from './AdSetCreateForm';
import { AdSetRow } from './AdSetRow';
import { useAdAccount } from './useAdAccounts';

export interface AdSetTierProps {
  connectionId: string;
  /** The network's own id for the campaign whose sets these are. */
  campaignExternalId: string;
  /** What the campaign buys, when this vocabulary has a name for it. Null means the
   *  create form asks — see `AdSetCreateForm`. */
  campaignObjective: AdObjective | null;
}

export function AdSetTier({ connectionId, campaignExternalId, campaignObjective }: AdSetTierProps) {
  const t = useTranslations('canvas.ads.adSets');
  const account = useAdAccount(connectionId);
  const { error, run } = usePanelTask();
  const [adSets, setAdSets] = useState<AdSet[] | null>(null);

  const load = useCallback(async () => {
    const read = await run(
      () => adSetsApi.adSets({ connectionId, campaignId: campaignExternalId }),
      { failure: t('loadFailed') },
    );
    if (read) setAdSets(read.adSets);
  }, [campaignExternalId, connectionId, run, t]);

  useEffect(() => {
    void load();
    // Keyed on the campaign, not on `load`: this read goes to the NETWORK, and a
    // dependency that changes identity per render would fan out one call per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, campaignExternalId]);

  return (
    <div className={styles.adTier}>
      <p className={styles.adTierHeading}>{t('heading')}</p>

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}

      <div className={styles.driveList} role="list">
        {adSets === null && <p className={styles.driveEmpty}>{t('loading')}</p>}
        {adSets?.length === 0 && (
          <p className={styles.driveEmpty}>
            {account?.requiresAdSet ? t('noneRequired', { network: account.networkLabel }) : t('none')}
          </p>
        )}
        {adSets?.map((adSet) => (
          <AdSetRow
            key={adSet.externalId}
            connectionId={connectionId}
            adSet={adSet}
            onChanged={load}
          />
        ))}
      </div>

      <AdSetCreateForm
        connectionId={connectionId}
        campaignExternalId={campaignExternalId}
        campaignObjective={campaignObjective}
        onCreated={load}
      />
    </div>
  );
}
