import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { mailboxApi, type MailboxConnection, type MailboxProviderInfo } from '@/lib/mailboxApi';

export function MailboxIntegrations({ search = '', viewMode = 'card' }: { search?: string; viewMode?: 'card' | 'table' }) {
  const t = useTranslations('inboxApp');
  const [providers, setProviders] = useState<MailboxProviderInfo[]>([]);
  const [connections, setConnections] = useState<MailboxConnection[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => mailboxApi.providers().then((result) => {
    setProviders(result.providers); setConnections(result.connections);
  }).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);

  const visible = providers.filter((provider) => !search.trim()
    || `${provider.label} ${provider.name} email mailbox`.toLowerCase().includes(search.trim().toLowerCase()));
  if (!visible.length) return null;

  return <div style={{ marginBottom: 24 }}>
    <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>{t('mailboxes')}</div>
    <div style={viewMode === 'card' ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 } : { display: 'grid', gap: 8 }}>
      {visible.map((provider) => {
        const accounts = connections.filter((connection) => connection.provider === provider.name);
        return <article key={provider.name} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--bg-base)', display: 'flex', flexDirection: viewMode === 'table' ? 'row' : 'column', gap: 10, justifyContent: 'space-between' }}>
          <div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{provider.label}</strong><span style={{ color: accounts.length ? 'var(--success)' : 'var(--text-muted)', fontSize: 'var(--font-size-eyebrow)' }}>{accounts.length ? `● ${t('connected')}` : `○ ${t('notConnected')}`}</span></div><p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', margin: '8px 0 0' }}>{accounts.length ? accounts.map((item) => item.accountEmail).join(', ') : t('mailboxIntegrationHelp')}</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy || !provider.configured} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '7px 11px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer' }} onClick={async () => {
              setBusy(true);
              try { const { authUrl } = await mailboxApi.connect(provider.name, '/settings/integrations'); window.location.href = authUrl; }
              finally { setBusy(false); }
            }}>{accounts.length ? t('connectAnother') : t('connect')}</button>
            {accounts.length > 0 && <Link href="/inbox" style={{ border: '1px solid var(--coral-bright)', borderRadius: 'var(--radius-md)', padding: '7px 11px', color: 'var(--coral-bright)', textDecoration: 'none', fontWeight: 650 }}>{t('openInbox')}</Link>}
          </div>
        </article>;
      })}
    </div>
  </div>;
}
