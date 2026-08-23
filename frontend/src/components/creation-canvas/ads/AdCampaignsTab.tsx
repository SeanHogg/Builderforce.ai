'use client';

/**
 * LAUNCH and steer a campaign — and, from each campaign, reach the two levels beneath it.
 *
 * ── WHY LAUNCHING IS TWO DELIBERATE ACTS ────────────────────────────────────
 * Creating a campaign never starts it. The form's default is PAUSED and starting to
 * spend is a separate, explicitly-labelled button, because the failure this prevents is
 * not a typo — it is a person filling in a form to think out loud and discovering a week
 * later that it had been buying impressions the whole time.
 *
 * ── WHY THE AD SETS HANG OFF THE ROW ────────────────────────────────────────
 * A campaign says what is bought and how much may be spent; the ad set says WHO it is
 * spent on. Those are one decision made twice, so the second lives inside the first
 * rather than in a fourth tab a person has to re-find the campaign in. Closed by default
 * and fetched only when opened: reading ad sets is a live call per campaign, and a list
 * that fanned out on mount would cost one upstream round trip per row.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import {
  adsApi, formatMoney,
  type AdCampaign, type AdObjective,
} from '@/lib/adsApi';
import { NETWORK_GLYPHS } from '@/lib/networkGlyph';
import { usePanelTask } from '@/hooks/usePanelTask';
import { AdSetTier } from './AdSetTier';
import { useAdAccounts } from './useAdAccounts';

export function AdCampaignsTab() {
  const t = useTranslations('canvas.ads');
  const locale = useLocale();
  const { ready } = useAdAccounts();
  const { busy, error, notice, run, fail } = usePanelTask();

  const [campaigns, setCampaigns] = useState<AdCampaign[] | null>(null);
  const [campaignErrors, setCampaignErrors] = useState<Array<{ connectionId: string; message: string }>>([]);
  /** Which campaign's ad sets are open. One at a time — the panel is 300px wide, and
   *  two expanded trees in it is a scroll position nobody can hold in their head. */
  const [expanded, setExpanded] = useState<string | null>(null);

  const [targetId, setTargetId] = useState('');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<AdObjective | ''>('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [launchNow, setLaunchNow] = useState(false);

  /** The objectives the SELECTED network can serve. Offering one it will refuse turns a
   *  clear "LinkedIn cannot do that" into a failed launch. */
  const objectives = ready.find((account) => account.id === targetId)?.objectives ?? [];

  useEffect(() => {
    // Keeps the picked objective inside what the picked ACCOUNT can buy — changing the
    // target network must not leave an objective it will reject sitting in the form.
    if (objectives.length > 0 && !objectives.includes(objective as AdObjective)) {
      setObjective(objectives[0] ?? '');
    }
  }, [objective, objectives]);

  const load = useCallback(async () => {
    const read = await run(() => adsApi.campaigns(), { failure: t('loadFailed') });
    if (!read) return;
    setCampaigns(read.campaigns);
    setCampaignErrors(read.errors.map((entry) => ({ connectionId: entry.connectionId, message: entry.message })));
  }, [run, t]);

  useEffect(() => {
    if (campaigns === null && ready.length > 0) void load();
    // Driven by the tab being open rather than eagerly on mount: this is a fan-out
    // across every connected network.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, ready.length]);

  const submitLaunch = useCallback(async () => {
    const budget = Number(dailyBudget);
    if (!objective) return;
    if (!Number.isFinite(budget) || budget <= 0) { fail(t('budgetRequired')); return; }
    const created = await run(
      () => adsApi.createCampaign({
        name: name.trim(),
        objective,
        connectionId: targetId,
        dailyBudget: budget,
        ...(launchNow ? { launch: true } : {}),
      }),
      {
        success: launchNow
          ? t('campaignLaunched', { name: name.trim() })
          : t('campaignDrafted', { name: name.trim() }),
        failure: t('launchFailed'),
      },
    );
    if (!created) return;
    setName('');
    setDailyBudget('');
    setLaunchNow(false);
    await load();
  }, [dailyBudget, fail, launchNow, load, name, objective, run, t, targetId]);

  /** Pause and resume are the same call with a different status — and pausing is the one
   *  a person reaches for when the spend is wrong, so it stays one click. */
  const setStatus = useCallback(async (campaign: AdCampaign, status: 'active' | 'paused') => {
    const done = await run(
      () => adsApi.updateCampaign(campaign.externalId, { connectionId: campaign.connectionId, status }),
      {
        success: status === 'paused'
          ? t('campaignPaused', { name: campaign.name })
          : t('campaignResumed', { name: campaign.name }),
        failure: t('updateFailed'),
      },
    );
    if (done) await load();
  }, [load, run, t]);

  return (
    <>
      {ready.length === 0 && <p className={styles.driveEmpty}>{t('connectFirst')}</p>}

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}
      {notice && <p className={styles.driveNotice} role="status">{notice}</p>}
      {campaignErrors.map((entry) => (
        <p key={entry.connectionId} className={styles.driveNotice} role="status">{entry.message}</p>
      ))}

      <div className={styles.driveList} role="list">
        {campaigns === null && ready.length > 0 && <p className={styles.driveEmpty}>{t('loading')}</p>}
        {campaigns?.length === 0 && <p className={styles.driveEmpty}>{t('noCampaigns')}</p>}
        {campaigns?.map((campaign) => {
          const key = `${campaign.connectionId}:${campaign.externalId}`;
          const open = expanded === key;
          return (
            <div key={key} role="listitem">
              <div className={styles.socialAccountRow}>
                <button
                  type="button"
                  className={styles.driveRowMain}
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : key)}
                >
                  <span aria-hidden>{NETWORK_GLYPHS[campaign.network]}</span>
                  <span className={styles.driveRowName}>{campaign.name}</span>
                  <small>{t('campaignMeta', {
                    status: t(`status.${campaign.status}`),
                    budget: formatMoney(campaign.dailyBudgetCents ?? campaign.totalBudgetCents, campaign.currency, locale),
                  })}</small>
                </button>
                {campaign.status === 'active'
                  ? <button type="button" disabled={busy} onClick={() => void setStatus(campaign, 'paused')}>{t('pause')}</button>
                  : <button type="button" disabled={busy} onClick={() => void setStatus(campaign, 'active')}>{t('resume')}</button>}
              </div>
              {open && (
                <AdSetTier
                  connectionId={campaign.connectionId}
                  campaignExternalId={campaign.externalId}
                  campaignObjective={campaign.objective}
                />
              )}
            </div>
          );
        })}
      </div>

      {ready.length > 0 && (
        <form
          className={styles.socialForm}
          onSubmit={(event) => { event.preventDefault(); void submitLaunch(); }}
        >
          <label>
            <span>{t('targetAccount')}</span>
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)} required>
              <option value="">{t('choosePlaceholder')}</option>
              {ready.map((account) => (
                <option key={account.id} value={account.id}>
                  {`${account.networkLabel} · ${account.name}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('campaignName')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>{t('objectiveLabel')}</span>
            <select
              value={objective}
              onChange={(event) => setObjective(event.target.value as AdObjective)}
              disabled={objectives.length === 0}
              required
            >
              <option value="">{t('choosePlaceholder')}</option>
              {objectives.map((option) => (
                <option key={option} value={option}>{t(`objective.${option}`)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('dailyBudget')}</span>
            <input
              type="number" min="1" step="0.01" inputMode="decimal"
              value={dailyBudget}
              onChange={(event) => setDailyBudget(event.target.value)}
              required
            />
          </label>
          <label className={styles.socialInlineCheck}>
            <input type="checkbox" checked={launchNow} onChange={(event) => setLaunchNow(event.target.checked)} />
            <span>{t('launchNow')}</span>
          </label>
          {/* Spending is never a surprise: the label states which of the two acts the
              button performs, and the warning only appears when it will spend. */}
          {launchNow && <p className={styles.driveNotice} role="status">{t('launchWarning')}</p>}
          <div className={styles.socialFormActions}>
            <button type="submit" disabled={busy || !targetId || !objective}>
              {busy ? t('working') : launchNow ? t('createAndLaunch') : t('createPaused')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
