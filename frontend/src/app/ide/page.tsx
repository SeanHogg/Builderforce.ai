'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredLastProjectId, persistLastProjectId } from '@/lib/auth';
import { fetchProject, createProject } from '@/lib/api';

/**
 * IDE entry: redirect to last project or create a WIP (Untitled) project and open it.
 * Requires auth + tenant (middleware). After login users are sent here to go straight to the IDE.
 */
export default function IDEEntryPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/ide');
      return;
    }
    if (!hasTenant) {
      router.replace('/tenants?next=/ide');
      return;
    }
  }, [isAuthenticated, hasTenant, router]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;

    let cancelled = false;
    const lastId = getStoredLastProjectId();

    async function go() {
      try {
        if (lastId) {
          const proj = await fetchProject(lastId);
          if (!cancelled) {
            persistLastProjectId(String(proj.id));
            router.replace(`/projects/${proj.id}`);
            return;
          }
        }
      } catch {
        // Last project missing or invalid; create WIP
      }
      if (cancelled) return;
      try {
        // Unique name so api.builderforce.ai project key is unique (key is derived from name).
        const wipName = `Untitled-${Date.now()}`;
        const project = await createProject({
          name: wipName,
          description: undefined,
          template: 'vanilla',
        });
        if (cancelled) return;
        persistLastProjectId(String(project.id));
        router.replace(`/projects/${project.id}`);
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : 'Failed to open IDE');
          setStatus('error');
        }
      }
    }

    go();
    return () => { cancelled = true; };
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  if (status === 'error') {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-deep)',
          color: 'var(--text-primary)',
          gap: 12,
          textAlign: 'center',
          padding: 24,
          fontFamily: 'var(--font-display)',
        }}
      >
        <div style={{ fontSize: '3rem' }}>⚠️</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Could not open IDE</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{errorMsg}</p>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            color: '#fff',
            border: 'none',
            padding: '10px 24px',
            borderRadius: 12,
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-secondary)',
        gap: 16,
        fontFamily: 'var(--font-display)',
      }}
    >
      <div style={{ fontSize: '2.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}>⚡</div>
      <p>Opening IDE…</p>
    </div>
  );
}
