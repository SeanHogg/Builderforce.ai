'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { persistLastProjectId } from '@/lib/auth';
import {
  listIdeProjects,
  createIdeProject,
  deleteIdeProject,
  listIdeContainers,
} from '@/lib/api';
import { workflowDefinitions, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { MODALITIES, getModality, type ProjectModality } from '@/lib/modality';
import type { IdeProject, IdeContainerOption } from '@/lib/types';
import { IdeProjectCard } from '@/components/IdeProjectCard';
import { IdeProjectDetailsModal } from '@/components/IdeProjectDetailsModal';
import { ViewToggle } from '@/components/ViewToggle';
import { UpgradeModal } from '@/components/UpgradeModal';

type IdeView = 'grouped' | 'card' | 'table';

/**
 * IDE Dashboard — the IDE's landing page and IDE-project launcher.
 *
 * Lists every IDE project (the buildable artifact: Designer / Video / LLM /
 * Voice), each a first-class child of a Project. Three views: Grouped (by the
 * parent Project), Card, and List. Creating one optionally nests it under a
 * Project; opening it launches the editor at its backing storage project.
 */
export default function IDEDashboardPage() {
  const t = useTranslations('ide');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasTenant } = useAuth();
  const { currentProjectId, currentProject, setProject } = useProjectScope();

  const typeParam = searchParams.get('type') as ProjectModality | null;

  const [ideProjects, setIdeProjects] = useState<IdeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<IdeView>('grouped');

  // New-project modal state
  const [createType, setCreateType] = useState<ProjectModality | null>(null);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<number | null>(null);
  const [newWorkflow, setNewWorkflow] = useState<string | null>(null);
  const [containers, setContainers] = useState<IdeContainerOption[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  // Details (rename + reassign) modal state
  const [detailsFor, setDetailsFor] = useState<IdeProject | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setIdeProjects(await listIdeProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load IDE projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/ide/dashboard');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/ide/dashboard');
    } else {
      void reload();
    }
  }, [isAuthenticated, hasTenant, router, reload]);

  // Pre-load the parent-Project options when the create modal opens (default the
  // parent to the currently-scoped Project, if any).
  useEffect(() => {
    if (!createType) return;
    setNewParent(currentProjectId ?? null);
    listIdeContainers().then(setContainers).catch(() => setContainers([]));
    // LLM projects must run a workflow — load the tenant's definitions to pick from.
    if (createType === 'llm') {
      setNewWorkflow(null);
      setWorkflowsLoaded(false);
      workflowDefinitions.list()
        .then(setWorkflows)
        .catch(() => setWorkflows([]))
        .finally(() => setWorkflowsLoaded(true));
    }
  }, [createType, currentProjectId]);

  const openIde = (p: IdeProject) => {
    persistLastProjectId(String(p.storageProjectId));
    router.push(`/ide/${p.storageProjectPublicId}`);
  };

  const handleDelete = async (p: IdeProject) => {
    if (!confirm(t('deleteConfirm', { name: p.name }))) return;
    try {
      await deleteIdeProject(p.id);
      setIdeProjects((prev) => prev.filter((x) => x.id !== p.id));
    } catch {
      alert(t('deleteFailed'));
    }
  };

  const llmNeedsWorkflow = createType === 'llm' && !newWorkflow;

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createType || !newName.trim() || creating || llmNeedsWorkflow) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createIdeProject({
        name: newName.trim(),
        modality: createType,
        containerProjectId: newParent,
        ...(createType === 'llm' ? { workflowDefinitionId: newWorkflow } : {}),
      });
      persistLastProjectId(String(created.storageProjectId));
      router.push(`/ide/${created.storageProjectPublicId}`);
    } catch (err) {
      if (isPlanLimitError(err)) {
        setCreateType(null);
        setPlanError(err);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create IDE project');
      }
    } finally {
      setCreating(false);
    }
  };

  // Apply the active filters (parent-Project scope wins, then IDE type).
  const filtered = useMemo(() => {
    let list = ideProjects;
    if (currentProjectId != null) list = list.filter((p) => p.containerProjectId === currentProjectId);
    if (typeParam) list = list.filter((p) => p.modality === typeParam);
    return list;
  }, [ideProjects, currentProjectId, typeParam]);

  // Grouped view: bucket the IDE projects under each parent Project, with an
  // "Ungrouped" bucket for those without one. Ordered by parent name.
  const byContainer = useMemo(() => {
    const buckets = new Map<number | 'none', { name: string | null; items: IdeProject[] }>();
    for (const p of filtered) {
      const k = p.containerProjectId ?? 'none';
      if (!buckets.has(k)) buckets.set(k, { name: p.containerName, items: [] });
      buckets.get(k)!.items.push(p);
    }
    return [...buckets.entries()]
      .map(([key, v]) => ({ key, name: v.name, items: v.items }))
      .sort((a, b) => {
        if (a.key === 'none') return 1;
        if (b.key === 'none') return -1;
        return (a.name ?? '').localeCompare(b.name ?? '');
      });
  }, [filtered]);

  const clearTypeFilter = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('type');
    const qs = next.toString();
    router.replace(qs ? `/ide/dashboard?${qs}` : '/ide/dashboard');
  };

  if (!isAuthenticated || !hasTenant) return null;

  const cardGrid = (items: IdeProject[]) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {items.map((p) => (
        <IdeProjectCard key={p.id} ideProject={p} onOpen={openIde} onDetails={setDetailsFor} onDelete={handleDelete} />
      ))}
    </div>
  );

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>{t('title')}</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 14 }}>{t('subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/llms')}
            style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            🧠 {t('manageLlms')}
          </button>
        </div>

        {error && (
          <div style={{ borderRadius: 8, padding: '12px 16px', margin: '16px 0', fontSize: 14, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}>
            {error}
          </div>
        )}

        {/* New IDE project — type chooser */}
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 12px', color: 'var(--text-secondary)' }}>{t('newIdeProject')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {MODALITIES.map((m) => {
              const disabled = !!m.comingSoon;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => { setNewName(''); setCreateType(m.id); }}
                  title={disabled ? `${m.label} — ${t('comingSoon')}` : t('newModalityProject', { label: m.label })}
                  style={{
                    textAlign: 'left', padding: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12,
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={disabled ? undefined : (e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={disabled ? undefined : (e) => { e.currentTarget.style.borderColor = ''; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 28 }} aria-hidden>{m.icon}</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>{m.label}</span>
                    {disabled && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '1px 6px' }}>{t('soon')}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{m.tagline}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Existing IDE projects */}
        <section style={{ marginTop: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-secondary)' }}>{t('yourIdeProjects')}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <FilterChip label={t('all')} active={!typeParam} onClick={clearTypeFilter} />
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
              <ViewToggle<IdeView>
                value={view}
                onChange={setView}
                options={[
                  { value: 'grouped', label: t('groupedView') },
                  { value: 'card', label: t('cardView') },
                  { value: 'table', label: t('listView') },
                ]}
              />
            </div>
          </div>

          {/* Active parent-Project scope chip */}
          {currentProjectId != null && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, background: 'var(--surface-interactive)', border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '4px 12px', color: 'var(--text-secondary)' }}>
                {t('filteredTo', { name: currentProject ? currentProject.name : `#${currentProjectId}` })}
                <button type="button" onClick={() => setProject(null)} aria-label={t('clearProjectFilter')} style={{ background: 'none', border: 'none', color: 'var(--coral-bright)', cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
              </span>
            </div>
          )}

          {loading ? (
            <div style={{ color: 'var(--text-muted)', padding: 24 }}>{t('loadingProjects')}</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
              <p style={{ color: 'var(--text-secondary)' }}>
                {currentProjectId != null || typeParam ? t('noProjectsFilter') : t('noProjectsYet')}
              </p>
            </div>
          ) : view === 'table' ? (
            <IdeProjectTable items={filtered} onOpen={openIde} onDetails={setDetailsFor} onDelete={handleDelete} />
          ) : view === 'card' ? (
            cardGrid(filtered)
          ) : (
            byContainer.map(({ key, name, items }) => (
              <div key={String(key)} style={{ marginBottom: 32 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden>{key === 'none' ? '🗂' : '📁'}</span>
                  {key === 'none' ? t('ungrouped') : name}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {items.length}</span>
                </h3>
                {cardGrid(items)}
              </div>
            ))
          )}
        </section>
      </main>

      {/* New IDE project modal */}
      {createType && (
        <div className="modal-overlay" style={{ zIndex: 50 }}>
          <div className="rounded-xl p-6 w-full max-w-md border border-gray-700" style={{ background: 'var(--bg-elevated)' }}>
            <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              {t('newModalityProject', { label: getModality(createType).label })}
            </h3>
            <p className="mb-4" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{getModality(createType).tagline}</p>
            <form onSubmit={submitCreate} className="space-y-4">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {MODALITIES.filter((m) => !m.comingSoon).map((m) => (
                  <FilterChip key={m.id} label={`${m.icon} ${m.label}`} active={createType === m.id} onClick={() => setCreateType(m.id)} />
                ))}
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('nameLabel')}</label>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('projectNamePlaceholder')} required style={inputStyle} />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('parentOptional')}</label>
                <select value={newParent ?? ''} onChange={(e) => setNewParent(e.target.value ? Number(e.target.value) : null)} style={inputStyle}>
                  <option value="">{t('ungrouped')}</option>
                  {containers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              {createType === 'llm' && (
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{t('workflowRequired')}</label>
                  {workflowsLoaded && workflows.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 14px' }}>
                      {t('noWorkflowsYet')}{' '}
                      <a href="/workflows" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>{t('goToWorkflows')}</a>
                    </div>
                  ) : (
                    <select value={newWorkflow ?? ''} onChange={(e) => setNewWorkflow(e.target.value || null)} required style={inputStyle}>
                      <option value="">{t('selectWorkflow')}</option>
                      {workflows.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
                    </select>
                  )}
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{t('workflowHint')}</p>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setCreateType(null)} style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('cancel')}</button>
                <button
                  type="submit"
                  disabled={creating || !newName.trim() || llmNeedsWorkflow}
                  style={{ padding: '8px 18px', fontSize: '0.875rem', fontWeight: 600, background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', border: 'none', borderRadius: 10, cursor: creating || !newName.trim() || llmNeedsWorkflow ? 'not-allowed' : 'pointer', opacity: creating || !newName.trim() || llmNeedsWorkflow ? 0.7 : 1 }}
                >
                  {creating ? t('creating') : t('createOpen')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailsFor && (
        <IdeProjectDetailsModal
          ideProject={detailsFor}
          onClose={() => setDetailsFor(null)}
          onSaved={(updated) => setIdeProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
        />
      )}

      <UpgradeModal error={planError} onClose={() => setPlanError(null)} />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-deep)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 14px', outline: 'none',
};

/** Compact List view for IDE projects. */
function IdeProjectTable({ items, onOpen, onDetails, onDelete }: {
  items: IdeProject[];
  onOpen: (p: IdeProject) => void;
  onDetails: (p: IdeProject) => void;
  onDelete: (p: IdeProject) => void;
}) {
  const t = useTranslations('ide');
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', textAlign: 'left' }}>
            <th style={th}>{t('colName')}</th>
            <th style={th}>{t('colType')}</th>
            <th style={th}>{t('colParent')}</th>
            <th style={{ ...th, textAlign: 'right' }}>{t('colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const m = getModality(p.modality);
            return (
              <tr key={p.id} style={{ borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }} onClick={() => onOpen(p)}>
                <td style={td}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                  <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{p.storageProjectKey}</span>
                </td>
                <td style={td}>{m.icon} {m.label}</td>
                <td style={{ ...td, color: p.containerName ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{p.containerName ?? t('ungrouped')}</td>
                <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => onOpen(p)} style={linkBtn}>{t('open')}</button>
                  <button type="button" onClick={() => onDetails(p)} style={linkBtn}>{t('details')}</button>
                  <button type="button" onClick={() => onDelete(p)} style={{ ...linkBtn, color: 'var(--coral-bright)' }}>{t('deleteAction')}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 14px', color: 'var(--text-secondary)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--coral-bright)', fontWeight: 600, fontSize: 12, marginLeft: 10, padding: 0 };

/** Small pill toggle used for the type filter and the in-modal type switcher. */
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ fontSize: 13, fontWeight: 600, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${active ? 'var(--coral-bright)' : 'var(--border-subtle)'}`, background: active ? 'var(--coral-bright)' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)' }}
    >
      {label}
    </button>
  );
}
