'use client';

/**
 * SalesLeadsPanel (migration 0360) — the book-a-demo pipeline. Lists sales_leads
 * newest-first (filterable by status) and lets a superadmin advance each lead's
 * status as they work it. Writes go through adminApi.updateSalesLead → reload.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminSalesLead, type SalesLeadStatus } from '@/lib/adminApi';
import { DEMO_PERSONAS } from '@/lib/demoApi';
import { AdminError, AdminLoading, AdminPanelHeader, composeMailto, errText, fmtDateTime, useAdminData } from '@/components/admin/adminShared';

const STATUSES: SalesLeadStatus[] = ['new', 'contacted', 'qualified', 'closed'];
const isPersona = (v: string): boolean => (DEMO_PERSONAS as string[]).includes(v);

export default function SalesLeadsPanel() {
  const t = useTranslations('admin.salesLeads');
  const [filter, setFilter] = useState<SalesLeadStatus | ''>('');
  const { data, loading, error, reload, setError } = useAdminData<AdminSalesLead[]>(
    () => adminApi.salesLeads(filter || undefined),
    [filter],
  );
  const leads = data ?? [];

  const setStatus = async (id: string, status: SalesLeadStatus) => {
    try {
      await adminApi.updateSalesLead(id, status);
      reload();
    } catch (e) {
      setError(errText(e));
    }
  };

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        count={t('count', { count: leads.length })}
        onRefresh={reload}
        actions={
          <select className="admin-select" value={filter} onChange={(e) => setFilter(e.target.value as SalesLeadStatus | '')}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}>
            <option value="">{t('filterAll')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        }
      />
      <AdminError message={error} />

      {leads.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('contact')}</th>
                <th>{t('interest')}</th>
                <th>{t('source')}</th>
                <th>{t('received')}</th>
                <th>{t('statusHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{lead.name}</div>
                    <a href={composeMailto(lead.email, t('mailSubject'), '')} className="text-muted" style={{ fontSize: 12 }}>{lead.email}</a>
                    {lead.company && <div className="text-muted" style={{ fontSize: 12 }}>{lead.company}</div>}
                    {lead.message && <div className="text-muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 320 }}>{lead.message}</div>}
                  </td>
                  <td>{lead.interest ? (isPersona(lead.interest) ? t(`personas.${lead.interest}`) : lead.interest) : '—'}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{lead.source ?? '—'}</td>
                  <td className="text-muted">{fmtDateTime(lead.createdAt)}</td>
                  <td>
                    <select
                      className="admin-select"
                      value={lead.status}
                      onChange={(e) => setStatus(lead.id, e.target.value as SalesLeadStatus)}
                      style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
