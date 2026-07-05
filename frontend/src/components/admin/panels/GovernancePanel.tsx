'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { errText, fmtDateTime, useAdminData, AdminError, AdminLoading } from '@/components/admin/adminShared';

export default function GovernancePanel() {
  const t = useTranslations('admin');
  const { data, loading, error, reload, setError } = useAdminData(() => adminApi.adminProjects(), []);
  const governanceProjects = data ?? [];

  const [governanceEditId, setGovernanceEditId] = useState<number | null>(null);
  const [governanceEditContent, setGovernanceEditContent] = useState('');
  const [governanceSaving, setGovernanceSaving] = useState(false);

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{t('governance.title')}</h2>
          <p className="text-muted" style={{ fontSize: 12 }}>
            {t('governance.description')}
          </p>
          <span className="text-muted" style={{ fontSize: 13 }}>{t('governance.count', { n: governanceProjects.length })}</span>
        </div>
        <button type="button" className="btn-ghost" onClick={() => reload()}>↻ {t('common.refresh')}</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('governance.colWorkspace')}</th>
              <th>{t('governance.colProject')}</th>
              <th>{t('governance.colGovernancePreview')}</th>
              <th>{t('governance.colUpdated')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {governanceProjects.length === 0 ? (
              <tr><td colSpan={5} className="text-muted" style={{ padding: 24 }}>{t('governance.empty')}</td></tr>
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
                      {t('common.edit')}
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
            <div className="page-title" style={{ marginBottom: 12 }}>{t('governance.editGovernance')}</div>
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              {t('governance.projectLabel', { name: governanceProjects.find((p) => p.id === governanceEditId)?.name ?? governanceEditId })}
            </p>
            <textarea
              className="admin-token-textarea"
              value={governanceEditContent}
              onChange={(e) => setGovernanceEditContent(e.target.value)}
              style={{ minHeight: 280, width: '100%', marginBottom: 16 }}
              placeholder={t('governance.rulesPlaceholder')}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="admin-tab active"
                disabled={governanceSaving}
                onClick={async () => {
                  setGovernanceSaving(true);
                  setError('');
                  try {
                    await adminApi.updateProjectGovernance(governanceEditId, governanceEditContent.trim() || null);
                    setGovernanceEditId(null);
                    setGovernanceEditContent('');
                    reload();
                  } catch (e) {
                    setError(errText(e));
                  } finally {
                    setGovernanceSaving(false);
                  }
                }}
              >
                {governanceSaving ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setGovernanceEditId(null); setGovernanceEditContent(''); }}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
