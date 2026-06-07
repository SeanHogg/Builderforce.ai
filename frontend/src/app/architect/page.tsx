'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { fetchProjects } from '@/lib/api';
import {
  startRepoAnalysis,
  fetchRepoAnalysisRun,
  fetchRepoAnalysisRuns,
  fetchRepoAnalysisArtifact,
  type RepoAnalysisRun,
  type RepoAnalysisArtifactMeta,
  type RepoAnalysisKind,
} from '@/lib/api';
import type { Project } from '@/lib/types';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { AgentAssignmentPanel } from '@/components/AgentAssignmentPanel';

const KIND_LABELS: Record<RepoAnalysisKind, string> = {
  diagnostic: 'Diagnostic',
  recommendation: 'Recommendation',
  business: 'Business Summary',
  arch_4plus1: '4+1 Architecture',
  antipatterns: 'Anti-Patterns',
  principles: 'Design Principles',
};

const TERMINAL = new Set(['completed', 'partial', 'failed']);

/**
 * Architect — the Digital-Transformation repo-analysis tool. Pick a project
 * with mapped repos, run a cloud-side analysis, watch progress, and read the
 * generated onboarding artifacts (diagnostic, recommendation, 4+1 views, etc.).
 */
export default function ArchitectPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [run, setRun] = useState<RepoAnalysisRun | null>(null);
  const [artifacts, setArtifacts] = useState<RepoAnalysisArtifactMeta[]>([]);
  const [activeKind, setActiveKind] = useState<RepoAnalysisKind | null>(null);
  const [bodyByKind, setBodyByKind] = useState<Partial<Record<RepoAnalysisKind, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noRepo, setNoRepo] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login?next=/architect');
    else if (!hasTenant) router.replace('/tenants?next=/architect');
  }, [isAuthenticated, hasTenant, router]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    fetchProjects()
      .then((p) => {
        setProjects(p);
        if (p.length && projectId == null) setProjectId(Number(p[0].id));
      })
      .catch(() => setError('Failed to load projects.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, hasTenant]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadRun = useCallback(async (runId: string) => {
    const { run: r, artifacts: a } = await fetchRepoAnalysisRun(runId);
    setRun(r);
    setArtifacts(a);
    setActiveKind((prev) => prev ?? (a.find((x) => x.status === 'complete')?.kind ?? a[0]?.kind ?? null));
    if (!TERMINAL.has(r.status)) {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const next = await fetchRepoAnalysisRun(runId);
          setRun(next.run);
          setArtifacts(next.artifacts);
          if (TERMINAL.has(next.run.status)) stopPolling();
        } catch {
          /* keep polling */
        }
      }, 3000);
    }
  }, [stopPolling]);

  // Load the latest run for the selected project.
  useEffect(() => {
    if (projectId == null) return;
    setRun(null);
    setArtifacts([]);
    setBodyByKind({});
    setActiveKind(null);
    setNoRepo(false);
    fetchRepoAnalysisRuns(projectId)
      .then(({ runs }) => {
        if (runs[0]) void loadRun(runs[0].id);
      })
      .catch(() => {});
  }, [projectId, loadRun]);

  useEffect(() => stopPolling, [stopPolling]);

  const onRun = async () => {
    if (projectId == null) return;
    setBusy(true);
    setError(null);
    setNoRepo(false);
    try {
      const { run: r } = await startRepoAnalysis(projectId);
      setBodyByKind({});
      setActiveKind(null);
      await loadRun(r.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('no_repo') || msg.toLowerCase().includes('repository')) setNoRepo(true);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  // Lazily load an artifact body when its tab is opened.
  useEffect(() => {
    if (!run || !activeKind) return;
    if (bodyByKind[activeKind] != null) return;
    const meta = artifacts.find((a) => a.kind === activeKind);
    if (!meta || meta.status !== 'complete') return;
    fetchRepoAnalysisArtifact(run.id, activeKind)
      .then(({ artifact }) => setBodyByKind((prev) => ({ ...prev, [activeKind]: artifact.bodyMd ?? '' })))
      .catch(() => {});
  }, [run, activeKind, artifacts, bodyByKind]);

  const running = run != null && !TERMINAL.has(run.status);
  const activeMeta = artifacts.find((a) => a.kind === activeKind) ?? null;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>🏛 Architect</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '6px 0 0' }}>
          Diagnose a legacy codebase from Day 1: what it does, a brownfield-vs-greenfield call, 4+1 architecture
          views, anti-patterns, and a design-principles assessment — generated for new employees and AI agents.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(Number(e.target.value))}
          style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', fontSize: '0.85rem' }}
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRun}
          disabled={busy || running || projectId == null}
          style={{
            padding: '8px 16px', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem',
            cursor: busy || running ? 'default' : 'pointer',
            background: busy || running ? 'var(--bg-elevated)' : 'var(--coral-bright)',
            color: busy || running ? 'var(--text-muted)' : '#fff', border: 'none',
          }}
        >
          {running ? 'Analyzing…' : busy ? 'Starting…' : 'Run Architecture Analysis'}
        </button>
      </div>

      {projectId != null && (
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
          <AgentAssignmentPanel
            scope="architecture"
            scopeId={projectId}
            title="Agents for this analysis"
            emptyHint="No agents assigned to architecture analysis for this project. Assign one to have it perform the analysis."
          />
        </div>
      )}

      {noRepo && (
        <div style={banner('var(--surface-coral-soft)')}>
          Map at least one repository to this project before running an analysis (GitHub, Bitbucket, or GitLab).
        </div>
      )}
      {error && <div style={banner('var(--surface-coral-soft)')}>{error}</div>}

      {run && (
        <>
          {running && (
            <div style={{ margin: '12px 0' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                {run.stage ?? run.status} — {run.progress}%
              </div>
              <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${run.progress}%`, height: '100%', background: 'var(--coral-bright)', transition: 'width .4s' }} />
              </div>
            </div>
          )}

          {run.status === 'failed' && (
            <div style={banner('var(--surface-coral-soft)')}>Analysis failed: {run.error ?? 'unknown error'}</div>
          )}
          {run.status === 'partial' && (
            <div style={banner('var(--bg-elevated)')}>Analysis finished with some sections unavailable.</div>
          )}

          {artifacts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0 12px' }}>
              {artifacts.map((a) => (
                <button
                  key={a.kind}
                  type="button"
                  onClick={() => setActiveKind(a.kind)}
                  style={{
                    padding: '6px 12px', borderRadius: 999, fontSize: '0.78rem', cursor: 'pointer',
                    border: '1px solid ' + (a.kind === activeKind ? 'var(--border-accent)' : 'var(--border-subtle)'),
                    background: a.kind === activeKind ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                    color: a.status === 'complete' ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {KIND_LABELS[a.kind]}
                  {a.status === 'skipped' && ' · Pro'}
                  {a.status === 'failed' && ' · ⚠'}
                </button>
              ))}
            </div>
          )}

          <div style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '14px 18px', minHeight: 120 }}>
            {!activeMeta && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Select a section above.</p>}
            {activeMeta?.status === 'skipped' && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                This analysis is available on the <strong>Pro</strong> plan. Upgrade to unlock the full architecture report.
              </p>
            )}
            {activeMeta?.status === 'failed' && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>This section could not be generated. Try re-running the analysis.</p>
            )}
            {activeMeta?.status === 'complete' && activeKind && (
              bodyByKind[activeKind] != null
                ? <ChatMessageContent content={bodyByKind[activeKind] as string} />
                : <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</p>
            )}
          </div>
        </>
      )}

      {!run && projectId != null && !running && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 16 }}>
          No analysis yet for this project. Click <strong>Run Architecture Analysis</strong> to generate one.
        </p>
      )}
    </div>
  );
}

function banner(bg: string): React.CSSProperties {
  return {
    background: bg, border: '1px solid var(--border-subtle)', borderRadius: 8,
    padding: '10px 14px', fontSize: '0.82rem', color: 'var(--text-primary)', margin: '10px 0',
  };
}
