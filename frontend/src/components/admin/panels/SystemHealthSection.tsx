'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminSystemHealth } from '@/lib/adminApi';
import { errText, fmtDateTime, fmtNum } from '../adminShared';

const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n; let i = -1;
  do { v /= 1024; i += 1; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
};

export function SystemHealthSection() {
  const [health, setHealth] = useState<AdminSystemHealth | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const reload = useCallback(async () => {
    try { setError(''); setHealth(await adminApi.systemHealth()); }
    catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const maintain = async (action: 'purge_expired' | 'vacuum_analyze', target?: 'primary' | 'transactional', table?: string) => {
    const label = action === 'purge_expired' ? 'run retention cleanup' : `vacuum ${table ?? 'all tables'} in ${target}`;
    if (!window.confirm(`Confirm: ${label}? This is an audited maintenance operation.`)) return;
    try {
      setBusy(`${action}:${target ?? 'both'}:${table ?? ''}`); setError('');
      await adminApi.systemMaintenance({ action, target, table });
      await reload();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(''); }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>System infrastructure</h2>
          <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Worker bindings, runtime state, Neon storage, and safe maintenance.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void maintain('purge_expired')}>Clean expired data</button>
          <button className="btn-ghost" type="button" onClick={() => void reload()}>↻ Refresh</button>
        </div>
      </div>
      {error && <div className="admin-error">{error}</div>}
      {!health ? <p className="text-muted">Loading system health…</p> : <>
        <div className="health-grid">
          <div className="health-card"><div className="health-label">Worker</div><div className="health-value">{health.worker.version}</div><div style={{ fontSize: 12 }}>{health.worker.environment}</div></div>
          <div className="health-card"><div className="health-label">Agent hosts</div><div className="health-value">{fmtNum(health.runtime.onlineAgentHosts)} / {fmtNum(health.runtime.agentHosts)}</div><div style={{ fontSize: 12 }}>online in last 5 min</div></div>
          <div className="health-card"><div className="health-label">Active executions</div><div className="health-value">{fmtNum(health.runtime.activeExecutions)}</div><div style={{ fontSize: 12 }}>{fmtNum(health.runtime.failedExecutions24h)} failed in 24h</div></div>
          <div className="health-card"><div className="health-label">Cloudflare bindings</div><div className="health-value">{Object.values(health.worker.bindings).filter(Boolean).length} / {Object.keys(health.worker.bindings).length}</div><div style={{ fontSize: 12 }}>configured services</div></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(health.worker.bindings).map(([name, ok]) => <span key={name} className={`badge ${ok ? 'badge-success' : 'badge-neutral'}`}>{name}: {ok ? 'bound' : 'missing'}</span>)}
        </div>
        {health.databases.map((db) => <div key={db.name} className="health-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div><strong style={{ textTransform: 'capitalize' }}>{db.name} Neon database</strong><div className="text-muted" style={{ fontSize: 12 }}>{db.databaseName ?? 'unavailable'} · {db.ok ? `${db.latencyMs} ms` : db.error}</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>{bytes(db.totalBytes)}</strong><button className="btn-ghost" type="button" disabled={Boolean(busy) || !db.ok} onClick={() => void maintain('vacuum_analyze', db.name)}>Vacuum & analyze</button></div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table" style={{ fontSize: 12 }}><thead><tr><th>Table</th><th>Size</th><th>Rows</th><th>Writes since stats reset</th><th>Last vacuum</th><th></th></tr></thead><tbody>{db.tables.map((table) => <tr key={table.name}><td>{table.name}</td><td>{bytes(Number(table.totalBytes))}</td><td>{fmtNum(Number(table.estimatedRows))}</td><td>{fmtNum(Number(table.insertsSinceStatsReset) + Number(table.updatesSinceStatsReset) + Number(table.deletesSinceStatsReset))}</td><td>{table.lastAutovacuum ? fmtDateTime(table.lastAutovacuum) : '—'}</td><td><button className="btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void maintain('vacuum_analyze', db.name, table.name)}>Vacuum</button></td></tr>)}</tbody></table></div>
        </div>)}
      </>}
    </section>
  );
}
