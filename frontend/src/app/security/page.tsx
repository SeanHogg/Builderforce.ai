'use client';

import { useState, useEffect } from 'react';
import { securityApi, type SecurityUser, type SecuritySession } from '@/lib/builderforceApi';
import { getStoredTenant, getStoredUser } from '@/lib/auth';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export default function SecurityPage() {
  const tenant = getStoredTenant();
  const currentUser = getStoredUser();
  const tenantId = tenant ? Number(tenant.id) : null;

  const [users, setUsers] = useState<SecurityUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userSessions, setUserSessions] = useState<Record<string, SecuritySession[]>>({});
  const [loadingSessions, setLoadingSessions] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    securityApi.listUsers(tenantId)
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tenantId]);

  const toggleUser = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    if (!tenantId || userSessions[userId]) return;
    setLoadingSessions(userId);
    try {
      const data = await securityApi.getUser(tenantId, userId);
      setUserSessions((prev) => ({ ...prev, [userId]: data.sessions }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setLoadingSessions(null);
    }
  };

  const revokeSession = async (userId: string, sessionId: string) => {
    if (!tenantId) return;
    setRevoking(sessionId);
    try {
      await securityApi.revokeSession(tenantId, userId, sessionId);
      setUserSessions((prev) => ({
        ...prev,
        [userId]: (prev[userId] ?? []).map((s) =>
          s.id === sessionId ? { ...s, isActive: false, revokedAt: new Date().toISOString() } : s
        ),
      }));
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, activeSessions: Math.max(0, u.activeSessions - 1) } : u
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  const revokeAll = async (userId: string) => {
    if (!tenantId) return;
    if (!confirm('Revoke all sessions for this user?')) return;
    setRevoking(`all-${userId}`);
    try {
      await securityApi.revokeAllSessions(tenantId, userId);
      setUserSessions((prev) => ({
        ...prev,
        [userId]: (prev[userId] ?? []).map((s) => ({ ...s, isActive: false, revokedAt: new Date().toISOString() })),
      }));
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, activeSessions: 0 } : u
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  if (!tenantId) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 720 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Security</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No workspace selected. Please select a workspace first.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Security</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Manage active sessions and tokens for workspace members.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', fontSize: 13, fontWeight: 600,
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading members…</div>
      ) : users.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          No members found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map((user) => {
            const isExpanded = expandedUserId === user.id;
            const sessions = userSessions[user.id] ?? [];
            const isCurrentUser = currentUser?.id === user.id;

            return (
              <div key={user.id} style={cardStyle}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
                  onClick={() => void toggleUser(user.id)}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'var(--surface-interactive)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', flexShrink: 0,
                    }}
                  >
                    {(user.displayName ?? user.username ?? user.email)[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {user.displayName ?? user.username}
                      {isCurrentUser && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-coral-soft, rgba(244,114,94,0.15))', color: 'var(--coral-bright, #f4726e)' }}>
                          You
                        </span>
                      )}
                      {user.mfaEnabled && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: 'rgba(34,197,94,0.9)' }}>
                          MFA
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{user.email}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                    <span><strong style={{ color: user.activeSessions > 0 ? 'var(--text-primary)' : undefined }}>{user.activeSessions}</strong> sessions</span>
                    <span><strong style={{ color: user.activeTokens > 0 ? 'var(--text-primary)' : undefined }}>{user.activeTokens}</strong> tokens</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                    {loadingSessions === user.id ? (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading sessions…</div>
                    ) : sessions.length === 0 ? (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions found.</div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Sessions</div>
                          {user.activeSessions > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void revokeAll(user.id); }}
                              disabled={revoking === `all-${user.id}`}
                              style={{
                                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                                background: 'none', color: 'var(--coral-bright, #f4726e)',
                                border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 6, cursor: 'pointer',
                              }}
                            >
                              {revoking === `all-${user.id}` ? '…' : 'Revoke all'}
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {sessions.map((s) => (
                            <div key={s.id} style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              padding: '8px 10px', borderRadius: 8,
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              opacity: s.isActive ? 1 : 0.5,
                            }}>
                              <div
                                style={{
                                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                  background: s.isActive ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)',
                                }}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {s.sessionName ?? s.userAgent ?? 'Unknown session'}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  {s.ipAddress && `${s.ipAddress} · `}
                                  {s.lastSeenAt ? `Last seen ${new Date(s.lastSeenAt).toLocaleString()}` : `Created ${new Date(s.createdAt).toLocaleString()}`}
                                  {s.revokedAt && ` · Revoked ${new Date(s.revokedAt).toLocaleString()}`}
                                </div>
                              </div>
                              {s.isActive && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void revokeSession(user.id, s.id); }}
                                  disabled={revoking === s.id}
                                  style={{
                                    padding: '4px 8px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                                    background: 'none', color: 'var(--coral-bright, #f4726e)',
                                    border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 6, cursor: 'pointer',
                                  }}
                                >
                                  {revoking === s.id ? '…' : 'Revoke'}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
