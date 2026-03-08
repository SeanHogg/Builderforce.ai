'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { fetchProject, fetchFiles, updateProject } from '@/lib/api';
import { persistLastProjectId } from '@/lib/auth';
import type { Project, FileEntry } from '@/lib/types';

/**
 * Load IDE only on the client so @huggingface/transformers (ONNX WASM ~21MB)
 * is not bundled into the edge function. Keeps worker under Cloudflare's 3 MiB limit.
 */
const IDE = dynamic(() => import('@/components/IDE').then((m) => m.IDE), { ssr: false });

/**
 * ProjectPage — loads project and files from api.builderforce.ai.
 * Project id in URL is numeric (unified API project).
 */
export const runtime = 'edge';

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const idRaw = params?.id ?? '';
  const id = idRaw ? (Number(idRaw) || idRaw) : '';

  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'notfound' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false);
  const [firstTimeProjectName, setFirstTimeProjectName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

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
          color: '#f87171', maxWidth: 560, overflowX: 'auto', whiteSpace: 'pre-wrap',
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

  // When project loads as Untitled (or Untitled-*), show first-time modal once per session
  useEffect(() => {
    if (status !== 'ready' || !project) return;
    if (project.name !== 'Untitled' && !project.name.startsWith('Untitled-')) return;
    const key = 'builderforce-first-time-modal-shown';
    if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      setShowFirstTimeModal(true);
    }
  }, [status, project]);

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
      <IDE project={project!} initialFiles={files} />
      {/* First-time / Untitled project: prompt to name project and optionally create workspace */}
      {openFirstTimeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            fontFamily: 'var(--font-display)',
          }}
        >
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 16,
              padding: 24,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            }}
          >
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
              Name your project
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Give your project a name to save it. Your first workspace is set as default.
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
                    background: 'transparent',
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
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 16 }}>
              Need another workspace? Create one at{' '}
              <a
                href="https://api.builderforce.ai"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--coral-bright)' }}
              >
                api.builderforce.ai
              </a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
