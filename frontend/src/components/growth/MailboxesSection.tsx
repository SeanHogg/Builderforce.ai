'use client';

/**
 * The Microsoft 365 / Gmail account a campaign can send as. Fully self-contained
 * — the Growth tab bar swaps this in for `?tab=` (default), and it owns its own
 * data and connect/disconnect flow so it can be dropped anywhere unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { mailboxApi, type MailboxConnection, type MailboxProviderInfo } from '@/lib/mailboxApi';
import { button, listItem, listReset, muted, spread, Row } from './growthStyles';

export function MailboxesSection() {
  const t = useTranslations('growth');
  const confirm = useConfirm();
  const searchParams = useSearchParams();

  const [mailboxes, setMailboxes] = useState<MailboxConnection[]>([]);
  const [providers, setProviders] = useState<MailboxProviderInfo[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { providers: p, connections } = await mailboxApi.providers();
    setProviders(p);
    setMailboxes(connections);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /**
   * The connect flow leaves and re-enters the app on this exact tab (the
   * default), so without this the user lands back on a page that looks exactly
   * as they left it and has no way to tell a successful grant from a declined
   * one.
   */
  useEffect(() => {
    const outcome = searchParams.get('mailbox');
    if (!outcome) return;
    if (outcome === 'connected') setNotice(t('mailboxes.connected'));
    else setError(t(`mailboxes.error.${outcome === 'declined' ? 'declined' : 'failed'}`));
  }, [searchParams, t]);

  const run = useCallback(async (op: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await op();
      setNotice(successMessage);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }, [reload, t]);

  const connectMailbox = useCallback(async (provider: MailboxProviderInfo['name']) => {
    setError('');
    try {
      // A full-page navigation, not a fetch: the provider's consent screen
      // cannot be framed or XHR'd.
      const { authUrl } = await mailboxApi.connect(provider, '/growth');
      window.location.href = authUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    }
  }, [t]);

  return (
    <section>
      {notice && <p role="status" style={{ ...muted, color: 'var(--success-text)' }}>{notice}</p>}
      {error && <p role="alert" style={{ ...muted, color: 'var(--danger-text)' }}>{error}</p>}
      {mailboxes.length === 0 ? (
        <p style={{ ...muted, marginTop: 10 }}>{t('mailboxes.empty')}</p>
      ) : (
        <ul style={listReset}>
          {mailboxes.map((mailbox) => (
            <li key={mailbox.id} style={listItem}>
              <div style={spread}>
                <span style={{ overflowWrap: 'anywhere' }}>{mailbox.accountEmail}</span>
                <span style={{
                  ...muted,
                  color: mailbox.status === 'connected' ? 'var(--success-text)' : 'var(--danger-text)',
                }}>
                  {t(`mailboxes.status.${mailbox.status === 'connected' ? 'connected' : 'reconnect'}`)}
                </span>
              </div>
              <div style={{ ...muted, marginTop: 2 }}>{t(`mailboxes.provider.${mailbox.provider}`)}</div>
              <Row>
                <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={mailbox.allowSending}
                    disabled={busy || mailbox.status !== 'connected'}
                    onChange={(e) => run(
                      () => mailboxApi.setSending(mailbox.id, e.target.checked),
                      t('mailboxes.sendingUpdated'),
                    )}
                  />
                  {t('mailboxes.allowSending')}
                </label>
                <button type="button" style={button} disabled={busy}
                  onClick={async () => {
                    const ok = await confirm({
                      message: t('mailboxes.confirmDisconnect', { email: mailbox.accountEmail }),
                    });
                    if (!ok) return;
                    await run(() => mailboxApi.disconnect(mailbox.id), t('mailboxes.disconnected'));
                  }}>
                  {t('mailboxes.disconnect')}
                </button>
              </Row>
            </li>
          ))}
        </ul>
      )}
      <Row>
        {providers.map((provider) => (
          <button key={provider.name} type="button" style={button}
            disabled={busy || !provider.configured}
            title={provider.configured ? undefined : t('mailboxes.notConfigured')}
            onClick={() => connectMailbox(provider.name)}>
            {t('mailboxes.connect', { provider: provider.label })}
          </button>
        ))}
      </Row>
    </section>
  );
}
