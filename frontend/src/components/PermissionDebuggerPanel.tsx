'use client';

import { useState, useMemo } from 'react';
import { usePermissionDebugger, type PermissionRegistration } from '@/lib/PermissionDebuggerContext';
import { useEmulation } from '@/lib/EmulationContext';
import { useRolePreview } from '@/lib/RolePreviewContext';

type PanelTab = 'page' | 'user' | 'role' | 'missing';

export default function PermissionDebuggerPanel() {
  const { debuggerActive, gates, toggleDebugger } = usePermissionDebugger();
  const { emulation } = useEmulation();
  const { previewRole } = useRolePreview();
  const [panelTab, setPanelTab] = useState<PanelTab>('page');

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

  // Unique permissions for the "role" tab — grouped by permission key
  const roleGrouped = useMemo(() => {
    const map = new Map<string, PermissionRegistration & { count: number }>();
    for (const g of gates) {
      const existing = map.get(g.permission);
      if (existing) { existing.count++; }
      else map.set(g.permission, { ...g, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.permission.localeCompare(b.permission));
  }, [gates]);

  function copyAll() {
    const json = JSON.stringify(
      { role: activeRole, gates: gates.map(({ id: _id, ...rest }) => rest) },
      null,
      2,
    );
    navigator.clipboard.writeText(json).catch(() => undefined);
  }

  function exportCsv() {
    const header = 'permission,status,grantedVia,apiEndpoint,count';
    const rows = (panelTab === 'role' ? roleGrouped : displayed).map((g) =>
      [`"${g.permission}"`, `"${g.status}"`, `"${g.grantedVia ?? ''}"`, `"${(g as PermissionRegistration & { count?: number }).apiEndpoint ?? ''}"`, String((g as PermissionRegistration & { count?: number }).count ?? 1)].join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'permission-debug.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function statusColor(status: string) {
    if (status === 'granted') return '#22c55e';
    if (status === 'soft-gate') return '#eab308';
    return '#ef4444';
  }

  return (
    <div className="perm-debugger-panel" role="dialog" aria-label="Permission Debugger">
      {/* Header */}
      <div className="perm-debugger-header">
        <span className="perm-debugger-title">Permission Debugger</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="perm-debugger-btn" onClick={copyAll} title="Copy all as JSON">Copy All</button>
          <button type="button" className="perm-debugger-btn" onClick={exportCsv} title="Export as CSV">Export CSV</button>
          <button type="button" className="perm-debugger-btn perm-debugger-btn--close" onClick={toggleDebugger} aria-label="Close">×</button>
        </div>
      </div>

      {/* Summary */}
      <div className="perm-debugger-summary">
        <span>Role: <strong>{activeRole}</strong></span>
        <span style={{ marginLeft: 12 }}>Active: <strong style={{ color: '#22c55e' }}>{granted.length}</strong> / {gates.length} permissions</span>
        {denied.length > 0 && <span style={{ marginLeft: 12, color: '#ef4444' }}>{denied.length} denied</span>}
        {soft.length > 0 && <span style={{ marginLeft: 12, color: '#eab308' }}>{soft.length} soft-gated</span>}
      </div>

      {/* Tabs */}
      <div className="perm-debugger-tabs">
        {(['page', 'user', 'role', 'missing'] as PanelTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`perm-debugger-tab${panelTab === t ? ' perm-debugger-tab--active' : ''}`}
            onClick={() => setPanelTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'missing' && denied.length > 0 && (
              <span style={{ marginLeft: 4, background: '#ef4444', color: '#fff', borderRadius: 8, padding: '0 5px', fontSize: 10 }}>{denied.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="perm-debugger-body">
        <table className="perm-debugger-table">
          <thead>
            <tr>
              <th>Permission</th>
              <th>Status</th>
              <th>Source</th>
              {panelTab === 'role' && <th>Count</th>}
              {panelTab !== 'role' && <th>API Endpoint</th>}
            </tr>
          </thead>
          <tbody>
            {(panelTab === 'role' ? roleGrouped : displayed).map((g) => (
              <tr key={g.id ?? g.permission}>
                <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>{g.permission}</td>
                <td>
                  <span style={{ color: statusColor(g.status), fontWeight: 600, fontSize: 11 }}>
                    {g.status.toUpperCase()}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.grantedVia ?? '—'}</td>
                {panelTab === 'role' && (
                  <td style={{ fontSize: 11 }}>{(g as PermissionRegistration & { count?: number }).count ?? 1}</td>
                )}
                {panelTab !== 'role' && (
                  <td style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{g.apiEndpoint ?? '—'}</td>
                )}
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>
                  No permissions in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
