'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { errText, useAdminData, AdminError, AdminLoading } from '@/components/admin/adminShared';

export default function PermissionsPanel() {
  const t = useTranslations('admin');
  const { data: permMatrix, loading, error, reload, setData, setError } = useAdminData(() => adminApi.permissionsMatrix(), []);

  const [permEditRole, setPermEditRole] = useState<string | null>(null);
  const [permEditOverrides, setPermEditOverrides] = useState<Record<string, boolean>>({});
  const [permSaving, setPermSaving] = useState(false);

  if (loading && !permMatrix) return <AdminLoading />;

  return (
    <div>
      <AdminError message={error} />
      {permMatrix && Array.isArray(permMatrix.roles) && Array.isArray(permMatrix.permissions) && (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 className="page-title" style={{ fontSize: 18, margin: 0 }}>{t('permissions.title')}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="admin-tab"
                onClick={async () => {
                  try {
                    const csv = await adminApi.permissionsMatrixExport();
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'permissions-matrix.csv'; a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) { setError(errText(e)); }
                }}
              >
                {t('common.exportCsv')}
              </button>
              <button type="button" className="admin-tab" onClick={() => reload()}>↻ {t('common.refresh')}</button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>{t('permissions.colPermission')}</th>
                  {permMatrix.roles.map((r) => (
                    <th key={r} style={{ textAlign: 'center' }}>
                      {r}
                      {permEditRole === r ? (
                        <button
                          type="button"
                          className="admin-tab active"
                          style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11 }}
                          disabled={permSaving}
                          onClick={async () => {
                            setPermSaving(true);
                            setError('');
                            try {
                              const overrides = Object.entries(permEditOverrides).map(([permission, granted]) => ({ permission, granted }));
                              await adminApi.updateRolePermissions(r, overrides);
                              setData(await adminApi.permissionsMatrix());
                              setPermEditRole(null);
                              setPermEditOverrides({});
                            } catch (e) { setError(errText(e)); }
                            finally { setPermSaving(false); }
                          }}
                        >
                          {permSaving ? t('common.saving') : t('common.save')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-tab"
                          style={{ marginLeft: 6, padding: '2px 8px', fontSize: 11 }}
                          onClick={() => {
                            setPermEditRole(r);
                            const current: Record<string, boolean> = {};
                            for (const p of permMatrix.permissions) {
                              current[p] = (permMatrix.matrix[r] ?? []).includes(p);
                            }
                            setPermEditOverrides(current);
                          }}
                        >
                          {t('common.edit')}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permMatrix.permissions.map((perm) => (
                  <tr key={perm}>
                    <td style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: 12 }}>{perm}</td>
                    {permMatrix.roles.map((r) => {
                      const granted = permEditRole === r
                        ? permEditOverrides[perm] ?? false
                        : (permMatrix.matrix[r] ?? []).includes(perm);
                      return (
                        <td key={r} style={{ textAlign: 'center' }}>
                          {permEditRole === r ? (
                            <input
                              type="checkbox"
                              checked={permEditOverrides[perm] ?? false}
                              onChange={(e) => setPermEditOverrides((prev) => ({ ...prev, [perm]: e.target.checked }))}
                            />
                          ) : (
                            <span style={{ color: granted ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                              {granted ? '✓' : '✗'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {permEditRole && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button type="button" className="admin-tab" onClick={() => { setPermEditRole(null); setPermEditOverrides({}); }}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
