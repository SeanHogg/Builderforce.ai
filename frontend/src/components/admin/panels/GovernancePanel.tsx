'use client';

import { useState } from 'react';
import { adminApi } from '@/lib/adminApi';
import { errText, fmtDateTime, useAdminData, AdminError, AdminLoading } from '@/components/admin/adminShared';

export default function GovernancePanel() {
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
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Governance</h2>
          <p className="text-muted" style={{ fontSize: 12 }}>
            View and edit project governance rules (markdown) across all workspaces.
          </p>
          <span className="text-muted" style={{ fontSize: 13 }}>{governanceProjects.length} projects</span>
        </div>
        <button type="button" className="btn-ghost" onClick={() => reload()}>↻ Refresh</button>
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
                {governanceSaving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setGovernanceEditId(null); setGovernanceEditContent(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
