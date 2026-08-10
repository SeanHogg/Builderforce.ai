'use client';

import { useTranslations } from 'next-intl';
import { adminApi, type AdminCreationSession } from '@/lib/adminApi';
import {
  AdminError,
  AdminLoading,
  AdminPanelHeader,
  fmtDateTime,
  fmtNum,
  useAdminData,
} from '@/components/admin/adminShared';

function inviteState(invite: AdminCreationSession['invitations'][number]): 'revoked' | 'accepted' | 'expired' | 'pending' {
  if (invite.revokedAt) return 'revoked';
  if (invite.acceptedAt) return 'accepted';
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'pending';
}

export default function CreationSessionsPanel() {
  const t = useTranslations('admin.creationSessions');
  const { data, loading, error, reload } = useAdminData<AdminCreationSession[]>(() => adminApi.creationSessions());
  const sessions = data ?? [];

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        count={t('count', { count: fmtNum(sessions.length) })}
        onRefresh={reload}
      />
      <AdminError message={error} />
      <p className="text-muted" style={{ margin: '0 0 16px' }}>
        {t('consentNotice')}
      </p>
      {sessions.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('session')}</th>
                <th>{t('workspace')}</th>
                <th>{t('canvas')}</th>
                <th>{t('invitations')}</th>
                <th>{t('lastActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{session.title}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{session.creatorEmail ?? t('noCreator')} · {session.status}</div>
                    <div className="text-muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{session.id}</div>
                  </td>
                  <td>
                    <div>{session.tenantName}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{t('tenant', { id: session.tenantId })}</div>
                  </td>
                  <td>
                    <div>{t('objectsMembers', { objects: fmtNum(session.objectCount), members: fmtNum(session.memberCount) })}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{t('revision', { revision: fmtNum(session.revision) })}</div>
                  </td>
                  <td>
                    {session.invitations.length === 0 ? <span className="text-muted">—</span> : session.invitations.map((invite) => (
                      <div key={invite.id} style={{ marginBottom: 6 }}>
                        <a href={`mailto:${encodeURIComponent(invite.email)}`}>{invite.email}</a>
                        <span className="text-muted" style={{ fontSize: 12 }}> · {invite.role} · {t(inviteState(invite))}</span>
                      </div>
                    ))}
                  </td>
                  <td className="text-muted">
                    {fmtDateTime(session.lastActivityAt)}
                    <div style={{ fontSize: 12 }}>{t('created', { date: fmtDateTime(session.createdAt) })}</div>
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
