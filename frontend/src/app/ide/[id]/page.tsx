'use client';

export const runtime = 'edge';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { fetchProject, fetchFiles, updateProject, deleteProject } from '@/lib/api';
import { persistLastProjectId } from '@/lib/auth';
import type { Project, FileEntry } from '@/lib/types';
import { ProjectDetailsPanel } from '@/components/ProjectDetailsPanel';

const IDE = dynamic(() => import('@/components/IDE').then((m) => m.IDE), { ssr: false });

/**
 * IDE page — opens a project in the IDE. Use ?chat= to open with a specific project chat active
 * (e.g. from Brain Storm "Open in IDE" with the current chat).
 */
export default function IDEPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idRaw = params?.id ?? '';
  const id = idRaw ? (Number(idRaw) || idRaw) : '';
  const chatIdParam = searchParams.get('chat');
  const initialChatId = chatIdParam ? (Number(chatIdParam) || null) : null;

  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'notfound' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false);
  const [firstTimeProjectName, setFirstTimeProjectName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);

  useEffect(() => {
    if (!idRaw) return;
    let cancelled = false;
    const projectId = Number(idRaw) || idRaw;

    Promise.all([
      fetchProject(projectId),
      fetchFiles(projectId),
    ])
      .then(([proj, fileList]) => {
        if (cancelled) return;
        setProject(proj);
        setFiles(fileList);
        setStatus('ready');
        persistLastProjectId(String(proj.id));
        const isUntitled = proj.name === 'Untitled' || proj.name.startsWith('Untitled-');
        if (isUntitled && typeof sessionStorage !== 'undefined') {
          const key = 'builderforce-first-time-modal-shown';
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            setShowFirstTimeModal(true);
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          setStatus('notfound');
        } else {
          setErrorMsg(msg);
          setStatus('error');
        }
      });

    return () => { cancelled = true; };
  }, [idRaw]);

  if (status === 'loading') {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-deep)', color: 'var(--text-secondary)',
        gap: 16, fontFamily: 'var(--font-display)',
      }}>
        <div style={{ fontSize: '2.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}>⚡</div>
        <p>Loading project…</p>
      </div>
    );
  }

  if (status === 'notfound') {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-deep)', color: 'var(--text-primary)',
        gap: 12, textAlign: 'center', fontFamily: 'var(--font-display)',
      }}>
        <div style={{ fontSize: '4rem', marginBottom: 8 }}>🔍</div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--coral-bright)' }}>404</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>Project not found</p>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            marginTop: 16,
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            color: '#fff', border: 'none', padding: '10px 24px',
            borderRadius: 12, fontFamily: 'var(--font-display)',
            fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem',
          }}
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-deep)', color: 'var(--text-primary)',
        gap: 12, textAlign: 'center', padding: 24, fontFamily: 'var(--font-display)',
      }}>
        <div style={{ fontSize: '3rem' }}>⚠️</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Could not load project</h2>
        <pre style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          borderRadius: 10, padding: '12px 20px', fontSize: '0.78rem',
          color: 'var(--error-text)', maxWidth: 560, overflowX: 'auto', whiteSpace: 'pre-wrap',
        }}>
          {errorMsg || 'Unknown error. Check your connection and try again.'}
        </pre>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => window.location.reload()}
            style={{ background: 'var(--surface-interactive)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '8px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
            Retry
          </button>
          <button onClick={() => router.push('/dashboard')}
            style={{ background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
            Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isUntitled = project!.name === 'Untitled' || project!.name.startsWith('Untitled-');
  const openFirstTimeModal = isUntitled && showFirstTimeModal;

  const handleSaveProjectName = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = firstTimeProjectName.trim();
    if (!name || !project) return;
    setIsSavingName(true);
    try {
      const updated = await updateProject(project.id, { name });
      setProject(updated);
      setShowFirstTimeModal(false);
      setFirstTimeProjectName('');
    } catch {
      // keep modal open
    } finally {
      setIsSavingName(false);
    }
  };

  return (
    <>
      <div className="ide-full-height" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <IDE
          project={project!}
          initialFiles={files}
          onProjectUpdate={setProject}
          onOpenProjectDetails={() => setProjectDetailsOpen(true)}
          initialChatId={initialChatId}
        />
      </div>
      {project && (
        <ProjectDetailsPanel
          project={project}
          open={projectDetailsOpen}
          onClose={() => setProjectDetailsOpen(false)}
          onProjectUpdate={setProject}
          projectHref={`/ide/${project.id}`}
          onDelete={async (p) => {
            try {
              await deleteProject(p.id);
              router.push('/dashboard');
            } catch (err) {
              console.error(err);
              alert('Failed to delete project');
            }
          }}
        />
      )}
      {openFirstTimeModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="modal-overlay"
          onClick={() => setShowFirstTimeModal(false)}
        >
          <div
            style={{
              maxWidth: 420,
              width: '90%',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
              Name your project
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Give your project a name to save it.
            </p>
            <form onSubmit={handleSaveProjectName}>
              <input
                type="text"
                value={firstTimeProjectName}
                onChange={(e) => setFirstTimeProjectName(e.target.value)}
                placeholder="My Awesome App"
                autoFocus
                style={{
                  width: '100%',
                  background: 'var(--bg-deep)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontSize: '0.95rem',
                  marginBottom: 16,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowFirstTimeModal(false)}
                  style={{
                    padding: '8px 16px',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    cursor: 'pointer',
                  }}
                >
                  Later
                </button>
                <button
                  type="submit"
                  disabled={isSavingName || !firstTimeProjectName.trim()}
                  style={{
                    padding: '8px 18px',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: '#fff',
                    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                    border: 'none',
                    borderRadius: 10,
                    cursor: isSavingName || !firstTimeProjectName.trim() ? 'not-allowed' : 'pointer',
                    opacity: isSavingName || !firstTimeProjectName.trim() ? 0.7 : 1,
                  }}
                >
                  {isSavingName ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
