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
  const monacoRef = useRef<MonacoInstance | null>(null);
  // Bumped on every editor mount so the Yjs binding effect re-runs against the
  // fresh instance (e.g. after closing all files and reopening one).
  const [mountToken, setMountToken] = useState(0);
  // Per-project Monaco model path. Falls back to the bare path when no namespace.
  const modelPath = filePath
    ? (modelNamespace ? `${modelNamespace}/${filePath}` : filePath)
    : undefined;

  const handleMount = (editor: MonacoEditorInstance, monaco: MonacoInstance) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setMountToken((t) => t + 1);
  };

  // Bind the active file's Monaco model to its Yjs text. The editor remounts per
  // file (key={modelPath}), so onMount fires per file and bumps mountToken; this
  // effect (re)binds against the fresh instance. Empty shared docs are seeded
  // from the persisted content so the binding never blanks a file. Inert when
  // collaboration is unconfigured (ydoc is null) — the common case.
  useEffect(() => {
    const editor = editorRef.current;
    if (!mountToken || !editor || !ydoc || !filePath || !modelPath) return;
    let binding: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { MonacoBinding } = await import('y-monaco');
        if (cancelled) return;
        // Bind to the model for THIS exact path, not `editor.getModel()`: during a
        // file switch the editor's active model can still be the PREVIOUS file's
        // (model swap vs this effect race), and binding `filePath`'s shared text to
        // the wrong model cross-wires content — one file's edits land in another
        // (the "updating the wrong files" / HTML-into-package.json corruption).
        const monaco = monacoRef.current;
        const model =
          (monaco ? monaco.editor.getModel(monaco.Uri.parse(modelPath)) : null) ?? editor.getModel();
        if (!model) return;
        const yText = ydoc.getText(filePath);
        if (yText.length === 0 && content) {
          ydoc.transact(() => yText.insert(0, content));
        }
        // Only wire cursor/selection sync through the editor when it is actually
        // showing this model; otherwise bind the model alone (no editor awareness).
        const editors = editor.getModel() === model ? new Set([editor]) : new Set<MonacoEditorInstance>();
        binding = new MonacoBinding(yText, model, editors as Set<MonacoEditorInstance>);
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
  }, [filePath, modelPath, ydoc, mountToken]);

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
        // Remount per file. @monaco-editor/react applies the controlled `value`
        // to the editor's CURRENT model, but when BOTH `path` and `value` change
        // on a file switch the value can hit the OLD model before `path` swaps it
        // — clobbering the previous file's content (the "opening one file replaces
        // another's content" bug). A per-path key gives each file its own editor
        // instance + single model, so `value` can only ever land on its own model.
        // onMount fires per file → mountToken bumps → the Yjs effect (re)binds.
        key={modelPath}
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
