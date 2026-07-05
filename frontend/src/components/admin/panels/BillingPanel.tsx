'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, type AdminTenant, type AdminError as AdminErrorRow } from '@/lib/adminApi';
import { AdminError, AdminLoading, composeMailto, errText, fmtDateTime } from '@/components/admin/adminShared';

export default function BillingPanel() {
  const router = useRouter();

  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [errors, setErrors] = useState<AdminErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([adminApi.tenants(), adminApi.errors()])
      .then(([t, e]) => {
        setTenants(t);
        setErrors(e);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && tenants.length === 0 && errors.length === 0) return <AdminLoading />;

  return (
    <>
      <AdminError message={error} />
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
            <button type="button" className="btn-ghost" onClick={reload}>↻ Refresh</button>
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
              onClick={() => router.push('/admin?tab=logs')}
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
    </>
  );
}
