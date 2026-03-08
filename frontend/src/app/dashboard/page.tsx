'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import { fetchProjects, createProject } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import AppHeader from '@/components/AppHeader';

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant, user, tenant, logout } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/dashboard');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/dashboard');
    }
  }, [isAuthenticated, hasTenant, router]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    fetchProjects()
      .then(setProjects)
      .catch(() => setError('Failed to load projects. Is the worker running?'))
      .finally(() => setIsLoading(false));
  }, [isAuthenticated, hasTenant]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsCreating(true);
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
    } catch {
      setError('Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      <AppHeader
        links={[
          ...(tenant ? [{ label: tenant.name || tenant.id, href: '/tenants' }] : []),
        ]}
        actions={
          <>
            {user && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }} className="hidden sm:block">{user.email}</span>}
            <button
              onClick={() => setShowForm(true)}
              style={{
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: '#fff', border: 'none', padding: '7px 14px',
                borderRadius: 10, fontSize: '0.85rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font-display)',
                boxShadow: '0 4px 14px var(--shadow-coral-mid)',
              }}
            >+ New Project</button>
            <button
              onClick={handleLogout}
              style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >Sign out</button>
          </>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* New Project Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">New Project</h3>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Project Name *</label>
                  <input
                    autoFocus
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="My Awesome App"
                    className="w-full bg-gray-800 text-white rounded px-3 py-2 outline-none border border-gray-700 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Description</label>
                  <input
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    placeholder="Optional description..."
                    className="w-full bg-gray-800 text-white rounded px-3 py-2 outline-none border border-gray-700 focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating || !newProjectName.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm"
                  >
                    {isCreating ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 rounded-lg px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Projects */}
        {isLoading ? (
          <div className="text-center text-gray-500 py-12">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">🚀</div>
            <p className="text-gray-400 mb-4">No projects yet. Create your first one!</p>
            <button
              onClick={() => setShowForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
            >
              Create Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-all hover:bg-gray-800 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-2xl">💻</div>
                  <span className="text-xs text-gray-500 bg-gray-800 group-hover:bg-gray-700 px-2 py-0.5 rounded">
                    {project.template}
                  </span>
                </div>
                <h3 className="text-white font-semibold mb-1">{project.name}</h3>
                {project.description && (
                  <p className="text-gray-400 text-sm line-clamp-2">{project.description}</p>
                )}
                <p className="text-gray-600 text-xs mt-3">
                  {new Date(project.created_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
