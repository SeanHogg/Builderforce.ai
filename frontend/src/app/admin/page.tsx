'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
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
} from '@/lib/adminApi';
import { BUILTIN_PERSONAS, type Persona } from '@/lib/marketplaceData';

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
  'errors',
  'token',
];

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
  const [impersonateTenantId, setImpersonateTenantId] = useState<number | null>(null);
  const [impersonateResult, setImpersonateResult] = useState<{ token: string; email: string; role: string } | null>(null);

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

  const isSuperadmin = Boolean(user?.isSuperadmin);

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
        if (t === 'health') setHealth(await adminApi.health());
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
        else if (t === 'token' || t === 'personas' || t === 'governance') {
          /* no fetch */
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [usageDays, newsletterStatusFilter, newsletterSearch, privacyStatusFilter, privacyTypeFilter, privacySearch]
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
    setImpersonateTenantId(null);
    setImpersonateResult(null);
    if (tenants.length === 0) {
      adminApi.tenants().then(setTenants).catch(() => setErrorMsg('Failed to load tenants'));
    }
  };

  const doImpersonate = async () => {
    if (!impersonateUser || !impersonateTenantId) return;
    try {
      const res = await adminApi.impersonate(impersonateUser.id, impersonateTenantId);
      setImpersonateResult({ token: res.token, email: res.email, role: res.role });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const closeImpersonate = () => {
    setImpersonateUser(null);
    setImpersonateTenantId(null);
    setImpersonateResult(null);
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
            {t.charAt(0).toUpperCase() + t.slice(1)}
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
                          <td>
                            <button type="button" className="btn-ghost" onClick={() => startImpersonate(u)}>
                              Impersonate
                            </button>
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
                        <tr key={t.id}>
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
                <div style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>System Personas</h2>
                  <p className="text-muted" style={{ fontSize: 12 }}>
                    Manage built-in and marketplace personas available across all tenants.
                  </p>
                  <span className="text-muted" style={{ fontSize: 13 }}>{BUILTIN_PERSONAS.length} personas registered</span>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Voice</th>
                        <th>Source</th>
                        <th>Prefix</th>
                        <th>Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(BUILTIN_PERSONAS as Persona[]).map((p, i) => (
                        <tr key={p.name}>
                          <td style={{ fontWeight: 600 }}>🎭 {p.name}</td>
                          <td>{p.voice}</td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background: p.source === 'builtin' ? 'var(--accent-subtle)' : 'var(--success-bg)',
                                color: p.source === 'builtin' ? 'var(--accent)' : 'var(--success-text)',
                                fontSize: 10,
                                textTransform: 'uppercase',
                              }}
                            >
                              {p.source}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{p.outputPrefix}</td>
                          <td>{(p.tags ?? []).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'governance' && (
              <div style={{ padding: 24 }}>
                <div className="page-title" style={{ marginBottom: 8 }}>Governance</div>
                <p className="page-sub">
                  Project governance rules are managed per-tenant in the workspace view.
                </p>
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
            <h3 id="impersonate-title" className="page-title" style={{ marginBottom: 8 }}>Impersonate {impersonateUser.email}</h3>
            <p className="page-sub" style={{ marginBottom: 16 }}>
              Select a workspace to issue a tenant-scoped JWT for this user.
            </p>
            <select
              value={impersonateTenantId ?? ''}
              onChange={(e) => setImpersonateTenantId(Number(e.target.value) || null)}
              className="admin-select"
              style={{ width: '100%', marginBottom: 16 }}
            >
              <option value="">Select workspace…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
              ))}
            </select>
            {impersonateResult ? (
              <div style={{ marginBottom: 16 }}>
                <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Token issued for {impersonateResult.email} ({impersonateResult.role}).</p>
                <textarea
                  readOnly
                  value={impersonateResult.token}
                  className="admin-token-textarea"
                  style={{ minHeight: 60, fontSize: 11 }}
                />
                <p className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Use this token as Bearer in API requests; do not store it in the app.
                </p>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="admin-tab" onClick={closeImpersonate}>
                Close
              </button>
              {!impersonateResult && (
                <button
                  type="button"
                  className="admin-tab active"
                  onClick={doImpersonate}
                  disabled={!impersonateTenantId}
                >
                  Issue token
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
