'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { WorkflowDagView } from '@/components/WorkflowDagView';
import { StatusPill, cardStyle, subtleBtn } from '@/components/workflowRunUi';
import { useLiveOrchestration } from './useLiveOrchestration';

const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 16,
  minWidth: 0,
  maxWidth: 1200,
};

const columns: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  minWidth: 0,
  alignItems: 'stretch',
};

const listPane: CSSProperties = {
  ...cardStyle,
  flex: '1 1 280px',
  maxWidth: 360,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const dagPane: CSSProperties = {
  ...cardStyle,
  flex: '2 1 360px',
  minWidth: 0,
  minHeight: 280,
};

const runBtn: CSSProperties = {
  ...subtleBtn,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: '100%',
  minHeight: 44,
  textAlign: 'left',
  padding: '8px 12px',
};

const selectedRunBtn: CSSProperties = {
  ...runBtn,
  background: 'var(--bg-elevated)',
  boxShadow: 'inset 0 0 0 1px var(--coral-bright)',
};

export function LiveOrchestrationWorkspace({ projectId }: { projectId?: number | null }) {
  const t = useTranslations('orchestrationWorkspace');
  const {
    runs,
    loading,
    error,
    selectedId,
    selected,
    graph,
    graphLoading,
    select,
    refresh,
  } = useLiveOrchestration(projectId);

  return (
    <div data-testid="live-orchestration-workspace" style={wrap}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: '1 1 240px' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--font-size-title)', color: 'var(--text-primary)' }}>{t('title')}</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" onClick={() => { void refresh(); }} style={{ ...subtleBtn, minHeight: 44 }}>
            {t('refresh')}
          </button>
          <a
            href="/create"
            style={{ ...subtleBtn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', minHeight: 44 }}
          >
            {t('openCanvas')}
          </a>
        </div>
      </header>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('authoringHint')}</p>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('loading')}</p>
      ) : error ? (
        <p role="alert" style={{ color: 'var(--text-danger, var(--coral-bright))' }}>{t('error')}</p>
      ) : (
        <div style={columns}>
          <aside style={listPane} aria-label={t('selectRun')}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{t('selectRun')}</strong>
              <span style={{ fontSize: 'var(--font-size-field-label)', color: 'var(--text-muted)' }}>{t('live')}</span>
            </div>
            {runs.length === 0 ? (
              <p data-testid="live-orchestration-empty" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
                {t('empty')}
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {runs.map((run) => {
                  const active = run.id === selectedId;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        data-testid={`live-orchestration-run-${run.id}`}
                        aria-pressed={active}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => select(run.id)}
                        style={active ? selectedRunBtn : runBtn}
                      >
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {run.description?.trim() || t('unnamed')}
                          </span>
                          {(run.projectName || run.agentHostName) && (
                            <span style={{ fontSize: 'var(--font-size-field-label)', color: 'var(--text-muted)' }}>
                              {[run.projectName, run.agentHostName].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        <StatusPill status={run.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section style={dagPane} data-testid="live-orchestration-dag" aria-live="polite">
            {!selectedId ? (
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('empty')}</p>
            ) : graphLoading && !graph ? (
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('loadingGraph')}</p>
            ) : graph ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {selected?.description?.trim() || t('unnamed')}
                  </strong>
                  {selected ? <StatusPill status={selected.status} /> : null}
                </div>
                <WorkflowDagView nodes={graph.nodes} edges={graph.edges} />
              </>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('noGraph')}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
