'use client';

import { useState, useEffect, useCallback } from 'react';
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
    if (!confirm(`Force-logout all sessions for ${user.email}?`)) return;
    setForceLogoutBusy(true);
    setErrorMsg('');
    try {
      await adminApi.forceLogout(user.id);
      setErrorMsg('');
      alert('All sessions have been invalidated.');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setForceLogoutBusy(false);
    }
  }

  async function doResetPassword() {
    if (!confirm(`Send password reset email to ${user.email}?`)) return;
    setResetPwBusy(true);
    setErrorMsg('');
    try {
      await adminApi.resetPassword(user.id);
      alert('Password reset email queued.');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setResetPwBusy(false);
    }
  }

  async function doSuspend(suspend: boolean) {
    if (!confirm(`${suspend ? 'Suspend' : 'Unsuspend'} account for ${user.email}?`)) return;
    setStatusBusy(true);
    setErrorMsg('');
    try {
      await adminApi.setUserStatus(user.id, suspend);
      alert(`Account ${suspend ? 'suspended' : 'unsuspended'}.`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(false);
    }
  }

  const TABS: DrawerTab[] = ['profile', 'permissions', 'sessions', 'security', 'access'];
  const TAB_LABELS: Record<DrawerTab, string> = {
    profile: 'Profile',
    permissions: 'Permissions',
    sessions: 'Sessions',
    security: 'Security',
    access: 'Admin Access',
  };

  return (
    <div
      className="user-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`User details: ${user.email}`}
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
                Emulate
              </button>
            )}
            <button type="button" className="admin-tab" style={{ fontSize: 18, padding: '2px 10px' }} onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        {/* Tenant selector (for permission/security tabs) */}
        {(tab === 'permissions' || tab === 'sessions' || tab === 'security') && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-color)' }}>
            <select
              className="admin-select"
              value={selectedTenantId ?? ''}
              onChange={(e) => {
                const tid = Number(e.target.value) || null;
                setSelectedTenantId(tid);
                if (tid) loadTab(tab);
              }}
              style={{ width: '100%' }}
            >
              <option value="">Select workspace…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
              ))}
            </select>
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
            <p style={{ color: 'var(--text-muted)', padding: 16 }}>Loading…</p>
          ) : (
            <>
              {/* Profile tab */}
              {tab === 'profile' && (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">User ID</span>
                    <code style={{ fontSize: 11 }}>{user.id}</code>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">Username</span>
                    <span>{user.username ?? '—'}</span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">Display name</span>
                    <span>{user.displayName ?? '—'}</span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">Superadmin</span>
                    <span style={{ color: user.isSuperadmin ? '#22c55e' : 'var(--text-muted)' }}>
                      {user.isSuperadmin ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">Workspaces</span>
                    <span>{user.tenantCount}</span>
                  </div>
                  <div className="user-drawer__field">
                    <span className="user-drawer__field-label">Member since</span>
                    <span>{fmtDateTime(user.createdAt)}</span>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={forceLogoutBusy}
                      onClick={doForceLogout}
                    >
                      {forceLogoutBusy ? 'Logging out…' : 'Force Logout'}
                    </button>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={resetPwBusy}
                      onClick={doResetPassword}
                    >
                      {resetPwBusy ? 'Sending…' : 'Reset Password'}
                    </button>
                    <button
                      type="button"
                      className="admin-tab"
                      style={{ color: '#ef4444' }}
                      disabled={statusBusy}
                      onClick={() => doSuspend(true)}
                    >
                      {statusBusy ? 'Suspending…' : 'Suspend Account'}
                    </button>
                  </div>
                </div>
              )}

              {/* Permissions tab */}
              {tab === 'permissions' && (
                <div style={{ padding: 16 }}>
                  {!selectedTenantId ? (
                    <p style={{ color: 'var(--text-muted)' }}>Select a workspace above.</p>
                  ) : !effectivePerms ? (
                    <p style={{ color: 'var(--text-muted)' }}>No permission data.</p>
                  ) : (
                    <>
                      <div style={{ marginBottom: 12, fontSize: 13 }}>
                        Role: <strong>{effectivePerms.role}</strong>
                        &nbsp;·&nbsp;
                        <span style={{ color: '#22c55e' }}>{effectivePerms.permissions.length} effective permissions</span>
                        {effectivePerms.userGrants.length > 0 && (
                          <span style={{ marginLeft: 8, color: '#3b82f6' }}>+{effectivePerms.userGrants.length} user grants</span>
                        )}
                        {effectivePerms.userRevocations.length > 0 && (
                          <span style={{ marginLeft: 8, color: '#ef4444' }}>-{effectivePerms.userRevocations.length} revocations</span>
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
                    <p style={{ color: 'var(--text-muted)' }}>Select a workspace above.</p>
                  ) : !secDetails ? (
                    <p style={{ color: 'var(--text-muted)' }}>No session data.</p>
                  ) : (
                    <table className="data-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Session</th>
                          <th>IP</th>
                          <th>Last seen</th>
                          <th>Status</th>
                          <th>Tokens</th>
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
                                {s.isActive ? 'Active' : 'Revoked'}
                              </span>
                            </td>
                            <td>{s.activeTokens}</td>
                          </tr>
                        ))}
                        {secDetails.sessions.length === 0 && (
                          <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>No sessions.</td></tr>
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
                    <p style={{ color: 'var(--text-muted)' }}>Select a workspace above.</p>
                  ) : !secDetails ? (
                    <p style={{ color: 'var(--text-muted)' }}>No data. Select workspace and refresh.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="user-drawer__field">
                        <span className="user-drawer__field-label">MFA</span>
                        <span style={{ color: secDetails.mfa.enabled ? '#22c55e' : '#ef4444' }}>
                          {secDetails.mfa.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      {secDetails.mfa.enabledAt && (
                        <div className="user-drawer__field">
                          <span className="user-drawer__field-label">MFA enabled</span>
                          <span>{fmtDateTime(secDetails.mfa.enabledAt)}</span>
                        </div>
                      )}
                      <div className="user-drawer__field">
                        <span className="user-drawer__field-label">Active sessions</span>
                        <span>{secDetails.sessions.filter((s) => s.isActive).length}</span>
                      </div>
                      <div className="user-drawer__field">
                        <span className="user-drawer__field-label">Active tokens</span>
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
                          Revoke All Sessions
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
                    <p style={{ color: 'var(--text-muted)' }}>No admin impersonation sessions for this user.</p>
                  ) : (
                    <table className="data-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Admin</th>
                          <th>Workspace</th>
                          <th>Role</th>
                          <th>When</th>
                          <th>Duration</th>
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
                              <td>{dur != null ? `${Math.floor(dur / 60)}m ${dur % 60}s` : 'Active'}</td>
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
