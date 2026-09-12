'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminSystemHealth } from '@/lib/adminApi';
import { errText } from '../adminShared';
import { formatBytes } from '@/lib/formatBytes';
import { useAdminFormat } from '../adminShared';
import { InlineConfirmButton } from '@/components/InlineConfirmButton';

type MaintenanceAction = 'purge_expired' | 'vacuum_analyze';
type MaintenanceTarget = 'primary' | 'transactional';

export function SystemHealthSection() {
  const t = useTranslations('admin.system');
  const { fmtDateTime, fmtNum } = useAdminFormat();
  const [health, setHealth] = useState<AdminSystemHealth | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const reload = useCallback(async () => {
    try { setError(''); setHealth(await adminApi.systemHealth()); }
    catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  /** What a maintenance run will do — the consequence shown when its button is armed. */
  const maintenanceHint = (action: MaintenanceAction, target?: MaintenanceTarget, table?: string) => {
    const label = action === 'purge_expired'
      ? t('maintenanceCleanup')
      : t('maintenanceVacuum', { table: table ?? t('allTables'), target: target ?? '' });
    return t('confirmMaintenance', { label });
  };

  // Vacuum and the retention sweep lose nothing live (the sweep only removes rows
  // already past retention), so the deliberate second click is the inline two-step
  // on each button (InlineConfirmButton), not a destructive modal.
  const maintain = async (action: MaintenanceAction, target?: MaintenanceTarget, table?: string) => {
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
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</h2>
          <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 'var(--font-size-body)' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <InlineConfirmButton className="btn-ghost" disabled={Boolean(busy)} hint={maintenanceHint('purge_expired')} onConfirm={() => maintain('purge_expired')}>{t('cleanExpired')}</InlineConfirmButton>
          <button className="btn-ghost" type="button" onClick={() => void reload()}>{t('refresh')}</button>
        </div>
      </div>
      {error && <div className="admin-error">{error}</div>}
      {!health ? <p className="text-muted">{t('loading')}</p> : <>
        <div className="health-grid">
          <div className="health-card"><div className="health-label">{t('worker')}</div><div className="health-value">{health.worker.version}</div><div style={{ fontSize: 'var(--font-size-small)' }}>{health.worker.environment}</div></div>
          <div className="health-card"><div className="health-label">{t('agentHosts')}</div><div className="health-value">{fmtNum(health.runtime.onlineAgentHosts)} / {fmtNum(health.runtime.agentHosts)}</div><div style={{ fontSize: 'var(--font-size-small)' }}>{t('onlineRecently')}</div></div>
          <div className="health-card"><div className="health-label">{t('activeExecutions')}</div><div className="health-value">{fmtNum(health.runtime.activeExecutions)}</div><div style={{ fontSize: 'var(--font-size-small)' }}>{t('failed24h', { count: fmtNum(health.runtime.failedExecutions24h) })}</div></div>
          <div className="health-card"><div className="health-label">{t('bindings')}</div><div className="health-value">{Object.values(health.worker.bindings).filter(Boolean).length} / {Object.keys(health.worker.bindings).length}</div><div style={{ fontSize: 'var(--font-size-small)' }}>{t('configuredServices')}</div></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(health.worker.bindings).map(([name, ok]) => <span key={name} className={`badge ${ok ? 'badge-success' : 'badge-neutral'}`}>{name}: {ok ? t('bound') : t('missing')}</span>)}
        </div>
        {health.databases.map((db) => <div key={db.name} className="health-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div><strong style={{ textTransform: 'capitalize' }}>{t('neonDatabase', { name: db.name })}</strong><div className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>{db.databaseName ?? t('unavailable')} · {db.ok ? t('latency', { ms: db.latencyMs }) : db.error}</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>{formatBytes(db.totalBytes)}</strong><InlineConfirmButton className="btn-ghost" disabled={Boolean(busy) || !db.ok} hint={maintenanceHint('vacuum_analyze', db.name)} onConfirm={() => maintain('vacuum_analyze', db.name)}>{t('vacuumAnalyze')}</InlineConfirmButton></div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table" style={{ fontSize: 'var(--font-size-small)' }}><thead><tr><th>{t('colTable')}</th><th>{t('colSize')}</th><th>{t('colRows')}</th><th>{t('colWrites')}</th><th>{t('colLastVacuum')}</th><th></th></tr></thead><tbody>{db.tables.map((table) => <tr key={table.name}><td>{table.name}</td><td>{formatBytes(Number(table.totalBytes))}</td><td>{fmtNum(Number(table.estimatedRows))}</td><td>{fmtNum(Number(table.insertsSinceStatsReset) + Number(table.updatesSinceStatsReset) + Number(table.deletesSinceStatsReset))}</td><td>{table.lastAutovacuum ? fmtDateTime(table.lastAutovacuum) : '—'}</td><td><InlineConfirmButton className="btn-ghost" disabled={Boolean(busy)} hint={maintenanceHint('vacuum_analyze', db.name, table.name)} onConfirm={() => maintain('vacuum_analyze', db.name, table.name)}>{t('vacuum')}</InlineConfirmButton></td></tr>)}</tbody></table></div>
        </div>)}
      </>}
    </section>
  );
}
