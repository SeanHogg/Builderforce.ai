'use client';

import type * as Y from 'yjs';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';

interface CodePaneProps {
  openFiles: string[];
  activeFile?: string;
  fileContents: Record<string, string>;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
  onChange: (value: string) => void;
  ydoc?: Y.Doc | null;
}

/**
 * Shared file editor surface: tab strip + Monaco editor.
 *
 * Extracted so every modality that opens a file (Designer, LLM) renders the
 * same code view instead of each branch re-inlining EditorTabs + CodeEditor.
 */
export function CodePane({
  openFiles,
  activeFile,
  fileContents,
  onTabSelect,
  onTabClose,
  onChange,
  ydoc,
}: CodePaneProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <EditorTabs
        openFiles={openFiles}
        activeFile={activeFile}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
      />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CodeEditor
          key={activeFile ?? 'none'}
          filePath={activeFile}
          content={activeFile ? (fileContents[activeFile] ?? '') : ''}
          onChange={onChange}
          ydoc={ydoc}
        />
      </div>
    </div>
  );
}
