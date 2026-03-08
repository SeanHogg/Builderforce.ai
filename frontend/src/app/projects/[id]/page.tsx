'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { IDE } from '@/components/IDE';
import { fetchProject, fetchFiles } from '@/lib/api';
import type { Project, FileEntry } from '@/lib/types';

/**
 * ProjectPage — client component so it uses the NEXT_PUBLIC_WORKER_URL
 * from api.ts (which correctly falls back to localhost:8787 in dev).
 *
 * Previously this was a server component with `runtime = 'edge'`, which
 * caused 404s because the fetch ran at build time against a localhost URL
 * that was not available during CI/CD.
 */
export const runtime = 'edge';

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'notfound' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    Promise.all([
      fetchProject(id),
      fetchFiles(id),
    ])
      .then(([proj, fileList]) => {
        if (cancelled) return;
        setProject(proj);
        setFiles(fileList);
        setStatus('ready');
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
  }, [id]);

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
          {errorMsg || 'Unknown error — is the worker running?'}
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

  return <IDE project={project!} initialFiles={files} />;
}
