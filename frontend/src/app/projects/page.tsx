'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Project } from '@/lib/types';
import { fetchProjects, createProject } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';

/**
 * Projects page — full project list, create project modal, open project → IDE.
 * Separate from Dashboard (home); Dashboard has a preview and "View all" links here.
 */
export default function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/projects');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/projects');
    }
  }, [isAuthenticated, hasTenant, router]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    fetchProjects()
      .then(setProjects)
      .catch(() => setError('Failed to load projects. Check your connection and try again.'))
      .finally(() => setIsLoading(false));
  }, [isAuthenticated, hasTenant]);

  useEffect(() => {
    if (searchParams.get('create') === '1') setShowForm(true);
  }, [searchParams]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const project = await createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
        template: 'vanilla',
      });
      setProjects((prev) => [project, ...prev]);
      setNewProjectName('');
      setNewProjectDesc('');
      setShowForm(false);
      router.replace('/projects', { scroll: false });
    } catch {
      setError('Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <div style={{ flex: 1, background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* New Project Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div
              className="rounded-xl p-6 w-full max-w-md border border-gray-700"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                New Project
              </h3>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Project Name *
                  </label>
                  <input
                    autoFocus
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="My Awesome App"
                    required
                    style={{
                      width: '100%',
                      background: 'var(--bg-deep)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      outline: 'none',
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Description
                  </label>
                  <input
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    placeholder="Optional description..."
                    style={{
                      width: '100%',
                      background: 'var(--bg-deep)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      outline: 'none',
                    }}
                  />
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating || !newProjectName.trim()}
                    style={{
                      padding: '8px 18px',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      cursor: isCreating || !newProjectName.trim() ? 'not-allowed' : 'pointer',
                      opacity: isCreating || !newProjectName.trim() ? 0.7 : 1,
                    }}
                  >
                    {isCreating ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {error && (
          <div
            className="rounded-lg px-4 py-3 mb-6 text-sm"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.5)', color: '#fca5a5' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>Projects</h1>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              boxShadow: '0 4px 14px var(--shadow-coral-mid)',
            }}
          >
            + New project
          </button>
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading projects…</div>
        ) : projects.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 48,
              background: 'var(--bg-elevated)',
              borderRadius: 12,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>No projects yet. Create your first one!</p>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              style={{
                padding: '12px 24px',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-display)',
              }}
            >
              Create project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                style={{
                  display: 'block',
                  padding: 20,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>💻</span>
                  {project.template && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        background: 'var(--surface-interactive)',
                        padding: '2px 8px',
                        borderRadius: 6,
                      }}
                    >
                      {project.template}
                    </span>
                  )}
                </div>
                <h3 style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{project.name}</h3>
                {project.description && (
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      marginBottom: 8,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {project.description}
                  </p>
                )}
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {project.created_at
                    ? new Date(project.created_at).toLocaleDateString()
                    : (project as { createdAt?: string }).createdAt
                      ? new Date((project as { createdAt?: string }).createdAt!).toLocaleDateString()
                      : ''}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
