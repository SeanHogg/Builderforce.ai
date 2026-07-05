'use client';

import { useState } from 'react';
import { adminApi } from '@/lib/adminApi';
import { errText, fmtDate, useAdminData, AdminError, AdminLoading } from '@/components/admin/adminShared';

export default function ModulesPanel() {
  const { data, loading, error, reload, setData, setError } = useAdminData(() => adminApi.modules(), []);
  const platformModules = data ?? [];

  const [moduleForm, setModuleForm] = useState<{ name: string; description: string; permissions: string } | null>(null);
  const [moduleFormBusy, setModuleFormBusy] = useState(false);

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
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
          <button type="button" className="admin-tab" onClick={() => reload()}>↻ Refresh</button>
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
                setError('');
                try {
                  await adminApi.createModule({
                    name: moduleForm.name.trim(),
                    description: moduleForm.description.trim() || null,
                    permissions: moduleForm.permissions.split(',').map((s) => s.trim()).filter(Boolean),
                  });
                  setData(await adminApi.modules());
                  setModuleForm(null);
                } catch (e) { setError(errText(e)); }
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
                    setError('');
                    try {
                      await adminApi.deleteModule(m.id);
                      setData((prev) => (prev ?? []).filter((x) => x.id !== m.id));
                    } catch (e) { setError(errText(e)); }
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
  );
}
