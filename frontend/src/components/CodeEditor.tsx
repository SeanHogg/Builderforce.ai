'use client';

import { Component, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { getLanguage } from '@/lib/utils';
import type * as Y from 'yjs';

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
        <div className="h-full flex items-center justify-center bg-gray-900 text-gray-600">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-4">📝</div>
            <p className="text-sm mb-2">Editor failed to load (chunk error).</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded bg-gray-700 text-white text-sm hover:bg-gray-600"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MonacoEditor = dynamic(
  () => import(/* webpackChunkName: "monaco-editor-react" */ '@monaco-editor/react'),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center bg-gray-900 text-gray-500"><div className="text-center"><div className="text-4xl mb-4">📝</div><p className="text-sm">Loading editor…</p></div></div> }
);

interface CodeEditorProps {
  filePath?: string;
  content: string;
  onChange: (value: string) => void;
  ydoc?: Y.Doc | null;
  /**
   * Prefix for the Monaco model path. Monaco caches one model per Uri globally,
   * so without a per-project prefix a same-named file (e.g. package.json) in a
   * second project would reuse the first project's model and show its content.
   */
  modelNamespace?: string;
}

type MonacoEditorInstance = Parameters<
  NonNullable<React.ComponentProps<typeof MonacoEditor>['onMount']>
>[0];
type MonacoInstance = Parameters<
  NonNullable<React.ComponentProps<typeof MonacoEditor>['onMount']>
>[1];

export function CodeEditor({ filePath, content, onChange, ydoc, modelNamespace }: CodeEditorProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  // Bumped on every editor mount so the Yjs binding effect re-runs against the
  // fresh instance (e.g. after closing all files and reopening one).
  const [mountToken, setMountToken] = useState(0);
  // Per-project Monaco model path. Falls back to the bare path when no namespace.
  const modelPath = filePath
    ? (modelNamespace ? `${modelNamespace}/${filePath}` : filePath)
    : undefined;

  const handleMount = (editor: MonacoEditorInstance, _monaco: MonacoInstance) => {
    editorRef.current = editor;
    setMountToken((t) => t + 1);
  };

  // Bind the active file's Monaco model to its Yjs text. The editor is now
  // persistent across file switches (no key remount), so onMount fires once —
  // (re)binding has to live in an effect keyed on the active file. Empty shared
  // docs are seeded from the persisted content so the binding never blanks a
  // file. Inert when collaboration is unconfigured (ydoc is null).
  useEffect(() => {
    const editor = editorRef.current;
    if (!mountToken || !editor || !ydoc || !filePath) return;
    let binding: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { MonacoBinding } = await import('y-monaco');
        if (cancelled) return;
        const model = editor.getModel();
        if (!model) return;
        const yText = ydoc.getText(filePath);
        if (yText.length === 0 && content) {
          ydoc.transact(() => yText.insert(0, content));
        }
        binding = new MonacoBinding(yText, model, new Set([editor]));
      } catch (e) {
        console.warn('Failed to init Yjs binding:', e);
      }
    })();
    return () => {
      cancelled = true;
      binding?.destroy();
    };
    // `content` is intentionally excluded: it changes on every keystroke and we
    // only seed on (re)bind, not on edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, ydoc, mountToken]);

  if (!filePath) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900 text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-4">📝</div>
          <p>Select a file to start editing</p>
        </div>
      </div>
    );
  }

  return (
    <EditorChunkErrorBoundary>
      <MonacoEditor
        height="100%"
        path={modelPath}
        language={getLanguage(filePath)}
        value={content}
        theme="vs-dark"
        onChange={(value) => onChange(value || '')}
        onMount={handleMount}
        options={{
          fontSize: 14,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderWhitespace: 'selection',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        }}
      />
    </EditorChunkErrorBoundary>
  );
}
