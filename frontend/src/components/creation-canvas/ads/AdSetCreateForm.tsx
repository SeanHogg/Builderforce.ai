'use client';

/**
 * NAME AN AUDIENCE — create one ad set under a campaign.
 *
 * The act the canvas had no surface for. Everything above this level was reachable from
 * the panel and everything at it required a REST client, so "spend this budget on
 * under-25s in Germany" was a sentence a CMO could say and not do.
 *
 * Two rules it inherits rather than re-argues:
 *
 *   1. CREATING IS NEVER LAUNCHING. Default is paused and starting to spend is a
 *      separately-labelled act — the same rule campaigns follow, and it matters MORE
 *      here: on most networks the daily budget lives on the ad set, so this is the
 *      object that actually buys.
 *   2. THE OBJECTIVE IS CARRIED DOWN, not looked up. On X the line item IS where the
 *      objective lives and on TikTok the ad group's goal must agree with the campaign's,
 *      so it travels with the draft. When the parent campaign was built in the network's
 *      own console under an objective this vocabulary cannot name, the form ASKS rather
 *      than guessing — a guess here buys the wrong thing at full price.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { adSetsApi, type AdTargeting } from '@/lib/adSetsApi';
import { AD_OBJECTIVES, type AdObjective } from '@/lib/adsApi';
import { usePanelTask } from '@/hooks/usePanelTask';
import { AdTargetingFields } from './AdTargetingFields';
import { useAdAccount } from '@/lib/ads/useAdAccounts';

export interface AdSetCreateFormProps {
  connectionId: string;
  /** The network's own id for the campaign this set will hang from. */
  campaignExternalId: string;
  /** What the parent campaign buys, when we have a name for it. Null means ask. */
  campaignObjective: AdObjective | null;
  /** Re-read the list. Called only after the network accepted the create. */
  onCreated: () => void | Promise<void>;
}

export function AdSetCreateForm({
  connectionId, campaignExternalId, campaignObjective, onCreated,
}: AdSetCreateFormProps) {
  const t = useTranslations('canvas.ads.adSets');
  const account = useAdAccount(connectionId);
  const { busy, error, run, clear } = usePanelTask();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<AdObjective | ''>(campaignObjective ?? '');
  const [dailyBudget, setDailyBudget] = useState('');
  const [bid, setBid] = useState('');
  const [targeting, setTargeting] = useState<AdTargeting>({});
  const [launchNow, setLaunchNow] = useState(false);

  /** Only the objectives this network can actually serve — offering one it will refuse
   *  turns a clear "LinkedIn cannot do that" into a failed create. */
  const objectives = account?.objectives ?? AD_OBJECTIVES;
  const chosen = campaignObjective ?? (objective || null);

  const reset = useCallback(() => {
    setName('');
    setDailyBudget('');
    setBid('');
    setTargeting({});
    setLaunchNow(false);
    setObjective(campaignObjective ?? '');
  }, [campaignObjective]);

  const submit = useCallback(async () => {
    if (!chosen) return;
    const daily = Number(dailyBudget);
    const cap = Number(bid);
    const created = await run(
      () => adSetsApi.createAdSet({
        connectionId,
        campaignId: campaignExternalId,
        name: name.trim(),
        objective: chosen,
        targeting,
        ...(dailyBudget.trim() && Number.isFinite(daily) ? { dailyBudget: daily } : {}),
        ...(bid.trim() && Number.isFinite(cap) ? { bid: cap } : {}),
        ...(launchNow ? { launch: true } : {}),
      }),
      { failure: t('createFailed') },
    );
    if (!created) return;
    reset();
    setOpen(false);
    await onCreated();
  }, [bid, campaignExternalId, chosen, connectionId, dailyBudget, launchNow, name, onCreated, reset, run, t, targeting]);

  if (!open) {
    return (
      <div className={styles.driveConnect}>
        <button type="button" onClick={() => setOpen(true)}>{t('newAdSet')}</button>
      </div>
    );
  }

  return (
    <form
      className={styles.socialForm}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      {error && <p className={styles.driveNotice} role="alert">{error}</p>}

      <label>
        <span>{t('name')}</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      {/* Only asked when the campaign cannot answer it — see rule 2 in the header. */}
      {campaignObjective === null && (
        <label>
          <span>{t('objectiveLabel')}</span>
          <select value={objective} onChange={(event) => setObjective(event.target.value as AdObjective)} required>
            <option value="">{t('choosePlaceholder')}</option>
            {objectives.map((option) => (
              <option key={option} value={option}>{t(`objective.${option}`)}</option>
            ))}
          </select>
          <small>{t('objectiveHelp')}</small>
        </label>
      )}

      <label>
        <span>{t('dailyBudget')}</span>
        <input
          type="number" min="0" step="0.01" inputMode="decimal"
          value={dailyBudget}
          onChange={(event) => setDailyBudget(event.target.value)}
        />
        <small>{t('dailyBudgetHelp')}</small>
      </label>

      <label>
        <span>{t('bid')}</span>
        <input
          type="number" min="0" step="0.01" inputMode="decimal"
          value={bid}
          onChange={(event) => setBid(event.target.value)}
        />
        <small>{t('bidHelp')}</small>
      </label>

      <AdTargetingFields
        value={targeting}
        onChange={setTargeting}
        dimensions={account?.targetingDimensions ?? []}
        disabled={busy}
      />

      <label className={styles.socialInlineCheck}>
        <input type="checkbox" checked={launchNow} onChange={(event) => setLaunchNow(event.target.checked)} />
        <span>{t('launchNow')}</span>
      </label>
      {launchNow && <p className={styles.driveNotice} role="status">{t('launchWarning')}</p>}

      <div className={styles.socialFormActions}>
        <button type="submit" disabled={busy || !name.trim() || !chosen}>
          {busy ? t('working') : launchNow ? t('createAndLaunch') : t('createPaused')}
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); reset(); clear(); }}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
