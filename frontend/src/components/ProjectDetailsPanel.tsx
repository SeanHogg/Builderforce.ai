'use client';

import { Select } from '@/components/Select';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { updateProject } from '@/lib/api';
import { checkProjectKeyAvailable } from '@/lib/builderforceApi';
import { TaskMgmtContent } from './TaskMgmtContent';
import { PRDsContent } from './PRDsContent';
import { AgentTab } from './agent/AgentTab';
import { BrainPanel } from './brain/BrainPanel';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { SourceControlContent } from './sourcecontrol/SourceControlContent';
import { IntegrationCredentialsManager } from './integrations/IntegrationCredentialsManager';
import { BoardConnectionsManager } from './integrations/BoardConnectionsManager';
import { ProjectDiagnosticsTab } from './ProjectDiagnosticsTab';
import { ProjectInitiativeLink } from './pm/ProjectInitiativeLink';
import { ProjectHealthGauges } from './ProjectHealth';
import { KanbanRosterCard } from './kanban/KanbanRosterCard';
import { ProjectInspectionReport, ProjectInspectionSummary } from './ProjectInspection';
import type { InspectionRecommendation } from '@/lib/projectInspection';

/** ISO timestamp → `yyyy-mm-dd` for a native date input (empty string when unset). */
const toDateInputValue = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** Localized deadline label, or an em dash when there is no deadline at all. */
const formatDeadline = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export type ProjectPanelTab =
  | 'analytics'
  | 'details'
  | 'integrations'
  | 'taskMgmt'
  | 'prds'
  | 'diagnostics'
  | 'capabilities'
  | 'brainChat'
  | 'workspace';

export interface ProjectDetailsPanelProps {
  project: Project;
  open: boolean;
  onClose: () => void;
  /** Initial tab when panel opens. */
  initialTab?: ProjectPanelTab;
  /** Called when project is updated (e.g. name, description). */
  onProjectUpdate?: (project: Project) => void;
  /** Called when the user deletes the project. Component will prompt for confirmation. */
  onDelete?: (project: Project) => void;
}

/** Tab id → i18n key; labels resolved through `projectDetails.tabs.*` at render. */
const TAB_DEFS: { id: ProjectPanelTab; key: string }[] = [
  { id: 'analytics', key: 'tabs.analytics' },
  { id: 'details', key: 'tabs.details' },
  { id: 'integrations', key: 'tabs.integrations' },
  { id: 'taskMgmt', key: 'tabs.taskMgmt' },
  { id: 'prds', key: 'tabs.prds' },
  { id: 'diagnostics', key: 'tabs.diagnostics' },
  { id: 'capabilities', key: 'tabs.capabilities' },
  { id: 'brainChat', key: 'tabs.brainChat' },
  { id: 'workspace', key: 'tabs.workspace' },
];

const PROJECT_STATUSES = ['active', 'completed', 'archived', 'on_hold'] as const;

/** DOM ids of details-tab fields a "Fix" can scroll to / focus. */
type DetailsFocusTarget = 'edit-description' | 'edit-due-date' | 'project-initiative-section';

/**
 * Where each prescriptive "what to target" fix is actually made. Most fixes live
 * on another tab; the details-resident ones (vision, goals, deadline) also name
 * the field to surface so the Fix button does something visible instead of
 * re-selecting the tab the report already lives on. `edit` opens the overview
 * edit form first (the field only exists in edit mode). `workflows` is omitted —
 * the report renders that one as a link to the top-level /workflows route.
 */
const REC_TARGET: Record<string, { tab: ProjectPanelTab; focus?: DetailsFocusTarget; edit?: boolean }> = {
  vision: { tab: 'details', focus: 'edit-description', edit: true },
  goals: { tab: 'details', focus: 'project-initiative-section' },
  deadline: { tab: 'details', focus: 'edit-due-date', edit: true },
  schedule: { tab: 'taskMgmt' },
  tasks: { tab: 'taskMgmt' },
  decompose: { tab: 'taskMgmt' },
  overdue: { tab: 'taskMgmt' },
  blocked: { tab: 'taskMgmt' },
  stalled: { tab: 'taskMgmt' },
  owner: { tab: 'capabilities' },
  architecture: { tab: 'prds' },
};

const panelOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9998,
};

const panelDrawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: '85%',
  maxWidth: '100%',
  borderLeft: '1px solid var(--border-subtle)',
  boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export function ProjectDetailsPanel({
  project,
  open,
  onClose,
  initialTab = 'analytics',
  onProjectUpdate,
  onDelete,
}: ProjectDetailsPanelProps) {
  const t = useTranslations('projectDetails');
  const [activeTab, setActiveTab] = useState<ProjectPanelTab>(initialTab);
  const [editingProject, setEditingProject] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDescription, setEditDescription] = useState(project.description ?? '');
  const [editKey, setEditKey] = useState(project.key ?? '');
  const [editStatus, setEditStatus] = useState(project.status ?? 'active');
  const [editDueDate, setEditDueDate] = useState(toDateInputValue(project.projectDueDate));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const keyCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  // A details-tab field a pending "Fix" should scroll to / focus once it renders.
  const [pendingFocus, setPendingFocus] = useState<DetailsFocusTarget | null>(null);

  /** Localized status label; falls back to the raw value for unknown statuses. */
  const statusLabel = (s: string) =>
    (PROJECT_STATUSES as readonly string[]).includes(s) ? t(`status.${s}`) : s.replace('_', ' ');

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (activeTab !== 'details' && editingProject) {
      setEditingProject(false);
    }
  }, [activeTab, editingProject]);

  // Once a "Fix" has switched to the details tab (and opened the edit form when
  // needed), scroll the target field into view and focus it. Re-runs when the
  // form mounts (editingProject) so an edit-only field exists before we focus.
  useEffect(() => {
    if (!pendingFocus || activeTab !== 'details') return;
    const timer = setTimeout(() => {
      const el = document.getElementById(pendingFocus);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
      }
      setPendingFocus(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [pendingFocus, activeTab, editingProject]);

  useEffect(() => {
    setEditName(project.name);
    setEditDescription(project.description ?? '');
    setEditKey(project.key ?? '');
    setEditStatus(project.status ?? 'active');
    setEditDueDate(toDateInputValue(project.projectDueDate));
  }, [project.id, project.name, project.description, project.key, project.status, project.projectDueDate]);

  if (!open) return null;

  const taskCount = project.taskCount ?? 0;

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (keyStatus === 'taken') return;
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await updateProject(project.publicId ?? project.id, {
        name: editName.trim() || project.name,
        description: editDescription.trim() || undefined,
        key: editKey.trim() || undefined,
        status: editStatus,
        // Empty input clears the explicit deadline (null) so it reverts to the
        // derived task-based deadline; a date sets it explicitly.
        dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
      });
      onProjectUpdate?.(updated);
      setEditingProject(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Act on a "what to target" recommendation: switch to the tab where the fix is
  // made and, for details-resident fixes, open the edit form and queue a focus so
  // a Fix that lands on the already-open details tab still surfaces the field.
  const handleTargetRecommendation = (rec: InspectionRecommendation) => {
    const target = REC_TARGET[rec.key];
    if (!target) return;
    setActiveTab(target.tab);
    if (target.tab !== 'details') return;
    if (target.edit) setEditingProject(true);
    if (target.focus) setPendingFocus(target.focus);
  };

  const handleKeyChange = (value: string) => {
    setEditKey(value);
    setSaveError(null);
    const trimmed = value.trim().toUpperCase();
    if (!trimmed || trimmed === (project.key ?? '').toUpperCase()) {
      setKeyStatus('idle');
      if (keyCheckTimer.current) clearTimeout(keyCheckTimer.current);
      return;
    }
    setKeyStatus('checking');
    if (keyCheckTimer.current) clearTimeout(keyCheckTimer.current);
    keyCheckTimer.current = setTimeout(async () => {
      try {
        const result = await checkProjectKeyAvailable(trimmed, project.id);
        setKeyStatus(result.available ? 'available' : 'taken');
      } catch {
        setKeyStatus('idle');
      }
    }, 500);
  };

  return (
    <>
      <div className="project-panel-overlay" role="presentation" style={panelOverlayStyle} onClick={onClose} aria-hidden />
      <div className="project-panel-drawer" style={panelDrawerStyle} role="dialog" aria-label={t('dialogAria')}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
              {project.name}
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
              {project.key ?? `#${project.id}`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {project.status && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: project.status === 'active' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
                  color: 'var(--text-secondary)',
                }}
              >
                {statusLabel(project.status)}
              </span>
            )}
            {onDelete && (
              <>
                <button
                  type="button"
                  onClick={() => setShowConfirm(true)}
                  aria-label={t('deleteAria')}
                  style={{
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-base)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
                <DeleteProjectDialog
                  project={showConfirm ? project : null}
                  onCancel={() => setShowConfirm(false)}
                  onConfirm={() => {
                    setShowConfirm(false);
                    onDelete?.(project);
                  }}
                />
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-base)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              aria-label={t('closeAria')}
            >
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            padding: '0 20px',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {TAB_DEFS.map(({ id, key }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              style={{
                padding: '12px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: activeTab === id ? 'var(--coral-bright)' : 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === id ? '2px solid var(--coral-bright)' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: -1,
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          overflow: activeTab === 'brainChat' ? 'hidden' : 'auto',
          padding: activeTab === 'brainChat' ? 0 : 20,
        }}>
          {activeTab === 'analytics' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {/* Metrics row — the reporting the user sees first: the health
                  speedometer + % done ring beside the overall inspection rating.
                  Same shared visuals as the project card/list so nothing drifts;
                  the gauges self-hide when the project has no task data. */}
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
                <ProjectHealthGauges project={project} size={120} />
                <div style={{ flex: 1, minWidth: 260 }}>
                  <ProjectInspectionSummary project={project} />
                </div>
              </div>

              {/* Prescriptive breakdown — every dimension benchmarked + a "what to
                  target" list that deep-links each fix to the right tab. The rating
                  summary is rendered in the metrics row above. Spans the grid. */}
              <div style={{ gridColumn: '1 / -1' }}>
                <ProjectInspectionReport
                  project={project}
                  onNavigate={setActiveTab}
                  onTargetRecommendation={handleTargetRecommendation}
                  showSummary={false}
                />
              </div>

              {/* Workspace actions — first column. */}
              <div style={cardStyle}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>{t('workspaceActions')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setActiveTab('taskMgmt')}
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: 'var(--surface-interactive)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    {t('createTask')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('brainChat')}
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: 'var(--surface-interactive)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    {t('planWithBrain')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('prds')}
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: 'var(--surface-interactive)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    {t('draftPrd')}
                  </button>
                </div> {/* end workspace actions button row */}
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('brainHint')}
                </div>
              </div>

              {/* Recommended roster — next column. */}
              <KanbanRosterCard projectId={project.id} />
            </div>
          )}

          {activeTab === 'details' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div style={cardStyle}>
                <div style={{ position: 'relative' }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>{t('overview')}</div>
                {!editingProject && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProject(true);
                      setEditName(project.name);
                      setEditDescription(project.description ?? '');
                      setEditKey(project.key ?? '');
                      setEditStatus(project.status ?? 'active');
                      setEditDueDate(toDateInputValue(project.projectDueDate));
                    }}
                    aria-label={t('editAria')}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      background: 'var(--bg-base)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                )}
              </div>
              {editingProject ? (
                <form onSubmit={handleSaveProject} style={{ marginBottom: 14 }}>
                  <div style={{ marginBottom: 10 }}>
                    <label htmlFor="edit-name" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('nameLabel')}</label>
                    <input
                      id="edit-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label htmlFor="edit-key" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('keyLabel')}</label>
                    <input
                      id="edit-key"
                      value={editKey}
                      onChange={(e) => handleKeyChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: `1px solid ${keyStatus === 'taken' ? 'var(--error-text, #e55)' : keyStatus === 'available' ? 'var(--success, #4c4)' : 'var(--border-subtle)'}`,
                        borderRadius: 8,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    {keyStatus === 'checking' && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('checking')}</div>
                    )}
                    {keyStatus === 'available' && (
                      <div style={{ fontSize: 11, color: 'var(--success, #4c4)', marginTop: 4 }}>{t('keyAvailable')}</div>
                    )}
                    {keyStatus === 'taken' && (
                      <div style={{ fontSize: 11, color: 'var(--error-text, #e55)', marginTop: 4 }}>{t('keyTaken')}</div>
                    )}
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label htmlFor="edit-status" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('statusLabel')}</label>
                    <Select
                      id="edit-status"
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {PROJECT_STATUSES.map((s) => (
                        <option key={s} value={s}>{t(`status.${s}`)}</option>
                      ))}
                    </Select>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label htmlFor="edit-due-date" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('dueDateLabel')}</label>
                    <input
                      id="edit-due-date"
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-primary)',
                        colorScheme: 'light dark',
                      }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('dueDateHint')}</div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="edit-description" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('descriptionLabel')}</label>
                    <textarea
                      id="edit-description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-primary)',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                  {saveError && (
                    <div style={{ fontSize: 12, color: 'var(--error-text, #e55)', marginBottom: 8, padding: '6px 10px', background: 'rgba(230,80,80,0.08)', borderRadius: 6, border: '1px solid rgba(230,80,80,0.2)' }}>
                      {saveError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="submit"
                      disabled={saving || keyStatus === 'taken' || keyStatus === 'checking'}
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        cursor: (saving || keyStatus === 'taken' || keyStatus === 'checking') ? 'not-allowed' : 'pointer',
                        opacity: (saving || keyStatus === 'taken' || keyStatus === 'checking') ? 0.6 : 1,
                      }}
                    >
                      {saving ? t('saving') : t('save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingProject(false)}
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{project.name}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 14 }}>
                    {project.description || t('noDescription')}
                  </div>
                </>
              )}
              <div style={{ display: 'grid', gap: 8 }}>
                  {!editingProject && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{t('keyLabel')}</span>
                        <span>{project.key ?? `#${project.id}`}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{t('statusLabel')}</span>
                        <span>{statusLabel(project.status ?? 'active')}</span>
                      </div>
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{t('tasks')}</span>
                    <span>{taskCount}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{t('template')}</span>
                    <span>{project.template ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{t('deadline')}</span>
                    <span>
                      {formatDeadline(project.dueDate)}
                      {project.dueDate && !project.projectDueDate && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{t('deadlineDerived')}</span>
                      )}
                    </span>
                  </div>
                </div>
                <div id="project-initiative-section" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                  <ProjectInitiativeLink projectId={project.id} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <IntegrationCredentialsManager projectId={project.id} heading={t('integrationKeys')} />
              <SourceControlContent projectId={project.id} />
              <BoardConnectionsManager projectId={project.id} />
            </div>
          )}

          {activeTab === 'taskMgmt' && (
            <TaskMgmtContent
              projectId={project.id}
              projectName={project.name}
            />
          )}

          {activeTab === 'prds' && (
            <PRDsContent projectId={project.id} projectName={project.name} />
          )}

          {activeTab === 'diagnostics' && (
            <ProjectDiagnosticsTab projectId={project.id} />
          )}

          {activeTab === 'brainChat' && (
            <div style={{ height: '100%' }}>
              <BrainPanel variant="docked" pinnedProjectId={project.id} />
            </div>
          )}

          {activeTab === 'workspace' && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('workspaceTitle')}</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {t('workspaceDesc')}
              </p>
              <Link href={`/ide/${project.publicId ?? project.id}`} style={{ fontSize: 13, color: 'var(--coral-bright)', marginTop: 8, display: 'inline-block' }}>
                {t('openInIde')} →
              </Link>
            </div>
          )}

          {activeTab === 'capabilities' && (
            <AgentTab projectId={project.id} agentHostId={project.assignedAgentHost?.id} />
          )}
        </div>
      </div>
    </>
  );
}
