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
import { usePanelTask } from '@/hooks/usePanelTask';
export function MailboxesSection() {
  const t = useTranslations('growth');
  const confirm = useConfirm();
  const searchParams = useSearchParams();

  const [mailboxes, setMailboxes] = useState<MailboxConnection[]>([]);
  const [providers, setProviders] = useState<MailboxProviderInfo[]>([]);
  const task = usePanelTask();
  const { run: taskRun, fail: taskFail } = task;

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
    // The grant already completed on the provider's side; report that finished action
    // through the same notice slot a local action uses.
    if (outcome === 'connected') void taskRun(() => Promise.resolve(), { success: t('mailboxes.connected') });
    else taskFail(t(`mailboxes.error.${outcome === 'declined' ? 'declined' : 'failed'}`));
  }, [searchParams, t, taskRun, taskFail]);

  // The reload is part of the action, so the notice lands only once the list shows it.
  const run = useCallback((op: () => Promise<unknown>, success: string) => taskRun(async () => {
    await op();
    await reload();
  }, { success, failure: t('genericError') }), [taskRun, reload, t]);

  const connectMailbox = useCallback(async (provider: MailboxProviderInfo['name']) => {
    // A full-page navigation, not a fetch: the provider's consent screen
    // cannot be framed or XHR'd.
    const started = await taskRun(() => mailboxApi.connect(provider, '/growth'), { failure: t('genericError') });
    if (started) window.location.href = started.authUrl;
  }, [taskRun, t]);

  return (
    <section>
      {task.notice && <p role="status" style={{ ...muted, color: 'var(--success-text)' }}>{task.notice}</p>}
      {task.error && <p role="alert" style={{ ...muted, color: 'var(--danger-text)' }}>{task.error}</p>}
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
                    disabled={task.busy || mailbox.status !== 'connected'}
                    onChange={(e) => run(
                      () => mailboxApi.setSending(mailbox.id, e.target.checked),
                      t('mailboxes.sendingUpdated'),
                    )}
                  />
                  {t('mailboxes.allowSending')}
                </label>
                <button type="button" style={button} disabled={task.busy}
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
            disabled={task.busy || !provider.configured}
            title={provider.configured ? undefined : t('mailboxes.notConfigured')}
            onClick={() => connectMailbox(provider.name)}>
            {t('mailboxes.connect', { provider: provider.label })}
          </button>
        ))}
      </Row>
    </section>
  );
}
