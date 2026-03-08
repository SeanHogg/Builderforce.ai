'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [securityTenantId, setSecurityTenantId] = useState<number | null>(null);
  const [securityUsers, setSecurityUsers] = useState<AdminSecurityUser[]>([]);
  const [securityUserId, setSecurityUserId] = useState<string | null>(null);
  const [securityDetails, setSecurityDetails] = useState<AdminSecurityDetails | null>(null);

  const [legalPublishVersion, setLegalPublishVersion] = useState('');
  const [legalPublishTitle, setLegalPublishTitle] = useState('Terms of Use');
  const [legalPublishContent, setLegalPublishContent] = useState('');
  const [legalPublishing, setLegalPublishing] = useState(false);

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
    [usageDays, newsletterStatusFilter, newsletterSearch, privacyStatusFilter, privacyTypeFilter]
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

  const handleSecurityTenantChange = (tid: number) => {
    setSecurityTenantId(tid);
    setSecurityUserId(null);
    setSecurityDetails(null);
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
                <div className="health-grid">
                  <div className="health-card">
                    <div className="health-label">DB</div>
                    <div className="health-value">{health.db.ok ? 'OK' : 'Degraded'}</div>
                    <div style={{ fontSize: 12 }}>{health.db.latencyMs} ms</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Users</div>
                    <div className="health-value">{fmtNum(health.platform.userCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Tenants</div>
                    <div className="health-value">{fmtNum(health.platform.tenantCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Claws</div>
                    <div className="health-value">{fmtNum(health.platform.clawCount)}</div>
                  </div>
                  <div className="health-card">
                    <div className="health-label">Errors (log)</div>
                    <div className="health-value">{fmtNum(health.platform.errorCount)}</div>
                  </div>
                </div>
                <div>
                  <div className="health-label" style={{ marginBottom: 8 }}>LLM pool ({health.llm.pool} models)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {health.llm.models.map((m) => (
                      <span
                        key={m.model}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          fontSize: 12,
                          background: m.available ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)',
                          color: m.available ? 'var(--success-text)' : 'var(--error-text)',
                        }}
                      >
                        {m.preferred ? '★ ' : ''}{m.model}
                      </span>
                    ))}
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
                        <th>Plan</th>
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
                          <td>{t.effectivePlan}</td>
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
                <div className="table-wrap">
                  <table className="data-table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Method</th>
                        <th>Path</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errors.map((e) => (
                        <tr key={e.id}>
                          <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                          <td>{e.method ?? '—'}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{e.path ?? '—'}</td>
                          <td style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.message ?? undefined}>
                            {e.message ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                </div>
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
                          <th style={{ textAlign: 'right' }}>Prompt tokens</th>
                          <th style={{ textAlign: 'right' }}>Completion tokens</th>
                          <th style={{ textAlign: 'right' }}>Total tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {llmUsage.byModel.map((m) => (
                          <tr key={m.model}>
                            <td>{m.model}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(m.requests)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(m.prompt_tokens)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(m.completion_tokens)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtNum(m.total_tokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                    onChange={(e) => handleSecurityTenantChange(Number(e.target.value))}
                  >
                    <option value="">Select…</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
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
                      <div className="health-card" style={{ padding: 16 }}>
                        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{securityDetails.user.email}</h3>
                        <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                          MFA: {securityDetails.mfa.enabled ? 'Enabled' : 'Off'}
                          {securityDetails.mfa.setupPending && ' (setup pending)'}
                        </p>
                        <div style={{ fontSize: 12 }}>
                          <strong>Sessions:</strong> {securityDetails.sessions.length}
                          <strong style={{ marginLeft: 16 }}>Tokens:</strong> {securityDetails.tokens.length}
                        </div>
                        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {!securityDetails.mfa.enabled && (
                            <button
                              type="button"
                              className="admin-tab"
                              onClick={async () => {
                                try {
                                  const r = await adminApi.securityMfaSetup(securityTenantId!, securityUserId!);
                                  window.open(r.otpauthUrl);
                                  setErrorMsg('Complete MFA setup in the app with code from your authenticator.');
                                } catch (e) {
                                  setErrorMsg(e instanceof Error ? e.message : String(e));
                                }
                              }}
                            >
                              MFA setup
                            </button>
                          )}
                          <button
                            type="button"
                            className="admin-tab"
                            onClick={async () => {
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
                    <div className="health-card" style={{ padding: 16 }}>
                      <div className="health-label">Current Terms</div>
                      <div style={{ fontSize: 12 }}>v{legalCurrent.terms.version} — {legalCurrent.terms.title}</div>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 200, overflow: 'auto', marginTop: 8 }}>
                        {legalCurrent.terms.content.slice(0, 500)}…
                      </pre>
                    </div>
                    <div className="health-card" style={{ padding: 16 }}>
                      <div className="health-label">Current Privacy</div>
                      <div style={{ fontSize: 12 }}>v{legalCurrent.privacy.version}</div>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 200, overflow: 'auto', marginTop: 8 }}>
                        {legalCurrent.privacy.content.slice(0, 500)}…
                      </pre>
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
                        <th>Subscribed</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newsletterSubscribers.slice(0, 200).map((s) => (
                        <tr key={s.id}>
                          <td>{s.email}</td>
                          <td>{s.status}</td>
                          <td className="text-muted">{s.subscribedAt ? fmtDate(s.subscribedAt) : '—'}</td>
                          <td className="text-muted">{s.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                        </tr>
                      </thead>
                      <tbody>
                        {newsletterTemplates.map((t) => (
                          <tr key={t.id}>
                            <td>{t.name}</td>
                            <td style={{ fontFamily: 'var(--mono)' }}>{t.slug}</td>
                            <td>{t.subject}</td>
                            <td>{t.isActive ? '✓' : '—'}</td>
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
                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                  <button type="button" className="btn-ghost" onClick={() => loadTab('privacy')}>↻ Refresh</button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Resolution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {privacyRequests.map((r) => (
                        <tr key={r.id}>
                          <td>{r.email}</td>
                          <td>{r.requestType}</td>
                          <td>{r.status}</td>
                          <td className="text-muted">{r.createdAt ? fmtDate(r.createdAt) : '—'}</td>
                          <td className="text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.resolution ?? '—'}</td>
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
