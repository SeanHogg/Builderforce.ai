'use client';

/**
 * CONNECT the ad accounts — the first of the three jobs the paid-media panel does.
 *
 * Reuses the CONNECTOR platform rather than introducing a second one: an ad account IS a
 * connector connection, so this form is the built-in manifest's own auth fields rendered
 * inline (`connectorsApi.get` → `authFieldsFor`). That is why a network's "Customer ID"
 * or "Advertiser ID" box appears here without this component knowing anything about
 * Google or TikTok, and why a tenth network needs no change to this file. Same argument,
 * same code path, as `CanvasSocialPanel`.
 *
 * Connecting and disconnecting both INVALIDATE the shared accounts read, so the launch
 * target picker in the campaigns tab cannot go on offering an account that was just
 * removed — the client half of the rule `adsService` keeps with `invalidateCached`.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { AdAccount, AdNetworkOption } from '@/lib/adsApi';
import { authFieldsFor, connectorsApi, type ConnectorAuthField } from '@/lib/connectorsApi';
import { NETWORK_GLYPHS } from '@/lib/networkGlyph';
import { usePanelTask } from '@/hooks/usePanelTask';
import { invalidateAdAccounts, useAdAccounts } from '@/lib/ads/useAdAccounts';

export function AdAccountsTab() {
  const t = useTranslations('canvas.ads');
  const { accounts, networks, loading, error: readError } = useAdAccounts();
  const { busy, error, notice, run } = usePanelTask();

  const [connecting, setConnecting] = useState<AdNetworkOption | null>(null);
  const [connectionName, setConnectionName] = useState('');
  const [authFields, setAuthFields] = useState<ConnectorAuthField[]>([]);
  const [authValues, setAuthValues] = useState<Record<string, string>>({});

  const beginConnect = useCallback(async (option: AdNetworkOption) => {
    const detail = await run(() => connectorsApi.get(option.connectorKey), { failure: t('loadFailed') });
    if (!detail) return;
    setAuthFields(authFieldsFor(detail.manifest));
    setAuthValues({});
    setConnectionName(option.label);
    setConnecting(option);
  }, [run, t]);

  const submitConnect = useCallback(async () => {
    if (!connecting) return;
    const done = await run(
      () => connectorsApi.createConnection({
        connectorKey: connecting.connectorKey,
        name: connectionName.trim() || connecting.label,
        credentials: authValues,
      }),
      { success: t('connected', { network: connecting.label }), failure: t('connectFailed') },
    );
    if (!done) return;
    await invalidateAdAccounts();
    setConnecting(null);
  }, [authValues, connecting, connectionName, run, t]);

  const disconnect = useCallback(async (account: AdAccount) => {
    const done = await run(
      () => connectorsApi.removeConnection(account.id),
      { failure: t('loadFailed') },
    );
    if (done) await invalidateAdAccounts();
  }, [run, t]);

  return (
    <>
      {(error ?? readError) && <p className={styles.driveNotice} role="alert">{error ?? readError}</p>}
      {notice && <p className={styles.driveNotice} role="status">{notice}</p>}

      <div className={styles.driveList} role="list">
        {loading && <p className={styles.driveEmpty}>{t('loading')}</p>}
        {!loading && accounts.length === 0 && <p className={styles.driveEmpty}>{t('noAccounts')}</p>}
        {accounts.map((account) => (
          <div key={account.id} className={styles.socialAccountRow} role="listitem">
            <span className={styles.driveRowMain}>
              <span aria-hidden>{NETWORK_GLYPHS[account.network]}</span>
              <span className={styles.driveRowName}>{`${account.networkLabel} · ${account.name}`}</span>
              <small>{account.ready
                ? t('ready')
                : t('missing', { fields: account.missingFields.map((field) => field.label).join(', ') })}</small>
            </span>
            <button type="button" disabled={busy} onClick={() => void disconnect(account)}>{t('disconnect')}</button>
          </div>
        ))}
      </div>

      {!connecting && (
        <div className={styles.driveConnect}>
          {networks.map((option) => (
            <button key={option.network} type="button" disabled={busy} onClick={() => void beginConnect(option)}>
              {t('connect', { network: option.label })}
            </button>
          ))}
        </div>
      )}

      {connecting && (
        <form
          className={styles.socialForm}
          onSubmit={(event) => { event.preventDefault(); void submitConnect(); }}
        >
          <label>
            <span>{t('connectionName')}</span>
            <input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} required />
          </label>
          {authFields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              <input
                type={field.secret ? 'password' : 'text'}
                value={authValues[field.key] ?? ''}
                placeholder={field.placeholder ?? ''}
                required={field.required}
                onChange={(event) => setAuthValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
              {field.help && <small>{field.help}</small>}
            </label>
          ))}
          <div className={styles.socialFormActions}>
            <button type="submit" disabled={busy}>{busy ? t('connecting') : t('saveConnection')}</button>
            <button type="button" disabled={busy} onClick={() => setConnecting(null)}>{t('cancel')}</button>
          </div>
        </form>
      )}
    </>
  );
}
