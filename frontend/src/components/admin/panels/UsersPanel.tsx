'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminUser, type AdminTenant } from '@/lib/adminApi';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import UserDetailDrawer from '@/components/UserDetailDrawer';
import { useEmulationLauncher } from '@/components/admin/EmulationLauncher';
import { AdminError, AdminLoading, errText, fmtDate } from '@/components/admin/adminShared';

export default function UsersPanel() {
  const t = useTranslations('admin');
  const { startEmulation } = useEmulationLauncher();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [usersViewMode, setUsersViewMode] = useState<ViewMode>('table');
  const [drawerUser, setDrawerUser] = useState<AdminUser | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([adminApi.users(), adminApi.tenants()])
      .then(([u, t]) => {
        setUsers(u);
        setTenants(t);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && users.length === 0) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span className="text-muted" style={{ fontSize: 14 }}>{t('users.count', { count: users.length })}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ViewToggle value={usersViewMode} onChange={setUsersViewMode} />
          <button type="button" className="btn-ghost" onClick={reload}>
            ↻ {t('common.refresh')}
          </button>
        </div>
      </div>
      {users.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('users.empty')}</p>
      ) : usersViewMode === 'table' ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('users.colEmail')}</th>
                <th>{t('users.colUsername')}</th>
                <th>{t('users.colWorkspaces')}</th>
                <th>{t('users.colJoined')}</th>
                <th>{t('users.colRole')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td className="text-muted">{u.username ?? '—'}</td>
                  <td>{u.tenantCount}</td>
                  <td className="text-muted">{fmtDate(u.createdAt)}</td>
                  <td>
                    {u.isSuperadmin ? (
                      <span className="badge badge-danger">{t('users.roleSuperadmin')}</span>
                    ) : (
                      <span className="badge badge-neutral">{t('users.roleUser')}</span>
                    )}
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn-ghost" onClick={() => setDrawerUser(u)}>
                      {t('common.details')}
                    </button>
                    {!u.isSuperadmin && (
                      <button type="button" className="btn-ghost" onClick={() => startEmulation(u)}>
                        {t('users.emulate')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>{u.email}</span>
                {u.isSuperadmin ? (
                  <span className="badge badge-danger">{t('users.roleSuperadmin')}</span>
                ) : (
                  <span className="badge badge-neutral">{t('users.roleUser')}</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {u.username ?? '—'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)' }}>
                <span>{t('users.workspacesCount', { count: u.tenantCount })}</span>
                <span>{fmtDate(u.createdAt)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button type="button" className="btn-ghost" onClick={() => setDrawerUser(u)}>
                  {t('common.details')}
                </button>
                {!u.isSuperadmin && (
                  <button type="button" className="btn-ghost" onClick={() => startEmulation(u)}>
                    {t('users.emulate')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {drawerUser && (
        <UserDetailDrawer
          user={drawerUser}
          tenants={tenants}
          onClose={() => setDrawerUser(null)}
          onStartImpersonate={(u) => { setDrawerUser(null); startEmulation(u); }}
        />
      )}
    </div>
  );
}
