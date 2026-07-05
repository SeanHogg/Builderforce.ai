'use client';

import { Select } from '@/components/Select';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  type AdminUser,
  type AdminSecurityDetails,
  type EffectivePermissions,
  type ImpersonationSession,
} from '@/lib/adminApi';

type DrawerTab = 'profile' | 'permissions' | 'sessions' | 'security' | 'access';

interface Props {
  user: AdminUser;
  tenants: Array<{ id: number; name: string; slug: string }>;
  onClose: () => void;
  onStartImpersonate: (user: AdminUser) => void;
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function UserDetailDrawer({ user, tenants, onClose, onStartImpersonate }: Props) {
  const t = useTranslations('admin');
  const [tab, setTab] = useState<DrawerTab>('profile');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Security details (sessions + tokens)
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(tenants[0]?.id ?? null);
  const [secDetails, setSecDetails] = useState<AdminSecurityDetails | null>(null);

  // Effective permissions
  const [effectivePerms, setEffectivePerms] = useState<EffectivePermissions | null>(null);

  // Admin access log
  const [adminAccess, setAdminAccess] = useState<ImpersonationSession[]>([]);

  // Action states
  const [forceLogoutBusy, setForceLogoutBusy] = useState(false);
  const [resetPwBusy, setResetPwBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const loadTab = useCallback(
    async (t: DrawerTab) => {
      setTab(t);
      setLoading(true);
      setErrorMsg('');
      try {
        if ((t === 'security' || t === 'sessions') && selectedTenantId) {
          setSecDetails(await adminApi.securityDetails(selectedTenantId, user.id));
        } else if (t === 'permissions' && selectedTenantId) {
          setEffectivePerms(await adminApi.effectivePermissions(user.id, selectedTenantId));
        } else if (t === 'access') {
          const r = await adminApi.userAdminAccess(user.id);
          setAdminAccess(r.sessions);
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [user.id, selectedTenantId],
  );

  useEffect(() => {
    loadTab('profile');
  }, []);// eslint-disable-line react-hooks/exhaustive-deps

  async function doForceLogout() {
    if (!confirm(t('users.drawer.confirmForceLogout', { email: user.email }))) return;
    setForceLogoutBusy(true);
    setErrorMsg('');
    try {
      await adminApi.forceLogout(user.id);
      setErrorMsg('');
      alert(t('users.drawer.forceLogoutDone'));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setForceLogoutBusy(false);
    }
  }

  async function doResetPassword() {
    if (!confirm(t('users.drawer.confirmResetPassword', { email: user.email }))) return;
    setResetPwBusy(true);
    setErrorMsg('');
    try {
      await adminApi.resetPassword(user.id);
      alert(t('users.drawer.resetPasswordDone'));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setResetPwBusy(false);
    }
  }

  async function doSuspend(suspend: boolean) {
    if (!confirm(suspend ? t('users.drawer.confirmSuspend', { email: user.email }) : t('users.drawer.confirmUnsuspend', { email: user.email }))) return;
    setStatusBusy(true);
    setErrorMsg('');
    try {
      await adminApi.setUserStatus(user.id, suspend);
      alert(suspend ? t('users.drawer.suspendDone') : t('users.drawer.unsuspendDone'));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(false);
    }
  }

  const TABS: DrawerTab[] = ['profile', 'permissions', 'sessions', 'security', 'access'];
  const TAB_LABELS: Record<DrawerTab, string> = {
    profile: t('users.drawer.tabProfile'),
    permissions: t('users.drawer.tabPermissions'),
    sessions: t('users.drawer.tabSessions'),
    security: t('users.drawer.tabSecurity'),
    access: t('users.drawer.tabAccess'),
  };

  return (
    <div
      className="user-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('users.drawer.dialogLabel', { email: user.email })}
    >
      <div className="user-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="user-drawer__header">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{user.displayName ?? user.username ?? user.email}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{user.email}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!user.isSuperadmin && (
              <button
                type="button"
                className="admin-tab active"
                style={{ fontSize: 12 }}
                onClick={() => { onClose(); onStartImpersonate(user); }}
              >
                {t('users.emulate')}
              </button>
            )}
            <button type="button" className="admin-tab" style={{ fontSize: 18, padding: '2px 10px' }} onClick={onClose} aria-label={t('common.close')}>×</button>
          </div>
        </div>

        {/* Tenant selector (for permission/security tabs) */}
        {(tab === 'permissions' || tab === 'sessions' || tab === 'security') && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-color)' }}>
            <Select
              className="admin-select"
              value={selectedTenantId ?? ''}
              onChange={(e) => {
                const tid = Number(e.target.value) || null;
                setSelectedTenantId(tid);
                if (tid) loadTab(tab);
              }}
              style={{ width: '100%' }}
            >
              <option value="">{t('users.drawer.selectWorkspacePlaceholder')}</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
              ))}
            </Select>
          </div>
        )}

        {/* Tab nav */}
        <div className="user-drawer__tabs">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`admin-tab${tab === t ? ' active' : ''}`}
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => loadTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="alert alert-error" role="alert" style={{ margin: '8px 16px 0' }}>
            {errorMsg}
          </div>
        )}

        <div className="user-drawer__body">
          {loading ? (
            <p style={{ color: 'var(--text-muted)', padding: 16 }}>{t('common.loading')}</p>
          ) : (
            <>
              {/* Profile tab */}
              {tab === 'profile' && (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">{t('users.drawer.fieldUserId')}</span>
                    <code style={{ fontSize: 11 }}>{user.id}</code>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">{t('users.drawer.fieldUsername')}</span>
                    <span>{user.username ?? '—'}</span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">{t('users.drawer.fieldDisplayName')}</span>
                    <span>{user.displayName ?? '—'}</span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">{t('users.drawer.fieldSuperadmin')}</span>
                    <span style={{ color: user.isSuperadmin ? '#22c55e' : 'var(--text-muted)' }}>
                      {user.isSuperadmin ? t('users.drawer.yes') : t('users.drawer.no')}
                    </span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">{t('users.drawer.fieldWorkspaces')}</span>
                    <span>{user.tenantCount}</span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">{t('users.drawer.fieldMemberSince')}</span>
                    <span>{fmtDateTime(user.createdAt)}</span>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={forceLogoutBusy}
                      onClick={doForceLogout}
                    >
                      {forceLogoutBusy ? t('users.drawer.forceLogoutBusy') : t('users.drawer.forceLogout')}
                    </button>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={resetPwBusy}
                      onClick={doResetPassword}
                    >
                      {resetPwBusy ? t('users.drawer.resetPasswordBusy') : t('users.drawer.resetPassword')}
                    </button>
                    <button
                      type="button"
                      className="admin-tab"
                      style={{ color: '#ef4444' }}
                      disabled={statusBusy}
                      onClick={() => doSuspend(true)}
                    >
                      {statusBusy ? t('users.drawer.suspendBusy') : t('users.drawer.suspendAccount')}
                    </button>
                  </div>
                </div>
              )}

              {/* Permissions tab */}
              {tab === 'permissions' && (
                <div style={{ padding: 16 }}>
                  {!selectedTenantId ? (
                    <p style={{ color: 'var(--text-muted)' }}>{t('users.drawer.selectWorkspaceAbove')}</p>
                  ) : !effectivePerms ? (
                    <p style={{ color: 'var(--text-muted)' }}>{t('users.drawer.noPermissionData')}</p>
                  ) : (
                    <>
                      <div style={{ marginBottom: 12, fontSize: 13 }}>
                        {t('users.drawer.roleLabel')} <strong>{effectivePerms.role}</strong>
                        &nbsp;·&nbsp;
                        <span style={{ color: '#22c55e' }}>{t('users.drawer.effectivePermissionsCount', { count: effectivePerms.permissions.length })}</span>
                        {effectivePerms.userGrants.length > 0 && (
                          <span style={{ marginLeft: 8, color: '#3b82f6' }}>+{t('users.drawer.userGrantsCount', { count: effectivePerms.userGrants.length })}</span>
                        )}
                        {effectivePerms.userRevocations.length > 0 && (
                          <span style={{ marginLeft: 8, color: '#ef4444' }}>-{t('users.drawer.revocationsCount', { count: effectivePerms.userRevocations.length })}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {effectivePerms.permissions.map((p) => (
                          <span
                            key={p}
                            style={{
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border-color)',
                              borderRadius: 4,
                              padding: '2px 7px',
                              fontSize: 11,
                              fontFamily: 'monospace',
                              color: effectivePerms.userRevocations.includes(p) ? '#ef4444' : effectivePerms.userGrants.includes(p) ? '#3b82f6' : 'var(--text)',
                            }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Sessions tab */}
              {tab === 'sessions' && (
                <div style={{ padding: 16 }}>
                  {!selectedTenantId ? (
                    <p style={{ color: 'var(--text-muted)' }}>{t('users.drawer.selectWorkspaceAbove')}</p>
                  ) : !secDetails ? (
                    <p style={{ color: 'var(--text-muted)' }}>{t('users.drawer.noSessionData')}</p>
                  ) : (
                    <table className="data-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>{t('users.drawer.colSession')}</th>
                          <th>{t('users.drawer.colIp')}</th>
                          <th>{t('users.drawer.colLastSeen')}</th>
                          <th>{t('users.drawer.colStatus')}</th>
                          <th>{t('users.drawer.colTokens')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {secDetails.sessions.map((s) => (
                          <tr key={s.id}>
                            <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{s.id.slice(0, 8)}…</td>
                            <td>{s.ipAddress ?? '—'}</td>
                            <td>{fmtDateTime(s.lastSeenAt)}</td>
                            <td>
                              <span style={{ color: s.isActive ? '#22c55e' : 'var(--text-muted)' }}>
                                {s.isActive ? t('users.drawer.statusActive') : t('users.drawer.statusRevoked')}
                              </span>
                            </td>
                            <td>{s.activeTokens}</td>
                          </tr>
                        ))}
                        {secDetails.sessions.length === 0 && (
                          <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>{t('users.drawer.noSessions')}</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Security tab */}
              {tab === 'security' && (
                <div style={{ padding: 16 }}>
                  {!selectedTenantId ? (
                    <p style={{ color: 'var(--text-muted)' }}>{t('users.drawer.selectWorkspaceAbove')}</p>
                  ) : !secDetails ? (
                    <p style={{ color: 'var(--text-muted)' }}>{t('users.drawer.noDataRefresh')}</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="user-drawer__field">
                        <span className="user-drawer__field-label">{t('users.drawer.fieldMfa')}</span>
                        <span style={{ color: secDetails.mfa.enabled ? '#22c55e' : '#ef4444' }}>
                          {secDetails.mfa.enabled ? t('users.drawer.mfaEnabled') : t('users.drawer.mfaDisabled')}
                        </span>
                      </div>
                      {secDetails.mfa.enabledAt && (
                        <div className="user-drawer__field">
                          <span className="user-drawer__field-label">{t('users.drawer.fieldMfaEnabledAt')}</span>
                          <span>{fmtDateTime(secDetails.mfa.enabledAt)}</span>
                        </div>
                      )}
                      <div className="user-drawer__field">
                        <span className="user-drawer__field-label">{t('users.drawer.fieldActiveSessions')}</span>
                        <span>{secDetails.sessions.filter((s) => s.isActive).length}</span>
                      </div>
                      <div className="user-drawer__field">
                        <span className="user-drawer__field-label">{t('users.drawer.fieldActiveTokens')}</span>
                        <span>{secDetails.tokens.filter((t) => t.isActive).length}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
                        <button
                          type="button"
                          className="admin-tab"
                          onClick={() => {
                            setLoading(true);
                            adminApi
                              .securityRevokeAllSessions(selectedTenantId, user.id)
                              .then(() => adminApi.securityDetails(selectedTenantId, user.id))
                              .then(setSecDetails)
                              .catch((e) => setErrorMsg(e instanceof Error ? e.message : String(e)))
                              .finally(() => setLoading(false));
                          }}
                        >
                          {t('users.drawer.revokeAllSessions')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Admin Access tab */}
              {tab === 'access' && (
                <div style={{ padding: 16 }}>
                  {adminAccess.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>{t('users.drawer.noAdminAccess')}</p>
                  ) : (
                    <table className="data-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>{t('users.drawer.colAdmin')}</th>
                          <th>{t('users.drawer.colWorkspace')}</th>
                          <th>{t('users.drawer.colRole')}</th>
                          <th>{t('users.drawer.colWhen')}</th>
                          <th>{t('users.drawer.colDuration')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminAccess.map((s) => {
                          const dur = s.endedAt
                            ? Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                            : null;
                          return (
                            <tr key={s.id}>
                              <td>{s.adminUserId.slice(0, 8)}…</td>
                              <td>{s.tenantName}</td>
                              <td>{s.roleOverride}</td>
                              <td>{fmtDateTime(s.startedAt)}</td>
                              <td>{dur != null ? `${Math.floor(dur / 60)}m ${dur % 60}s` : t('users.drawer.durationActive')}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
