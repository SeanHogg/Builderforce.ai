'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { calendarApi, type CalendarConnectionInfo } from '@/lib/builderforceApi';

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft / Outlook',
};

/**
 * Connect / manage the current user's calendars (Google, Microsoft). Connecting
 * redirects to the provider's consent screen; on return, scheduled meetings are
 * pushed to the calendar and upcoming events are surfaced.
 */
export function CalendarConnectionsCard({ returnPath = '/meetings' }: { returnPath?: string } = {}) {
  const t = useTranslations('meetings');
  const [providers, setProviders] = useState<string[]>([]);
  const [connections, setConnections] = useState<CalendarConnectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await calendarApi.providers();
      setProviders(r.providers);
      setConnections(r.connections);
    } catch { /* leave empty */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const connect = useCallback(async (provider: string) => {
    setBusy(provider);
    try {
      const { authUrl } = await calendarApi.connectUrl(provider, returnPath);
      window.location.href = authUrl;
    } catch { setBusy(null); }
  }, [returnPath]);

  const disconnect = useCallback(async (id: string) => {
    await calendarApi.disconnect(id).catch(() => {});
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const connectedProviders = new Set(connections.map((c) => c.provider));

  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('calendarsTitle')}</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('calendarsSubtitle')}</p>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : providers.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noCalendarProviders')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {connections.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{PROVIDER_LABEL[c.provider] ?? c.provider}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.accountEmail || t('connected')}</div>
              </div>
              <button
                type="button"
                onClick={() => disconnect(c.id)}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--error-text)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {t('disconnect')}
              </button>
            </div>
          ))}
          {providers.filter((p) => !connectedProviders.has(p)).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => connect(p)}
              disabled={busy === p}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
                fontSize: 13, fontWeight: 600, opacity: busy === p ? 0.6 : 1,
              }}
            >
              <span aria-hidden style={{ fontSize: 15 }}>📅</span>
              {t('connectProvider', { provider: PROVIDER_LABEL[p] ?? p })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
