'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminTenant, type AdminUser, type TenantMember } from '@/lib/adminApi';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { useEmulationLauncher } from '@/components/admin/EmulationLauncher';
import { AdminError, AdminLoading, errText, fmtDate } from '@/components/admin/adminShared';
import { TenantTokenLimitOverrideEditor } from '@/components/admin/TenantTokenLimitOverrideEditor';
import { TenantPaidOverflowCapEditor } from '@/components/admin/TenantPaidOverflowCapEditor';
import { TenantImageCreditsEditor } from '@/components/admin/TenantImageCreditsEditor';
import { TenantPremiumOverrideEditor } from '@/components/admin/TenantPremiumOverrideEditor';

export default function TenantsPanel() {
  const t = useTranslations('admin');
  const { startEmulation } = useEmulationLauncher();

  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [tenantsViewMode, setTenantsViewMode] = useState<ViewMode>('table');
  const [expandedTenantId, setExpandedTenantId] = useState<number | null>(null);
  const [tenantMembersMap, setTenantMembersMap] = useState<Record<number, TenantMember[]>>({});

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.tenants()
      .then((t) => setTenants(t))
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && tenants.length === 0) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span className="text-muted" style={{ fontSize: 14 }}>{t('tenants.workspaceCount', { count: tenants.length })}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ViewToggle value={tenantsViewMode} onChange={setTenantsViewMode} />
          <button type="button" className="btn-ghost" onClick={reload}>
            ↻ {t('common.refresh')}
          </button>
        </div>
      </div>
      {tenants.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('tenants.empty')}</p>
      ) : tenantsViewMode === 'table' ? (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>{t('tenants.colName')}</th>
              <th>{t('tenants.colSlug')}</th>
              <th>{t('tenants.colStatus')}</th>
              <th>{t('tenants.colPlan')}</th>
              <th>{t('tenants.colBilling')}</th>
              <th>{t('tenants.colMembers')}</th>
              <th>{t('tenants.colAgentHosts')}</th>
              <th>{t('tenants.colCreated')}</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <React.Fragment key={tenant.id}>
                <tr
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  onClick={async () => {
                    if (expandedTenantId === tenant.id) {
                      setExpandedTenantId(null);
                      return;
                    }
                    setExpandedTenantId(tenant.id);
                    if (!tenantMembersMap[tenant.id]) {
                      try {
                        const members = await adminApi.tenantMembers(tenant.id);
                        setTenantMembersMap((prev) => ({ ...prev, [tenant.id]: members }));
                      } catch (e) {
                        setError(errText(e));
                      }
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                >
                  <td style={{ verticalAlign: 'middle' }}>
                    <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: expandedTenantId === tenant.id ? 'rotate(90deg)' : 'none' }}>▶</span>
                  </td>
                  <td>{tenant.name}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{tenant.slug}</td>
                  <td>
                    <span className={`badge ${tenant.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                      {tenant.status}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${tenant.effectivePlan === 'pro' ? 'badge-danger' : 'badge-neutral'}`}>
                      {tenant.effectivePlan}
                    </span>
                  </td>
                  <td className="text-muted">{tenant.billingStatus}</td>
                  <td>{tenant.memberCount}</td>
                  <td>{tenant.agentHostCount}</td>
                  <td className="text-muted">{fmtDate(tenant.createdAt)}</td>
                </tr>
                {expandedTenantId === tenant.id && (
                  <tr>
                    <td colSpan={9} style={{ padding: 0, background: 'var(--bg-elevated)' }}>
                      <div style={{ padding: '8px 16px 12px 40px' }} onClick={(e) => e.stopPropagation()}>
                        <TenantTokenLimitOverrideEditor
                          tenantId={tenant.id}
                          value={tenant.tokenDailyLimitOverride ?? null}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, tokenDailyLimitOverride: next } : x))}
                        />
                        <TenantPaidOverflowCapEditor
                          tenantId={tenant.id}
                          value={tenant.paidOverflowDailyCap ?? null}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, paidOverflowDailyCap: next } : x))}
                        />
                        <TenantImageCreditsEditor
                          tenantId={tenant.id}
                          value={tenant.imageCreditsDailyLimit ?? null}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, imageCreditsDailyLimit: next } : x))}
                        />
                        <TenantPremiumOverrideEditor
                          tenantId={tenant.id}
                          value={tenant.premiumOverride === true}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, premiumOverride: next } : x))}
                        />
                        {!tenantMembersMap[tenant.id] ? (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('tenants.loadingMembers')}</span>
                        ) : tenantMembersMap[tenant.id].length === 0 ? (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('tenants.noMembers')}</span>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('tenants.memberEmail')}</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('tenants.memberRole')}</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('tenants.memberJoined')}</th>
                                <th style={{ padding: '4px 8px' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {tenantMembersMap[tenant.id].map((m) => (
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
                                        startEmulation(adminUser);
                                      }}
                                    >
                                      {t('tenants.emulate')}
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
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {tenants.map((tenant) => {
            const expanded = expandedTenantId === tenant.id;
            const toggleExpand = async () => {
              if (expanded) {
                setExpandedTenantId(null);
                return;
              }
              setExpandedTenantId(tenant.id);
              if (!tenantMembersMap[tenant.id]) {
                try {
                  const members = await adminApi.tenantMembers(tenant.id);
                  setTenantMembersMap((prev) => ({ ...prev, [tenant.id]: members }));
                } catch (e) {
                  setError(errText(e));
                }
              }
            };
            return (
              <div
                key={tenant.id}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
                  onClick={() => { void toggleExpand(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggleExpand(); } }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', marginRight: 6, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'none' }}>▶</span>
                      {tenant.name}
                    </span>
                    <span className={`badge ${tenant.effectivePlan === 'pro' ? 'badge-danger' : 'badge-neutral'}`}>
                      {tenant.effectivePlan}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-muted)' }}>{tenant.slug}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <span className={`badge ${tenant.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{tenant.status}</span>
                    <span className="text-muted">{tenant.billingStatus}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)' }}>
                    <span>{t('tenants.memberCount', { count: tenant.memberCount })}</span>
                    <span>{t('tenants.agentHostCount', { count: tenant.agentHostCount })}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('tenants.createdOn', { date: fmtDate(tenant.createdAt) })}</div>
                </div>
                {expanded && (
                  <div onClick={(e) => e.stopPropagation()} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                    <TenantTokenLimitOverrideEditor
                      tenantId={tenant.id}
                      value={tenant.tokenDailyLimitOverride ?? null}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, tokenDailyLimitOverride: next } : x))}
                    />
                    <TenantPaidOverflowCapEditor
                      tenantId={tenant.id}
                      value={tenant.paidOverflowDailyCap ?? null}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, paidOverflowDailyCap: next } : x))}
                    />
                    <TenantImageCreditsEditor
                      tenantId={tenant.id}
                      value={tenant.imageCreditsDailyLimit ?? null}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, imageCreditsDailyLimit: next } : x))}
                    />
                    <TenantPremiumOverrideEditor
                      tenantId={tenant.id}
                      value={tenant.premiumOverride === true}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === tenant.id ? { ...x, premiumOverride: next } : x))}
                    />
                    {!tenantMembersMap[tenant.id] ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('tenants.loadingMembers')}</span>
                    ) : tenantMembersMap[tenant.id].length === 0 ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('tenants.noMembers')}</span>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('tenants.memberEmail')}</th>
                            <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('tenants.memberRole')}</th>
                            <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('tenants.memberJoined')}</th>
                            <th style={{ padding: '4px 8px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {tenantMembersMap[tenant.id].map((m) => (
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
                                    const adminUser: AdminUser = {
                                      id: m.id,
                                      email: m.email,
                                      username: m.username,
                                      displayName: m.displayName,
                                      isSuperadmin: false,
                                      createdAt: m.joinedAt,
                                      tenantCount: 1,
                                    };
                                    startEmulation(adminUser);
                                  }}
                                >
                                  {t('tenants.emulate')}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
