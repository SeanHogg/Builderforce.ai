'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { persistLastProjectId } from '@/lib/auth';
import { fetchProjects, createProject, deleteProject } from '@/lib/api';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { MODALITIES, getModality, DEFAULT_MODALITY, type ProjectModality } from '@/lib/modality';
import type { Project } from '@/lib/types';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectTable } from '@/components/ProjectTable';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { UpgradeModal } from '@/components/UpgradeModal';

/**
 * IDE Dashboard — the IDE's landing page and project launcher.
 *
 * Shows every project grouped by its IDE type (modality: Designer / Video / LLM)
 * and lets the user start a new project of any type. A project IS an IDE project,
 * typed by its `modality`; "create a Video project" just creates a project with
 * `modality: 'video'`.
 *
 * Query params:
 *   ?project=<id> — scope the list to a single project (used by the Projects-page
 *                   IDE icon, which deep-links here filtered to that project).
 *   ?type=<modality> — scope the list to one IDE type.
 *
 * Opening a project card loads it into the editor at /ide/<id>.
 */
export default function IDEDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();

  const projectParam = searchParams.get('project');
  const typeParam = searchParams.get('type') as ProjectModality | null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  // New-project modal state
  const [createType, setCreateType] = useState<ProjectModality | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/ide/dashboard');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/ide/dashboard');
    }
  }, [isAuthenticated, hasTenant, router]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) return;
    let cancelled = false;
    fetchProjects()
      .then((list) => { if (!cancelled) setProjects(list); })
      .catch(() => { if (!cancelled) setError('Failed to load projects. Check your connection and try again.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated, hasTenant]);

  const openProject = (p: Project) => {
    persistLastProjectId(String(p.id));
    router.push(`/ide/${p.publicId ?? p.id}`);
  };

  const handleDelete = async (proj: Project) => {
    try {
      await deleteProject(proj.id);
      setProjects((prev) => prev.filter((x) => x.id !== proj.id));
    } catch {
      alert('Failed to delete project');
    }
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createType || !newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const project = await createProject({ name: newName.trim(), modality: createType, origin: 'ide' });
      persistLastProjectId(String(project.id));
      router.push(`/ide/${project.publicId ?? project.id}`);
    } catch (err) {
      if (isPlanLimitError(err)) {
        setCreateType(null);
        setPlanError(err);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create project');
      }
    } finally {
      setCreating(false);
    }
  };

  // The single project this view is scoped to, if any (matches numeric id or publicId).
  const scopedProject = useMemo(
    () => (projectParam ? projects.find((p) => String(p.id) === projectParam || p.publicId === projectParam) ?? null : null),
    [projectParam, projects],
  );

  // Apply the active filters (project scope wins, then type).
  const filtered = useMemo(() => {
    let list = projects;
    if (projectParam) list = list.filter((p) => String(p.id) === projectParam || p.publicId === projectParam);
    if (typeParam) list = list.filter((p) => (p.modality ?? DEFAULT_MODALITY) === typeParam);
    return list;
  }, [projects, projectParam, typeParam]);

  // Group the filtered set under each modality, in registry order.
  const grouped = useMemo(
    () => MODALITIES.map((m) => ({
      modality: m,
      items: filtered.filter((p) => (p.modality ?? DEFAULT_MODALITY) === m.id),
    })).filter((g) => g.items.length > 0),
    [filtered],
  );

  const clearFilter = (key: 'project' | 'type') => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `/ide/dashboard?${qs}` : '/ide/dashboard');
  };

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>IDE</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 14 }}>
              Start a new IDE project or open an existing one.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/llms')}
            style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            🧠 Manage LLMs
          </button>
        </div>

        {error && (
          <div
            style={{
              borderRadius: 8,
              padding: '12px 16px',
              margin: '16px 0',
              fontSize: 14,
              background: 'var(--error-bg)',
              border: '1px solid var(--error-border)',
              color: 'var(--error-text)',
            }}
          >
            {error}
          </div>
        )}

        {/* New IDE project — type chooser */}
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 12px', color: 'var(--text-secondary)' }}>
            New IDE project
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {MODALITIES.map((m) => {
              const disabled = !!m.comingSoon;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => { setNewName(''); setCreateType(m.id); }}
                  title={disabled ? `${m.label} — coming soon` : `New ${m.label} project`}
                  style={{
                    textAlign: 'left',
                    padding: 20,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 12,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.55 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={disabled ? undefined : (e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={disabled ? undefined : (e) => { e.currentTarget.style.borderColor = ''; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 28 }} aria-hidden>{m.icon}</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>{m.label}</span>
                    {disabled && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '1px 6px' }}>
                        soon
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{m.tagline}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Existing projects */}
        <section style={{ marginTop: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-secondary)' }}>
              Your IDE projects
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* Type filter */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <FilterChip label="All" active={!typeParam} onClick={() => clearFilter('type')} />
                {MODALITIES.map((m) => (
                  <FilterChip
                    key={m.id}
                    label={`${m.icon} ${m.label}`}
                    active={typeParam === m.id}
                    onClick={() => {
                      const next = new URLSearchParams(searchParams.toString());
                      next.set('type', m.id);
                      router.replace(`/ide/dashboard?${next.toString()}`);
                    }}
                  />
                ))}
              </div>
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          </div>

          {/* Active project-scope chip */}
          {projectParam && (
            <div style={{ marginBottom: 16 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  background: 'var(--surface-interactive)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 999,
                  padding: '4px 12px',
                  color: 'var(--text-secondary)',
                }}
              >
                Filtered to {scopedProject ? scopedProject.name : `project ${projectParam}`}
                <button
                  type="button"
                  onClick={() => clearFilter('project')}
                  aria-label="Clear project filter"
                  style={{ background: 'none', border: 'none', color: 'var(--coral-bright)', cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: 0 }}
                >
                  ✕
                </button>
              </span>
            </div>
          )}

          {isLoading ? (
            <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading projects…</div>
          ) : grouped.length === 0 ? (
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
              <p style={{ color: 'var(--text-secondary)' }}>
                {projectParam || typeParam
                  ? 'No projects match this filter. Create a new one above.'
                  : 'No projects yet. Pick a type above to create your first one.'}
              </p>
            </div>
          ) : (
            grouped.map(({ modality, items }) => (
              <div key={modality.id} style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden>{modality.icon}</span>
                  {modality.label}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {items.length}</span>
                </h3>
                {viewMode === 'card' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                    {items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        onCardClick={openProject}
                        onOpenIde={openProject}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                ) : (
                  <ProjectTable projects={items} onOpenIde={openProject} onDelete={handleDelete} />
                )}
              </div>
            ))
          )}
        </section>
      </main>

      {/* New project modal */}
      {createType && (
        <div className="modal-overlay" style={{ zIndex: 50 }}>
          <div className="rounded-xl p-6 w-full max-w-md border border-gray-700" style={{ background: 'var(--bg-elevated)' }}>
            <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              New {getModality(createType).label} project
            </h3>
            <p className="mb-4" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {getModality(createType).tagline}
            </p>
            <form onSubmit={submitCreate} className="space-y-4">
              {/* Type switcher inside the modal so the user can change their mind */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {MODALITIES.filter((m) => !m.comingSoon).map((m) => (
                  <FilterChip
                    key={m.id}
                    label={`${m.icon} ${m.label}`}
                    active={createType === m.id}
                    onClick={() => setCreateType(m.id)}
                  />
                ))}
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Project name *
                </label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My Awesome Project"
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
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setCreateType(null)}
                  style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  style={{
                    padding: '8px 18px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer',
                    opacity: creating || !newName.trim() ? 0.7 : 1,
                  }}
                >
                  {creating ? 'Creating…' : 'Create & open'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <UpgradeModal error={planError} onClose={() => setPlanError(null)} />
    </div>
  );
}

/** Small pill toggle used for the type filter and the in-modal type switcher. */
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 13,
        fontWeight: 600,
        padding: '5px 12px',
        borderRadius: 999,
        cursor: 'pointer',
        border: `1px solid ${active ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
        background: active ? 'var(--coral-bright)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );
}
