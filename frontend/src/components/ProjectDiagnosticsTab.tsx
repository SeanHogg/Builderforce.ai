'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toolsApi } from '@/lib/builderforceApi';
import { runArchitectureAnalysis } from '@/lib/api';
import { DiagnosticsResultsPanel } from '@/components/DiagnosticsResultsPanel';
import type { ProjectScore, ToolSummary } from '@/lib/tools';

/** The architecture analysis is just another diagnostic — a run-only one (it
 *  kicks off the repo analysis rather than navigating to the tool runner). */
const ARCHITECTURE_DIAGNOSTIC_ID = 'architecture-analysis';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8,
};
const primaryBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
};
const subtleBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, textDecoration: 'none',
  background: 'var(--surface-interactive)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap', cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8,
  background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', whiteSpace: 'nowrap', cursor: 'pointer',
};

interface DiagnosticRow { id: string; name: string; tagline: string; icon: string; isArchitecture: boolean }

/**
 * Project diagnostics: one list of diagnostics (architecture analysis is just
 * another row), each runnable against the project, with a Results button that
 * opens the shared slide-out — combined at the top, or filtered to one row.
 */
export function ProjectDiagnosticsTab({ projectId }: { projectId: number }) {
  const t = useTranslations('projectDiagnostics');
  const [score, setScore] = useState<ProjectScore | null>(null);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archState, setArchState] = useState<'idle' | 'running' | 'started' | 'error'>('idle');
  const [archMsg, setArchMsg] = useState('');
  const [results, setResults] = useState<{ open: boolean; filterToolId: string | null }>({ open: false, filterToolId: null });

  const loadScore = useCallback(async () => {
    try {
      setScore(await toolsApi.projectScore(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadScore(), toolsApi.list().then(setTools).catch(() => {})])
      .finally(() => setLoading(false));
  }, [loadScore]);

  const runArchitecture = async () => {
    setArchState('running');
    setArchMsg('');
    try {
      await runArchitectureAnalysis(projectId);
      setArchState('started');
      setArchMsg(t('architectureStarted'));
    } catch (e) {
      setArchState('error');
      const m = e instanceof Error ? e.message : t('architectureError');
      setArchMsg(m.includes('no_repo') ? t('architectureNeedsRepo') : m);
    }
  };

  // Architecture first, then the registered tools — one uniform list.
  const rows = useMemo<DiagnosticRow[]>(() => [
    { id: ARCHITECTURE_DIAGNOSTIC_ID, name: t('architectureTitle'), tagline: t('architectureDesc'), icon: '📐', isArchitecture: true },
    ...tools.map((tool) => ({ id: tool.id, name: tool.name, tagline: tool.tagline, icon: tool.icon, isArchitecture: false })),
  ], [tools, t]);

  const hasRun = useCallback((toolId: string) => score?.diagnostics.some((d) => d.toolId === toolId) ?? false, [score]);
  const anyRun = (score?.diagnostics.length ?? 0) > 0;

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('intro')}</p>
        </div>
        {anyRun && (
          <button type="button" onClick={() => setResults({ open: true, filterToolId: null })} style={ghostBtn}>
            {t('viewResults')} →
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.12)', color: '#ef4444', borderRadius: 8 }}>
          {t('loadError')}: {error}
        </div>
      )}

      {archMsg && (
        <div style={{ fontSize: 12, color: archState === 'error' ? '#ef4444' : '#22c55e' }}>{archMsg}</div>
      )}

      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('runOther')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{t('runOtherDesc')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => {
            const diag = score?.diagnostics.find((d) => d.toolId === row.id);
            return (
              <div key={row.id} style={rowStyle}>
                <span style={{ fontSize: 18 }}>{row.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{row.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {diag?.score != null ? `${diag.score.toFixed(1)} / 5 — ${diag.scoreLabel}` : row.tagline}
                  </div>
                </div>
                {hasRun(row.id) && (
                  <button type="button" onClick={() => setResults({ open: true, filterToolId: row.id })} style={subtleBtn}>
                    {t('results')}
                  </button>
                )}
                {row.isArchitecture ? (
                  <button
                    type="button"
                    onClick={runArchitecture}
                    disabled={archState === 'running'}
                    style={{ ...primaryBtn, opacity: archState === 'running' ? 0.6 : 1, cursor: archState === 'running' ? 'not-allowed' : 'pointer' }}
                  >
                    {archState === 'running' ? t('architectureRunning') : t('run')} →
                  </button>
                ) : (
                  <Link href={`/tools/${row.id}?project=${projectId}`} style={primaryBtn}>{t('run')} →</Link>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <DiagnosticsResultsPanel
        open={results.open}
        onClose={() => setResults({ open: false, filterToolId: null })}
        score={score}
        filterToolId={results.filterToolId}
      />
    </div>
  );
}
