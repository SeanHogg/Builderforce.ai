'use client';

import { Component } from 'react';
import dynamic from 'next/dynamic';
import { getLanguage } from '@/lib/utils';
import { runtimeApi, type TaskFileContent } from '@/lib/builderforceApi';
import { useEffect, useState } from 'react';

/**
 * Read-only Monaco viewer for one changed file in the Changes tab.
 *
 * Fetches the file's current (ticket branch) + base (fork point) contents and
 * renders them in a Monaco diff editor — modified files show a side-by-side
 * diff, created/deleted files render the single side that exists. This is the
 * same Monaco surface the in-browser IDE uses, so reviewing an agent's change
 * here reads identically to reviewing it in the editor.
 */

/** Catches ChunkLoadError when Monaco fails to load and offers retry (reload). */
class EditorChunkErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Editor failed to load — retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const MonacoDiffEditor = dynamic(
  () => import(/* webpackChunkName: "monaco-editor-react" */ '@monaco-editor/react').then((m) => m.DiffEditor),
  { ssr: false, loading: () => <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading editor…</div> }
);

interface FileChangeViewerProps {
  taskId: number;
  path: string;
  height?: number;
}

export function FileChangeViewer({ taskId, path, height = 420 }: FileChangeViewerProps) {
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
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load file'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId, path]);

  const note: React.CSSProperties = { height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 16, textAlign: 'center' };

  if (loading) return <div style={note}>Loading {path}…</div>;
  if (error) return <div style={note}>{error}</div>;
  if (!data) return <div style={note}>No content.</div>;
  if (!data.bound) {
    return (
      <div style={note}>
        Can’t show file contents: {data.reason ?? 'no repo bound to this task'}. This run’s deliverables live only in its summary.
      </div>
    );
  }
  if (data.current == null && data.base == null) {
    return <div style={note}>No content found on the ticket branch for {path}.</div>;
  }

  return (
    <EditorChunkErrorBoundary>
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
          File truncated for display — open the pull request to see the full contents.
        </div>
      )}
    </EditorChunkErrorBoundary>
  );
}
