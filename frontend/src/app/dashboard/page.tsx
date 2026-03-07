'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import { fetchProjects, createProject } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';

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
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-blue-400 text-2xl">⚡</span>
              <span className="text-xl font-bold text-white">Builderforce.ai</span>
            </Link>
            {tenant && (
              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-gray-600">/</span>
                <Link
                  href="/tenants"
                  className="text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2.5 py-0.5 rounded-md transition-colors"
                  title="Switch workspace"
                >
                  {tenant.name || tenant.id}
                </Link>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-sm text-gray-500 hidden sm:block">{user.email}</span>
            )}
            <button
              onClick={() => setShowForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              + New Project
            </button>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

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
