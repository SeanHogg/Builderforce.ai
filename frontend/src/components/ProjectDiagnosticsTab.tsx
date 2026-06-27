'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toolsApi } from '@/lib/builderforceApi';
import { runArchitectureAnalysis } from '@/lib/api';
import { ToolResultView } from '@/components/tools/ToolResultView';
import type { ProjectScore, ToolSummary } from '@/lib/tools';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8,
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, textDecoration: 'none',
  background: 'var(--surface-interactive)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap',
};

/**
 * Project diagnostics: run diagnostics against this project, see the resulting
 * rating, and trigger the architecture analysis (itself a tracked diagnostic).
 * The rating aggregates the latest run of each diagnostic and rolls up to the
 * tenant (see the workspace rating on the Diagnostics hub).
 */
export function ProjectDiagnosticsTab({ projectId }: { projectId: number }) {
  const t = useTranslations('projectDiagnostics');
  const [score, setScore] = useState<ProjectScore | null>(null);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archState, setArchState] = useState<'idle' | 'running' | 'started' | 'error'>('idle');
  const [archMsg, setArchMsg] = useState('');

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
      setArchMsg(e instanceof Error ? e.message : t('architectureError'));
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('intro')}</p>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.12)', color: '#ef4444', borderRadius: 8 }}>
          {t('loadError')}: {error}
        </div>
      )}

      {/* Overall project rating */}
      {score && score.diagnostics.length > 0 ? (
        <ToolResultView result={score.result} />
      ) : (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{t('noRuns')}</div>
      )}

      {/* Architecture analysis — a tracked diagnostic */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t('architectureTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t('architectureDesc')}</div>
          </div>
          <button
            type="button"
            onClick={runArchitecture}
            disabled={archState === 'running'}
            style={{ ...primaryBtn, opacity: archState === 'running' ? 0.6 : 1, cursor: archState === 'running' ? 'not-allowed' : 'pointer' }}
          >
            {archState === 'running' ? t('architectureRunning') : t('runArchitecture')}
          </button>
        </div>
        {archMsg && (
          <div style={{ fontSize: 12, marginTop: 10, color: archState === 'error' ? '#ef4444' : '#22c55e' }}>{archMsg}</div>
        )}
      </div>

      {/* Run another diagnostic against this project */}
      {tools.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('runOther')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{t('runOtherDesc')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tools.map((tool) => (
              <div key={tool.id} style={rowStyle}>
                <span style={{ fontSize: 18 }}>{tool.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{tool.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.tagline}</div>
                </div>
                <Link href={`/tools/${tool.id}?projectId=${projectId}`} style={linkBtn}>{t('run')} →</Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
