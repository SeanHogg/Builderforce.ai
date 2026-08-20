/**
 * The workspace's PAID media, managed on the canvas.
 *
 * Three jobs, in the order a CMO actually does them: CONNECT the ad accounts, LAUNCH
 * or steer a campaign, and MEASURE what it cost and returned.
 *
 * Connecting reuses the CONNECTOR platform rather than introducing a second one — an
 * ad account IS a connector connection, so this form is the built-in manifest's own
 * auth fields rendered inline (`connectorsApi.get` → `authFieldsFor`). That is why a
 * network's "Customer ID" or "Advertiser ID" box appears here without this component
 * knowing anything about Google or TikTok, and why a ninth network needs no change
 * to this file. It is the same argument, and the same code path, as
 * {@link ./CanvasSocialPanel}.
 *
 * ── WHY LAUNCHING IS TWO DELIBERATE ACTS ─────────────────────────────────────
 * Creating a campaign never starts it. The form's default is PAUSED and starting to
 * spend is a separate, explicitly-labelled button, because the failure this prevents
 * is not a typo — it is a person filling in a form to think out loud and discovering
 * a week later that it had been buying impressions the whole time.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import styles from './CreationCanvas.module.css';
import {
  AD_OBJECTIVES,
  adsApi,
  formatMoney,
  type AdAccount,
  type AdCampaign,
  type AdInsightsRead,
  type AdNetwork,
  type AdNetworkOption,
  type AdObjective,
} from '@/lib/adsApi';
import { authFieldsFor, connectorsApi, type ConnectorAuthField } from '@/lib/connectorsApi';
import { useFormat } from "@/i18n/useFormat";

/** One glyph per network. Brand marks, so they stay literal — and the record is
 *  exhaustive by TYPE, so a ninth network fails to compile here rather than rendering
 *  a blank square beside an account nobody can identify. */
const NETWORK_GLYPH: Readonly<Record<AdNetwork, string>> = {
  google: 'G', meta: '◈', linkedin: 'in', tiktok: '◐',
  x: '✕', reddit: '◕', pinterest: 'P', snapchat: '◔',
};

type Mode = 'accounts' | 'campaigns' | 'insights';

export interface CanvasAdsPanelProps {
  onClose: () => void;
}

export function CanvasAdsPanel({ onClose }: CanvasAdsPanelProps) {
  const fmt = useFormat();
  const t = useTranslations('canvas.ads');
  const locale = useLocale();

  const [mode, setMode] = useState<Mode>('accounts');
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [networks, setNetworks] = useState<AdNetworkOption[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [campaignErrors, setCampaignErrors] = useState<Array<{ connectionId: string; message: string }>>([]);
  const [insights, setInsights] = useState<AdInsightsRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Connect form — the manifest's own fields, fetched when a network is picked.
  const [connecting, setConnecting] = useState<AdNetworkOption | null>(null);
  const [connectionName, setConnectionName] = useState('');
  const [authFields, setAuthFields] = useState<ConnectorAuthField[]>([]);
  const [authValues, setAuthValues] = useState<Record<string, string>>({});

  // Launch form.
  const [targetId, setTargetId] = useState('');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<AdObjective>('traffic');
  const [dailyBudget, setDailyBudget] = useState('');
  const [launchNow, setLaunchNow] = useState(false);

  const refreshAccounts = useCallback(async () => {
    const [accountRead, networkRead] = await Promise.all([adsApi.accounts(), adsApi.networks()]);
    setAccounts(accountRead.accounts);
    setNetworks(networkRead.networks);
    return accountRead.accounts;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await refreshAccounts();
        if (live && loaded.some((account) => account.ready)) setMode('campaigns');
      } catch (failure) {
        if (live) setError(failure instanceof Error ? failure.message : t('loadFailed'));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [refreshAccounts, t]);

  const ready = useMemo(() => accounts.filter((account) => account.ready), [accounts]);

  /** The objectives the SELECTED network can serve. Offering one it will refuse turns
   *  a clear "LinkedIn cannot do that" into a failed launch. */
  const objectives = useMemo(() => {
    const target = ready.find((account) => account.id === targetId);
    return target ? target.objectives : AD_OBJECTIVES;
  }, [ready, targetId]);

  useEffect(() => {
    if (objectives.length > 0 && !objectives.includes(objective)) setObjective(objectives[0]!);
  }, [objective, objectives]);

  const loadCampaigns = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const read = await adsApi.campaigns();
      setCampaigns(read.campaigns);
      setCampaignErrors(read.errors.map((entry) => ({ connectionId: entry.connectionId, message: entry.message })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const loadInsights = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setInsights(await adsApi.insights());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    if (mode === 'campaigns' && campaigns.length === 0 && ready.length > 0) void loadCampaigns();
    if (mode === 'insights' && insights === null) void loadInsights();
    // Loading is intentionally driven by the tab the person opened, not eagerly on
    // mount: each of these is an upstream fan-out across every connected network.
  }, [campaigns.length, insights, loadCampaigns, loadInsights, mode, ready.length]);

  const beginConnect = useCallback(async (option: AdNetworkOption) => {
    setBusy(true);
    setError(null);
    try {
      const detail = await connectorsApi.get(option.connectorKey);
      setAuthFields(authFieldsFor(detail.manifest));
      setAuthValues({});
      setConnectionName(option.label);
      setConnecting(option);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const submitConnect = useCallback(async () => {
    if (!connecting) return;
    setBusy(true);
    setError(null);
    try {
      await connectorsApi.createConnection({
        connectorKey: connecting.connectorKey,
        name: connectionName.trim() || connecting.label,
        credentials: authValues,
      });
      await refreshAccounts();
      setConnecting(null);
      setNotice(t('connected', { network: connecting.label }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('connectFailed'));
    } finally {
      setBusy(false);
    }
  }, [authValues, connecting, connectionName, refreshAccounts, t]);

  const disconnect = useCallback(async (account: AdAccount) => {
    setBusy(true);
    try {
      await connectorsApi.removeConnection(account.id);
      await refreshAccounts();
      setCampaigns([]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [refreshAccounts, t]);

  const submitLaunch = useCallback(async () => {
    const budget = Number(dailyBudget);
    if (!Number.isFinite(budget) || budget <= 0) { setError(t('budgetRequired')); return; }
    setBusy(true);
    setError(null);
    try {
      const created = await adsApi.createCampaign({
        name: name.trim(),
        objective,
        connectionId: targetId,
        dailyBudget: budget,
        ...(launchNow ? { launch: true } : {}),
      });
      setNotice(launchNow
        ? t('campaignLaunched', { name: created.campaign.name })
        : t('campaignDrafted', { name: created.campaign.name }));
      setName('');
      setDailyBudget('');
      setLaunchNow(false);
      await loadCampaigns();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('launchFailed'));
    } finally {
      setBusy(false);
    }
  }, [dailyBudget, launchNow, loadCampaigns, name, objective, t, targetId]);

  /** Pause and resume are the same call with a different status — and pausing is the
   *  one a person reaches for when the spend is wrong, so it stays one click. */
  const setStatus = useCallback(async (campaign: AdCampaign, status: 'active' | 'paused') => {
    setBusy(true);
    setError(null);
    try {
      await adsApi.updateCampaign(campaign.externalId, { connectionId: campaign.connectionId, status });
      setNotice(status === 'paused'
        ? t('campaignPaused', { name: campaign.name })
        : t('campaignResumed', { name: campaign.name }));
      await loadCampaigns();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('updateFailed'));
    } finally {
      setBusy(false);
    }
  }, [loadCampaigns, t]);

  const sync = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adsApi.sync();
      setNotice(t('synced', { count: result.synced }));
      setInsights(await adsApi.insights());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('syncFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const totals = insights?.totals;
  const currency = insights?.rows[0]?.currency ?? 'USD';

  return (
    <aside className={styles.drivePanel} aria-label={t('title')}>
      <header>
        <strong>{t('title')}</strong>
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>
      </header>

      <div className={styles.driveAccounts} role="tablist" aria-label={t('title')}>
        <button type="button" role="tab" aria-selected={mode === 'accounts'} onClick={() => setMode('accounts')}>{t('tabAccounts')}</button>
        <button type="button" role="tab" aria-selected={mode === 'campaigns'} onClick={() => setMode('campaigns')}>{t('tabCampaigns')}</button>
        <button type="button" role="tab" aria-selected={mode === 'insights'} onClick={() => setMode('insights')}>{t('tabInsights')}</button>
      </div>

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}
      {notice && <p className={styles.driveNotice} role="status">{notice}</p>}

      {mode === 'accounts' && <>
        <div className={styles.driveList} role="list">
          {loading && <p className={styles.driveEmpty}>{t('loading')}</p>}
          {!loading && accounts.length === 0 && <p className={styles.driveEmpty}>{t('noAccounts')}</p>}
          {accounts.map((account) => <div key={account.id} className={styles.socialAccountRow} role="listitem">
            <span className={styles.driveRowMain}>
              <span aria-hidden>{NETWORK_GLYPH[account.network]}</span>
              <span className={styles.driveRowName}>{`${account.networkLabel} · ${account.name}`}</span>
              <small>{account.ready
                ? t('ready')
                : t('missing', { fields: account.missingFields.map((field) => field.label).join(', ') })}</small>
            </span>
            <button type="button" disabled={busy} onClick={() => void disconnect(account)}>{t('disconnect')}</button>
          </div>)}
        </div>

        {!connecting && <div className={styles.driveConnect}>
          {networks.map((option) => <button key={option.network} type="button" disabled={busy} onClick={() => void beginConnect(option)}>
            {t('connect', { network: option.label })}
          </button>)}
        </div>}

        {connecting && <form
          className={styles.socialForm}
          onSubmit={(event) => { event.preventDefault(); void submitConnect(); }}
        >
          <label>
            <span>{t('connectionName')}</span>
            <input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} required />
          </label>
          {authFields.map((field) => <label key={field.key}>
            <span>{field.label}</span>
            <input
              type={field.secret ? 'password' : 'text'}
              value={authValues[field.key] ?? ''}
              placeholder={field.placeholder ?? ''}
              required={field.required}
              onChange={(event) => setAuthValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
            {field.help && <small>{field.help}</small>}
          </label>)}
          <div className={styles.socialFormActions}>
            <button type="submit" disabled={busy}>{busy ? t('connecting') : t('saveConnection')}</button>
            <button type="button" disabled={busy} onClick={() => setConnecting(null)}>{t('cancel')}</button>
          </div>
        </form>}
      </>}

      {mode === 'campaigns' && <>
        {ready.length === 0 && <p className={styles.driveEmpty}>{t('connectFirst')}</p>}

        {campaignErrors.map((entry) => <p key={entry.connectionId} className={styles.driveNotice} role="status">{entry.message}</p>)}

        <div className={styles.driveList} role="list">
          {busy && campaigns.length === 0 && <p className={styles.driveEmpty}>{t('loading')}</p>}
          {!busy && ready.length > 0 && campaigns.length === 0 && <p className={styles.driveEmpty}>{t('noCampaigns')}</p>}
          {campaigns.map((campaign) => <div key={`${campaign.connectionId}:${campaign.externalId}`} className={styles.socialAccountRow} role="listitem">
            <span className={styles.driveRowMain}>
              <span aria-hidden>{NETWORK_GLYPH[campaign.network]}</span>
              <span className={styles.driveRowName}>{campaign.name}</span>
              <small>{t('campaignMeta', {
                status: t(`status.${campaign.status}`),
                budget: formatMoney(campaign.dailyBudgetCents ?? campaign.totalBudgetCents, campaign.currency, locale),
              })}</small>
            </span>
            {campaign.status === 'active'
              ? <button type="button" disabled={busy} onClick={() => void setStatus(campaign, 'paused')}>{t('pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void setStatus(campaign, 'active')}>{t('resume')}</button>}
          </div>)}
        </div>

        {ready.length > 0 && <form
          className={styles.socialForm}
          onSubmit={(event) => { event.preventDefault(); void submitLaunch(); }}
        >
          <label>
            <span>{t('targetAccount')}</span>
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)} required>
              <option value="">{t('choosePlaceholder')}</option>
              {ready.map((account) => <option key={account.id} value={account.id}>
                {`${account.networkLabel} · ${account.name}`}
              </option>)}
            </select>
          </label>
          <label>
            <span>{t('campaignName')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>{t('objectiveLabel')}</span>
            <select value={objective} onChange={(event) => setObjective(event.target.value as AdObjective)}>
              {objectives.map((option) => <option key={option} value={option}>{t(`objective.${option}`)}</option>)}
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
            <button type="submit" disabled={busy || !targetId}>
              {busy ? t('working') : launchNow ? t('createAndLaunch') : t('createPaused')}
            </button>
          </div>
        </form>}
      </>}

      {mode === 'insights' && <>
        <div className={styles.driveConnect}>
          <button type="button" disabled={busy} onClick={() => void sync()}>{busy ? t('syncing') : t('syncNow')}</button>
        </div>

        {insights && <>
          <p className={styles.driveEmpty}>{t('window', { since: insights.window.since, until: insights.window.until })}</p>
          <dl className={styles.socialStats}>
            <div><dt>{t('spend')}</dt><dd>{formatMoney(totals?.spendCents ?? 0, currency, locale)}</dd></div>
            <div><dt>{t('impressions')}</dt><dd>{fmt.number((totals?.impressions ?? 0))}</dd></div>
            <div><dt>{t('clicks')}</dt><dd>{fmt.number((totals?.clicks ?? 0))}</dd></div>
            <div><dt>{t('conversions')}</dt><dd>{fmt.number((totals?.conversions ?? 0))}</dd></div>
            {/* A null rate means the denominator was zero — shown as an em dash rather
                than 0, because "no clicks yet" and "free per click" are different. */}
            <div><dt>{t('costPerClick')}</dt><dd>{formatMoney(totals?.costPerClickCents, currency, locale)}</dd></div>
            <div><dt>{t('costPerConversion')}</dt><dd>{formatMoney(totals?.costPerConversionCents, currency, locale)}</dd></div>
          </dl>

          <div className={styles.driveList} role="list">
            {insights.rows.length === 0 && <p className={styles.driveEmpty}>{t('noInsights')}</p>}
            {insights.rows.slice(0, 60).map((row) => <div key={`${row.campaignId}:${row.date}`} className={styles.socialAccountRow} role="listitem">
              <span className={styles.driveRowMain}>
                <span aria-hidden>{NETWORK_GLYPH[row.platform]}</span>
                <span className={styles.driveRowName}>{row.campaignName}</span>
                <small>{t('insightRow', {
                  date: row.date,
                  spend: formatMoney(row.spendCents, row.currency, locale),
                  clicks: fmt.number(row.clicks),
                  conversions: fmt.number(row.conversions),
                })}</small>
              </span>
            </div>)}
          </div>
        </>}
      </>}
    </aside>
  );
}
