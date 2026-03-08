'use client';

import { Component, useEffect, useRef } from 'react';
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
}

type MonacoEditorInstance = Parameters<
  NonNullable<React.ComponentProps<typeof MonacoEditor>['onMount']>
>[0];
type MonacoInstance = Parameters<
  NonNullable<React.ComponentProps<typeof MonacoEditor>['onMount']>
>[1];

export function CodeEditor({ filePath, content, onChange, ydoc }: CodeEditorProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const bindingRef = useRef<{ destroy: () => void } | null>(null);

  const handleMount = async (editor: MonacoEditorInstance, _monaco: MonacoInstance) => {
    editorRef.current = editor;

    if (ydoc && filePath) {
      try {
        const { MonacoBinding } = await import('y-monaco');
        const yText = ydoc.getText(filePath);
        const model = editor.getModel();
        if (model) {
          bindingRef.current = new MonacoBinding(
            yText,
            model,
            new Set([editor])
          );
        }
      } catch (e) {
        console.warn('Failed to init Yjs binding:', e);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [filePath]);

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
