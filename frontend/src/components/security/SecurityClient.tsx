'use client';

/**
 * Workspace security governance (owner/admin). Personal account security (your
 * own sessions + admin-access log) has moved to Settings → Sessions; this page is
 * now purely workspace-scoped and split into focused sub-views via a <PillTabs>
 * bar (?sub=): Members · Agents · SOC 2.
 */

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
  securityApi,
  type SecurityUser, type SecuritySession,
} from '@/lib/builderforceApi';
import { getStoredTenant, getStoredUser } from '@/lib/auth';
import { AgentAssignmentPanel } from '@/components/AgentAssignmentPanel';
import { SessionList } from '@/components/security/SessionList';
import { SecurityTicketAccessCard } from '@/components/security/SecurityTicketAccessCard';
import { SecurityAuditPanel } from '@/components/security/SecurityAuditPanel';
import { WebSecurityScanPanel } from '@/components/security/WebSecurityScanPanel';
import PolicyPacksPanel from '@/components/security/PolicyPacksPanel';
import PillTabs, { type PillTab } from '@/components/PillTabs';
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

export default function SecurityClient() {
  const t = useTranslations('security');
  const sub = useSearchParams().get('sub') ?? '';
  const tenant = getStoredTenant();
  const currentUser = getStoredUser();
  const tenantId = tenant ? Number(tenant.id) : null;

  const [users, setUsers] = useState<SecurityUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userSessions, setUserSessions] = useState<Record<string, SecuritySession[]>>({});
  const [loadingSessions, setLoadingSessions] = useState<string | null>(null);

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

  const subTabs: PillTab[] = [
    { id: '', label: t('membersTab'), icon: '👥', href: '/security' },
    { id: 'agents', label: t('agentsTab'), icon: '🛡', href: '/security?sub=agents' },
    { id: 'webscan', label: t('webTab'), icon: '🌐', href: '/security?sub=webscan' },
    { id: 'soc2', label: t('auditTab'), icon: '📋', href: '/security?sub=soc2' },
    { id: 'policies', label: t('policiesTab'), icon: '⚖️', href: '/security?sub=policies' },
  ];

  const renderMembers = () => (
    <>
      <div style={{ marginBottom: 12 }}>
        <div style={{ ...sectionTitle, marginBottom: 2 }}>{t('memberSessions')}</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('memberSessionsSubtitle')}</p>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>
          {t('error', { message: error })}
        </div>
      )}

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
  );

  const renderAgents = () => (
    <div style={cardStyle}>
      <AgentAssignmentPanel
        scope="security"
        title={t('securityAgents')}
        emptyHint={t('securityAgentsEmpty')}
      />
    </div>
  );

  // The Security agent (SOC 2 auditor): its audit results + who can see the
  // access-restricted SECURITY tickets it files.
  const renderSoc2 = () => (
    <>
      <SecurityAuditPanel />
      <SecurityTicketAccessCard />
    </>
  );

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('subtitle')}</p>
        </div>
        {tenantId != null && sub === '' && (
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

      {tenantId == null ? (
        <div style={cardStyle}>
          <div style={{ ...sectionTitle, marginBottom: 6 }}>{t('memberSessions')}</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('noWorkspace')}</p>
        </div>
      ) : (
        <>
          <PillTabs tabs={subTabs} activeId={sub} ariaLabel={t('subnavLabel')} />
          {sub === 'agents' ? renderAgents()
            : sub === 'webscan' ? <WebSecurityScanPanel />
              : sub === 'soc2' ? renderSoc2()
                : sub === 'policies' ? <PolicyPacksPanel />
                  : renderMembers()}
        </>
      )}
    </PageContainer>
  );
}
