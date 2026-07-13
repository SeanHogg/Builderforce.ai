'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { getLanguage } from '@/lib/utils';
import { runtimeApi, type TaskFileContent } from '@/lib/builderforceApi';
import { useEffect, useState } from 'react';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';

/**
 * Read-only Monaco viewer for one changed file in the Changes tab.
 *
 * Fetches the file's current (ticket branch) + base (fork point) contents and
 * renders them in a Monaco diff editor — modified files show a side-by-side
 * diff, created/deleted files render the single side that exists. This is the
 * same Monaco surface the in-browser IDE uses, so reviewing an agent's change
 * here reads identically to reviewing it in the editor.
 */

/** Localized diff-editor loading placeholder (dynamic's `loading` is a component). */
function DiffLoading() {
  const t = useTranslations('fileChangeViewer');
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      {t('loadingEditor')}
    </div>
  );
}

const MonacoDiffEditor = dynamic(
  () => import(/* webpackChunkName: "monaco-editor-react" */ '@monaco-editor/react').then((m) => m.DiffEditor),
  { ssr: false, loading: () => <DiffLoading /> }
);

interface FileChangeViewerProps {
  taskId: number;
  path: string;
  height?: number;
}

export function FileChangeViewer({ taskId, path, height = 420 }: FileChangeViewerProps) {
  const t = useTranslations('fileChangeViewer');
  const [data, setData] = useState<TaskFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    runtimeApi.taskFileContent(taskId, path)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : t('loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId, path, t]);

  const note: React.CSSProperties = { height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 16, textAlign: 'center' };

  if (loading) return <div style={note}>{t('loadingFile', { path })}</div>;
  if (error) return <div style={note}>{error}</div>;
  if (!data) return <div style={note}>{t('noContent')}</div>;
  if (!data.bound) {
    return (
      <div style={note}>
        {t('cannotShow', { reason: data.reason ?? t('noRepoBound') })}
      </div>
    );
  }
  if (data.current == null && data.base == null) {
    return <div style={note}>{t('noContentOnBranch', { path })}</div>;
  }

  return (
    <ChunkErrorBoundary compact>
      <div style={{ height, border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        <MonacoDiffEditor
          height="100%"
          language={getLanguage(path)}
          original={data.base ?? ''}
          modified={data.current ?? ''}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: data.base != null && data.current != null,
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          }}
        />
      </div>
      {(data.currentTruncated || data.baseTruncated) && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {t('truncated')}
        </div>
      )}
    </ChunkErrorBoundary>
  );
}
