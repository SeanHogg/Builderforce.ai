'use client';

import { useTranslations } from 'next-intl';
import { adminApi, type AdminGuestSession } from '@/lib/adminApi';
import {
  AdminError,
  AdminLoading,
  AdminPanelHeader,
  fmtDateTime,
  fmtNum,
  useAdminData,
} from '@/components/admin/adminShared';

export default function GuestSessionsPanel() {
  const t = useTranslations('admin.sessions');
  const { data, loading, error, reload } = useAdminData<AdminGuestSession[]>(() => adminApi.guestSessions());
  const sessions = data ?? [];

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        count={t('count', { count: sessions.length })}
        onRefresh={reload}
      />
      <AdminError message={error} />
      {sessions.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('visitor')}</th>
                <th>{t('engagement')}</th>
                <th>{t('firstSeen')}</th>
                <th>{t('lastSeen')}</th>
                <th>{t('conversion')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{session.visitorId}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{session.landingPath ?? '—'}</div>
                  </td>
                  <td>
                    <div>{t('brainMessages', { count: session.guestChatCount })}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {t('tokensAndTools', { tokens: fmtNum(session.guestChatTokens), tools: fmtNum(session.toolRuns) })}
                    </div>
                  </td>
                  <td className="text-muted">{fmtDateTime(session.firstSeenAt)}</td>
                  <td className="text-muted">{fmtDateTime(session.lastSeenAt)}</td>
                  <td>
                    {session.isPaid ? (
                      <span className="badge badge-success">{t('paid')}</span>
                    ) : session.converted ? (
                      <span className="badge badge-neutral">{t('registered')}</span>
                    ) : (
                      <span className="badge badge-neutral">{t('guest')}</span>
                    )}
                    {session.convertedEmail && (
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{session.convertedEmail}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
