'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { clearBuildFailures, type BuildFailure } from '@/lib/buildDiagnostics';
import { useFormat } from '@/i18n/useFormat';

/**
 * What went wrong on the last run: build failures (a command and its output) and
 * runtime errors raised inside the preview. The same record the agent repairs
 * from, so what the person reads here is what the agent is told.
 */
export function ProblemsPanel({ projectId, failures }: { projectId: number; failures: BuildFailure[] }) {
  const t = useTranslations('builderPanels');
  const fmt = useFormat();

  if (failures.length === 0) {
    return <p style={{ margin: 0, padding: 12, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('noProblems')}</p>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', flexShrink: 0 }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => clearBuildFailures(projectId)}>{t('clearProblems')}</Button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '0 8px 8px', overflowY: 'auto', flex: 1, minHeight: 0, display: 'grid', gap: 6, alignContent: 'start' }}>
        {failures.map((failure) => (
          <li key={`${failure.firstSeen}:${failure.message}`} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)' }}>
            <details>
              <summary style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 'var(--font-size-small)' }}>
                <span style={{ fontWeight: 700, color: 'var(--error-text)' }}>{t(failure.source === 'build' ? 'sourceBuild' : 'sourceRuntime')}</span>
                <span style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{failure.message}</span>
                {failure.count > 1 && <span style={{ color: 'var(--text-muted)' }}>×{failure.count}</span>}
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{fmt.dateTime(failure.lastSeen)}</span>
              </summary>
              {(failure.command || failure.at || failure.detail) && (
                <pre style={{ margin: 0, padding: '6px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
                  {[failure.command, failure.at, failure.detail].filter(Boolean).join('\n')}
                </pre>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
