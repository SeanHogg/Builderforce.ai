'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useEmulation } from '@/lib/EmulationContext';
import { getStoredWebToken } from '@/lib/auth';
import {
  adminApi,
  type AdminHealth,
  type AdminUser,
  type AdminTenant,
  type AdminError,
  type LlmUsageStats,
  type AdminLegalCurrent,
  type AdminNewsletterSubscriber,
  type AdminNewsletterTemplate,
  type AdminNewsletterEvent,
  type AdminPrivacyRequest,
  type AdminSecurityUser,
  type AdminSecurityDetails,
  type AdminPlatformPersona,
  type AdminProjectGovernance,
  type PermissionMatrix,
  type PlatformModule,
  type AuditLogEntry,
  type ImpersonationSession,
  type TenantMember,
  type UserWorkspace,
} from '@/lib/adminApi';
import { BUILTIN_PERSONAS, type Persona } from '@/lib/marketplaceData';
import UserDetailDrawer from '@/components/UserDetailDrawer';

type AdminTab =
  | 'health'
  | 'billing'
  | 'usage'
  | 'users'
  | 'tenants'
  | 'security'
  | 'legal'
  | 'newsletter'
  | 'privacy'
  | 'personas'
  | 'governance'
  | 'permissions'
  | 'modules'
  | 'impsessions'
  | 'auditlog'
  | 'errors'
  | 'token';

const TABS: AdminTab[] = [
  'health',
  'billing',
  'usage',
  'users',
  'tenants',
  'security',
  'legal',
  'newsletter',
  'privacy',
  'personas',
  'governance',
  'permissions',
  'modules',
  'impsessions',
  'auditlog',
  'errors',
  'token',
];

const TAB_LABELS: Partial<Record<AdminTab, string>> = {
  impsessions: 'Imp. Sessions',
  auditlog: 'Audit Log',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtNum(n: number | string) {
  return Number(n).toLocaleString();
}

export default function AdminPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [tab, setTab] = useState<AdminTab>('health');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [errors, setErrors] = useState<AdminError[]>([]);
  const [llmUsage, setLlmUsage] = useState<LlmUsageStats | null>(null);
  const [usageDays, setUsageDays] = useState(30);
  const [showToken, setShowToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [downloadedEnv, setDownloadedEnv] = useState(false);
  const [impersonateUser, setImpersonateUser] = useState<AdminUser | null>(null);
  const [impersonateWorkspaces, setImpersonateWorkspaces] = useState<UserWorkspace[]>([]);
  const [impersonateWorkspacesLoading, setImpersonateWorkspacesLoading] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [impersonateDebugger, setImpersonateDebugger] = useState(false);
  const [impersonateBusy, setImpersonateBusy] = useState(false);

  const [legalCurrent, setLegalCurrent] = useState<AdminLegalCurrent | null>(null);
  const [newsletterSubscribers, setNewsletterSubscribers] = useState<AdminNewsletterSubscriber[]>([]);
  const [newsletterTemplates, setNewsletterTemplates] = useState<AdminNewsletterTemplate[]>([]);
  const [newsletterEvents, setNewsletterEvents] = useState<AdminNewsletterEvent[]>([]);
  const [newsletterStatusFilter, setNewsletterStatusFilter] = useState<'all' | 'subscribed' | 'unsubscribed' | 'suppressed'>('subscribed');
  const [newsletterSearch, setNewsletterSearch] = useState('');
  const [privacyRequests, setPrivacyRequests] = useState<AdminPrivacyRequest[]>([]);
  const [privacyStatusFilter, setPrivacyStatusFilter] = useState('');
  const [privacyTypeFilter, setPrivacyTypeFilter] = useState('');
  const [privacySearch, setPrivacySearch] = useState('');
  const [securityTenantId, setSecurityTenantId] = useState<number | null>(null);
  const [securityUsers, setSecurityUsers] = useState<AdminSecurityUser[]>([]);
  const [securityUserId, setSecurityUserId] = useState<string | null>(null);
  const [securityDetails, setSecurityDetails] = useState<AdminSecurityDetails | null>(null);

  const [legalPublishVersion, setLegalPublishVersion] = useState('');
  const [legalPublishTitle, setLegalPublishTitle] = useState('Terms of Use');
  const [legalPublishContent, setLegalPublishContent] = useState('');
  const [legalPublishing, setLegalPublishing] = useState(false);

  const [llmPoolTab, setLlmPoolTab] = useState<'free' | 'pro'>('free');
  const [expandedErrorId, setExpandedErrorId] = useState<number | null>(null);

  const [newsletterTemplateName, setNewsletterTemplateName] = useState('');
  const [newsletterTemplateSubject, setNewsletterTemplateSubject] = useState('');
  const [newsletterTemplatePreheader, setNewsletterTemplatePreheader] = useState('');
  const [newsletterTemplateBody, setNewsletterTemplateBody] = useState('');
  const [newsletterTemplateBusy, setNewsletterTemplateBusy] = useState(false);
  const [newsletterTrackTemplateId, setNewsletterTrackTemplateId] = useState('');
  const [newsletterTrackEmail, setNewsletterTrackEmail] = useState('');
  const [newsletterTrackBusy, setNewsletterTrackBusy] = useState(false);

  const [privacyUpdateBusy, setPrivacyUpdateBusy] = useState(false);

  const [securityMfaCode, setSecurityMfaCode] = useState('');
  const [securityRecoveryCode, setSecurityRecoveryCode] = useState('');
  const [securityMfaMode, setSecurityMfaMode] = useState<'totp' | 'recovery'>('totp');
  const [securityMfaManualKey, setSecurityMfaManualKey] = useState('');
  const [securityRecoveryCodes, setSecurityRecoveryCodes] = useState<string[]>([]);

  const [platformPersonas, setPlatformPersonas] = useState<AdminPlatformPersona[]>([]);
  const [governanceProjects, setGovernanceProjects] = useState<AdminProjectGovernance[]>([]);
  const [personaForm, setPersonaForm] = useState<Partial<AdminPlatformPersona> & { name: string } | null>(null);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaSeedBusy, setPersonaSeedBusy] = useState(false);
  const [governanceEditId, setGovernanceEditId] = useState<number | null>(null);
  const [governanceEditContent, setGovernanceEditContent] = useState('');
  const [governanceSaving, setGovernanceSaving] = useState(false);

  // Active sessions dashboard (health tab widget)
  const [activeSessions, setActiveSessions] = useState<ImpersonationSession[]>([]);
  const [activeSessionsLoaded, setActiveSessionsLoaded] = useState(false);

  // Permissions tab
  const [permMatrix, setPermMatrix] = useState<PermissionMatrix | null>(null);
  const [permEditRole, setPermEditRole] = useState<string | null>(null);
  const [permEditOverrides, setPermEditOverrides] = useState<Record<string, boolean>>({});
  const [permSaving, setPermSaving] = useState(false);

  // Modules tab
  const [platformModules, setPlatformModules] = useState<PlatformModule[]>([]);
  const [moduleForm, setModuleForm] = useState<{ name: string; description: string; permissions: string } | null>(null);
  const [moduleFormBusy, setModuleFormBusy] = useState(false);

  // Impersonation sessions tab
  const [impSessions, setImpSessions] = useState<ImpersonationSession[]>([]);
  const [impSessionsTotal, setImpSessionsTotal] = useState(0);
  const [impSessionsOffset, setImpSessionsOffset] = useState(0);

  // User detail drawer
  const [drawerUser, setDrawerUser] = useState<AdminUser | null>(null);

  // Tenants tab: expanded tenant members
  const [expandedTenantId, setExpandedTenantId] = useState<number | null>(null);
  const [tenantMembersMap, setTenantMembersMap] = useState<Record<number, TenantMember[]>>({});

  // Audit log tab
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditEventFilter, setAuditEventFilter] = useState('');
  const [auditExporting, setAuditExporting] = useState(false);

  const isSuperadmin = Boolean(user?.isSuperadmin);
  const { startEmulation } = useEmulation();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/admin');
      return;
    }
    if (isAuthenticated && !isSuperadmin) {
      router.replace('/dashboard');
      return;
    }
  }, [isAuthenticated, isSuperadmin, router]);

  const loadTab = useCallback(
    async (t: AdminTab) => {
      setTab(t);
      setLoading(true);
      setErrorMsg('');
      try {
        if (t === 'health') {
          setHealth(await adminApi.health());
          // Load active impersonation sessions
          const sessions = await adminApi.impersonationList({ limit: 20 });
          setActiveSessions(sessions.sessions.filter((s) => !s.endedAt));
          setActiveSessionsLoaded(true);
        }
        else if (t === 'billing') {
          const [tenantsData, errorsData] = await Promise.all([adminApi.tenants(), adminApi.errors()]);
          setTenants(tenantsData);
          setErrors(errorsData);
        } else if (t === 'usage') setLlmUsage(await adminApi.llmUsage(usageDays));
        else if (t === 'users') setUsers(await adminApi.users());
        else if (t === 'tenants') setTenants(await adminApi.tenants());
        else if (t === 'security') {
          const tenantsData = await adminApi.tenants();
          setTenants(tenantsData);
          const tid = securityTenantId ?? tenantsData[0]?.id ?? null;
          if (tid && !tenantsData.find((x) => x.id === tid)) setSecurityTenantId(tenantsData[0]?.id ?? null);
          else if (tid !== securityTenantId) setSecurityTenantId(tid);
          if (tid) {
            const usersData = await adminApi.securityUsers(tid);
            setSecurityUsers(usersData);
            if (securityUserId) {
              const details = await adminApi.securityDetails(tid, securityUserId);
              setSecurityDetails(details);
            } else setSecurityDetails(null);
          } else setSecurityUsers([]);
        } else if (t === 'legal') setLegalCurrent(await adminApi.legalCurrent());
        else if (t === 'newsletter') {
          const status = newsletterStatusFilter === 'all' ? undefined : newsletterStatusFilter;
          const [subs, tmpls, evts] = await Promise.all([
            adminApi.newsletterSubscribers({ status, q: newsletterSearch || undefined, limit: 400 }),
            adminApi.newsletterTemplates(),
            adminApi.newsletterEvents(300),
          ]);
          setNewsletterSubscribers(subs);
          setNewsletterTemplates(tmpls);
          setNewsletterEvents(evts);
        } else if (t === 'privacy') {
          const reqs = await adminApi.privacyRequests({
            status: privacyStatusFilter || undefined,
            type: privacyTypeFilter || undefined,
            q: privacySearch || undefined,
            limit: 400,
          });
          setPrivacyRequests(reqs);
        } else if (t === 'errors') setErrors(await adminApi.errors());
        else if (t === 'personas') setPlatformPersonas(await adminApi.personas());
        else if (t === 'governance') setGovernanceProjects(await adminApi.adminProjects());
        else if (t === 'permissions') setPermMatrix(await adminApi.permissionsMatrix());
        else if (t === 'modules') setPlatformModules(await adminApi.modules());
        else if (t === 'impsessions') {
          const r = await adminApi.impersonationList({ limit: 50, offset: impSessionsOffset });
          setImpSessions(r.sessions);
          setImpSessionsTotal(r.total);
        } else if (t === 'auditlog') {
          const r = await adminApi.auditLog({ event: auditEventFilter || undefined, limit: 50, offset: auditOffset });
          setAuditEntries(r.entries);
          setAuditTotal(r.total);
        } else if (t === 'token') {
          /* no fetch */
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    // securityTenantId and securityUserId are intentionally omitted: including them
    // would cause the security tab to reload whenever loading sets those values (infinite loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usageDays, newsletterStatusFilter, newsletterSearch, privacyStatusFilter, privacyTypeFilter, privacySearch, impSessionsOffset, auditEventFilter, auditOffset]
  );

  useEffect(() => {
    if (!isSuperadmin || !isAuthenticated) return;
    loadTab(tab);
  }, [isSuperadmin, isAuthenticated, tab, loadTab]);

  const webToken = getStoredWebToken();

  const copyToken = async () => {
    if (!webToken) {
      setErrorMsg('No superadmin web token found for this session.');
      return;
    }
    try {
      await navigator.clipboard.writeText(webToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const buildEnvTemplate = () => {
    const base = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai') : 'https://api.builderforce.ai';
    const apiUrl = base.replace(/\/+$/, '');
    return [
      `BUILDERFORCE_API_URL=${apiUrl}`,
      `BUILDERFORCE_WEB_TOKEN=${webToken ?? ''}`,
      'BUILDERFORCE_TENANT_TOKEN=',
      'BUILDERFORCE_TENANT_ID=',
    ].join('\n');
  };

  const copyEnvTemplate = async () => {
    if (!webToken) {
      setErrorMsg('No superadmin web token found for this session.');
      return;
    }
    try {
      await navigator.clipboard.writeText(buildEnvTemplate());
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const downloadEnvTemplate = () => {
    if (!webToken) {
      setErrorMsg('No superadmin web token found for this session.');
      return;
    }
    try {
      const blob = new Blob([`${buildEnvTemplate()}\n`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'builderforce.superadmin.env';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadedEnv(true);
      setTimeout(() => setDownloadedEnv(false), 2000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const startImpersonate = (u: AdminUser) => {
    setImpersonateUser(u);
    setImpersonateWorkspaces([]);
    setImpersonateReason('');
    setImpersonateDebugger(false);
    setImpersonateWorkspacesLoading(true);
    adminApi.userWorkspaces(u.id)
      .then(setImpersonateWorkspaces)
      .catch(() => setErrorMsg('Failed to load user workspaces'))
      .finally(() => setImpersonateWorkspacesLoading(false));
  };

  const doImpersonate = async () => {
    const defaultWorkspace = impersonateWorkspaces[0];
    if (!impersonateUser || !defaultWorkspace || !impersonateReason.trim()) return;
    setImpersonateBusy(true);
    setErrorMsg('');
    try {
      const res = await adminApi.impersonationStart(
        impersonateUser.id,
        defaultWorkspace.tenantId,
        impersonateReason.trim(),
        impersonateDebugger,
      );
      startEmulation(res.session, res.emulationToken);
      setImpersonateUser(null);
      router.push('/dashboard');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setImpersonateBusy(false);
    }
  };

  const closeImpersonate = () => {
    setImpersonateUser(null);
    setImpersonateWorkspaces([]);
    setImpersonateReason('');
    setImpersonateDebugger(false);
  };

  const composeMailto = (email: string, subject: string, body: string) => {
    const q = new URLSearchParams({ subject, body });
    return `mailto:${encodeURIComponent(email)}?${q.toString()}`;
  };

  const handleSecurityTenantChange = (tid: number | null) => {
    setSecurityTenantId(tid);
    setSecurityUserId(null);
    setSecurityDetails(null);
    if (!tid) {
      setSecurityUsers([]);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    adminApi
      .securityUsers(tid)
      .then(setSecurityUsers)
      .catch((e) => setErrorMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const handleSecurityUserSelect = (uid: string | null) => {
    setSecurityUserId(uid);
    if (!uid || !securityTenantId) {
      setSecurityDetails(null);
      return;
    }
    setLoading(true);
    adminApi
      .securityDetails(securityTenantId, uid)
      .then(setSecurityDetails)
      .catch((e) => setErrorMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const handlePublishTerms = async () => {
    if (!legalPublishVersion.trim() || !legalPublishContent.trim()) {
      setErrorMsg('Version and content are required.');
      return;
    }
    setLegalPublishing(true);
    setErrorMsg('');
    try {
      await adminApi.publishTerms({
        version: legalPublishVersion.trim(),
        title: legalPublishTitle.trim() || 'Terms of Use',
        content: legalPublishContent.trim(),
      });
      setLegalCurrent(await adminApi.legalCurrent());
      setLegalPublishVersion('');
      setLegalPublishContent('');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLegalPublishing(false);
    }
  };

  if (!isAuthenticated || !isSuperadmin) return null;

  return (
    <div className="admin-page">
      <h1 className="page-title">Platform Admin</h1>
      <p className="page-sub">Health, users, tenants, errors, LLM usage, and superadmin token.</p>

      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => loadTab(t)}
            className={`admin-tab ${tab === t ? 'active' : ''}`}
          >
            {TAB_LABELS[t] ?? (t.charAt(0).toUpperCase() + t.slice(1))}
          </button>
        ))}
      </nav>

      {errorMsg && (
        <div className="alert alert-error" role="alert">
          {errorMsg}
        </div>
      )}

      <div className="admin-content">
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : (
          <>
            {tab === 'health' && health && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span className="text-muted" style={{ fontSize: 14 }}>Last updated: {health.timestamp ? fmtDateTime(health.timestamp) : '—'}</span>
                  <button type="button" className="btn-ghost" onClick={() => loadTab('health')}>↻ Refresh</button>
                </div>
                <div className={`health-card ${health.db.ok ? 'health-ok' : 'health-degraded'}`} style={{ padding: 16 }}>
                  <div className="health-label">System Status</div>
                  <div className="health-value" style={{ fontSize: 18 }}>{health.db.ok ? 'OK' : 'Degraded'}</div>
                  <div style={{ fontSize: 12 }}>DB latency: {health.db.latencyMs} ms</div>
                </div>
                <div className="health-grid">
                  <div className="health-card">
                    <div className="health-label">Users</div>
                    <div className="health-value">{fmtNum(health.platform.userCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Tenants</div>
                    <div className="health-value">{fmtNum(health.platform.tenantCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Paid Workspaces</div>
                    <div className="health-value">{fmtNum(health.platform.paidTenantCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Claws</div>
                    <div className="health-value">{fmtNum(health.platform.clawCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Executions</div>
                    <div className="health-value">{fmtNum(health.platform.executionCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Errors (log)</div>
                    <div className="health-value">{fmtNum(health.platform.errorCount)}</div>
                    {health.platform.errorCount > 0 && (
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ marginTop: 4, fontSize: 12 }}
                        onClick={() => { setTab('errors'); loadTab('errors'); }}
                      >
                        View errors →
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="health-label" style={{ marginBottom: 12 }}>LLM pool ({health.llm.pool} models) — status by usage and errors</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <div className="health-label" style={{ marginBottom: 8 }}>Free models ({(health.llm.free ?? health.llm.models).length})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(health.llm.free ?? health.llm.models).map((m) => (
                          <span
                            key={`free-${m.model}`}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              background: m.available ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)',
                              color: m.available ? 'var(--success-text)' : 'var(--error-text)',
                            }}
                            title={m.cooldownUntil ? `Cooldown until ${new Date(m.cooldownUntil).toLocaleString()}` : m.available ? 'Available' : 'Unavailable (rate limit or error)'}
                          >
                            {m.preferred ? '★ ' : ''}{m.model}
                            {m.cooldownUntil && !m.available ? ' (cooldown)' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="health-label" style={{ marginBottom: 8 }}>Premium models ({health.llm.pro?.length ?? 0})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(health.llm.pro ?? []).map((m) => (
                          <span
                            key={`pro-${m.model}`}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              background: m.available ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)',
                              color: m.available ? 'var(--success-text)' : 'var(--error-text)',
                            }}
                            title={m.cooldownUntil ? `Cooldown until ${new Date(m.cooldownUntil).toLocaleString()}` : m.available ? 'Available' : 'Unavailable (rate limit or error)'}
                          >
                            {m.preferred ? '★ ' : ''}{m.model}
                            {m.cooldownUntil && !m.available ? ' (cooldown)' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Active Impersonation Sessions */}
                {activeSessionsLoaded && (
                  <div>
                    <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                        Active Emulation Sessions
                        {activeSessions.length > 0 && (
                          <span style={{ marginLeft: 8, background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 8px', fontSize: 12 }}>
                            {activeSessions.length}
                          </span>
                        )}
                      </h3>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          const sessions = await adminApi.impersonationList({ limit: 20 });
                          setActiveSessions(sessions.sessions.filter((s) => !s.endedAt));
                        }}
                      >
                        ↻
                      </button>
                    </div>
                    {activeSessions.length === 0 ? (
                      <p className="text-muted" style={{ fontSize: 13 }}>No active emulation sessions.</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="data-table" style={{ fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th>Target</th>
                              <th>Workspace</th>
                              <th>Role</th>
                              <th>Started</th>
                              <th>Pages</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeSessions.map((s) => (
                              <tr key={s.id}>
                                <td>{s.targetEmail}</td>
                                <td>{s.tenantName}</td>
                                <td><span className="badge badge-neutral">{s.roleOverride}</span></td>
                                <td className="text-muted">{fmtDateTime(s.startedAt)}</td>
                                <td>{s.pagesVisited.length}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    style={{ color: '#ef4444', fontSize: 12 }}
                                    onClick={async () => {
                                      try {
                                        await adminApi.impersonationEnd(s.id);
                                        setActiveSessions((prev) => prev.filter((x) => x.id !== s.id));
                                      } catch (e) { setErrorMsg(e instanceof Error ? e.message : String(e)); }
                                    }}
                                  >
                                    Terminate
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'users' && (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-muted" style={{ fontSize: 14 }}>{users.length} users</span>
                  <button type="button" className="btn-ghost" onClick={() => loadTab('users')}>
                    ↻ Refresh
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Username</th>
                        <th>Workspaces</th>
                        <th>Joined</th>
                        <th>Role</th>
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
                              <span className="badge badge-danger">superadmin</span>
                            ) : (
                              <span className="badge badge-neutral">user</span>
                            )}
                          </td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="btn-ghost" onClick={() => setDrawerUser(u)}>
                              Details
                            </button>
                            {!u.isSuperadmin && (
                              <button type="button" className="btn-ghost" onClick={() => startImpersonate(u)}>
                                Emulate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'tenants' && (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-muted" style={{ fontSize: 14 }}>{tenants.length} workspaces</span>
                  <button type="button" className="btn-ghost" onClick={() => loadTab('tenants')}>
                    ↻ Refresh
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 24 }}></th>
                        <th>Name</th>
                        <th>Slug</th>
                        <th>Status</th>
                        <th>Plan</th>
                        <th>Billing</th>
                        <th>Members</th>
                        <th>Claws</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenants.map((t) => (
                        <React.Fragment key={t.id}>
                          <tr
                            role="button"
                            tabIndex={0}
                            style={{ cursor: 'pointer' }}
                            onClick={async () => {
                              if (expandedTenantId === t.id) {
                                setExpandedTenantId(null);
                                return;
                              }
                              setExpandedTenantId(t.id);
                              if (!tenantMembersMap[t.id]) {
                                try {
                                  const members = await adminApi.tenantMembers(t.id);
                                  setTenantMembersMap((prev) => ({ ...prev, [t.id]: members }));
                                } catch (e) {
                                  setErrorMsg(e instanceof Error ? e.message : String(e));
                                }
                              }
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                          >
                            <td style={{ verticalAlign: 'middle' }}>
                              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: expandedTenantId === t.id ? 'rotate(90deg)' : 'none' }}>▶</span>
                            </td>
                            <td>{t.name}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{t.slug}</td>
                            <td>
                              <span className={`badge ${t.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                                {t.status}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${t.effectivePlan === 'pro' ? 'badge-danger' : 'badge-neutral'}`}>
                                {t.effectivePlan}
                              </span>
                            </td>
                            <td className="text-muted">{t.billingStatus}</td>
                            <td>{t.memberCount}</td>
                            <td>{t.clawCount}</td>
                            <td className="text-muted">{fmtDate(t.createdAt)}</td>
                          </tr>
                          {expandedTenantId === t.id && (
                            <tr>
                              <td colSpan={9} style={{ padding: 0, background: 'var(--bg-elevated)' }}>
                                <div style={{ padding: '8px 16px 12px 40px' }}>
                                  {!tenantMembersMap[t.id] ? (
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading members…</span>
                                  ) : tenantMembersMap[t.id].length === 0 ? (
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No members.</span>
                                  ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                      <thead>
                                        <tr>
                                          <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Email</th>
                                          <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Role</th>
                                          <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>Joined</th>
                                          <th style={{ padding: '4px 8px' }}></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {tenantMembersMap[t.id].map((m) => (
                                          <tr key={m.id}>
                                            <td style={{ padding: '4px 8px' }}>{m.email}</td>
                                            <td style={{ padding: '4px 8px' }}>
                                              <span className="badge badge-neutral" style={{ fontSize: 10 }}>{m.role}</span>
                                            </td>
                                            <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{fmtDate(m.joinedAt)}</td>
                                            <td style={{ padding: '4px 8px' }}>
                                              <button
                                                type="button"
                                                className="btn-ghost"
                                                style={{ fontSize: 11, padding: '2px 8px' }}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  // Build a minimal AdminUser from TenantMember for the modal
                                                  const adminUser: AdminUser = {
                                                    id: m.id,
                                                    email: m.email,
                                                    username: m.username,
                                                    displayName: m.displayName,
                                                    isSuperadmin: false,
                                                    createdAt: m.joinedAt,
                                                    tenantCount: 1,
                                                  };
                                                  setImpersonateUser(adminUser);
                                                  setImpersonateTenantId(t.id);
                                                  setImpersonateRole(m.role);
                                                  setImpersonateReason('');
                                                  setImpersonateDebugger(false);
                                                }}
                                              >
                                                Emulate
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'errors' && (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-muted" style={{ fontSize: 14 }}>Last 200 errors</span>
                  <button type="button" className="btn-ghost" onClick={() => loadTab('errors')}>
                    ↻ Refresh
                  </button>
                </div>
                {errors.length === 0 ? (
                  <p className="text-muted" style={{ padding: 24 }}>No errors recorded.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 24 }}></th>
                          <th>Time</th>
                          <th>Method</th>
                          <th>Path</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.map((e) => (
                          <React.Fragment key={e.id}>
                            <tr
                              role="button"
                              tabIndex={0}
                              onClick={() => setExpandedErrorId(expandedErrorId === e.id ? null : e.id)}
                              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setExpandedErrorId(expandedErrorId === e.id ? null : e.id); } }}
                              style={{ cursor: 'pointer' }}
                            >
                              <td style={{ verticalAlign: 'middle' }}>
                                <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: expandedErrorId === e.id ? 'rotate(90deg)' : 'none' }}>▶</span>
                              </td>
                              <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                              <td>{e.method ?? '—'}</td>
                              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{e.path ?? '—'}</td>
                              <td style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.message ?? undefined}>
                                {e.message ?? '—'}
                              </td>
                            </tr>
                            {expandedErrorId === e.id && e.stack && (
                              <tr>
                                <td colSpan={5} style={{ padding: 0, verticalAlign: 'top' }}>
                                  <pre style={{ margin: 0, padding: 12, fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                    {e.stack}
                                  </pre>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'usage' && llmUsage && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div className="health-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                  <div className="health-card">
                    <div className="health-label">Requests</div>
                    <div className="health-value">{fmtNum(llmUsage.totals.requests)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Total tokens</div>
                    <div className="health-value">{fmtNum(llmUsage.totals.totalTokens)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Models</div>
                    <div className="health-value">{llmUsage.totals.modelCount}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Spend</div>
                    <div className="health-value">$0</div>
                    <div style={{ fontSize: 12 }}>free tier</div>
                  </div>
                </div>
                {llmUsage.daily.length > 0 && (
                  <div>
                    <div className="health-label" style={{ marginBottom: 8 }}>Daily requests</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minHeight: 120 }}>
                      {llmUsage.daily.slice(-30).map((d) => {
                        const maxReq = Math.max(1, ...llmUsage!.daily.map((x) => x.requests));
                        const h = maxReq ? (d.requests / maxReq) * 100 : 0;
                        return (
                          <div
                            key={d.day}
                            title={`${d.day}: ${d.requests} requests`}
                            style={{
                              flex: 1,
                              minWidth: 8,
                              height: `${Math.max(4, h)}%`,
                              background: 'var(--accent)',
                              borderRadius: 4,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span>{llmUsage.daily[llmUsage.daily.length - 30]?.day ?? ''}</span>
                      <span>{llmUsage.daily[llmUsage.daily.length - 1]?.day ?? ''}</span>
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="text-muted" style={{ fontSize: 14 }}>By model — last</span>
                    <select
                      value={usageDays}
                      onChange={async (e) => {
                        const days = Number(e.target.value);
                        setUsageDays(days);
                        setLoading(true);
                        setErrorMsg('');
                        try {
                          setLlmUsage(await adminApi.llmUsage(days));
                        } catch (err) {
                          setErrorMsg(err instanceof Error ? err.message : String(err));
                        } finally {
                          setLoading(false);
                        }
                      }}
                      className="admin-select"
                    >
                      {[7, 14, 30, 60, 90].map((d) => (
                        <option key={d} value={d}>{d} days</option>
                      ))}
                    </select>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th style={{ textAlign: 'right' }}>Requests</th>
                          <th style={{ textAlign: 'right' }}>Retries</th>
                          <th style={{ textAlign: 'right' }}>Streamed</th>
                          <th style={{ textAlign: 'right' }}>Prompt tokens</th>
                          <th style={{ textAlign: 'right' }}>Completion tokens</th>
                          <th style={{ textAlign: 'right' }}>Total tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {llmUsage.byModel.length === 0 ? (
                          <tr><td colSpan={7} className="text-muted" style={{ padding: 24 }}>No usage in this period.</td></tr>
                        ) : (
                          llmUsage.byModel.map((m) => (
                            <tr key={m.model}>
                              <td>{m.model}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(m.requests)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(m.retries)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(m.streamed_requests)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(m.prompt_tokens)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(m.completion_tokens)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtNum(m.total_tokens)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        {llmUsage.byModel.length > 0 && (
                          <tr style={{ fontWeight: 600 }}>
                            <td>Total</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.requests)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.byModel.reduce((s, m) => s + m.retries, 0))}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.byModel.reduce((s, m) => s + m.streamed_requests, 0))}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.promptTokens)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.completionTokens)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(llmUsage.totals.totalTokens)}</td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="health-label" style={{ marginBottom: 8 }}>Failover events</div>
                  {llmUsage.failovers.length === 0 ? (
                    <p className="text-muted" style={{ fontSize: 13 }}>No failover events in this period.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="data-table" style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>Model</th>
                            <th style={{ textAlign: 'right' }}>HTTP code</th>
                            <th style={{ textAlign: 'right' }}>Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {llmUsage.failovers.map((f, i) => (
                            <tr key={`${f.model}-${f.errorCode}-${i}`}>
                              <td>{f.model}</td>
                              <td style={{ textAlign: 'right' }}>{f.errorCode}</td>
                              <td style={{ textAlign: 'right' }}>{f.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'billing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div className="health-grid">
                  <div className="health-card">
                    <div className="health-label">Paid Workspaces</div>
                    <div className="health-value">
                      {tenants.filter((t) => t.billingStatus === 'active' && t.effectivePlan === 'pro').length}
                    </div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Past Due</div>
                    <div className="health-value">{tenants.filter((t) => t.billingStatus === 'past_due').length}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Pending Billing</div>
                    <div className="health-value">{tenants.filter((t) => t.billingStatus === 'pending').length}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Upgrade Leads</div>
                    <div className="health-value">{tenants.filter((t) => t.effectivePlan === 'free').length}</div>
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-muted">
                      Invoice queue ({tenants.filter((t) => ['active', 'past_due', 'pending'].includes(t.billingStatus)).length})
                    </span>
                    <button type="button" className="btn-ghost" onClick={() => loadTab('billing')}>↻ Refresh</button>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Workspace</th>
                          <th>Plan</th>
                          <th>Billing</th>
                          <th>Billing Email</th>
                          <th>Updated</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {tenants
                          .filter((t) => ['active', 'past_due', 'pending'].includes(t.billingStatus))
                          .map((t) => (
                            <tr key={t.id}>
                              <td>{t.name}</td>
                              <td>
                                <span className={`badge ${t.effectivePlan === 'pro' ? 'badge-success' : 'badge-neutral'}`}>
                                  {t.effectivePlan}
                                </span>
                              </td>
                              <td className="text-muted">{t.billingStatus}</td>
                              <td className="text-muted">{t.billingEmail ?? '—'}</td>
                              <td className="text-muted">
                                {t.billingUpdatedAt ? fmtDateTime(t.billingUpdatedAt) : '—'}
                              </td>
                              <td>
                                {t.billingEmail ? (
                                  <>
                                    <a
                                      className="btn-ghost"
                                      href={composeMailto(
                                        t.billingEmail,
                                        'Builderforce billing invoice',
                                        'Hi team,\n\nYour latest Builderforce invoice is ready.\n\nThanks,\nBuilderforce Billing'
                                      )}
                                    >
                                      Send invoice
                                    </a>
                                    <a
                                      className="btn-ghost"
                                      href={composeMailto(
                                        t.billingEmail,
                                        'Action needed: billing update',
                                        'Hi team,\n\nPlease update payment details to keep Pro features active.\n\nThanks,\nBuilderforce Billing'
                                      )}
                                    >
                                      Reminder
                                    </a>
                                  </>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: 12 }}>No billing email</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <span className="text-muted">Upgrade communications (free workspaces)</span>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Workspace</th>
                          <th>Billing Email</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {tenants
                          .filter((t) => t.effectivePlan === 'free')
                          .map((t) => (
                            <tr key={t.id}>
                              <td>{t.name}</td>
                              <td className="text-muted">{t.billingEmail ?? '—'}</td>
                              <td>
                                {t.billingEmail ? (
                                  <a
                                    className="btn-ghost"
                                    href={composeMailto(
                                      t.billingEmail,
                                      'Upgrade to Builderforce Pro',
                                      'Hi team,\n\nUpgrade to Pro for more capacity and features.\n\nThanks,\nBuilderforce'
                                    )}
                                  >
                                    Send upgrade message
                                  </a>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: 12 }}>No billing email</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <span className="text-muted">Feedback & issues ({errors.slice(0, 20).length})</span>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ marginLeft: 8 }}
                      onClick={() => loadTab('errors')}
                    >
                      Open full error log
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th>Path</th>
                          <th>Message</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.slice(0, 20).map((e) => (
                          <tr key={e.id}>
                            <td>{e.method ?? '—'}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{e.path ?? '—'}</td>
                            <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.message ?? '—'}</td>
                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === 'security' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <label className="text-muted" style={{ fontSize: 14 }}>Workspace</label>
                  <select
                    className="admin-select"
                    value={securityTenantId ?? ''}
                    onChange={(e) => handleSecurityTenantChange(Number(e.target.value) || null)}
                  >
                    <option value="">Select…</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {securityTenantId && (
                    <>
                      <label className="text-muted" style={{ fontSize: 14 }}>User</label>
                      <select
                        className="admin-select"
                        value={securityUserId ?? ''}
                        onChange={(e) => handleSecurityUserSelect(e.target.value || null)}
                        style={{ minWidth: 200 }}
                      >
                        <option value="">Select user…</option>
                        {securityUsers.map((u) => (
                          <option key={u.id} value={u.id}>{u.email}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <button type="button" className="btn-ghost" onClick={() => loadTab('security')}>↻ Refresh</button>
                </div>
                {securityTenantId && (
                  <>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Email</th>
                            <th>MFA</th>
                            <th>Sessions</th>
                            <th>Tokens</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {securityUsers.map((u) => (
                            <tr key={u.id}>
                              <td>{u.email}</td>
                              <td>{u.mfaEnabled ? '✓' : '—'}</td>
                              <td>{u.activeSessions}</td>
                              <td>{u.activeTokens}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => handleSecurityUserSelect(securityUserId === u.id ? null : u.id)}
                                >
                                  {securityUserId === u.id ? 'Hide details' : 'Details'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {securityDetails && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div className="health-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                          <div className="health-card" style={{ padding: 12 }}>
                            <div className="health-label">User</div>
                            <div style={{ fontSize: 14 }}>{securityDetails.user.email}</div>
                          </div>
                          <div className="health-card" style={{ padding: 12 }}>
                            <div className="health-label">MFA</div>
                            <div style={{ fontSize: 14 }}>{securityDetails.mfa.enabled ? 'Enabled' : 'Off'}</div>
                          </div>
                          <div className="health-card" style={{ padding: 12 }}>
                            <div className="health-label">Active sessions</div>
                            <div className="health-value">{securityDetails.sessions.length}</div>
                          </div>
                          <div className="health-card" style={{ padding: 12 }}>
                            <div className="health-label">Active tokens</div>
                            <div className="health-value">{securityDetails.tokens.length}</div>
                          </div>
                        </div>
                        <div className="health-card" style={{ padding: 16 }}>
                          <div className="health-label" style={{ marginBottom: 12 }}>MFA</div>
                          {!securityDetails.mfa.enabled && !securityDetails.mfa.setupPending && (
                            <button
                              type="button"
                              className="admin-tab"
                              onClick={async () => {
                                setErrorMsg('');
                                try {
                                  const r = await adminApi.securityMfaSetup(securityTenantId!, securityUserId!);
                                  setSecurityMfaManualKey(r.manualEntryKey ?? '');
                                  window.open(r.otpauthUrl);
                                  setErrorMsg('Scan QR in the opened tab (or use manual key below). Enter 6-digit code and click Enable MFA.');
                                  handleSecurityUserSelect(securityUserId);
                                } catch (e) {
                                  setErrorMsg(e instanceof Error ? e.message : String(e));
                                }
                              }}
                            >
                              Set up MFA
                            </button>
                          )}
                          {!securityDetails.mfa.enabled && securityDetails.mfa.setupPending && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {securityMfaManualKey && (
                                <div style={{ fontSize: 12 }}>
                                  <span className="text-muted">Manual entry key: </span>
                                  <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>{securityMfaManualKey}</code>
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  type="text"
                                  placeholder="6-digit code"
                                  value={securityMfaCode}
                                  onChange={(e) => setSecurityMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                  className="admin-select"
                                  style={{ width: 120 }}
                                />
                                <button
                                  type="button"
                                  className="admin-tab active"
                                  disabled={securityMfaCode.length !== 6}
                                  onClick={async () => {
                                    setErrorMsg('');
                                    try {
                                      const r = await adminApi.securityMfaEnable(securityTenantId!, securityUserId!, securityMfaCode);
                                      setSecurityRecoveryCodes(r.recoveryCodes ?? []);
                                      setSecurityMfaCode('');
                                      setSecurityMfaManualKey('');
                                      setErrorMsg('');
                                      handleSecurityUserSelect(securityUserId);
                                    } catch (e) {
                                      setErrorMsg(e instanceof Error ? e.message : String(e));
                                    }
                                  }}
                                >
                                  Enable MFA
                                </button>
                              </div>
                            </div>
                          )}
                          {securityDetails.mfa.enabled && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label className="text-muted" style={{ fontSize: 12 }}>Disable with:</label>
                                <select
                                  className="admin-select"
                                  value={securityMfaMode}
                                  onChange={(e) => setSecurityMfaMode(e.target.value as 'totp' | 'recovery')}
                                  style={{ width: 100 }}
                                >
                                  <option value="totp">TOTP code</option>
                                  <option value="recovery">Recovery code</option>
                                </select>
                                <input
                                  type="text"
                                  placeholder={securityMfaMode === 'totp' ? '6-digit code' : 'Recovery code'}
                                  value={securityMfaMode === 'totp' ? securityMfaCode : securityRecoveryCode}
                                  onChange={(e) =>
                                    securityMfaMode === 'totp'
                                      ? setSecurityMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                      : setSecurityRecoveryCode(e.target.value)
                                  }
                                  className="admin-select"
                                  style={{ width: 160 }}
                                />
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={async () => {
                                    setErrorMsg('');
                                    try {
                                      await adminApi.securityMfaDisable(securityTenantId!, securityUserId!, securityMfaMode === 'totp' ? { code: securityMfaCode } : { recoveryCode: securityRecoveryCode });
                                      setSecurityMfaCode('');
                                      setSecurityRecoveryCode('');
                                      handleSecurityUserSelect(securityUserId);
                                    } catch (e) {
                                      setErrorMsg(e instanceof Error ? e.message : String(e));
                                    }
                                  }}
                                >
                                  Disable MFA
                                </button>
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className="text-muted" style={{ fontSize: 12 }}>Regenerate recovery codes:</span>
                                <input
                                  type="text"
                                  placeholder={securityMfaMode === 'totp' ? '6-digit code' : 'Recovery code'}
                                  value={securityMfaMode === 'totp' ? securityMfaCode : securityRecoveryCode}
                                  onChange={(e) =>
                                    securityMfaMode === 'totp'
                                      ? setSecurityMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                      : setSecurityRecoveryCode(e.target.value)
                                  }
                                  className="admin-select"
                                  style={{ width: 160 }}
                                />
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={async () => {
                                    setErrorMsg('');
                                    try {
                                      const r = await adminApi.securityRegenerateRecoveryCodes(securityTenantId!, securityUserId!, securityMfaMode === 'totp' ? { code: securityMfaCode } : { recoveryCode: securityRecoveryCode });
                                      setSecurityRecoveryCodes(r.recoveryCodes ?? []);
                                      handleSecurityUserSelect(securityUserId);
                                    } catch (e) {
                                      setErrorMsg(e instanceof Error ? e.message : String(e));
                                    }
                                  }}
                                >
                                  Regenerate
                                </button>
                              </div>
                              {securityRecoveryCodes.length > 0 && (
                                <div style={{ fontSize: 12 }}>
                                  <div className="health-label">Recovery codes (save these)</div>
                                  <pre style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, overflow: 'auto' }}>{securityRecoveryCodes.join('\n')}</pre>
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    style={{ marginTop: 4 }}
                                    onClick={() => {
                                      const blob = new Blob([securityRecoveryCodes.join('\n')], { type: 'text/plain' });
                                      const a = document.createElement('a');
                                      a.href = URL.createObjectURL(blob);
                                      a.download = `recovery-codes-${securityDetails.user.email}-${new Date().toISOString().slice(0, 10)}.txt`;
                                      a.click();
                                      URL.revokeObjectURL(a.href);
                                    }}
                                  >
                                    Download recovery codes
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="health-card" style={{ padding: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div className="health-label">Sessions</div>
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={async () => {
                                setErrorMsg('');
                                try {
                                  await adminApi.securityRevokeAllSessions(securityTenantId!, securityUserId!);
                                  handleSecurityUserSelect(securityUserId);
                                } catch (e) {
                                  setErrorMsg(e instanceof Error ? e.message : String(e));
                                }
                              }}
                            >
                              Revoke all sessions
                            </button>
                          </div>
                          <div className="table-wrap">
                            <table className="data-table" style={{ fontSize: 13 }}>
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>User agent</th>
                                  <th>IP</th>
                                  <th>Tokens</th>
                                  <th>Last seen</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {securityDetails.sessions.filter((s) => s.isActive).map((s) => (
                                  <tr key={s.id}>
                                    <td>{s.sessionName ?? '—'}</td>
                                    <td className="text-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.userAgent ?? undefined}>{s.userAgent ?? '—'}</td>
                                    <td className="text-muted">{s.ipAddress ?? '—'}</td>
                                    <td>{s.activeTokens}</td>
                                    <td className="text-muted">{s.lastSeenAt ? fmtDateTime(s.lastSeenAt) : '—'}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={async () => {
                                          setErrorMsg('');
                                          try {
                                            await adminApi.securityRevokeSession(securityTenantId!, securityUserId!, s.id);
                                            handleSecurityUserSelect(securityUserId);
                                          } catch (e) {
                                            setErrorMsg(e instanceof Error ? e.message : String(e));
                                          }
                                        }}
                                      >
                                        Revoke
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="health-card" style={{ padding: 16 }}>
                          <div className="health-label" style={{ marginBottom: 12 }}>JWT tokens</div>
                          <div className="table-wrap">
                            <table className="data-table" style={{ fontSize: 13 }}>
                              <thead>
                                <tr>
                                  <th>jti</th>
                                  <th>Type</th>
                                  <th>Tenant</th>
                                  <th>Expires</th>
                                  <th>Active</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {securityDetails.tokens.filter((t) => t.isActive).map((tok) => (
                                  <tr key={tok.jti}>
                                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{tok.jti.slice(0, 12)}…</td>
                                    <td>{tok.tokenType}</td>
                                    <td className="text-muted">{tok.tenantId ?? '—'}</td>
                                    <td className="text-muted">{fmtDateTime(tok.expiresAt)}</td>
                                    <td>{tok.isActive ? '✓' : '—'}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={async () => {
                                          setErrorMsg('');
                                          try {
                                            await adminApi.securityRevokeToken(securityTenantId!, securityUserId!, tok.jti);
                                            handleSecurityUserSelect(securityUserId);
                                          } catch (e) {
                                            setErrorMsg(e instanceof Error ? e.message : String(e));
                                          }
                                        }}
                                      >
                                        Revoke
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === 'legal' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {legalCurrent && (
                  <>
                    <div className="health-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                      <div className="health-card" style={{ padding: 16 }}>
                        <div className="health-label">Terms version</div>
                        <div className="health-value" style={{ fontSize: 16 }}>v{legalCurrent.terms.version}</div>
                        <div style={{ fontSize: 12 }}>{legalCurrent.terms.title}</div>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          Published {legalCurrent.terms.publishedAt ? fmtDateTime(legalCurrent.terms.publishedAt) : '—'}
                        </div>
                      </div>
                      <div className="health-card" style={{ padding: 16 }}>
                        <div className="health-label">Privacy version</div>
                        <div className="health-value" style={{ fontSize: 16 }}>v{legalCurrent.privacy.version}</div>
                        <div style={{ fontSize: 12 }}>{legalCurrent.privacy.title}</div>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          Published {legalCurrent.privacy.publishedAt ? fmtDateTime(legalCurrent.privacy.publishedAt) : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="health-card" style={{ padding: 16 }}>
                      <div className="health-label">Current Terms (full text)</div>
                      <textarea
                        readOnly
                        value={legalCurrent.terms.content}
                        className="admin-token-textarea"
                        style={{ minHeight: 200, fontSize: 12 }}
                      />
                    </div>
                    <div className="health-card" style={{ padding: 16 }}>
                      <div className="health-label">Current Privacy (full text)</div>
                      <textarea
                        readOnly
                        value={legalCurrent.privacy.content}
                        className="admin-token-textarea"
                        style={{ minHeight: 200, fontSize: 12 }}
                      />
                    </div>
                  </>
                )}
                <div className="health-card" style={{ padding: 16 }}>
                  <div className="health-label">Publish new Terms</div>
                  <input
                    type="text"
                    placeholder="Version (e.g. 1.0.1)"
                    value={legalPublishVersion}
                    onChange={(e) => setLegalPublishVersion(e.target.value)}
                    className="admin-select"
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                  <input
                    type="text"
                    placeholder="Title"
                    value={legalPublishTitle}
                    onChange={(e) => setLegalPublishTitle(e.target.value)}
                    className="admin-select"
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                  <textarea
                    placeholder="Content (full text)"
                    value={legalPublishContent}
                    onChange={(e) => setLegalPublishContent(e.target.value)}
                    className="admin-token-textarea"
                    style={{ minHeight: 120, marginBottom: 8 }}
                  />
                  <button
                    type="button"
                    className="admin-tab active"
                    onClick={handlePublishTerms}
                    disabled={legalPublishing || !legalPublishVersion.trim() || !legalPublishContent.trim()}
                  >
                    {legalPublishing ? 'Publishing…' : 'Publish'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'newsletter' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div className="health-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <div className="health-card">
                    <div className="health-label">Subscribers</div>
                    <div className="health-value">{fmtNum(newsletterSubscribers.length)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Templates</div>
                    <div className="health-value">{newsletterTemplates.length}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Tracked events</div>
                    <div className="health-value">{fmtNum(newsletterEvents.length)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    className="admin-select"
                    value={newsletterStatusFilter}
                    onChange={(e) => {
                      setNewsletterStatusFilter(e.target.value as typeof newsletterStatusFilter);
                      loadTab('newsletter');
                    }}
                  >
                    <option value="all">All</option>
                    <option value="subscribed">Subscribed</option>
                    <option value="unsubscribed">Unsubscribed</option>
                    <option value="suppressed">Suppressed</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Search email"
                    value={newsletterSearch}
                    onChange={(e) => setNewsletterSearch(e.target.value)}
                    className="admin-select"
                    style={{ width: 180 }}
                  />
                  <button type="button" className="btn-ghost" onClick={() => loadTab('newsletter')}>↻ Refresh</button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>User</th>
                        <th>Subscribed</th>
                        <th>Unsubscribed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newsletterSubscribers.slice(0, 200).map((s) => (
                        <tr key={s.id}>
                          <td>{s.email}</td>
                          <td>
                            <span className={`badge ${s.status === 'subscribed' ? 'badge-success' : 'badge-neutral'}`}>
                              {s.status}
                            </span>
                          </td>
                          <td className="text-muted">{s.source}</td>
                          <td className="text-muted">{(s.userDisplayName || s.userUsername) ? `${s.userDisplayName ?? s.userUsername ?? ''} (${s.userUsername ?? ''})` : '—'}</td>
                          <td className="text-muted">{s.subscribedAt ? fmtDate(s.subscribedAt) : '—'}</td>
                          <td className="text-muted">{s.unsubscribedAt ? fmtDate(s.unsubscribedAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="health-card" style={{ padding: 16 }}>
                  <div className="health-label" style={{ marginBottom: 12 }}>Create template</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      placeholder="Name"
                      value={newsletterTemplateName}
                      onChange={(e) => setNewsletterTemplateName(e.target.value)}
                      className="admin-select"
                    />
                    <input
                      type="text"
                      placeholder="Subject"
                      value={newsletterTemplateSubject}
                      onChange={(e) => setNewsletterTemplateSubject(e.target.value)}
                      className="admin-select"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Preheader"
                    value={newsletterTemplatePreheader}
                    onChange={(e) => setNewsletterTemplatePreheader(e.target.value)}
                    className="admin-select"
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                  <textarea
                    placeholder="Body (Markdown)"
                    value={newsletterTemplateBody}
                    onChange={(e) => setNewsletterTemplateBody(e.target.value)}
                    className="admin-token-textarea"
                    style={{ minHeight: 120, marginBottom: 8 }}
                  />
                  <button
                    type="button"
                    className="admin-tab active"
                    disabled={newsletterTemplateBusy || !newsletterTemplateName.trim() || !newsletterTemplateSubject.trim() || !newsletterTemplateBody.trim()}
                    onClick={async () => {
                      setNewsletterTemplateBusy(true);
                      setErrorMsg('');
                      try {
                        await adminApi.createNewsletterTemplate({
                          name: newsletterTemplateName.trim(),
                          subject: newsletterTemplateSubject.trim(),
                          preheader: newsletterTemplatePreheader.trim() || undefined,
                          bodyMarkdown: newsletterTemplateBody.trim(),
                        });
                        setNewsletterTemplateName('');
                        setNewsletterTemplateSubject('');
                        setNewsletterTemplatePreheader('');
                        setNewsletterTemplateBody('');
                        await loadTab('newsletter');
                      } catch (e) {
                        setErrorMsg(e instanceof Error ? e.message : String(e));
                      } finally {
                        setNewsletterTemplateBusy(false);
                      }
                    }}
                  >
                    {newsletterTemplateBusy ? 'Saving…' : 'Save template'}
                  </button>
                </div>
                <div className="health-card" style={{ padding: 16 }}>
                  <div className="health-label" style={{ marginBottom: 12 }}>Track send</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      className="admin-select"
                      value={newsletterTrackTemplateId}
                      onChange={(e) => setNewsletterTrackTemplateId(e.target.value)}
                      style={{ minWidth: 180 }}
                    >
                      <option value="">Select template</option>
                      {newsletterTemplates.map((t) => (
                        <option key={t.id} value={String(t.id)}>{t.name}</option>
                      ))}
                    </select>
                    <input
                      type="email"
                      placeholder="Subscriber email"
                      value={newsletterTrackEmail}
                      onChange={(e) => setNewsletterTrackEmail(e.target.value)}
                      className="admin-select"
                      style={{ width: 220 }}
                    />
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={newsletterTrackBusy || !newsletterTrackTemplateId || !newsletterTrackEmail.trim()}
                      onClick={async () => {
                        setNewsletterTrackBusy(true);
                        setErrorMsg('');
                        try {
                          await adminApi.trackNewsletterEvent({
                            subscriberEmail: newsletterTrackEmail.trim(),
                            templateId: newsletterTrackTemplateId ? Number(newsletterTrackTemplateId) : undefined,
                            eventType: 'template_sent',
                          });
                          setNewsletterTrackEmail('');
                          await loadTab('newsletter');
                        } catch (e) {
                          setErrorMsg(e instanceof Error ? e.message : String(e));
                        } finally {
                          setNewsletterTrackBusy(false);
                        }
                      }}
                    >
                      {newsletterTrackBusy ? 'Sending…' : 'Track send'}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="health-label" style={{ marginBottom: 8 }}>Templates ({newsletterTemplates.length})</div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Slug</th>
                          <th>Subject</th>
                          <th>Active</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newsletterTemplates.map((t) => (
                          <tr key={t.id}>
                            <td>{t.name}</td>
                            <td style={{ fontFamily: 'var(--mono)' }}>{t.slug}</td>
                            <td>{t.subject}</td>
                            <td>{t.isActive ? '✓' : '—'}</td>
                            <td className="text-muted">{t.updatedAt ? fmtDateTime(t.updatedAt) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="health-label" style={{ marginBottom: 8 }}>Recent events ({newsletterEvents.length})</div>
                  <div className="table-wrap">
                    <table className="data-table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Email</th>
                          <th>Event</th>
                          <th>Template</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newsletterEvents.slice(0, 100).map((ev) => (
                          <tr key={ev.id}>
                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{ev.createdAt ? fmtDateTime(ev.createdAt) : '—'}</td>
                            <td>{ev.email}</td>
                            <td>{ev.eventType}</td>
                            <td className="text-muted">{ev.templateSlug ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === 'privacy' && (
              <div>
                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    className="admin-select"
                    value={privacyStatusFilter}
                    onChange={(e) => {
                      setPrivacyStatusFilter(e.target.value);
                      loadTab('privacy');
                    }}
                  >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                    <option value="closed">Closed</option>
                  </select>
                  <select
                    className="admin-select"
                    value={privacyTypeFilter}
                    onChange={(e) => {
                      setPrivacyTypeFilter(e.target.value);
                      loadTab('privacy');
                    }}
                  >
                    <option value="">All types</option>
                    <option value="ccpa">CCPA</option>
                    <option value="gdpr">GDPR</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Search email"
                    value={privacySearch}
                    onChange={(e) => setPrivacySearch(e.target.value)}
                    className="admin-select"
                    style={{ width: 180 }}
                  />
                  <button type="button" className="btn-ghost" onClick={() => loadTab('privacy')}>Search / Refresh</button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Requested</th>
                        <th>Details</th>
                        <th>Resolution</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {privacyRequests.map((r) => (
                        <tr key={r.id}>
                          <td>{r.email}</td>
                          <td>{r.requestType}</td>
                          <td>
                            <span className={`badge ${r.status === 'pending' ? 'badge-neutral' : r.status === 'completed' ? 'badge-success' : 'badge-neutral'}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="text-muted">{r.createdAt ? fmtDateTime(r.createdAt) : '—'}</td>
                          <td className="text-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.details ?? undefined}>{r.details ?? '—'}</td>
                          <td className="text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.resolution ?? undefined}>{r.resolution ?? '—'}</td>
                          <td>
                            {r.status === 'pending' && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={privacyUpdateBusy}
                                  onClick={async () => {
                                    setPrivacyUpdateBusy(true);
                                    setErrorMsg('');
                                    try {
                                      await adminApi.updatePrivacyRequest(r.id, { status: 'completed', resolution: 'Processed' });
                                      await loadTab('privacy');
                                    } catch (e) {
                                      setErrorMsg(e instanceof Error ? e.message : String(e));
                                    } finally {
                                      setPrivacyUpdateBusy(false);
                                    }
                                  }}
                                >
                                  Mark Resolved
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={privacyUpdateBusy}
                                  onClick={async () => {
                                    setPrivacyUpdateBusy(true);
                                    setErrorMsg('');
                                    try {
                                      await adminApi.updatePrivacyRequest(r.id, { status: 'closed', resolution: null });
                                      await loadTab('privacy');
                                    } catch (e) {
                                      setErrorMsg(e instanceof Error ? e.message : String(e));
                                    } finally {
                                      setPrivacyUpdateBusy(false);
                                    }
                                  }}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'personas' && (
              <div>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Platform Personas</h2>
                    <p className="text-muted" style={{ fontSize: 12 }}>
                      Create, edit, and delete personas available in the marketplace. Seed from built-in to copy defaults into the database.
                    </p>
                    <span className="text-muted" style={{ fontSize: 13 }}>{platformPersonas.length} platform personas</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="admin-tab active"
                      onClick={() => setPersonaForm({ name: '', slug: '', description: '', voice: '', perspective: '', decisionStyle: '', outputPrefix: '', capabilities: [], tags: [], source: 'builtin', author: 'Builderforce', active: true })}
                    >
                      Add persona
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={personaSeedBusy}
                      onClick={async () => {
                        setPersonaSeedBusy(true);
                        setErrorMsg('');
                        try {
                          for (const p of BUILTIN_PERSONAS as Persona[]) {
                            await adminApi.createPersona({
                              name: p.name,
                              slug: p.name,
                              description: p.description ?? null,
                              voice: p.voice ?? null,
                              perspective: p.perspective ?? null,
                              decisionStyle: p.decisionStyle ?? null,
                              outputPrefix: p.outputPrefix ?? null,
                              capabilities: p.capabilities ?? [],
                              tags: p.tags ?? [],
                              source: 'builtin',
                              author: p.author ?? 'Builderforce',
                              active: true,
                            });
                          }
                          await loadTab('personas');
                        } catch (e) {
                          setErrorMsg(e instanceof Error ? e.message : String(e));
                        } finally {
                          setPersonaSeedBusy(false);
                        }
                      }}
                    >
                      {personaSeedBusy ? 'Seeding…' : 'Seed from built-in'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => loadTab('personas')}>↻ Refresh</button>
                  </div>
                </div>
                {personaForm && (
                  <div className="health-card" style={{ padding: 16, marginBottom: 16 }}>
                    <div className="health-label" style={{ marginBottom: 8 }}>{personaForm.id ? 'Edit persona' : 'New persona'}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <input
                        placeholder="Name"
                        value={personaForm.name}
                        onChange={(e) => setPersonaForm((f) => f && { ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                        className="admin-select"
                      />
                      <input
                        placeholder="Slug"
                        value={personaForm.slug ?? ''}
                        onChange={(e) => setPersonaForm((f) => f && { ...f, slug: e.target.value })}
                        className="admin-select"
                      />
                    </div>
                    <input
                      placeholder="Output prefix (e.g. CODE:)"
                      value={personaForm.outputPrefix ?? ''}
                      onChange={(e) => setPersonaForm((f) => f && { ...f, outputPrefix: e.target.value })}
                      className="admin-select"
                      style={{ width: '100%', marginBottom: 8 }}
                    />
                    <input
                      placeholder="Voice"
                      value={personaForm.voice ?? ''}
                      onChange={(e) => setPersonaForm((f) => f && { ...f, voice: e.target.value })}
                      className="admin-select"
                      style={{ width: '100%', marginBottom: 8 }}
                    />
                    <textarea
                      placeholder="Description"
                      value={personaForm.description ?? ''}
                      onChange={(e) => setPersonaForm((f) => f && { ...f, description: e.target.value })}
                      className="admin-token-textarea"
                      style={{ minHeight: 60, marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="admin-tab active"
                        disabled={personaSaving || !personaForm.name?.trim()}
                        onClick={async () => {
                          if (!personaForm?.name?.trim()) return;
                          setPersonaSaving(true);
                          setErrorMsg('');
                          try {
                            if (personaForm.id) {
                              await adminApi.updatePersona(personaForm.id, {
                                name: personaForm.name.trim(),
                                slug: (personaForm.slug || personaForm.name).trim().toLowerCase().replace(/\s+/g, '-'),
                                description: personaForm.description?.trim() || null,
                                voice: personaForm.voice?.trim() || null,
                                perspective: personaForm.perspective?.trim() || null,
                                decisionStyle: personaForm.decisionStyle?.trim() || null,
                                outputPrefix: personaForm.outputPrefix?.trim() || null,
                                capabilities: personaForm.capabilities ?? [],
                                tags: personaForm.tags ?? [],
                                author: personaForm.author ?? null,
                                active: personaForm.active ?? true,
                              });
                            } else {
                              await adminApi.createPersona({
                                name: personaForm.name.trim(),
                                slug: (personaForm.slug || personaForm.name).trim().toLowerCase().replace(/\s+/g, '-'),
                                description: personaForm.description?.trim() || null,
                                voice: personaForm.voice?.trim() || null,
                                perspective: personaForm.perspective?.trim() || null,
                                decisionStyle: personaForm.decisionStyle?.trim() || null,
                                outputPrefix: personaForm.outputPrefix?.trim() || null,
                                capabilities: personaForm.capabilities ?? [],
                                tags: personaForm.tags ?? [],
                                source: 'builtin',
                                author: personaForm.author ?? 'Builderforce',
                                active: personaForm.active ?? true,
                              });
                            }
                            setPersonaForm(null);
                            await loadTab('personas');
                          } catch (e) {
                            setErrorMsg(e instanceof Error ? e.message : String(e));
                          } finally {
                            setPersonaSaving(false);
                          }
                        }}
                      >
                        {personaSaving ? 'Saving…' : personaForm.id ? 'Update' : 'Create'}
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => setPersonaForm(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Voice</th>
                        <th>Source</th>
                        <th>Prefix</th>
                        <th>Tags</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformPersonas.length === 0 ? (
                        <tr><td colSpan={6} className="text-muted" style={{ padding: 24 }}>No platform personas yet. Click &quot;Seed from built-in&quot; or &quot;Add persona&quot;.</td></tr>
                      ) : (
                        platformPersonas.map((p) => (
                          <tr key={p.id}>
                            <td style={{ fontWeight: 600 }}>🎭 {p.name}</td>
                            <td>{p.voice ?? '—'}</td>
                            <td>
                              <span className="badge" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', fontSize: 10, textTransform: 'uppercase' }}>{p.source}</span>
                            </td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{p.outputPrefix ?? '—'}</td>
                            <td>{(p.tags ?? []).join(', ') || '—'}</td>
                            <td>
                              <button type="button" className="btn-ghost" onClick={() => setPersonaForm({ ...p, name: p.name })}>Edit</button>
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={async () => {
                                  if (!confirm(`Delete persona "${p.name}"?`)) return;
                                  setErrorMsg('');
                                  try {
                                    await adminApi.deletePersona(p.id);
                                    await loadTab('personas');
                                  } catch (e) {
                                    setErrorMsg(e instanceof Error ? e.message : String(e));
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'governance' && (
              <div>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Governance</h2>
                    <p className="text-muted" style={{ fontSize: 12 }}>
                      View and edit project governance rules (markdown) across all workspaces.
                    </p>
                    <span className="text-muted" style={{ fontSize: 13 }}>{governanceProjects.length} projects</span>
                  </div>
                  <button type="button" className="btn-ghost" onClick={() => loadTab('governance')}>↻ Refresh</button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Project</th>
                        <th>Governance (preview)</th>
                        <th>Updated</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {governanceProjects.length === 0 ? (
                        <tr><td colSpan={5} className="text-muted" style={{ padding: 24 }}>No projects yet.</td></tr>
                      ) : (
                        governanceProjects.map((proj) => (
                          <tr key={proj.id}>
                            <td>{proj.tenantName ?? proj.tenantId}</td>
                            <td style={{ fontWeight: 600 }}>{proj.name}</td>
                            <td className="text-muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={proj.governance ?? undefined}>
                              {proj.governance ? (proj.governance.slice(0, 80) + (proj.governance.length > 80 ? '…' : '')) : '—'}
                            </td>
                            <td className="text-muted">{proj.updatedAt ? fmtDateTime(proj.updatedAt) : '—'}</td>
                            <td>
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => {
                                  setGovernanceEditId(proj.id);
                                  setGovernanceEditContent(proj.governance ?? '');
                                }}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {governanceEditId !== null && (
                  <div
                    className="admin-modal-overlay"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    role="dialog"
                    aria-modal="true"
                    onClick={() => { setGovernanceEditId(null); setGovernanceEditContent(''); }}
                  >
                    <div className="health-card" style={{ padding: 24, maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      <div className="page-title" style={{ marginBottom: 12 }}>Edit governance</div>
                      <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                        Project: {governanceProjects.find((p) => p.id === governanceEditId)?.name ?? governanceEditId}
                      </p>
                      <textarea
                        className="admin-token-textarea"
                        value={governanceEditContent}
                        onChange={(e) => setGovernanceEditContent(e.target.value)}
                        style={{ minHeight: 280, width: '100%', marginBottom: 16 }}
                        placeholder="Governance rules (markdown)"
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="admin-tab active"
                          disabled={governanceSaving}
                          onClick={async () => {
                            setGovernanceSaving(true);
                            setErrorMsg('');
                            try {
                              await adminApi.updateProjectGovernance(governanceEditId, governanceEditContent.trim() || null);
                              setGovernanceEditId(null);
                              setGovernanceEditContent('');
                              await loadTab('governance');
                            } catch (e) {
                              setErrorMsg(e instanceof Error ? e.message : String(e));
                            } finally {
                              setGovernanceSaving(false);
                            }
                          }}
                        >
                          {governanceSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => { setGovernanceEditId(null); setGovernanceEditContent(''); }}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'permissions' && permMatrix && (
              <div>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>Roles &amp; Permissions</h2>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="admin-tab"
                      onClick={async () => {
                        try {
                          const csv = await adminApi.permissionsMatrixExport();
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = 'permissions-matrix.csv'; a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) { setErrorMsg(e instanceof Error ? e.message : String(e)); }
                      }}
                    >
                      Export CSV
                    </button>
                    <button type="button" className="admin-tab" onClick={() => loadTab('permissions')}>↻ Refresh</button>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th>Permission</th>
                        {permMatrix.roles.map((r) => (
                          <th key={r} style={{ textAlign: 'center' }}>
                            {r}
                            {permEditRole === r ? (
                              <button
                                type="button"
                                className="admin-tab active"
                                style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11 }}
                                disabled={permSaving}
                                onClick={async () => {
                                  setPermSaving(true);
                                  setErrorMsg('');
                                  try {
                                    const overrides = Object.entries(permEditOverrides).map(([permission, granted]) => ({ permission, granted }));
                                    await adminApi.updateRolePermissions(r, overrides);
                                    setPermMatrix(await adminApi.permissionsMatrix());
                                    setPermEditRole(null);
                                    setPermEditOverrides({});
                                  } catch (e) { setErrorMsg(e instanceof Error ? e.message : String(e)); }
                                  finally { setPermSaving(false); }
                                }}
                              >
                                {permSaving ? 'Saving…' : 'Save'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="admin-tab"
                                style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11 }}
                                onClick={() => {
                                  setPermEditRole(r);
                                  const current: Record<string, boolean> = {};
                                  for (const p of permMatrix.permissions) {
                                    current[p] = (permMatrix.matrix[r] ?? []).includes(p);
                                  }
                                  setPermEditOverrides(current);
                                }}
                              >
                                Edit
                              </button>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {permMatrix.permissions.map((perm) => (
                        <tr key={perm}>
                          <td style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 12 }}>{perm}</td>
                          {permMatrix.roles.map((r) => {
                            const granted = permEditRole === r
                              ? permEditOverrides[perm] ?? false
                              : (permMatrix.matrix[r] ?? []).includes(perm);
                            return (
                              <td key={r} style={{ textAlign: 'center' }}>
                                {permEditRole === r ? (
                                  <input
                                    type="checkbox"
                                    checked={permEditOverrides[perm] ?? false}
                                    onChange={(e) => setPermEditOverrides((prev) => ({ ...prev, [perm]: e.target.checked }))}
                                  />
                                ) : (
                                  <span style={{ color: granted ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                                    {granted ? '✓' : '✗'}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {permEditRole && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button type="button" className="admin-tab" onClick={() => { setPermEditRole(null); setPermEditOverrides({}); }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'modules' && (
              <div>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>Platform Modules</h2>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="admin-tab active"
                      onClick={() => setModuleForm({ name: '', description: '', permissions: '' })}
                    >
                      + New Module
                    </button>
                    <button type="button" className="admin-tab" onClick={() => loadTab('modules')}>↻ Refresh</button>
                  </div>
                </div>
                {moduleForm && (
                  <div className="health-card" style={{ marginBottom: 16, padding: 16 }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>New Module</h3>
                    <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>Name *</label>
                    <input
                      className="admin-select"
                      value={moduleForm.name}
                      onChange={(e) => setModuleForm((f) => f ? { ...f, name: e.target.value } : f)}
                      placeholder="e.g. Reporting Access"
                      style={{ width: '100%', marginBottom: 10 }}
                    />
                    <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>Description</label>
                    <input
                      className="admin-select"
                      value={moduleForm.description}
                      onChange={(e) => setModuleForm((f) => f ? { ...f, description: e.target.value } : f)}
                      placeholder="Optional description"
                      style={{ width: '100%', marginBottom: 10 }}
                    />
                    <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>Permissions (comma-separated)</label>
                    <input
                      className="admin-select"
                      value={moduleForm.permissions}
                      onChange={(e) => setModuleForm((f) => f ? { ...f, permissions: e.target.value } : f)}
                      placeholder="e.g. report:read,report:export"
                      style={{ width: '100%', marginBottom: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" className="admin-tab" onClick={() => setModuleForm(null)}>Cancel</button>
                      <button
                        type="button"
                        className="admin-tab active"
                        disabled={!moduleForm.name.trim() || moduleFormBusy}
                        onClick={async () => {
                          if (!moduleForm.name.trim()) return;
                          setModuleFormBusy(true);
                          setErrorMsg('');
                          try {
                            await adminApi.createModule({
                              name: moduleForm.name.trim(),
                              description: moduleForm.description.trim() || null,
                              permissions: moduleForm.permissions.split(',').map((s) => s.trim()).filter(Boolean),
                            });
                            setPlatformModules(await adminApi.modules());
                            setModuleForm(null);
                          } catch (e) { setErrorMsg(e instanceof Error ? e.message : String(e)); }
                          finally { setModuleFormBusy(false); }
                        }}
                      >
                        {moduleFormBusy ? 'Creating…' : 'Create'}
                      </button>
                    </div>
                  </div>
                )}
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Slug</th>
                      <th>Permissions</th>
                      <th>Default</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {platformModules.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.slug}</td>
                        <td style={{ fontSize: 12, maxWidth: 280 }}>{m.permissions.join(', ') || '—'}</td>
                        <td>{m.defaultEnabled ? 'Yes' : 'No'}</td>
                        <td>{fmtDate(m.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-tab"
                            style={{ padding: '3px 10px', fontSize: 12, color: '#ef4444' }}
                            onClick={async () => {
                              if (!confirm(`Delete module "${m.name}"?`)) return;
                              setErrorMsg('');
                              try {
                                await adminApi.deleteModule(m.id);
                                setPlatformModules((prev) => prev.filter((x) => x.id !== m.id));
                              } catch (e) { setErrorMsg(e instanceof Error ? e.message : String(e)); }
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {platformModules.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No modules configured.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'impsessions' && (
              <div>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>
                    Impersonation Sessions
                    <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>{impSessionsTotal} total</span>
                  </h2>
                  <button type="button" className="admin-tab" onClick={() => loadTab('impsessions')}>↻ Refresh</button>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Workspace</th>
                      <th>Role</th>
                      <th>Reason</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Duration / Pages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impSessions.map((s) => {
                      const dur = s.endedAt
                        ? Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
                        : null;
                      const durStr = dur != null ? `${Math.floor(dur / 60)}m ${dur % 60}s` : 'Active';
                      return (
                        <tr key={s.id}>
                          <td style={{ fontSize: 13 }}>{s.targetEmail}</td>
                          <td style={{ fontSize: 12 }}>{s.tenantName}</td>
                          <td><span className="badge" style={{ background: 'var(--bg-card)' }}>{s.roleOverride}</span></td>
                          <td style={{ fontSize: 12, maxWidth: 200 }}>{s.reason}</td>
                          <td style={{ fontSize: 12 }}>{fmtDateTime(s.startedAt)}</td>
                          <td style={{ fontSize: 12 }}>{s.endedAt ? fmtDateTime(s.endedAt) : <span style={{ color: '#f59e0b' }}>Active</span>}</td>
                          <td style={{ fontSize: 12 }}>{durStr} / {s.pagesVisited.length} pages {s.writeBlockCount > 0 && <span style={{ color: '#ef4444' }}>({s.writeBlockCount} blocked writes)</span>}</td>
                        </tr>
                      );
                    })}
                    {impSessions.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No impersonation sessions found.</td></tr>
                    )}
                  </tbody>
                </table>
                {impSessionsTotal > 50 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={impSessionsOffset === 0}
                      onClick={() => { setImpSessionsOffset(Math.max(0, impSessionsOffset - 50)); loadTab('impsessions'); }}
                    >
                      ← Prev
                    </button>
                    <span style={{ fontSize: 13 }}>{impSessionsOffset + 1}–{Math.min(impSessionsOffset + 50, impSessionsTotal)} of {impSessionsTotal}</span>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={impSessionsOffset + 50 >= impSessionsTotal}
                      onClick={() => { setImpSessionsOffset(impSessionsOffset + 50); loadTab('impsessions'); }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'auditlog' && (
              <div>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>
                    Audit Log
                    <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>{auditTotal} total</span>
                  </h2>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="admin-select"
                      value={auditEventFilter}
                      onChange={(e) => setAuditEventFilter(e.target.value)}
                      placeholder="Filter by event…"
                      style={{ width: 200 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setAuditOffset(0); loadTab('auditlog'); } }}
                    />
                    <button type="button" className="admin-tab" onClick={() => { setAuditOffset(0); loadTab('auditlog'); }}>Filter</button>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={auditExporting}
                      onClick={async () => {
                        setAuditExporting(true);
                        setErrorMsg('');
                        try {
                          const csv = await adminApi.auditLogExport({ event: auditEventFilter || undefined });
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = 'audit-log.csv'; a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) { setErrorMsg(e instanceof Error ? e.message : String(e)); }
                        finally { setAuditExporting(false); }
                      }}
                    >
                      {auditExporting ? 'Exporting…' : 'Export CSV'}
                    </button>
                    <button type="button" className="admin-tab" onClick={() => { setAuditOffset(0); loadTab('auditlog'); }}>↻ Refresh</button>
                  </div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Actor</th>
                      <th>Target</th>
                      <th>Workspace</th>
                      <th>IP</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.event}</td>
                        <td style={{ fontSize: 12 }}>{e.actorEmail ?? e.actorId ?? '—'}</td>
                        <td style={{ fontSize: 12 }}>{e.targetEmail ?? e.targetUserId ?? '—'}</td>
                        <td style={{ fontSize: 12 }}>{e.tenantName ?? (e.tenantId ? String(e.tenantId) : '—')}</td>
                        <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{e.ipAddress ?? '—'}</td>
                        <td style={{ fontSize: 12 }}>{fmtDateTime(e.createdAt)}</td>
                      </tr>
                    ))}
                    {auditEntries.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No audit log entries found.</td></tr>
                    )}
                  </tbody>
                </table>
                {auditTotal > 50 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={auditOffset === 0}
                      onClick={() => { setAuditOffset(Math.max(0, auditOffset - 50)); loadTab('auditlog'); }}
                    >
                      ← Prev
                    </button>
                    <span style={{ fontSize: 13 }}>{auditOffset + 1}–{Math.min(auditOffset + 50, auditTotal)} of {auditTotal}</span>
                    <button
                      type="button"
                      className="admin-tab"
                      disabled={auditOffset + 50 >= auditTotal}
                      onClick={() => { setAuditOffset(auditOffset + 50); loadTab('auditlog'); }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'token' && (
              <div className="admin-token-card">
                <p className="page-sub" style={{ marginBottom: 12 }}>
                  This web token grants superadmin API access for your current session. Share only with trusted tooling.
                </p>
                <div className="admin-token-actions">
                  <button
                    type="button"
                    className="admin-tab"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? 'Hide token' : 'Show token'}
                  </button>
                  <button
                    type="button"
                    className="admin-tab"
                    onClick={copyToken}
                    disabled={!webToken}
                  >
                    {copiedToken ? 'Copied!' : 'Copy token'}
                  </button>
                  <button
                    type="button"
                    className="admin-tab"
                    onClick={copyEnvTemplate}
                    disabled={!webToken}
                  >
                    {copiedEnv ? 'Env copied!' : 'Copy env template'}
                  </button>
                  <button
                    type="button"
                    className="admin-tab"
                    onClick={downloadEnvTemplate}
                    disabled={!webToken}
                  >
                    {downloadedEnv ? 'Downloaded!' : 'Download .env file'}
                  </button>
                </div>
                {showToken ? (
                  <textarea
                    readOnly
                    value={webToken || 'No superadmin web token found'}
                    className="admin-token-textarea"
                  />
                ) : (
                  <div className="text-muted" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
                    {webToken ? '••••••••••••••••••••••••••••' : 'No superadmin web token found'}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Impersonate modal */}
      {impersonateUser && (
        <div
          className="admin-modal-overlay"
          onClick={closeImpersonate}
          role="dialog"
          aria-modal="true"
          aria-labelledby="impersonate-title"
        >
          <div
            className="admin-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="impersonate-title" className="page-title" style={{ marginBottom: 4 }}>
              Emulate User
            </h3>
            <p className="page-sub" style={{ marginBottom: 16 }}>
              Start an emulation session as <strong>{impersonateUser.email}</strong> using their default workspace and assigned role.
              You will be taken to the dashboard with an amber emulation bar.
            </p>

            {impersonateWorkspacesLoading ? (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>Loading workspace…</p>
            ) : impersonateWorkspaces.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 14, color: 'var(--error-text)' }}>
                This user has no active workspaces.
              </p>
            ) : (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--surface-alt, #1e1e2e)', borderRadius: 6, fontSize: 13 }}>
                <span style={{ opacity: 0.6, marginRight: 8 }}>Workspace:</span>
                <strong>{impersonateWorkspaces[0]!.name}</strong>
                <span style={{ opacity: 0.5, margin: '0 8px' }}>·</span>
                <span style={{ opacity: 0.6, marginRight: 8 }}>Role:</span>
                <strong>{impersonateWorkspaces[0]!.role}</strong>
              </div>
            )}

            <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>
              Reason <span style={{ color: 'var(--error-text)' }}>*</span>
            </label>
            <textarea
              value={impersonateReason}
              onChange={(e) => setImpersonateReason(e.target.value)}
              className="admin-token-textarea"
              placeholder="Brief reason for this emulation session (required)…"
              style={{ minHeight: 72, marginBottom: 14 }}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={impersonateDebugger}
                onChange={(e) => setImpersonateDebugger(e.target.checked)}
              />
              Enable permission debugger overlay
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="admin-tab" onClick={closeImpersonate} disabled={impersonateBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-tab active"
                onClick={doImpersonate}
                disabled={impersonateWorkspaces.length === 0 || !impersonateReason.trim() || impersonateBusy}
              >
                {impersonateBusy ? 'Starting…' : 'Start Emulation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Detail Drawer */}
      {drawerUser && (
        <UserDetailDrawer
          user={drawerUser}
          tenants={tenants}
          onClose={() => setDrawerUser(null)}
          onStartImpersonate={(u) => { setDrawerUser(null); startImpersonate(u); }}
        />
      )}
    </div>
  );
}
