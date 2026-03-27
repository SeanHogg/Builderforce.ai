'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { mySessionsApi, myAdminAccessApi, type MySession, type MyAdminAccessSession } from '@/lib/builderforceApi';
import {
  getStoredUser,
  getStoredTenant,
  getStoredWebToken,
  getLinkedAccounts,
  unlinkProvider,
  getOAuthUrl,
} from '@/lib/auth';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 14,
};

const OAUTH_PROVIDERS = [
  { id: 'google',    label: 'Google',    icon: 'G' },
  { id: 'github',    label: 'GitHub',    icon: '⌥' },
  { id: 'linkedin',  label: 'LinkedIn',  icon: 'in' },
  { id: 'microsoft', label: 'Microsoft', icon: 'M' },
];

export default function SettingsPage() {
  const user = getStoredUser();
  const tenant = getStoredTenant();

  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [adminAccessSessions, setAdminAccessSessions] = useState<MyAdminAccessSession[]>([]);
  const [loadingAdminAccess, setLoadingAdminAccess] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  type LinkedAccount = { provider: string; email: string | null; displayName: string | null };
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [hasPassword, setHasPassword] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    mySessionsApi.list()
      .then(setSessions)
      .catch((e: Error) => setSessionError(e.message))
      .finally(() => setLoadingSessions(false));
    myAdminAccessApi.list()
      .then(setAdminAccessSessions)
      .catch(() => undefined) // non-critical; suppress errors
      .finally(() => setLoadingAdminAccess(false));
  }, []);

  useEffect(() => {
    const token = getStoredWebToken();
    if (!token) { setLoadingAccounts(false); return; }
    getLinkedAccounts(token)
      .then(({ accounts, hasPassword: hp }) => { setLinkedAccounts(accounts); setHasPassword(hp); })
      .catch((e: Error) => setAccountsError(e.message))
      .finally(() => setLoadingAccounts(false));

    // Show connect error from redirect if present
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'already_linked_other') {
      setConnectError('That provider account is already connected to a different Builderforce account.');
    }
  }, []);

  const handleConnect = (providerId: string) => {
    const token = getStoredWebToken();
    if (!token) return;
    window.location.href = getOAuthUrl(providerId, '/settings', token);
  };

  const handleUnlink = async (provider: string) => {
    const token = getStoredWebToken();
    if (!token) return;
    setUnlinking(provider);
    try {
      await unlinkProvider(token, provider);
      setLinkedAccounts((prev) => prev.filter((a) => a.provider !== provider));
    } catch (e) {
      setAccountsError(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setUnlinking(null);
    }
  };

  const revokeSession = async (id: string) => {
    setRevoking(id);
    try {
      await mySessionsApi.revoke(id);
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, isActive: false, revokedAt: new Date().toISOString() } : s));
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  const revokeOthers = async () => {
    if (!confirm('Sign out of all other sessions?')) return;
    setRevoking('others');
    try {
      await mySessionsApi.revokeOthers();
      setSessions((prev) => prev.map((s) => s.isCurrent ? s : { ...s, isActive: false, revokedAt: new Date().toISOString() }));
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  const activeSessions = sessions.filter((s) => s.isActive);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>Settings</h1>

      {/* Profile */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={sectionTitle}>Profile</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { label: 'Email', value: user?.email },
            { label: 'Display name', value: user?.name },
            { label: 'User ID', value: user?.id, mono: true },
          ].filter((r) => r.value).map(({ label, value, mono }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={mono ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : {}}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Workspace */}
      {tenant && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={sectionTitle}>Workspace</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { label: 'Name', value: tenant.name },
              { label: 'Slug', value: tenant.slug, mono: true },
              { label: 'ID', value: tenant.id, mono: true },
            ].filter((r) => r.value).map(({ label, value, mono }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span style={mono ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : {}}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10 }}>
            <Link
              href="/tenants"
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                background: 'var(--surface-interactive)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)', borderRadius: 8, textDecoration: 'none',
              }}
            >
              Switch workspace
            </Link>
            <Link
              href="/security"
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)', borderRadius: 8, textDecoration: 'none',
              }}
            >
              Manage member sessions →
            </Link>
          </div>
        </div>
      )}

      {/* Connected Accounts */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={sectionTitle}>Connected Accounts</div>

        {connectError && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 12 }}>{connectError}</div>
        )}
        {accountsError && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 12 }}>Error: {accountsError}</div>
        )}

        {loadingAccounts ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {OAUTH_PROVIDERS.map(({ id, label, icon }) => {
              const linked = linkedAccounts.find((a) => a.provider === id);
              return (
                <div
                  key={id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    border: `1px solid ${linked ? 'var(--border-subtle)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <span style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.75rem', background: 'var(--bg-surface)',
                    borderRadius: 6, flexShrink: 0,
                  }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                    {linked && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {linked.email ?? linked.displayName ?? 'Connected'}
                      </div>
                    )}
                  </div>
                  {linked ? (
                    <button
                      type="button"
                      onClick={() => void handleUnlink(id)}
                      disabled={unlinking === id}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                        background: 'none', color: 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
                      }}
                    >
                      {unlinking === id ? '…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleConnect(id)}
                      style={{
                        padding: '4px 10px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                        background: 'var(--surface-interactive)', color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer',
                      }}
                    >
                      Connect
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!hasPassword && linkedAccounts.length <= 1 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
            Add a password or connect another provider before disconnecting your only sign-in method.
          </p>
        )}
      </div>

      {/* Sessions */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={sectionTitle}>Active Sessions</div>
          {activeSessions.filter((s) => !s.isCurrent).length > 0 && (
            <button
              type="button"
              onClick={revokeOthers}
              disabled={revoking === 'others'}
              style={{
                padding: '5px 10px', fontSize: 11, fontWeight: 600,
                background: 'none', color: 'var(--coral-bright, #f4726e)',
                border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 6, cursor: 'pointer',
              }}
            >
              {revoking === 'others' ? '…' : 'Sign out others'}
            </button>
          )}
        </div>

        {sessionError && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>Error: {sessionError}</div>
        )}

        {loadingSessions ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.map((s) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8,
                background: 'var(--bg-elevated)',
                border: `1px solid ${s.isCurrent ? 'var(--coral-bright, #f4726e)' : 'var(--border-subtle)'}`,
                opacity: s.isActive ? 1 : 0.45,
              }}>
                <div
                  style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: s.isActive ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {s.sessionName ?? s.userAgent ?? 'Session'}
                    {s.isCurrent && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-coral-soft, rgba(244,114,94,0.15))', color: 'var(--coral-bright, #f4726e)' }}>
                        Current
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {s.ipAddress && `${s.ipAddress} · `}
                    {s.lastSeenAt
                      ? `Last active ${new Date(s.lastSeenAt).toLocaleString()}`
                      : `Created ${new Date(s.createdAt).toLocaleString()}`}
                    {!s.isActive && s.revokedAt && ` · Revoked`}
                  </div>
                </div>
                {s.isActive && !s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => void revokeSession(s.id)}
                    disabled={revoking === s.id}
                    style={{
                      padding: '4px 8px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                      background: 'none', color: 'var(--coral-bright, #f4726e)',
                      border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    {revoking === s.id ? '…' : 'Sign out'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Admin Access */}
      <div style={{ ...cardStyle, marginTop: 20 }}>
        <div style={sectionTitle}>Recent Admin Access</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          These are sessions in which a platform administrator viewed your account. All admin sessions are read-only.
        </p>
        {loadingAdminAccess ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
        ) : adminAccessSessions.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No admin access sessions found.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {adminAccessSessions.map((s) => {
              const dur = s.endedAt
                ? Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                : null;
              const durStr = dur != null ? `${Math.floor(dur / 60)}m ${dur % 60}s` : 'Active';
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    padding: '10px 14px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.tenantName}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                        as {s.roleOverride}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      {new Date(s.startedAt).toLocaleString()}
                      {' · '}Duration: {durStr}
                      {s.writeBlockCount > 0 && (
                        <span style={{ color: '#f59e0b', marginLeft: 6 }}>({s.writeBlockCount} write attempts blocked)</span>
                      )}
                    </div>
                    {s.reason && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                        Reason: {s.reason}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: s.endedAt ? 'var(--bg-card)' : 'rgba(245,158,11,0.15)',
                      border: '1px solid',
                      borderColor: s.endedAt ? 'var(--border-color)' : 'rgba(245,158,11,0.5)',
                      color: s.endedAt ? 'var(--text-muted)' : '#f59e0b',
                      flexShrink: 0,
                    }}
                  >
                    {s.endedAt ? 'Ended' : 'Active'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
