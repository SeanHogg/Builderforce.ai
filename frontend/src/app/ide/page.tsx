'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredLastProjectId, persistLastProjectId } from '@/lib/auth';
import { fetchProject, fetchProjects, createProject } from '@/lib/api';
import { isPlanLimitError, PlanLimitError } from '@/lib/planLimitError';
import type { Project } from '@/lib/types';
import { ProjectCard } from '@/components/ProjectCard';
import { UpgradeModal } from '@/components/UpgradeModal';

/**
 * IDE entry:
 *   1. If a last-opened project is remembered and still exists → jump straight into it.
 *   2. Otherwise load the project list.
 *      - If empty → try to create an "Untitled" WIP; if that hits the plan limit,
 *        show the upgrade modal and leave the user on an empty-state screen.
 *      - If non-empty → render a picker so the user can open an existing project
 *        without auto-creating a new one.
 */
export default function IDEEntryPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  type Phase = 'loading' | 'picker' | 'error';
  const [phase, setPhase] = useState<Phase>('loading');
  const [projects, setProjects] = useState<Project[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);
  const [creating, setCreating] = useState(false);

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
      // 1. Fast path: reopen the last project we used.
      if (lastId) {
        try {
          const proj = await fetchProject(lastId);
          if (cancelled) return;
          persistLastProjectId(String(proj.id));
          router.replace(`/ide/${proj.publicId ?? proj.id}`);
          return;
        } catch {
          // Fall through to picker — last project gone / renamed / not ours.
        }
      }

      // 2. Pull the project list so we always have something to show.
      let list: Project[] = [];
      try {
        list = await fetchProjects();
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : 'Failed to load projects');
        setPhase('error');
        return;
      }
      if (cancelled) return;

      if (list.length > 0) {
        // Existing projects → show picker, do NOT auto-create.
        setProjects(list);
        setPhase('picker');
        return;
      }

      // 3. Zero projects: genuinely new tenant → try to create a WIP.
      try {
        const wipName = `Untitled-${Date.now()}`;
        const project = await createProject({
          name: wipName,
          description: undefined,
          template: 'vanilla',
        });
        if (cancelled) return;
        persistLastProjectId(String(project.id));
        router.replace(`/ide/${project.publicId ?? project.id}`);
      } catch (e) {
        if (cancelled) return;
        if (isPlanLimitError(e)) {
          // Shouldn't happen at zero projects, but if the backend counts differ
          // (e.g. soft-deleted rows), still degrade gracefully: show modal + empty picker.
          setPlanError(e);
          setProjects([]);
          setPhase('picker');
          return;
        }
        setErrorMsg(e instanceof Error ? e.message : 'Failed to open IDE');
        setPhase('error');
      }
    }

    go();
    return () => { cancelled = true; };
  }, [isAuthenticated, hasTenant, router]);

  const openProject = (p: Project) => {
    persistLastProjectId(String(p.id));
    router.replace(`/ide/${p.publicId ?? p.id}`);
  };

  const createNewProject = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const wipName = `Untitled-${Date.now()}`;
      const project = await createProject({
        name: wipName,
        description: undefined,
        template: 'vanilla',
      });
      persistLastProjectId(String(project.id));
      router.replace(`/ide/${project.publicId ?? project.id}`);
    } catch (e) {
      if (isPlanLimitError(e)) {
        setPlanError(e);
      } else {
        setErrorMsg(e instanceof Error ? e.message : 'Failed to create project');
        setPhase('error');
      }
    } finally {
      setCreating(false);
    }
  };

  if (!isAuthenticated || !hasTenant) return null;

  if (phase === 'error') {
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

  if (phase === 'picker') {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-deep)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
        }}
      >
        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Open a project</h1>
              <p style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 14 }}>
                Pick an existing project to load it into the IDE, or start a new one.
              </p>
            </div>
            <button
              type="button"
              onClick={createNewProject}
              disabled={creating}
              style={{
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 600,
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                cursor: creating ? 'not-allowed' : 'pointer',
                opacity: creating ? 0.7 : 1,
                boxShadow: '0 4px 14px var(--shadow-coral-mid)',
              }}
            >
              {creating ? 'Creating…' : '+ New project'}
            </button>
          </div>

          {projects.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 48,
                marginTop: 32,
                background: 'var(--bg-elevated)',
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
              <p style={{ color: 'var(--text-secondary)' }}>
                No projects yet. Create your first one to start building.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
                marginTop: 24,
              }}
            >
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onCardClick={openProject} />
              ))}
            </div>
          )}
        </main>

        <UpgradeModal error={planError} onClose={() => setPlanError(null)} />
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
