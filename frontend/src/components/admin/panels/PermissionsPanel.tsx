'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { downloadText } from '@/lib/download';
import { errText, useAdminData, AdminError, AdminLoading } from '@/components/admin/adminShared';

/**
 * How much force a permission row actually carries. Three states, not two:
 *
 *  • `enforced`      — a real `requirePermission` gate runs on the routes it names.
 *  • `unenforceable` — it can NEVER get one (see {@link PermissionMatrix.unenforceable}).
 *  • `advisory`      — gated by the role ladder alone; an override on it changes this
 *                      table and nothing else, until someone adds the gate.
 *
 * Split out so the decision lives in ONE place: the badge copy, the tooltip and the
 * colours all derive from this single verdict instead of three parallel ternaries that
 * could disagree about the same row.
 */
type PermissionGate = 'enforced' | 'unenforceable' | 'advisory';

function permissionGate(
  permission: string,
  enforced: ReadonlySet<string>,
  unenforceable: ReadonlySet<string>,
): PermissionGate {
  if (enforced.has(permission)) return 'enforced';
  if (unenforceable.has(permission)) return 'unenforceable';
  return 'advisory';
}

/** Token-driven so both themes read correctly; every value has a CSS variable. */
const GATE_BADGE_STYLE: Record<PermissionGate, { color: string; background: string; border: string }> = {
  enforced: {
    color: 'var(--success-text)',
    background: 'var(--success-bg, rgba(34,197,94,0.15))',
    border: '1px solid var(--success-border, rgba(34,197,94,0.35))',
  },
  // Amber, not green and not grey: it is not a gap someone should file work against,
  // but it is also not a row an override will ever affect.
  unenforceable: {
    color: 'var(--warning-text)',
    background: 'var(--warning-bg, rgba(245,158,11,0.15))',
    border: '1px solid var(--warning-border, rgba(245,158,11,0.35))',
  },
  advisory: {
    color: 'var(--text-secondary)',
    background: 'var(--surface-2, rgba(127,127,127,0.12))',
    border: '1px solid var(--border, rgba(127,127,127,0.3))',
  },
};

export default function PermissionsPanel() {
  const t = useTranslations('admin');
  const { data: permMatrix, loading, error, reload, setData, setError } = useAdminData(() => adminApi.permissionsMatrix(), []);

  const [permEditRole, setPermEditRole] = useState<string | null>(null);
  const [permEditOverrides, setPermEditOverrides] = useState<Record<string, boolean>>({});
  const [permSaving, setPermSaving] = useState(false);

  if (loading && !permMatrix) return <AdminLoading />;

  /**
   * Permissions the API reports as backed by a real request-time gate. The rest
   * are gated by the ROLE ladder alone, so an override on them changes this table
   * and nothing else — the badge says so rather than letting the screen imply
   * control the platform does not have.
   */
  const enforced = new Set(permMatrix?.enforced ?? []);
  /** See {@link PermissionMatrix.unenforceable} — "not applicable", not "not yet". */
  const unenforceable = new Set(permMatrix?.unenforceable ?? []);

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
                    downloadText(csv, 'permissions-matrix.csv', 'text/csv');
                  } catch (e) { setError(errText(e)); }
                }}
              >
                {t('common.exportCsv')}
              </button>
              <button type="button" className="admin-tab" onClick={() => reload()}>↻ {t('common.refresh')}</button>
            </div>
          </div>
          <p
            style={{
              margin: '0 0 12px',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              maxWidth: '72ch',
            }}
          >
            {t('permissions.enforcementNote')}
          </p>
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
                {permMatrix.permissions.map((perm) => {
                  const gate = permissionGate(perm, enforced, unenforceable);
                  return (
                  <tr key={perm}>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-mono,monospace)' }}>{perm}</span>
                        <span
                          title={t(`permissions.${gate}Hint`)}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            whiteSpace: 'nowrap',
                            ...GATE_BADGE_STYLE[gate],
                          }}
                        >
                          {t(`permissions.${gate}`)}
                        </span>
                      </div>
                    </td>
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
                            <span
                              aria-label={granted ? t('permissions.granted') : t('permissions.denied')}
                              style={{ color: granted ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}
                            >
                              {granted ? '✓' : '✗'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
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
