'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  securityApi, mySessionsApi, myAdminAccessApi,
  type SecurityUser, type SecuritySession, type MySession, type MyAdminAccessSession,
} from '@/lib/builderforceApi';
import { getStoredTenant, getStoredUser } from '@/lib/auth';
import { AgentAssignmentPanel } from '@/components/AgentAssignmentPanel';
import { SessionList } from '@/components/security/SessionList';
import PageContainer from '@/components/PageContainer';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
};

export default function SecurityPage() {
  const t = useTranslations('security');
  const tenant = getStoredTenant();
  const currentUser = getStoredUser();
  const tenantId = tenant ? Number(tenant.id) : null;

  // --- The viewer's own account security (moved here from Settings) ---
  const [mySessions, setMySessions] = useState<MySession[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [myError, setMyError] = useState<string | null>(null);
  const [adminAccess, setAdminAccess] = useState<MyAdminAccessSession[]>([]);
  const [loadingAdmin, setLoadingAdmin] = useState(true);

  // --- Workspace member sessions (owner/admin view) ---
  const [users, setUsers] = useState<SecurityUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userSessions, setUserSessions] = useState<Record<string, SecuritySession[]>>({});
  const [loadingSessions, setLoadingSessions] = useState<string | null>(null);

  useEffect(() => {
    mySessionsApi.list()
      .then(setMySessions)
      .catch((e: Error) => setMyError(e.message))
      .finally(() => setLoadingMine(false));
    myAdminAccessApi.list()
      .then(setAdminAccess)
      .catch(() => undefined) // non-critical; suppress errors
      .finally(() => setLoadingAdmin(false));
  }, []);

  const load = () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    securityApi.listUsers(tenantId)
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [tenantId]);

  const revokeMine = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => mySessionsApi.revoke(id)));
      setMySessions((prev) => prev.map((s) =>
        ids.includes(s.id) ? { ...s, isActive: false, revokedAt: new Date().toISOString() } : s
      ));
    } catch (e) {
      setMyError(e instanceof Error ? e.message : 'Revoke failed');
    }
  };

  const toggleUser = async (userId: string) => {
    if (expandedUserId === userId) { setExpandedUserId(null); return; }
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

  const revokeMemberSessions = async (userId: string, ids: string[]) => {
    if (!tenantId) return;
    try {
      await Promise.all(ids.map((id) => securityApi.revokeSession(tenantId, userId, id)));
      setUserSessions((prev) => ({
        ...prev,
        [userId]: (prev[userId] ?? []).map((s) =>
          ids.includes(s.id) ? { ...s, isActive: false, revokedAt: new Date().toISOString() } : s
        ),
      }));
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, activeSessions: Math.max(0, u.activeSessions - ids.length) } : u
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    }
  };

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('subtitle')}</p>
        </div>
        {tenantId != null && (
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
            {loading ? t('loading') : t('refresh')}
          </button>
        )}
      </div>

      {/* My active sessions (moved from Settings) */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ ...sectionTitle, marginBottom: 4 }}>{t('mySessions')}</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>{t('mySessionsSubtitle')}</p>
        {myError && <div style={{ fontSize: 12, color: 'var(--coral-bright)', marginBottom: 10 }}>{t('error', { message: myError })}</div>}
        {loadingMine ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingSessions')}</div>
        ) : (
          <SessionList sessions={mySessions} onRevoke={revokeMine} />
        )}
      </div>

      {/* Recent admin access (moved from Settings) */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ ...sectionTitle, marginBottom: 4 }}>{t('adminAccess')}</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>{t('adminAccessNote')}</p>
        {loadingAdmin ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</p>
        ) : adminAccess.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noAdminAccess')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {adminAccess.map((s) => {
              const dur = s.endedAt
                ? Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                : null;
              const durStr = dur != null ? `${Math.floor(dur / 60)}m ${dur % 60}s` : t('active');
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    padding: '10px 14px', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)', borderRadius: 8, gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.tenantName}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                        {t('as')} {s.roleOverride}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      {new Date(s.startedAt).toLocaleString()}
                      {' · '}{t('duration')}: {durStr}
                      {s.writeBlockCount > 0 && (
                        <span style={{ color: 'var(--warning-fg, #f59e0b)', marginLeft: 6 }}>({t('writeBlocked', { count: s.writeBlockCount })})</span>
                      )}
                    </div>
                    {s.reason && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                        {t('reason')}: {s.reason}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      background: s.endedAt ? 'var(--bg-card)' : 'rgba(245,158,11,0.15)',
                      border: '1px solid',
                      borderColor: s.endedAt ? 'var(--border-subtle)' : 'rgba(245,158,11,0.5)',
                      color: s.endedAt ? 'var(--text-muted)' : 'var(--warning-fg, #f59e0b)',
                      flexShrink: 0,
                    }}
                  >
                    {s.endedAt ? t('ended') : t('active')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Workspace member sessions (owner/admin) */}
      {tenantId == null ? (
        <div style={{ ...cardStyle }}>
          <div style={{ ...sectionTitle, marginBottom: 6 }}>{t('memberSessions')}</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('noWorkspace')}</p>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...sectionTitle, marginBottom: 2 }}>{t('memberSessions')}</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('memberSessionsSubtitle')}</p>
          </div>

          {error && (
            <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>
              {t('error', { message: error })}
            </div>
          )}

          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <AgentAssignmentPanel
              scope="security"
              title={t('securityAgents')}
              emptyHint={t('securityAgentsEmpty')}
            />
          </div>

          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingMembers')}</div>
          ) : users.length === 0 ? (
            <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
              {t('noMembers')}
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
                              {t('you')}
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
                        <span><strong style={{ color: user.activeSessions > 0 ? 'var(--text-primary)' : undefined }}>{user.activeSessions}</strong> {t('sessionsLabel')}</span>
                        <span><strong style={{ color: user.activeTokens > 0 ? 'var(--text-primary)' : undefined }}>{user.activeTokens}</strong> {t('tokensLabel')}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>{t('sessionsHeading')}</div>
                        {loadingSessions === user.id ? (
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingSessions')}</div>
                        ) : (
                          <SessionList
                            sessions={sessions}
                            onRevoke={(ids) => revokeMemberSessions(user.id, ids)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
