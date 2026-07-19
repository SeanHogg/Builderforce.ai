'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { errText, fmtDate, useAdminData, AdminError, AdminLoading } from '@/components/admin/adminShared';
import { useConfirm } from '@/components/ConfirmProvider';

export default function ModulesPanel() {
  const t = useTranslations('admin');
  const confirm = useConfirm();
  const { data, loading, error, reload, setData, setError } = useAdminData(() => adminApi.modules(), []);
  const platformModules = data ?? [];

  const [moduleForm, setModuleForm] = useState<{ name: string; description: string; permissions: string } | null>(null);
  const [moduleFormBusy, setModuleFormBusy] = useState(false);

  if (loading && !data) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>{t('modules.title')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="admin-tab active"
            onClick={() => setModuleForm({ name: '', description: '', permissions: '' })}
          >
            {t('modules.newModuleButton')}
          </button>
          <button type="button" className="admin-tab" onClick={() => reload()}>↻ {t('common.refresh')}</button>
        </div>
      </div>
      {moduleForm && (
        <div className="health-card" style={{ marginBottom: 16, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>{t('modules.newModuleTitle')}</h3>
          <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>{t('modules.nameLabel')}</label>
          <input
            className="admin-select"
            value={moduleForm.name}
            onChange={(e) => setModuleForm((f) => f ? { ...f, name: e.target.value } : f)}
            placeholder={t('modules.namePlaceholder')}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>{t('modules.descriptionLabel')}</label>
          <input
            className="admin-select"
            value={moduleForm.description}
            onChange={(e) => setModuleForm((f) => f ? { ...f, description: e.target.value } : f)}
            placeholder={t('modules.descriptionPlaceholder')}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <label className="admin-label" style={{ display: 'block', marginBottom: 4 }}>{t('modules.permissionsLabel')}</label>
          <input
            className="admin-select"
            value={moduleForm.permissions}
            onChange={(e) => setModuleForm((f) => f ? { ...f, permissions: e.target.value } : f)}
            placeholder={t('modules.permissionsPlaceholder')}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="admin-tab" onClick={() => setModuleForm(null)}>{t('common.cancel')}</button>
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
              {moduleFormBusy ? t('common.creating') : t('common.create')}
            </button>
          </div>
        </div>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('modules.colName')}</th>
            <th>{t('modules.colSlug')}</th>
            <th>{t('modules.colPermissions')}</th>
            <th>{t('modules.colDefault')}</th>
            <th>{t('modules.colCreated')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {platformModules.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.slug}</td>
              <td style={{ fontSize: 12, maxWidth: 280 }}>{m.permissions.join(', ') || '—'}</td>
              <td>{m.defaultEnabled ? t('modules.yes') : t('modules.no')}</td>
              <td>{fmtDate(m.createdAt)}</td>
              <td>
                <button
                  type="button"
                  className="admin-tab"
                  style={{ padding: '3px 10px', fontSize: 12, color: '#ef4444' }}
                  onClick={async () => {
                    if (!(await confirm(t('modules.confirmDelete', { name: m.name })))) return;
                    setError('');
                    try {
                      await adminApi.deleteModule(m.id);
                      setData((prev) => (prev ?? []).filter((x) => x.id !== m.id));
                    } catch (e) { setError(errText(e)); }
                  }}
                >
                  {t('common.remove')}
                </button>
              </td>
            </tr>
          ))}
          {platformModules.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>{t('modules.empty')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
