'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminTenant, type AdminDiscountCode, type AdminError as AdminErrorRow } from '@/lib/adminApi';
import { AdminError, AdminLoading, composeMailto, errText, fmtDateTime } from '@/components/admin/adminShared';

export default function BillingPanel() {
  const t = useTranslations('admin');
  const router = useRouter();

  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [errors, setErrors] = useState<AdminErrorRow[]>([]);
  const [discounts, setDiscounts] = useState<AdminDiscountCode[]>([]);
  const [newCode, setNewCode] = useState('');
  const [percentOff, setPercentOff] = useState(50);
  const [durationYears, setDurationYears] = useState(1);
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([adminApi.tenants(), adminApi.errors({ limit: 20 }), adminApi.discountCodes()])
      .then(([t, e, d]) => {
        setTenants(t);
        setErrors(e.errors);
        setDiscounts(d);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createDiscount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newCode.trim() || savingDiscount) return;
    setSavingDiscount(true);
    setError('');
    try {
      await adminApi.createDiscountCode({
        code: newCode.trim().toUpperCase(), percentOff, durationYears,
        applicablePlan: 'pro', billingCycle: 'yearly', isActive: true,
      });
      setNewCode('');
      reload();
    } catch (e) { setError(errText(e)); }
    finally { setSavingDiscount(false); }
  };

  if (loading && tenants.length === 0 && errors.length === 0) return <AdminLoading />;

  return (
    <>
      <AdminError message={error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <div style={{ marginBottom: 12, fontWeight: 600 }}>Signup discount codes</div>
          <form onSubmit={createDiscount} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>Code<input className="input" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="ANNUAL50" style={{ display: 'block', marginTop: 4 }} /></label>
            <label style={{ fontSize: 12 }}>Percent off<input className="input" type="number" min={1} max={100} value={percentOff} onChange={(e) => setPercentOff(Number(e.target.value))} style={{ display: 'block', marginTop: 4, width: 90 }} /></label>
            <label style={{ fontSize: 12 }}>Years<input className="input" type="number" min={1} max={20} value={durationYears} onChange={(e) => setDurationYears(Number(e.target.value))} style={{ display: 'block', marginTop: 4, width: 70 }} /></label>
            <button className="btn-primary" type="submit" disabled={savingDiscount || !newCode.trim()}>{savingDiscount ? 'Creating…' : 'Create annual Individual code'}</button>
          </form>
          <div className="table-wrap">
            <table className="data-table"><thead><tr><th>Code</th><th>Offer</th><th>Duration</th><th>Uses</th><th>Status</th><th></th></tr></thead>
              <tbody>{discounts.map((d) => <tr key={d.id}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{d.code}</td>
                <td>{d.percentOff}% off {d.billingCycle} {d.applicablePlan === 'pro' ? 'Individual' : 'Teams'}</td>
                <td>{d.durationYears} {d.durationYears === 1 ? 'year' : 'years'}</td>
                <td>{d.redeemedCount} redeemed / {d.redemptionCount} applied</td>
                <td><span className={`badge ${d.isActive ? 'badge-success' : 'badge-neutral'}`}>{d.isActive ? 'active' : 'inactive'}</span></td>
                <td><button type="button" className="btn-ghost" onClick={async () => { try { await adminApi.updateDiscountCode(d.id, { isActive: !d.isActive }); reload(); } catch (e) { setError(errText(e)); } }}>{d.isActive ? 'Deactivate' : 'Activate'}</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="health-grid">
          <div className="health-card">
            <div className="health-label">{t('billing.paidWorkspaces')}</div>
            <div className="health-value">
              {tenants.filter((t) => t.billingStatus === 'active' && t.effectivePlan === 'pro').length}
            </div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('billing.pastDue')}</div>
            <div className="health-value">{tenants.filter((t) => t.billingStatus === 'past_due').length}</div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('billing.pendingBilling')}</div>
            <div className="health-value">{tenants.filter((t) => t.billingStatus === 'pending').length}</div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('billing.upgradeLeads')}</div>
            <div className="health-value">{tenants.filter((t) => t.effectivePlan === 'free').length}</div>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="text-muted">
              {t('billing.invoiceQueue', { n: tenants.filter((tn) => ['active', 'past_due', 'pending'].includes(tn.billingStatus)).length })}
            </span>
            <button type="button" className="btn-ghost" onClick={reload}>↻ {t('common.refresh')}</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('billing.workspace')}</th>
                  <th>{t('billing.plan')}</th>
                  <th>{t('billing.billing')}</th>
                  <th>{t('billing.billingEmail')}</th>
                  <th>{t('billing.updated')}</th>
                  <th>Discount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants
                  .filter((tn) => ['active', 'past_due', 'pending'].includes(tn.billingStatus))
                  .map((tn) => (
                    <tr key={tn.id}>
                      <td>{tn.name}</td>
                      <td>
                        <span className={`badge ${tn.effectivePlan === 'pro' ? 'badge-success' : 'badge-neutral'}`}>
                          {tn.effectivePlan}
                        </span>
                      </td>
                      <td className="text-muted">{tn.billingStatus}</td>
                      <td className="text-muted">{tn.billingEmail ?? '—'}</td>
                      <td className="text-muted">
                        {tn.billingUpdatedAt ? fmtDateTime(tn.billingUpdatedAt) : '—'}
                      </td>
                      <td>{tn.discountCode ? <span title={`${tn.discountStatus} · applied ${tn.discountAppliedAt ? fmtDateTime(tn.discountAppliedAt) : '—'}`}><strong>{tn.discountCode}</strong> · {tn.discountPercentOff}% / {tn.discountDurationYears}y</span> : '—'}</td>
                      <td>
                        {tn.billingEmail ? (
                          <>
                            <a
                              className="btn-ghost"
                              href={composeMailto(
                                tn.billingEmail,
                                t('billing.invoiceSubject'),
                                t('billing.invoiceBody')
                              )}
                            >
                              {t('billing.sendInvoice')}
                            </a>
                            <a
                              className="btn-ghost"
                              href={composeMailto(
                                tn.billingEmail,
                                t('billing.reminderSubject'),
                                t('billing.reminderBody')
                              )}
                            >
                              {t('billing.reminder')}
                            </a>
                          </>
                        ) : (
                          <span className="text-muted" style={{ fontSize: 12 }}>{t('billing.noBillingEmail')}</span>
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
            <span className="text-muted">{t('billing.upgradeComms')}</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('billing.workspace')}</th>
                  <th>{t('billing.billingEmail')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants
                  .filter((tn) => tn.effectivePlan === 'free')
                  .map((tn) => (
                    <tr key={tn.id}>
                      <td>{tn.name}</td>
                      <td className="text-muted">{tn.billingEmail ?? '—'}</td>
                      <td>
                        {tn.billingEmail ? (
                          <a
                            className="btn-ghost"
                            href={composeMailto(
                              tn.billingEmail,
                              t('billing.upgradeSubject'),
                              t('billing.upgradeBody')
                            )}
                          >
                            {t('billing.sendUpgradeMessage')}
                          </a>
                        ) : (
                          <span className="text-muted" style={{ fontSize: 12 }}>{t('billing.noBillingEmail')}</span>
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
            <span className="text-muted">{t('billing.feedbackIssues', { n: errors.slice(0, 20).length })}</span>
            <button
              type="button"
              className="btn-ghost"
              style={{ marginLeft: 8 }}
              onClick={() => router.push('/admin?tab=logs')}
            >
              {t('billing.openFullErrorLog')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>{t('billing.method')}</th>
                  <th>{t('billing.path')}</th>
                  <th>{t('billing.message')}</th>
                  <th>{t('billing.time')}</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 20).map((e) => (
                  <tr key={e.id}>
                    <td>{e.method ?? '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.path ?? '—'}</td>
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
