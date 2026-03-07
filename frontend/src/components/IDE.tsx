'use client';

import { useState, useCallback } from 'react';
import { FileExplorer } from './FileExplorer';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { Terminal } from './Terminal';
import { AIChat } from './AIChat';
import { AITrainingPanel } from './AITrainingPanel';
import { PreviewFrame } from './PreviewFrame';
import { useWebContainer } from '@/hooks/useWebContainer';
import { useCollaboration } from '@/hooks/useCollaboration';
import type { Project, FileEntry } from '@/lib/types';
import { saveFile, fetchFileContent, deleteFile } from '@/lib/api';

interface IDEProps {
  project: Project;
  initialFiles: FileEntry[];
}

type BottomTab = 'terminal' | 'preview';
type RightTab = 'ai' | 'train';

export function IDE({ project, initialFiles }: IDEProps) {
  const [files, setFiles] = useState<FileEntry[]>(initialFiles);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal');
  const [rightTab, setRightTab] = useState<RightTab>('ai');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [terminalWriter, setTerminalWriter] = useState<((data: string) => void) | undefined>();
  const [shellWriter, setShellWriter] = useState<WritableStreamDefaultWriter<string> | undefined>();
  const [isRunning, setIsRunning] = useState(false);

  const { state: wcState, mountFiles, runCommand, startShell, startDevServer } = useWebContainer();
  const { doc: ydoc, connected: collabConnected } = useCollaboration(project.id, 'user-local');

  const openFile = useCallback(async (path: string) => {
    setActiveFile(path);
    if (!openFiles.includes(path)) {
      setOpenFiles(prev => [...prev, path]);
    }
    if (!fileContents[path]) {
      try {
        const content = await fetchFileContent(project.id, path);
        setFileContents(prev => ({ ...prev, [path]: content }));
      } catch {
        setFileContents(prev => ({ ...prev, [path]: '' }));
      }
    }
  }, [openFiles, fileContents, project.id]);

  const closeTab = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f !== path);
      if (activeFile === path) {
        setActiveFile(next[next.length - 1]);
      }
      return next;
    });
  }, [activeFile]);

  const handleEditorChange = useCallback(async (value: string) => {
    if (!activeFile) return;
    setFileContents(prev => ({ ...prev, [activeFile]: value }));
    try {
      await saveFile(project.id, activeFile, value);
    } catch (e) {
      console.error('Failed to save:', e);
    }
  }, [activeFile, project.id]);

  const handleFileCreate = useCallback(async (path: string) => {
    try {
      await saveFile(project.id, path, '');
      setFiles(prev => [...prev, { path, content: '', type: 'file' }]);
      setFileContents(prev => ({ ...prev, [path]: '' }));
      openFile(path);
    } catch (e) {
      console.error('Failed to create file:', e);
    }
  }, [project.id, openFile]);

  const handleFileDelete = useCallback(async (path: string) => {
    try {
      await deleteFile(project.id, path);
      setFiles(prev => prev.filter(f => f.path !== path));
      closeTab(path);
    } catch (e) {
      console.error('Failed to delete file:', e);
    }
  }, [project.id, closeTab]);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setBottomTab('terminal');
    try {
      // Fetch any file contents not yet loaded and build the full map
      const allContents: Record<string, string> = { ...fileContents };
      const unfetched = files.filter(f => f.type === 'file' && !(f.path in allContents));
      await Promise.all(
        unfetched.map(async (f) => {
          try {
            allContents[f.path] = await fetchFileContent(project.id, f.path);
          } catch {
            allContents[f.path] = '';
          }
        })
      );
      setFileContents(allContents);

      // Mount files into the WebContainer
      terminalWriter?.('\r\n\x1b[36mMounting project files...\x1b[0m\r\n');
      await mountFiles(allContents);

      // Run npm install if package.json exists
      if (allContents['package.json']) {
        terminalWriter?.('\r\n\x1b[36mRunning npm install...\x1b[0m\r\n');
        await runCommand('npm', ['install'], (data) => terminalWriter?.(data));
      }

      // Spawn an interactive shell for the terminal panel
      const writer = await startShell((data) => terminalWriter?.(data));
      setShellWriter(writer);

      // Start the dev server
      const url = await startDevServer((data) => {
        terminalWriter?.(data);
      });
      setPreviewUrl(url);
      setBottomTab('preview');
    } catch (e) {
      console.error('Failed to start dev server:', e);
      terminalWriter?.('\r\n\x1b[31mFailed to start dev server\x1b[0m\r\n');
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, startDevServer, mountFiles, runCommand, startShell, terminalWriter, files, fileContents, project.id]);

  // Forward keystrokes directly to the WebContainer shell
  const handleTerminalInput = useCallback((data: string) => {
    shellWriter?.write(data);
  }, [shellWriter]);

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-blue-400 font-bold">⚡</span>
          <span className="font-semibold">{project.name}</span>
          {project.description && (
            <span className="text-gray-500 text-sm hidden md:block">— {project.description}</span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {collabConnected && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 bg-green-400 rounded-full inline-block" />
              Live
            </span>
          )}
          <span className="text-xs text-gray-500">
            {wcState.status === 'booting' ? '⏳ Booting...' : wcState.status === 'ready' ? '✅ Ready' : ''}
          </span>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded flex items-center gap-1"
          >
            {isRunning ? '⏳' : '▶'} Run
          </button>
          <button className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded">
            Share
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File Explorer */}
        <div className="w-60 shrink-0 border-r border-gray-700 overflow-hidden">
          <FileExplorer
            files={files}
            activeFile={activeFile}
            onFileSelect={openFile}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
          />
        </div>

        {/* Editor + Bottom */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Editor area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <EditorTabs
              openFiles={openFiles}
              activeFile={activeFile}
              onTabSelect={setActiveFile}
              onTabClose={closeTab}
            />
            <div className="flex-1 overflow-hidden">
              <CodeEditor
                filePath={activeFile}
                content={activeFile ? (fileContents[activeFile] || '') : ''}
                onChange={handleEditorChange}
                ydoc={ydoc}
              />
            </div>
          </div>

          {/* Bottom panel — both panels always mounted; CSS controls visibility */}
          <div className="h-72 border-t border-gray-700 flex flex-col shrink-0">
            <div className="flex items-center bg-gray-900 border-b border-gray-700">
              <button
                className={`px-4 py-1.5 text-sm ${bottomTab === 'terminal' ? 'bg-gray-800 text-white border-t-2 border-t-blue-500' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setBottomTab('terminal')}
              >
                Terminal
              </button>
              <button
                className={`px-4 py-1.5 text-sm ${bottomTab === 'preview' ? 'bg-gray-800 text-white border-t-2 border-t-blue-500' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setBottomTab('preview')}
              >
                Preview {previewUrl && <span className="ml-1 text-green-400">●</span>}
              </button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              {/* Terminal — always mounted so terminalWriter / shellWriter are never lost */}
              <div className={`absolute inset-0 ${bottomTab === 'terminal' ? '' : 'invisible pointer-events-none'}`}>
                <Terminal
                  onReady={(write) => setTerminalWriter(() => write)}
                  onInput={handleTerminalInput}
                />
              </div>
              {/* Preview iframe */}
              <div className={`absolute inset-0 ${bottomTab === 'preview' ? '' : 'invisible pointer-events-none'}`}>
                <PreviewFrame url={previewUrl} />
              </div>
            </div>
          </div>
        </div>

        {/* AI Chat / Training Panel */}
        <div className="w-72 shrink-0 border-l border-gray-700 overflow-hidden flex flex-col">
          {/* Right panel tabs */}
          <div className="flex border-b border-gray-700 shrink-0">
            <button
              className={`px-3 py-1.5 text-xs ${rightTab === 'ai' ? 'bg-gray-800 text-white border-t-2 border-t-blue-500' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setRightTab('ai')}
            >
              AI Assistant
            </button>
            <button
              className={`px-3 py-1.5 text-xs ${rightTab === 'train' ? 'bg-gray-800 text-white border-t-2 border-t-blue-500' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setRightTab('train')}
            >
              🧠 Train
            </button>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <div className={`absolute inset-0 ${rightTab === 'ai' ? '' : 'invisible pointer-events-none'}`}>
              <AIChat projectId={project.id} />
            </div>
            <div className={`absolute inset-0 ${rightTab === 'train' ? '' : 'invisible pointer-events-none'}`}>
              <AITrainingPanel
                projectId={project.id}
                onLog={(msg) => terminalWriter?.(`\r\n\x1b[35m[Train]\x1b[0m ${msg}`)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
