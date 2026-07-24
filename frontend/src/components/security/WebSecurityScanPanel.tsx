'use client';

/**
 * WebSecurityScanPanel — the "point at your live website, get findings now" surface.
 * Owner/Manager only. Configure a target URL, run a deterministic external scan in
 * the request, and see the posture score, the baseline delta vs the last scan, and
 * every finding (each already filed as a SECURITY ticket for remediation).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  securityAgentApi,
  type WebScanRun,
  type WebScanFinding,
  type WebScanRunResult,
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
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

/** Score band → colour (>=80 good, >=50 fair, else poor). */
function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#dc2626';
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `conic-gradient(${color} ${score * 3.6}deg, var(--surface-interactive) 0deg)`,
      }}>
        <div style={{
          width: 58, height: 58, borderRadius: '50%', background: 'var(--bg-base)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 800, color,
        }}>{score}</div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{score}<span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>/100</span></div>
      </div>
    </div>
  );
}

export function WebSecurityScanPanel() {
  const t = useTranslations('security');
  const [target, setTarget] = useState('');
  const [savedTarget, setSavedTarget] = useState<string | null>(null);
  const [scans, setScans] = useState<WebScanRun[]>([]);
  const [result, setResult] = useState<WebScanRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFinding, setOpenFinding] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([securityAgentApi.getWebScanConfig(), securityAgentApi.listWebScans()])
      .then(([cfg, list]) => {
        setSavedTarget(cfg.targetUrl);
        setTarget((prev) => prev || cfg.targetUrl || '');
        setScans(list);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const saveTarget = async () => {
    setSaving(true); setError(null);
    try {
      const res = await securityAgentApi.setWebScanTarget(target.trim() || null);
      setSavedTarget(res.targetUrl);
      if (res.targetUrl) setTarget(res.targetUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runScan = async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await securityAgentApi.runWebScan(target.trim() || undefined);
      setResult(res);
      setSavedTarget(res.targetUrl);
      securityAgentApi.listWebScans().then(setScans).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setRunning(false);
    }
  };

  const sortedFindings = (fs: WebScanFinding[]) =>
    [...fs].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  const sevLabel = (s: string) => t(`sev_${s}` as 'sev_critical');
  const deltaChip = (delta: number) => {
    const up = delta >= 0;
    const color = up ? '#22c55e' : '#dc2626';
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
        background: `color-mix(in srgb, ${color} 15%, transparent)`, color,
      }}>
        {t('webScoreDelta', { delta: `${up ? '+' : ''}${delta}` })}
      </span>
    );
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={sectionTitle}>{t('webTitle')}</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('webSubtitle')}</p>
      </div>

      {/* Configure + run */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <input
          type="url"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={t('webUrlPlaceholder')}
          aria-label={t('webUrlLabel')}
          onKeyDown={(e) => { if (e.key === 'Enter' && !running) void runScan(); }}
          style={{
            flex: '1 1 240px', minWidth: 0, padding: '9px 12px', fontSize: 13,
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
          }}
        />
        <button
          type="button"
          onClick={() => void saveTarget()}
          disabled={saving || !target.trim() || target.trim() === savedTarget}
          style={{
            padding: '9px 14px', fontSize: 13, fontWeight: 600, flexShrink: 0,
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
            cursor: saving ? 'default' : 'pointer', opacity: (!target.trim() || target.trim() === savedTarget) ? 0.5 : 1,
          }}
        >
          {saving ? t('loading') : t('webSave')}
        </button>
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={running || !target.trim()}
          style={{
            padding: '9px 16px', fontSize: 13, fontWeight: 700, flexShrink: 0,
            background: 'var(--coral-bright, #f4726e)', color: '#fff',
            border: 'none', borderRadius: 8,
            cursor: running || !target.trim() ? 'default' : 'pointer', opacity: running || !target.trim() ? 0.7 : 1,
          }}
        >
          {running ? t('webRunning') : t('webRunNow')}
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright)', margin: '10px 0 0' }}>{t('error', { message: error })}</div>}

      {/* Latest result */}
      {result && (
        <div style={{ marginTop: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <ScoreGauge score={result.score} label={t('webScore')} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              {result.baseline.scoreDelta == null
                ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('webBaselineFirst')}</span>
                : deltaChip(result.baseline.scoreDelta)}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {result.baseline.newFindings > 0 && (
                  <span style={{ fontSize: 11, color: '#f4726e' }}>{t('webNewFindings', { count: result.baseline.newFindings })}</span>
                )}
                {result.baseline.resolvedFindings > 0 && (
                  <span style={{ fontSize: 11, color: '#22c55e' }}>{t('webResolved', { count: result.baseline.resolvedFindings })}</span>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('webFindingsFiled', { count: result.recorded })}</span>
            </div>
          </div>

          <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            {result.findings.length === 0 ? (
              <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>✓ {t('webNoIssues')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sortedFindings(result.findings).map((f) => {
                  const color = SEVERITY_COLOR[f.severity] ?? 'var(--text-muted)';
                  const isOpen = openFinding === f.checkId;
                  return (
                    <div key={f.checkId} style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }}
                        onClick={() => setOpenFinding(isOpen ? null : f.checkId)}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                          background: `color-mix(in srgb, ${color} 15%, transparent)`, color,
                          border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
                        }}>{sevLabel(f.severity)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{f.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          <p style={{ margin: '0 0 8px' }}>{f.detail}</p>
                          <p style={{ margin: 0 }}>
                            <strong style={{ color: 'var(--text-primary)' }}>{t('webRecommendation')}:</strong> {f.recommendation}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* History */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('webHistory')}</div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
        ) : scans.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('webNoHistory')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scans.map((s) => {
              const sev = s.countsBySeverity ?? {};
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, flexWrap: 'wrap' }}>
                  {s.score != null && (
                    <span style={{ fontWeight: 800, color: scoreColor(s.score), flexShrink: 0 }}>{s.score}</span>
                  )}
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-all', minWidth: 0 }}>{s.targetUrl ?? '—'}</span>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {SEVERITY_ORDER.filter((k) => sev[k]).map((k) => (
                      <span key={k} style={{ fontSize: 10, fontWeight: 700, color: SEVERITY_COLOR[k] }}>{sev[k]} {sevLabel(k)}</span>
                    ))}
                  </span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', flexShrink: 0 }}>{new Date(s.startedAt).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
