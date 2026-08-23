'use client';

/**
 * THE payout-destination surface — one component, three places.
 *
 * "Connect your bank account" is asked for in three different rooms: the
 * integrations gallery (where every other connection lives), the billing pages
 * (where money is managed) and the Sales Hub's payouts tab (where a commission
 * is waiting). Those are three doors into ONE thing, so they render this rather
 * than three arrangements of the same six buttons that drift the first time a
 * provider is added.
 *
 * It decides its own everything: which providers exist, which are connectable on
 * this deployment, whether a provider is a consent flow or a form, and what the
 * masked label says. A consumer passes only `returnTo` — where the OAuth round
 * trip should land the browser back — because that is the one fact the component
 * genuinely cannot know.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Button } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  payoutsApi,
  type PayoutAccount,
  type PayoutProviderDescriptor,
  type PayoutProviderName,
} from '@/lib/payoutsApi';

export interface PayoutConnectionsProps {
  /** Where the consent round trip returns to. */
  returnTo: string;
  /** Filters the provider list — the integrations gallery's search box. */
  search?: string;
  /** Told when the set of connected destinations changed, so a page showing a
   *  balance beside this can refresh it. */
  onChanged?: () => void;
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  background: 'var(--bg-base)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  justifyContent: 'space-between',
};

export function PayoutConnections({ returnTo, search = '', onChanged }: PayoutConnectionsProps) {
  const t = useTranslations('payouts');
  const confirm = useConfirm();
  const [providers, setProviders] = useState<PayoutProviderDescriptor[]>([]);
  const [accounts, setAccounts] = useState<PayoutAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formProvider, setFormProvider] = useState<PayoutProviderDescriptor | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const result = await payoutsApi.providers();
      setProviders(result.providers);
      setAccounts(result.connections);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return providers;
    return providers.filter((provider) => `${provider.label} ${provider.name} ${provider.blurb} payout bank`.toLowerCase().includes(needle));
  }, [providers, search]);

  const refresh = useCallback(async () => { await load(); onChanged?.(); }, [load, onChanged]);

  const connectOauth = async (provider: PayoutProviderDescriptor) => {
    setBusy(true); setError('');
    try {
      const { authUrl } = await payoutsApi.connectUrl(provider.name, returnTo);
      window.location.href = authUrl;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('connectFailed'));
      setBusy(false);
    }
  };

  const submitFields = async () => {
    if (!formProvider) return;
    setBusy(true); setError('');
    try {
      await payoutsApi.connectFields(formProvider.name, draft);
      setFormProvider(null); setDraft({});
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('connectFailed'));
    } finally {
      setBusy(false);
    }
  };

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await run(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('actionFailed')); }
    finally { setBusy(false); }
  };

  // Disconnecting is destructive and irreversible from the UI's point of view —
  // the one case the app's convention reserves a confirm dialog for.
  const disconnect = async (account: PayoutAccount) => {
    const ok = await confirm({
      title: t('disconnectTitle'),
      message: t('disconnectMessage', { label: account.label }),
      confirmLabel: t('disconnect'),
      destructive: true,
    });
    if (ok) await act(() => payoutsApi.disconnect(account.id));
  };

  const accountsFor = (name: PayoutProviderName) => accounts.filter((account) => account.provider === name);

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>;
  if (!visible.length) return null;

  return (
    <div>
      {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', margin: '0 0 10px' }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
        {visible.map((provider) => {
          const connected = accountsFor(provider.name);
          return (
            <article key={provider.name} style={cardStyle}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{provider.label}</strong>
                  <span style={{ color: connected.length ? 'var(--success)' : 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)', whiteSpace: 'nowrap' }}>
                    {connected.length ? `● ${t('connected')}` : `○ ${t('notConnected')}`}
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', margin: '8px 0 0', lineHeight: 1.5 }}>
                  {provider.blurb}
                </p>
                {connected.map((account) => (
                  <div key={account.id} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', fontWeight: 600 }}>{account.label}</span>
                    {account.isDefault && <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-on-accent)', background: 'var(--coral-bright)', borderRadius: 'var(--radius-full)', padding: '2px 8px' }}>{t('default')}</span>}
                    {account.status !== 'connected' && <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--coral-bright)' }}>{t('needsReconnect')}</span>}
                    {account.lastError && <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--coral-bright)', width: '100%' }}>{account.lastError}</span>}
                  </div>
                ))}
                {/* A provider whose OAuth client is not bound on this deployment
                    stays VISIBLE and disabled with the reason — hiding it turns
                    "the operator has not set this up" into "we cannot do this". */}
                {!provider.configured && (
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)', margin: '8px 0 0' }}>{t('notConfigured')}</p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant={connected.length ? 'ghost' : 'primary'}
                  disabled={busy || !provider.configured}
                  onClick={() => (provider.connect === 'oauth' ? void connectOauth(provider) : (setFormProvider(provider), setDraft({})))}
                >
                  {connected.length ? t('reconnect') : t('connect')}
                </Button>
                {connected.map((account) => (
                  <span key={account.id} style={{ display: 'inline-flex', gap: 8 }}>
                    {!account.isDefault && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => payoutsApi.setDefault(account.id))}>
                        {t('makeDefault')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect(account)}>
                      {t('disconnect')}
                    </Button>
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <SlideOutPanel
        open={formProvider != null}
        onClose={() => { setFormProvider(null); setDraft({}); }}
        title={formProvider ? t('connectTitle', { provider: formProvider.label }) : ''}
        crumb={t('crumb')}
        widthStorageKey="payout-connect"
      >
        <form
          onSubmit={(event) => { event.preventDefault(); void submitFields(); }}
          style={{ display: 'grid', gap: 14 }}
        >
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', margin: 0, lineHeight: 1.55 }}>
            {t('fieldsIntro')}
          </p>
          {(formProvider?.fields ?? []).map((field) => (
            <label key={field.key} style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 'var(--font-size-field-label)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {field.label}{field.required ? ' *' : ''}
              </span>
              <input
                // A secret is write-only end to end: it is never returned by the
                // API, so the field is never pre-filled and the browser is asked
                // not to remember it either.
                type={field.secret ? 'password' : 'text'}
                autoComplete={field.secret ? 'off' : 'on'}
                required={field.required}
                placeholder={field.placeholder ?? ''}
                value={draft[field.key] ?? ''}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                style={{
                  padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-body)', minHeight: 40,
                }}
              />
              {field.help && <small style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' }}>{field.help}</small>}
            </label>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button type="submit" variant="primary" loading={busy}>{t('saveDestination')}</Button>
          </div>
        </form>
      </SlideOutPanel>
    </div>
  );
}

export default PayoutConnections;
