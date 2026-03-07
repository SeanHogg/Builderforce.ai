'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type * as Y from 'yjs';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface CodeEditorProps {
  filePath?: string;
  content: string;
  onChange: (value: string) => void;
  ydoc?: Y.Doc | null;
}

function getLanguage(filePath?: string): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
  };
  return map[ext] || 'plaintext';
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
  );
}
