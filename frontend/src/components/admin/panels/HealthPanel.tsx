'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { adminApi, type AdminHealth, type ImpersonationSession } from '@/lib/adminApi';
import {
  AdminError,
  AdminLoading,
  ModelPoolBadges,
  errText,
  fmtDateTime,
  fmtNum,
} from '../adminShared';
import { PlatformTrends } from './PlatformTrends';

export default function HealthPanel() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [activeSessions, setActiveSessions] = useState<ImpersonationSession[]>([]);
  const [activeSessionsLoaded, setActiveSessionsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([adminApi.health(), adminApi.impersonationList({ limit: 20 })])
      .then(([h, sessions]) => {
        setHealth(h);
        setActiveSessions(sessions.sessions.filter((s) => !s.endedAt));
        setActiveSessionsLoaded(true);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && !health) return <AdminLoading />;
  if (!health) {
    return <AdminError message={error} />;
  }

  return (
    <>
      <AdminError message={error} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span className="text-muted" style={{ fontSize: 14 }}>{t('health.lastUpdated')} {health.timestamp ? fmtDateTime(health.timestamp) : '—'}</span>
          <button type="button" className="btn-ghost" onClick={() => reload()}>↻ {t('common.refresh')}</button>
        </div>
        <div className={`health-card ${health.db.ok ? 'health-ok' : 'health-degraded'}`} style={{ padding: 16 }}>
          <div className="health-label">{t('health.systemStatus')}</div>
          <div className="health-value" style={{ fontSize: 18 }}>{health.db.ok ? t('health.ok') : t('health.degraded')}</div>
          <div style={{ fontSize: 12 }}>{t('health.dbLatency', { ms: health.db.latencyMs })}</div>
        </div>
        <div className="health-grid">
          <div className="health-card">
            <div className="health-label">{t('health.users')}</div>
            <div className="health-value">{fmtNum(health.platform.userCount)}</div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('health.tenants')}</div>
            <div className="health-value">{fmtNum(health.platform.tenantCount)}</div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('health.paidWorkspaces')}</div>
            <div className="health-value">{fmtNum(health.platform.paidTenantCount)}</div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('health.agentHosts')}</div>
            <div className="health-value">{fmtNum(health.platform.agentHostCount)}</div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('health.executions')}</div>
            <div className="health-value">{fmtNum(health.platform.executionCount)}</div>
          </div>
          <div className="health-card">
            <div className="health-label">{t('health.errorsLog')}</div>
            <div className="health-value">{fmtNum(health.platform.errorCount)}</div>
            {health.platform.errorCount > 0 && (
              <button
                type="button"
                className="btn-ghost"
                style={{ marginTop: 4, fontSize: 12 }}
                onClick={() => router.push('/admin?tab=logs')}
              >
                {t('health.viewErrors')}
              </button>
            )}
          </div>
        </div>
        {/* Platform-wide historical trends (growth / LLM usage / error volume). */}
        <PlatformTrends />

        <div>
          <div className="health-label" style={{ marginBottom: 12 }}>{t('health.llmPool', { n: health.llm.pool })}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ModelPoolBadges label={t('health.freeModels')}    keyPrefix="free" models={health.llm.free ?? health.llm.models} />
            <ModelPoolBadges label={t('health.premiumModels')} keyPrefix="pro"  models={health.llm.pro  ?? []} />
            {(health.llm.premiumFallback?.length ?? 0) > 0 && (
              <ModelPoolBadges label={t('health.premiumFallback')} keyPrefix="fallback" models={health.llm.premiumFallback ?? []} />
            )}
          </div>
        </div>

        {/* Active Impersonation Sessions */}
        {activeSessionsLoaded && (
          <div>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                {t('health.activeEmulationSessions')}
                {activeSessions.length > 0 && (
                  <span style={{ marginLeft: 8, background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 8px', fontSize: 12 }}>
                    {activeSessions.length}
                  </span>
                )}
              </h3>
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  const sessions = await adminApi.impersonationList({ limit: 20 });
                  setActiveSessions(sessions.sessions.filter((s) => !s.endedAt));
                }}
              >
                ↻
              </button>
            </div>
            {activeSessions.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>{t('health.noActiveSessions')}</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>{t('health.target')}</th>
                      <th>{t('health.workspace')}</th>
                      <th>{t('health.role')}</th>
                      <th>{t('health.started')}</th>
                      <th>{t('health.pages')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.targetEmail}</td>
                        <td>{s.tenantName}</td>
                        <td><span className="badge badge-neutral">{s.roleOverride}</span></td>
                        <td className="text-muted">{fmtDateTime(s.startedAt)}</td>
                        <td>{s.pagesVisited.length}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ color: '#ef4444', fontSize: 12 }}
                            onClick={async () => {
                              try {
                                await adminApi.impersonationEnd(s.id);
                                setActiveSessions((prev) => prev.filter((x) => x.id !== s.id));
                              } catch (e) { setError(errText(e)); }
                            }}
                          >
                            {t('health.terminate')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
