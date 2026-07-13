'use client';

/**
 * SecurityAuditPanel — the Security agent's SOC 2 audit results. Owner/Manager only.
 * Lists audit runs (status, findings, severity/criterion rollups, summary), lets an
 * admin trigger an on-demand audit, and expands a run to its finding tickets.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  securityAgentApi,
  type SecurityAudit,
  type SecurityAuditFinding,
} from '@/lib/builderforceApi';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' };

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626', high: '#f4726e', medium: '#f59e0b', low: '#3b82f6', info: '#6b7280',
};

function SeverityChip({ severity, count }: { severity: string; count: number }) {
  const color = SEVERITY_COLOR[severity] ?? 'var(--text-muted)';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
      background: `color-mix(in srgb, ${color} 15%, transparent)`, color,
      border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
    }}>
      {severity} {count}
    </span>
  );
}

export function SecurityAuditPanel() {
  const t = useTranslations('security');
  const [audits, setAudits] = useState<SecurityAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [findings, setFindings] = useState<Record<number, SecurityAuditFinding[]>>({});

  const load = () => {
    setLoading(true);
    securityAgentApi.listAudits()
      .then(setAudits)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const runNow = async () => {
    setRunning(true); setError(null);
    try {
      await securityAgentApi.runAudit();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start audit');
    } finally {
      setRunning(false);
    }
  };

  const toggle = async (id: number) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (findings[id]) return;
    try {
      const res = await securityAgentApi.getAudit(id);
      setFindings((prev) => ({ ...prev, [id]: res.findings }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load findings');
    }
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <div style={sectionTitle}>{t('auditTitle')}</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('auditSubtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={running}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600,
            background: 'var(--coral-bright, #f4726e)', color: '#fff',
            border: 'none', borderRadius: 8, cursor: running ? 'default' : 'pointer', opacity: running ? 0.7 : 1, flexShrink: 0,
          }}
        >
          {running ? t('auditStarting') : t('auditRunNow')}
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', margin: '10px 0' }}>{t('error', { message: error })}</div>}

      <div style={{ marginTop: 14 }}>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : audits.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>{t('auditEmpty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {audits.map((a) => {
              const sev = a.countsBySeverity ?? {};
              const isOpen = expanded === a.id;
              return (
                <div key={a.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => void toggle(a.id)}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: a.status === 'running' ? 'rgba(245,158,11,0.15)' : a.status === 'failed' ? 'rgba(220,38,38,0.15)' : 'rgba(34,197,94,0.12)',
                      color: a.status === 'running' ? '#f59e0b' : a.status === 'failed' ? '#dc2626' : '#22c55e',
                    }}>
                      {t(`auditStatus_${a.status}` as 'auditStatus_running' | 'auditStatus_complete' | 'auditStatus_failed')}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {t('auditFindings', { count: a.findingsCount })}
                    </span>
                    <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {Object.entries(sev).map(([s, c]) => <SeverityChip key={s} severity={s} count={c} />)}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(a.startedAt).toLocaleString()}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {a.summary && (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>{a.summary}</p>
                  )}

                  {isOpen && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                      {(findings[a.id] ?? []).length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('auditNoFindings')}</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(findings[a.id] ?? []).map((f) => {
                            const color = SEVERITY_COLOR[f.severity ?? 'info'] ?? 'var(--text-muted)';
                            return (
                              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{f.title}</span>
                                {f.tsc && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {t(`tsc_${f.tsc}` as 'tsc_security')}</span>}
                                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>{f.status}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
