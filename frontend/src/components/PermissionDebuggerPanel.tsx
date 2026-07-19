'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { usePermissionDebugger, type PermissionRegistration } from '@/lib/PermissionDebuggerContext';
import { useEmulation } from '@/lib/EmulationContext';
import { useRolePreview } from '@/lib/RolePreviewContext';
import { downloadText, toCsv } from '@/lib/download';

type PanelTab = 'page' | 'user' | 'role' | 'missing';

export default function PermissionDebuggerPanel() {
  const t = useTranslations('permissionDebugger');
  const { debuggerActive, gates, toggleDebugger } = usePermissionDebugger();
  const { emulation } = useEmulation();
  const { previewRole } = useRolePreview();
  const [panelTab, setPanelTab] = useState<PanelTab>('page');

  // useMemo must be called unconditionally before any early return (rules-of-hooks).
  const roleGrouped = useMemo(() => {
    const map = new Map<string, PermissionRegistration & { count: number }>();
    for (const g of gates) {
      const existing = map.get(g.permission);
      if (existing) { existing.count++; }
      else map.set(g.permission, { ...g, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.permission.localeCompare(b.permission));
  }, [gates]);

  if (!debuggerActive) return null;

  const activeRole = emulation?.role ?? previewRole ?? 'viewer';
  const granted = gates.filter((g) => g.status === 'granted');
  const denied  = gates.filter((g) => g.status === 'denied');
  const soft    = gates.filter((g) => g.status === 'soft-gate');

  const tabGates: Record<PanelTab, PermissionRegistration[]> = {
    page:    gates,
    user:    granted,
    role:    gates,
    missing: denied,
  };

  const displayed = tabGates[panelTab];

  function copyAll() {
    const json = JSON.stringify(
      { role: activeRole, gates: gates.map(({ id: _id, ...rest }) => rest) },
      null,
      2,
    );
    navigator.clipboard.writeText(json).catch(() => undefined);
  }

  function exportCsv() {
    const rows = (panelTab === 'role' ? roleGrouped : displayed).map((g) => {
      const withCount = g as PermissionRegistration & { count?: number; apiEndpoint?: string };
      return [g.permission, g.status, g.grantedVia ?? '', withCount.apiEndpoint ?? '', withCount.count ?? 1];
    });
    const csv = toCsv(['permission', 'status', 'grantedVia', 'apiEndpoint', 'count'], rows);
    downloadText(csv, 'permission-debug.csv', 'text/csv');
  }

  /** Status colours come from the shared semantic tokens, not literal hex, so the
   *  panel stays legible in light mode (a raw #22c55e on a light surface fails
   *  contrast where var(--success) is theme-tuned). */
  function statusColor(status: string) {
    if (status === 'granted') return 'var(--success, #22c55e)';
    if (status === 'soft-gate') return 'var(--warning, #eab308)';
    return 'var(--error, #ef4444)';
  }

  /** A gate's status is a fixed enum from the permission registry (`granted` /
   *  `denied` / `soft-gate`), so it is translated through a key rather than
   *  upper-cased in place — several locales have no cased alphabet. */
  const statusLabel = (status: string) => t(`status.${status}` as 'status.granted');

  return (
    <div className="perm-debugger-panel" role="dialog" aria-label={t('title')}>
      {/* Header */}
      <div className="perm-debugger-header">
        <span className="perm-debugger-title">{t('title')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="perm-debugger-btn" onClick={copyAll} title={t('copyAllHint')}>{t('copyAll')}</button>
          <button type="button" className="perm-debugger-btn" onClick={exportCsv} title={t('exportCsvHint')}>{t('exportCsv')}</button>
          <button type="button" className="perm-debugger-btn perm-debugger-btn--close" onClick={toggleDebugger} aria-label={t('close')}>×</button>
        </div>
      </div>

      {/* Summary */}
      <div className="perm-debugger-summary">
        <span>{t('role')} <strong>{activeRole}</strong></span>
        <span>{t('activeCount', { granted: granted.length, total: gates.length })}</span>
        {denied.length > 0 && <span style={{ color: 'var(--error, #ef4444)' }}>{t('deniedCount', { count: denied.length })}</span>}
        {soft.length > 0 && <span style={{ color: 'var(--warning, #eab308)' }}>{t('softGatedCount', { count: soft.length })}</span>}
      </div>

      {/* Tabs */}
      <div className="perm-debugger-tabs">
        {(['page', 'user', 'role', 'missing'] as PanelTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`perm-debugger-tab${panelTab === tab ? ' perm-debugger-tab--active' : ''}`}
            onClick={() => setPanelTab(tab)}
          >
            {t(`tab.${tab}` as 'tab.page')}
            {tab === 'missing' && denied.length > 0 && (
              <span className="perm-debugger-count-badge">{denied.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="perm-debugger-body">
        <table className="perm-debugger-table">
          <thead>
            <tr>
              <th>{t('col.permission')}</th>
              <th>{t('col.status')}</th>
              <th>{t('col.source')}</th>
              {panelTab === 'role' && <th>{t('col.count')}</th>}
              {panelTab !== 'role' && <th>{t('col.apiEndpoint')}</th>}
            </tr>
          </thead>
          <tbody>
            {(panelTab === 'role' ? roleGrouped : displayed).map((g) => (
              <tr key={g.id ?? g.permission}>
                <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>{g.permission}</td>
                <td>
                  <span style={{ color: statusColor(g.status), fontWeight: 600, fontSize: 11 }}>
                    {statusLabel(g.status)}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.grantedVia ?? '—'}</td>
                {panelTab === 'role' && (
                  <td style={{ fontSize: 11 }}>{(g as PermissionRegistration & { count?: number }).count ?? 1}</td>
                )}
                {panelTab !== 'role' && (
                  <td style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{g.apiEndpoint ?? '—'}</td>
                )}
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
