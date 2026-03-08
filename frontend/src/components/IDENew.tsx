'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { FileExplorer } from './FileExplorer';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { Terminal } from './Terminal';
import { AIChat } from './AIChat';
import { AITrainingPanel } from './AITrainingPanel';
import { AgentPublishPanel } from './AgentPublishPanel';
import { PreviewFrame } from './PreviewFrame';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { useWebContainer } from '@/hooks/useWebContainer';
import { useCollaboration } from '@/hooks/useCollaboration';
import type { Project, FileEntry, TrainingJob } from '@/lib/types';
import { saveFile, fetchFileContent, deleteFile, fetchFiles } from '@/lib/api';

interface IDEProps {
  project: Project;
  initialFiles: FileEntry[];
  onToggleLayout?: () => void;
}

type BottomTab = 'terminal' | 'preview';
type RightTab = 'files' | 'train' | 'publish';

export function IDE({ project, initialFiles, onToggleLayout }: IDEProps) {
  const [files, setFiles] = useState<FileEntry[]>(initialFiles);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal');
  const [rightTab, setRightTab] = useState<RightTab>('files');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [terminalWriter, setTerminalWriter] = useState<((data: string) => void) | undefined>();
  const [shellWriter, setShellWriter] = useState<WritableStreamDefaultWriter<string> | undefined>();
  const [isRunning, setIsRunning] = useState(false);
  const [completedJobs, setCompletedJobs] = useState<TrainingJob[]>([]);
  const shellStartedRef = useRef(false);

  const { state: wcState, mountFiles, runCommand, startShell, startDevServer, getOrBootWebContainer } = useWebContainer();
  const { doc: ydoc, connected: collabConnected } = useCollaboration(project.id, 'user-local');

  // Task 2: Boot WebContainer and spawn an interactive shell immediately on IDE load.
  // This makes the terminal live from the moment the IDE opens, not just after clicking Run.
  useEffect(() => {
    if (shellStartedRef.current) return;
    shellStartedRef.current = true;

    const initShell = async () => {
      try {
        await getOrBootWebContainer();
        // Wait for terminalWriter — poll briefly (terminal mounts asynchronously)
        let attempts = 0;
        const trySpawn = async () => {
          const writer = await startShell((data) => {
            setTerminalWriter((prev: ((data: string) => void) | undefined) => {
              prev?.(data);
              return prev;
            });
          });
          setShellWriter(writer);
        };
        // Retry a few times to wait for terminalWriter to be registered
        const waitAndSpawn = () => {
          attempts++;
          trySpawn().catch((e) => {
            if (attempts < 5) setTimeout(waitAndSpawn, 500);
            else console.warn('Shell spawn failed:', e);
          });
        };
        setTimeout(waitAndSpawn, 300);
      } catch (e) {
        console.warn('WebContainer boot failed (may not be supported in this browser):', e);
      }
    };

    initShell();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once terminalWriter is ready, wire up the shellWriter output to it
  const handleTerminalReady = useCallback((write: (data: string) => void) => {
    setTerminalWriter(() => write);
    // If shell is already started, we need to re-spawn with this writer
    if (!shellStartedRef.current) return;
    startShell((data) => write(data))
      .then(writer => setShellWriter(writer))
      .catch(e => console.warn('Shell re-spawn failed:', e));
  }, [startShell]);

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
      // Fetch all file contents not yet loaded
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

      terminalWriter?.('\r\n\x1b[36mMounting project files...\x1b[0m\r\n');
      await mountFiles(allContents);  // Task 1: now uses proper nested tree

      if (allContents['package.json']) {
        terminalWriter?.('\r\n\x1b[36mRunning npm install...\x1b[0m\r\n');
        await runCommand('npm', ['install'], (data) => terminalWriter?.(data));
      }

      // Start the dev server
      const url = await startDevServer((data) => terminalWriter?.(data));
      setPreviewUrl(url);
      setBottomTab('preview');
    } catch (e) {
      console.error('Failed to start dev server:', e);
      terminalWriter?.('\r\n\x1b[31mFailed to start dev server\x1b[0m\r\n');
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, startDevServer, mountFiles, runCommand, terminalWriter, files, fileContents, project.id]);

  const handleTerminalInput = useCallback((data: string) => {
    shellWriter?.write(data);
  }, [shellWriter]);

  // Refresh file list after create/delete
  const refreshFiles = useCallback(async () => {
    try {
      const updated = await fetchFiles(project.id);
      setFiles(updated);
    } catch { /* silent */ }
  }, [project.id]);

  const statusLabel = wcState.status === 'booting'
    ? '⏳ Booting…'
    : wcState.status === 'ready'
      ? '✅ Ready'
      : wcState.status === 'error'
        ? '⚠️ WC Error'
        : '';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      {/* Task 5: Top bar — claw logo, project name, back link, theme toggle, run button */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0, minHeight: 46,
      }}>
        {/* Left: back + logo + project */}
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', flexShrink: 0, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          ← Dashboard
        </Link>
        <Image src="/claw.png" alt="" width={20} height={20} style={{ filter: 'drop-shadow(0 0 6px var(--logo-glow))', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {project.name}
        </span>
        {project.description && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            — {project.description}
          </span>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right: collab status, WC status, theme toggle, layout toggle, run, share */}
        {onToggleLayout && (
          <button
            onClick={onToggleLayout}
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              flexShrink: 0,
              fontFamily: 'var(--font-display)',
            }}
            title="Switch to old layout"
          >
            🔄 Old Layout
          </button>
        )}
        {collabConnected && (
          <span style={{ fontSize: '0.72rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%', display: 'inline-block' }} />
            Live
          </span>
        )}
        {statusLabel && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{statusLabel}</span>
        )}
        <ThemeToggleButton />
        <button
          onClick={handleRun}
          disabled={isRunning}
          style={{
            background: isRunning ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '5px 14px', fontSize: '0.82rem', fontWeight: 600,
            cursor: isRunning ? 'wait' : 'pointer', fontFamily: 'var(--font-display)',
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            opacity: isRunning ? 0.6 : 1,
          }}
        >
          {isRunning ? '⏳ Running…' : '▶ Run'}
        </button>
        <button
          style={{
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
            padding: '5px 12px', fontSize: '0.82rem', cursor: 'pointer', flexShrink: 0,
          }}
        >
          Share
        </button>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* AI Chat */}
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: '1.5rem' }}>🤖</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                AI Assistant
              </div>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <AIChat
              projectId={project.id}
              activeFile={activeFile}
              activeFileContent={activeFile ? (fileContents[activeFile] || '') : undefined}
              onApplyCode={activeFile ? (code) => {
                setFileContents(prev => ({ ...prev, [activeFile]: code }));
                saveFile(project.id, activeFile, code).catch(console.error);
              } : undefined}
            />
          </div>
        </div>

        {/* Editor + Bottom panel */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Editor area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <EditorTabs
              openFiles={openFiles}
              activeFile={activeFile}
              onTabSelect={setActiveFile}
              onTabClose={closeTab}
            />
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <CodeEditor
                filePath={activeFile}
                content={activeFile ? (fileContents[activeFile] || '') : ''}
                onChange={handleEditorChange}
                ydoc={ydoc}
              />
            </div>
          </div>

          {/* Bottom panel */}
          <div style={{ height: 260, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
              {(['terminal', 'preview'] as BottomTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  style={{
                    padding: '6px 16px', fontSize: '0.8rem',
                    background: bottomTab === tab ? 'var(--bg-elevated)' : 'transparent',
                    color: bottomTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: 'none', borderTop: bottomTab === tab ? '2px solid var(--coral-bright)' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {tab === 'terminal' ? 'Terminal' : (
                    <>Preview {previewUrl && <span style={{ color: '#4ade80' }}>●</span>}</>
                  )}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, visibility: bottomTab === 'terminal' ? 'visible' : 'hidden', pointerEvents: bottomTab === 'terminal' ? 'auto' : 'none' }}>
                <Terminal
                  onReady={handleTerminalReady}
                  onInput={handleTerminalInput}
                />
              </div>
              <div style={{ position: 'absolute', inset: 0, visibility: bottomTab === 'preview' ? 'visible' : 'hidden', pointerEvents: bottomTab === 'preview' ? 'auto' : 'none' }}>
                <PreviewFrame url={previewUrl} />
              </div>
            </div>
          </div>
        </div>

        {/* Right panel: Files / Train / Publish */}
        <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            {([['files', '📁 Files'], ['train', '🧠 Train'], ['publish', '🚀 Publish']] as [RightTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1, padding: '7px 4px', fontSize: '0.72rem', fontWeight: 600,
                  background: rightTab === tab ? 'var(--bg-elevated)' : 'transparent',
                  color: rightTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none', borderTop: rightTab === tab ? '2px solid var(--coral-bright)' : '2px solid transparent',
                  cursor: 'pointer', fontFamily: 'var(--font-display)',
                  whiteSpace: 'nowrap',
                }}
              >{label}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'files' ? 'visible' : 'hidden', pointerEvents: rightTab === 'files' ? 'auto' : 'none' }}>
              <FileExplorer
                files={files}
                activeFile={activeFile}
                onFileSelect={openFile}
                onFileCreate={async (path) => { await handleFileCreate(path); refreshFiles(); }}
                onFileDelete={async (path) => { await handleFileDelete(path); refreshFiles(); }}
                showHeader={false}
              />
            </div>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'train' ? 'visible' : 'hidden', pointerEvents: rightTab === 'train' ? 'auto' : 'none' }}>
              <AITrainingPanel
                projectId={project.id}
                onLog={(msg) => terminalWriter?.(`\r\n\x1b[35m[Train]\x1b[0m ${msg}`)}
                onJobCompleted={(job) => setCompletedJobs(prev => {
                  const exists = prev.some(j => j.id === job.id);
                  return exists ? prev.map(j => j.id === job.id ? job : j) : [job, ...prev];
                })}
              />
            </div>
            <div style={{ position: 'absolute', inset: 0, visibility: rightTab === 'publish' ? 'visible' : 'hidden', pointerEvents: rightTab === 'publish' ? 'auto' : 'none' }}>
              <AgentPublishPanel projectId={project.id} completedJobs={completedJobs} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
