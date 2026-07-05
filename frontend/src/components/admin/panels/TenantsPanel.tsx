'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminTenant, type AdminUser, type TenantMember } from '@/lib/adminApi';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { useEmulationLauncher } from '@/components/admin/EmulationLauncher';
import { AdminError, AdminLoading, errText, fmtDate } from '@/components/admin/adminShared';
import { TenantTokenLimitOverrideEditor } from '@/components/admin/TenantTokenLimitOverrideEditor';
import { TenantPaidOverflowCapEditor } from '@/components/admin/TenantPaidOverflowCapEditor';
import { TenantImageCreditsEditor } from '@/components/admin/TenantImageCreditsEditor';
import { TenantPremiumOverrideEditor } from '@/components/admin/TenantPremiumOverrideEditor';

export default function TenantsPanel() {
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
        <span className="text-muted" style={{ fontSize: 14 }}>{tenants.length} workspaces</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ViewToggle value={tenantsViewMode} onChange={setTenantsViewMode} />
          <button type="button" className="btn-ghost" onClick={reload}>
            ↻ Refresh
          </button>
        </div>
      </div>
      {tenants.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>No workspaces found.</p>
      ) : tenantsViewMode === 'table' ? (
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
              <th>AgentHosts</th>
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
                        setError(errText(e));
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
                  <td>{t.agentHostCount}</td>
                  <td className="text-muted">{fmtDate(t.createdAt)}</td>
                </tr>
                {expandedTenantId === t.id && (
                  <tr>
                    <td colSpan={9} style={{ padding: 0, background: 'var(--bg-elevated)' }}>
                      <div style={{ padding: '8px 16px 12px 40px' }} onClick={(e) => e.stopPropagation()}>
                        <TenantTokenLimitOverrideEditor
                          tenantId={t.id}
                          value={t.tokenDailyLimitOverride ?? null}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, tokenDailyLimitOverride: next } : x))}
                        />
                        <TenantPaidOverflowCapEditor
                          tenantId={t.id}
                          value={t.paidOverflowDailyCap ?? null}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, paidOverflowDailyCap: next } : x))}
                        />
                        <TenantImageCreditsEditor
                          tenantId={t.id}
                          value={t.imageCreditsDailyLimit ?? null}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, imageCreditsDailyLimit: next } : x))}
                        />
                        <TenantPremiumOverrideEditor
                          tenantId={t.id}
                          value={t.premiumOverride === true}
                          onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, premiumOverride: next } : x))}
                        />
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
                                        startEmulation(adminUser);
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
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {tenants.map((t) => {
            const expanded = expandedTenantId === t.id;
            const toggleExpand = async () => {
              if (expanded) {
                setExpandedTenantId(null);
                return;
              }
              setExpandedTenantId(t.id);
              if (!tenantMembersMap[t.id]) {
                try {
                  const members = await adminApi.tenantMembers(t.id);
                  setTenantMembersMap((prev) => ({ ...prev, [t.id]: members }));
                } catch (e) {
                  setError(errText(e));
                }
              }
            };
            return (
              <div
                key={t.id}
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
                      {t.name}
                    </span>
                    <span className={`badge ${t.effectivePlan === 'pro' ? 'badge-danger' : 'badge-neutral'}`}>
                      {t.effectivePlan}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-muted)' }}>{t.slug}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    <span className={`badge ${t.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{t.status}</span>
                    <span className="text-muted">{t.billingStatus}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)' }}>
                    <span>{t.memberCount} members</span>
                    <span>{t.agentHostCount} agenthosts</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Created {fmtDate(t.createdAt)}</div>
                </div>
                {expanded && (
                  <div onClick={(e) => e.stopPropagation()} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                    <TenantTokenLimitOverrideEditor
                      tenantId={t.id}
                      value={t.tokenDailyLimitOverride ?? null}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, tokenDailyLimitOverride: next } : x))}
                    />
                    <TenantPaidOverflowCapEditor
                      tenantId={t.id}
                      value={t.paidOverflowDailyCap ?? null}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, paidOverflowDailyCap: next } : x))}
                    />
                    <TenantImageCreditsEditor
                      tenantId={t.id}
                      value={t.imageCreditsDailyLimit ?? null}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, imageCreditsDailyLimit: next } : x))}
                    />
                    <TenantPremiumOverrideEditor
                      tenantId={t.id}
                      value={t.premiumOverride === true}
                      onChange={(next) => setTenants((prev) => prev.map((x) => x.id === t.id ? { ...x, premiumOverride: next } : x))}
                    />
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
                                  Emulate
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
