'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FileExplorer } from './FileExplorer';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { Terminal } from './Terminal';
import { ProjectAIChat } from './ProjectAIChat';
import { AITrainingPanel } from './AITrainingPanel';
import { AgentPublishPanel } from './AgentPublishPanel';
import { PreviewFrame } from './PreviewFrame';
import { ProjectsSlideOutPanel } from './ProjectsSlideOutPanel';
import { useWebContainer } from '@/hooks/useWebContainer';
import { useCollaboration } from '@/hooks/useCollaboration';
import type { Project, FileEntry, TrainingJob } from '@/lib/types';
import { saveFile, fetchFileContent, deleteFile, fetchFiles, updateProject } from '@/lib/api';
import { brain } from '@/lib/builderforceApi';

interface IDEProps {
  project: Project;
  initialFiles: FileEntry[];
  onProjectUpdate?: (project: Project) => void;
  /** Open the project details slide-out panel. */
  onOpenProjectDetails?: () => void;
  /** When opening from "Open in IDE" with a chat, select this project chat on load. */
  initialChatId?: number | null;
}

type CenterView = 'preview' | 'code';
type RightTab = 'files' | 'train' | 'publish';

export function IDE({ project, initialFiles, onProjectUpdate, onOpenProjectDetails, initialChatId }: IDEProps) {
  const router = useRouter();
  const [files, setFiles] = useState<FileEntry[]>(initialFiles);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [centerView, setCenterView] = useState<CenterView>('preview');
  const [rightTab, setRightTab] = useState<RightTab>('files');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [terminalWriter, setTerminalWriter] = useState<((data: string) => void) | undefined>();
  const [shellWriter, setShellWriter] = useState<WritableStreamDefaultWriter<string> | undefined>();
  const [isRunning, setIsRunning] = useState(false);
  const [completedJobs, setCompletedJobs] = useState<TrainingJob[]>([]);
  const [projectTitle, setProjectTitle] = useState(project.name);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [projectsPanelOpen, setProjectsPanelOpen] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(true);
  const shellStartedRef = useRef(false);
  const terminalWriteRef = useRef<((data: string) => void) | null>(null);

  // Keep title in sync when project prop changes (e.g. after save elsewhere)
  useEffect(() => {
    setProjectTitle(project.name);
  }, [project.name]);

  const { state: wcState, mountFiles, runCommand, runCommandAndWait, startShell, startDevServer, getOrBootWebContainer } = useWebContainer();
  const { doc: ydoc, connected: collabConnected } = useCollaboration(project.id, 'user-local');

  // Task 2: Boot WebContainer and spawn an interactive shell immediately on IDE load.
  // This makes the terminal live from the moment the IDE opens, not just after clicking Run.
  useEffect(() => {
    if (shellStartedRef.current) return;
    shellStartedRef.current = true;

    const initShell = async () => {
      try {
        await getOrBootWebContainer();
        // Pipe shell output to terminal via ref so it works whether Terminal has mounted yet or not
        let attempts = 0;
        const trySpawn = async () => {
          const writer = await startShell((data) => {
            terminalWriteRef.current?.(data);
          });
          setShellWriter(writer);
        };
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

  // When Terminal mounts, store its write function in a ref so the single shell's output reaches it
  const handleTerminalReady = useCallback((write: (data: string) => void) => {
    terminalWriteRef.current = write;
    setTerminalWriter(() => write);
  }, []);

  const openFile = useCallback(async (path: string) => {
    if (fileContents[path] !== undefined) {
      setActiveFile(path);
      if (!openFiles.includes(path)) {
        setOpenFiles(prev => [...prev, path]);
      }
      return;
    }
    try {
      const content = await fetchFileContent(project.id, path);
      setFileContents(prev => ({ ...prev, [path]: content }));
      setOpenFiles(prev => (prev.includes(path) ? prev : [...prev, path]));
      setActiveFile(path);
    } catch {
      setFileContents(prev => ({ ...prev, [path]: '' }));
      setOpenFiles(prev => (prev.includes(path) ? prev : [...prev, path]));
      setActiveFile(path);
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
    try {
      terminalWriter?.('\r\n\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
      terminalWriter?.('\x1b[36m▶ Run started\x1b[0m\r\n');
      terminalWriter?.('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n\r\n');

      // Build project contents only (no overwriting user's files)
      const allContents: Record<string, string> = { ...fileContents };
      const unfetched = files.filter(f => f.type === 'file' && !(f.path in allContents));
      const fetchedContents: Record<string, string> = {};

      terminalWriter?.('\x1b[36m[1/4] Fetching file contents...\x1b[0m\r\n');
      if (unfetched.length === 0) {
        terminalWriter?.('  No files to fetch (using cached content).\r\n');
      } else {
        await Promise.all(
          unfetched.map(async (f) => {
            try {
              const content = await fetchFileContent(project.id, f.path);
              allContents[f.path] = content;
              fetchedContents[f.path] = content;
              terminalWriter?.(`  \x1b[32m✓\x1b[0m ${f.path}\r\n`);
            } catch (error) {
              terminalWriter?.(`  \x1b[31m✗\x1b[0m ${f.path} - Failed to fetch\r\n`);
              console.error(`Failed to fetch ${f.path}:`, error);
            }
          })
        );
        terminalWriter?.(`  Fetched ${unfetched.length} file(s).\r\n`);
      }
      // Update state only with project data (newly fetched), never with Run defaults
      if (Object.keys(fetchedContents).length > 0) {
        setFileContents(prev => ({ ...prev, ...fetchedContents }));
        setFiles(prev => {
          const existingPaths = new Set(prev.map(f => f.path));
          const added = Object.keys(fetchedContents)
            .filter(p => !existingPaths.has(p))
            .map(path => ({ path, content: fetchedContents[path], type: 'file' as const }));
          return added.length > 0 ? [...prev, ...added] : prev;
        });
      }
      terminalWriter?.('\r\n');

      terminalWriter?.('\x1b[36m[2/4] Checking project files...\x1b[0m\r\n');
      // For mount only: use a copy and fill defaults for missing/empty required files (do not overwrite project state)
      const mountContents: Record<string, string> = { ...allContents };
      const defaultPackageJson = JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
        devDependencies: { '@vitejs/plugin-react': '^4.0.0', vite: '^4.3.9' }
      }, null, 2);
      const defaultIndexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
      const defaultMainJsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Hello World! 🚀</h1>
      <p>Edit src/main.jsx to get started.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);`;
      const defaultIndexCss = `body {
  margin: 0;
  padding: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`;
      const defaultViteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`;

      if (!mountContents['package.json'] || mountContents['package.json'].trim() === '') {
        terminalWriter?.('  \x1b[33m⚠\x1b[0m package.json is empty, using default for this run only\r\n');
        mountContents['package.json'] = defaultPackageJson;
      }
      if (!mountContents['index.html'] || mountContents['index.html'].trim() === '') {
        terminalWriter?.('  \x1b[33m⚠\x1b[0m index.html is empty, using default for this run only\r\n');
        mountContents['index.html'] = defaultIndexHtml;
      }
      if (!mountContents['src/main.jsx'] || mountContents['src/main.jsx'].trim() === '') {
        terminalWriter?.('  \x1b[33m⚠\x1b[0m src/main.jsx is empty, using default for this run only\r\n');
        mountContents['src/main.jsx'] = defaultMainJsx;
      }
      if (!mountContents['src/index.css'] || mountContents['src/index.css'].trim() === '') {
        terminalWriter?.('  \x1b[33m⚠\x1b[0m src/index.css is empty, using default for this run only\r\n');
        mountContents['src/index.css'] = defaultIndexCss;
      }
      if (!mountContents['vite.config.js'] || mountContents['vite.config.js'].trim() === '') {
        terminalWriter?.('  \x1b[33m⚠\x1b[0m vite.config.js is empty, using default for this run only\r\n');
        mountContents['vite.config.js'] = defaultViteConfig;
      }

      if (mountContents['package.json']) {
        try {
          JSON.parse(mountContents['package.json']);
        } catch (e) {
          terminalWriter?.('\r\n\x1b[31m✗ Invalid package.json\x1b[0m\r\n');
          throw new Error('Invalid package.json: ' + (e instanceof Error ? e.message : 'Parse error'));
        }
      }
      terminalWriter?.('  \x1b[32m✓\x1b[0m Project files ready.\r\n\r\n');

      terminalWriter?.('\x1b[36m[3/4] Mounting project files...\x1b[0m\r\n');
      await mountFiles(mountContents);
      const fileCount = Object.keys(mountContents).length;
      terminalWriter?.(`  \x1b[32m✓\x1b[0m Mounted ${fileCount} file(s).\r\n\r\n`);

      if (mountContents['package.json']) {
        terminalWriter?.('\x1b[36m[4/4] Running npm install...\x1b[0m\r\n');
        const installCode = await runCommandAndWait('npm', ['install'], (data) => terminalWriter?.(data));
        if (installCode !== 0) {
          terminalWriter?.('\r\n\x1b[31m✗ npm install failed (exit code ' + installCode + '). Fix errors above and try again.\x1b[0m\r\n');
          return;
        }
        terminalWriter?.('\r\n  \x1b[32m✓\x1b[0m npm install completed.\r\n\r\n');
      }

      terminalWriter?.('\x1b[36mStarting dev server...\x1b[0m\r\n');
      const url = await startDevServer((data) => terminalWriter?.(data));
      terminalWriter?.(`\r\n  \x1b[32m✓\x1b[0m Dev server ready at \x1b[33m${url}\x1b[0m\r\n`);
      terminalWriter?.('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n\r\n');
      setPreviewUrl(url);
      setCenterView('preview');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('Run failed:', e);

      // Always surface the error in the terminal so the user sees it
      if (errorMsg.includes('EJSONPARSE')) {
        terminalWriter?.('\r\n\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
        terminalWriter?.('\x1b[31m✗ PACKAGE.JSON ERROR\x1b[0m\r\n');
        terminalWriter?.('\r\n\x1b[33mYour package.json file is invalid or empty.\x1b[0m\r\n');
        terminalWriter?.('\x1b[33mPlease check the Files tab and ensure package.json contains valid JSON.\x1b[0m\r\n');
        terminalWriter?.('\r\n\x1b[36mExpected format:\x1b[0m\r\n');
        terminalWriter?.('{\r\n');
        terminalWriter?.('  "name": "my-app",\r\n');
        terminalWriter?.('  "version": "1.0.0",\r\n');
        terminalWriter?.('  "scripts": { "dev": "vite" },\r\n');
        terminalWriter?.('  "dependencies": { ... }\r\n');
        terminalWriter?.('}\r\n');
        terminalWriter?.('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
      } else if (errorMsg.includes('output:')) {
        const outputMatch = errorMsg.match(/output:\n([\s\S]+)/);
        if (outputMatch) {
          terminalWriter?.('\r\n\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
          terminalWriter?.('\x1b[31m✗ DEV SERVER ERROR\x1b[0m\r\n\r\n');
          terminalWriter?.(outputMatch[1]);
          terminalWriter?.('\r\n\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
        } else {
          terminalWriter?.(`\r\n\x1b[31m✗ Error: ${errorMsg}\x1b[0m\r\n`);
        }
      } else {
        terminalWriter?.(`\r\n\x1b[31m✗ Error: ${errorMsg}\x1b[0m\r\n`);
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, startDevServer, mountFiles, runCommand, runCommandAndWait, terminalWriter, files, fileContents, project.id]);

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

  const handleStartBrainStormSession = useCallback(
    async (message: string) => {
      try {
        const title = message.slice(0, 80).trim() || 'New chat';
        const chat = await brain.createChat({
          title,
          projectId: typeof project.id === 'number' ? project.id : Number(project.id),
        });
        await brain.sendMessages(chat.id, [{ role: 'user', content: message }]);
        router.push(`/brainstorm?chat=${chat.id}`);
      } catch (e) {
        console.error('Start Brain Storm session failed:', e);
      }
    },
    [project.id, router]
  );

  const statusLabel = wcState.status === 'booting'
    ? '⏳ Booting…'
    : wcState.status === 'ready'
      ? '✅ Ready'
      : wcState.status === 'error'
        ? '⚠️ WC Error'
        : '';

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)', overflow: 'hidden' }}>
      {/* Top bar — editable project title, theme toggle, run button */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0, minHeight: 40,
      }}>
        {/* Left: hamburger (projects panel) */}
        <button
          type="button"
          onClick={() => setProjectsPanelOpen(true)}
          aria-label="Open projects"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '6px 10px',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
          }}
          title="All projects"
        >
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 1 }} />
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 1 }} />
          <span style={{ width: 18, height: 2, background: 'currentColor', borderRadius: 1 }} />
        </button>
        {/* Editable project title */}
        <input
          type="text"
          value={projectTitle}
          onChange={e => setProjectTitle(e.target.value)}
          onBlur={async (e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            const name = projectTitle.trim() || project.name;
            if (name === project.name) {
              setProjectTitle(project.name);
              return;
            }
            setIsSavingTitle(true);
            try {
              const updated = await updateProject(project.id, { name });
              onProjectUpdate?.({ ...project, ...updated });
              setProjectTitle(updated.name);
            } catch {
              setProjectTitle(project.name);
            } finally {
              setIsSavingTitle(false);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; }}
          disabled={isSavingTitle}
          title="Edit project name (saves on blur or Enter)"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '0.9rem',
            color: 'var(--text-primary)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '6px 10px',
            minWidth: 120,
            maxWidth: 320,
            outline: 'none',
          }}
        />
        {project.description && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            — {project.description}
          </span>
        )}

        {/* Next to title: Details */}
        {onOpenProjectDetails && (
          <button
            type="button"
            onClick={onOpenProjectDetails}
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: '0.82rem',
              cursor: 'pointer',
              flexShrink: 0,
              fontFamily: 'var(--font-display)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Project details"
          >
            <span style={{ fontSize: '1rem' }}>▦</span>
            Details
          </button>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right: collab status, run */}
        {collabConnected && (
          <span style={{ fontSize: '0.72rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%', display: 'inline-block' }} />
            Live
          </span>
        )}
        {statusLabel && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{statusLabel}</span>
        )}
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
      </div>

      <ProjectsSlideOutPanel
        open={projectsPanelOpen}
        onClose={() => setProjectsPanelOpen(false)}
        currentProjectId={typeof project.id === 'number' ? project.id : Number(project.id)}
      />

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Brain: project-scoped chats (same selector as Brain Storm, project fixed) */}
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ProjectAIChat
            projectId={project.id}
            projectName={project.name}
            activeFile={activeFile}
            activeFileContent={activeFile ? (fileContents[activeFile] || '') : undefined}
            onApplyCode={activeFile ? (code) => {
              setFileContents(prev => ({ ...prev, [activeFile]: code }));
              saveFile(project.id, activeFile, code).catch(console.error);
            } : undefined}
            onCreateFile={(path, content) => {
              setFileContents(prev => ({ ...prev, [path]: content }));
              saveFile(project.id, path, content)
                .then(() => {
                  refreshFiles();
                  if (!openFiles.includes(path)) {
                    setOpenFiles(prev => [...prev, path]);
                    setActiveFile(path);
                  }
                })
                .catch(console.error);
            }}
            onStartBrainStormSession={handleStartBrainStormSession}
            initialChatId={initialChatId}
            onChatSelect={(chatId) => {
              const path = `/ide/${project.id}`;
              router.replace(chatId != null ? `${path}?chat=${chatId}` : path, { scroll: false });
            }}
          />
        </div>

        {/* Center panel: Preview/Code toggle + Terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Preview/Code toggle */}
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', padding: '2px 6px', gap: 6, flexShrink: 0 }}>
            {(['preview', 'code'] as CenterView[]).map(view => (
              <button
                key={view}
                onClick={() => setCenterView(view)}
                style={{
                  padding: '6px 16px', fontSize: '0.8rem', fontWeight: 600,
                  background: centerView === view ? 'var(--bg-elevated)' : 'transparent',
                  color: centerView === view ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none', borderBottom: centerView === view ? '2px solid var(--coral-bright)' : '2px solid transparent',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  borderRadius: 6,
                }}
              >
                {view === 'preview' ? (
                  <>🌐 Preview {previewUrl && <span style={{ color: '#4ade80' }}>●</span>}</>
                ) : (
                  '💻 Code'
                )}
              </button>
            ))}
          </div>

          {/* Main content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            {/* Preview */}
            <div style={{ position: 'absolute', inset: 0, visibility: centerView === 'preview' ? 'visible' : 'hidden', pointerEvents: centerView === 'preview' ? 'auto' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <PreviewFrame url={previewUrl} />
              </div>
            </div>

            {/* Code Editor */}
            <div style={{ position: 'absolute', inset: 0, visibility: centerView === 'code' ? 'visible' : 'hidden', pointerEvents: centerView === 'code' ? 'auto' : 'none', display: 'flex', flexDirection: 'column' }}>
              <EditorTabs
                openFiles={openFiles}
                activeFile={activeFile}
                onTabSelect={setActiveFile}
                onTabClose={closeTab}
              />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <CodeEditor
                  key={activeFile ?? 'none'}
                  filePath={activeFile}
                  content={activeFile ? (fileContents[activeFile] ?? '') : ''}
                  onChange={handleEditorChange}
                  ydoc={ydoc}
                />
              </div>
            </div>
          </div>

          {/* Terminal at bottom — collapsible panel with tab */}
          <div
            style={{
              height: terminalExpanded ? 220 : 36,
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              background: '#1a1a2e',
              transition: 'height 0.2s ease',
            }}
          >
            <button
              type="button"
              onClick={() => setTerminalExpanded((e) => !e)}
              aria-expanded={terminalExpanded}
              aria-label={terminalExpanded ? 'Collapse terminal' : 'Expand terminal'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                background: 'rgba(0,0,0,0.25)',
                border: 'none',
                borderBottom: terminalExpanded ? '1px solid rgba(255,255,255,0.08)' : 'none',
                padding: '6px 10px',
                cursor: 'pointer',
                fontFamily: 'var(--font-display)',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Terminal
              </span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>
                {terminalExpanded ? '▼' : '▶'}
              </span>
            </button>
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                minHeight: 0,
                display: terminalExpanded ? 'flex' : 'none',
              }}
            >
              <Terminal
                onReady={handleTerminalReady}
                onInput={handleTerminalInput}
              />
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
                  flex: 1, padding: '5px 4px', fontSize: '0.72rem', fontWeight: 600,
                  background: rightTab === tab ? 'var(--bg-elevated)' : 'transparent',
                  color: rightTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
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
