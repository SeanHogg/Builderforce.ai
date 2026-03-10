'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Project } from '@/lib/types';
import { updateProject } from '@/lib/api';
import { ObservabilityContent } from './ObservabilityContent';
import { TaskMgmtContent } from './TaskMgmtContent';
import { PRDsContent } from './PRDsContent';
import { ConfirmDialog } from './ConfirmDialog';

export type ProjectPanelTab =
  | 'details'
  | 'taskMgmt'
  | 'prds'
  | 'brain'
  | 'chat'
  | 'instances'
  | 'workspace'
  | 'observability';

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
  /** Optional: project base path for links (e.g. /ide/123). */
  projectHref?: string;
}

const TABS: { id: ProjectPanelTab; label: string }[] = [
  { id: 'details', label: 'Project details' },
  { id: 'taskMgmt', label: 'Task Mgmt' },
  { id: 'prds', label: 'PRDs' },
  { id: 'brain', label: 'Brain' },
  { id: 'chat', label: 'Chat' },
  { id: 'instances', label: 'Instances' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'observability', label: 'Observability' },
];

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
  width: '75%',
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
  initialTab = 'details',
  onProjectUpdate,
  onDelete,
  projectHref,
}: ProjectDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<ProjectPanelTab>(initialTab);
  const [editingProject, setEditingProject] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDescription, setEditDescription] = useState(project.description ?? '');
  const [editKey, setEditKey] = useState(project.key ?? '');
  const [editStatus, setEditStatus] = useState(project.status ?? 'active');
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (activeTab !== 'details' && editingProject) {
      setEditingProject(false);
    }
  }, [activeTab, editingProject]);

  useEffect(() => {
    setEditName(project.name);
    setEditDescription(project.description ?? '');
    setEditKey(project.key ?? '');
    setEditStatus(project.status ?? 'active');
  }, [project.id, project.name, project.description, project.key, project.status]);

  if (!open) return null;

  const href = projectHref ?? `/ide/${project.id}`;
  const taskCount = project.taskCount ?? 0;

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updateProject(project.id, {
        name: editName.trim() || project.name,
        description: editDescription.trim() || undefined,
        key: editKey.trim() || undefined,
        status: editStatus,
      });
      onProjectUpdate?.(updated);
      setEditingProject(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="project-panel-overlay" role="presentation" style={panelOverlayStyle} onClick={onClose} aria-hidden />
      <div className="project-panel-drawer" style={panelDrawerStyle} role="dialog" aria-label="Project details">
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
                {project.status.replace('_', ' ')}
              </span>
            )}
            {onDelete && (
              <>
                <button
                  type="button"
                  onClick={() => setShowConfirm(true)}
                  aria-label="Delete project"
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
                <ConfirmDialog
                  open={showConfirm}
                  message={`Delete project "${project.name}"? This cannot be undone.`}
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
              aria-label="Close panel"
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
          {TABS.map(({ id, label }) => (
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
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {activeTab === 'details' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div style={cardStyle}>
                <div style={{ position: 'relative' }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Overview</div>
                {!editingProject && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProject(true);
                      setEditName(project.name);
                      setEditDescription(project.description ?? '');
                      setEditKey(project.key ?? '');
                      setEditStatus(project.status ?? 'active');
                    }}
                    aria-label="Edit project"
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
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Name</label>
                    <input
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
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Project key</label>
                    <input
                      value={editKey}
                      onChange={(e) => setEditKey(e.target.value)}
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
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Status</label>
                    <select
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
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                      <option value="on_hold">On hold</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Description</label>
                    <textarea
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="submit"
                      disabled={saving}
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {saving ? 'Saving…' : 'Save'}
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
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{project.name}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 14 }}>
                    {project.description || 'No project description yet.'}
                  </div>
                </>
              )}
              <div style={{ display: 'grid', gap: 8 }}>
                  {!editingProject && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Project key</span>
                        <span>{project.key ?? `#${project.id}`}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Status</span>
                        <span>{project.status ?? 'active'}</span>
                      </div>
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Tasks</span>
                    <span>{taskCount}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Template</span>
                    <span>{project.template ?? '—'}</span>
                  </div>
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Workspace actions</div>
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
                    Create task
                  </button>
                  <Link
                    href="/brainstorm"
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: 'var(--surface-interactive)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      textDecoration: 'none',
                      display: 'inline-block',
                    }}
                  >
                    Plan with Brain
                  </Link>
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
                    Draft PRD
                  </button>
                </div> {/* end workspace actions button row */}
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                  Use Brain to generate PRDs and executable task actions for this project.
                </div>
              </div>

              <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Source control</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Repository and integrations can be configured here. No integrations configured yet.
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    placeholder="owner/repo"
                    readOnly
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      background: 'var(--bg-deep)',
                      color: 'var(--text-secondary)',
                      minWidth: 180,
                    }}
                  />
                  <input
                    placeholder="https://github.com/owner/repo"
                    readOnly
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      background: 'var(--bg-deep)',
                      color: 'var(--text-secondary)',
                      flex: 1,
                      minWidth: 200,
                    }}
                  />
                  <button
                    type="button"
                    disabled
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      cursor: 'not-allowed',
                    }}
                  >
                    Save assignment
                  </button>
                </div>
              </div>
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

          {activeTab === 'brain' && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Brain</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Use Brain to plan, generate PRDs, and create tasks for this project.
              </p>
              <Link
                href="/brainstorm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  color: '#fff',
                  borderRadius: 10,
                  textDecoration: 'none',
                }}
              >
                Open Brain Storm →
              </Link>
            </div>
          )}

          {activeTab === 'chat' && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Chat</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Project-scoped AI chat. Open the IDE to use the in-editor chat.
              </p>
              <Link
                href={`/ide/${project.id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  background: 'var(--surface-coral-soft)',
                  color: 'var(--coral-bright)',
                  border: '1px solid var(--border-accent)',
                  borderRadius: 10,
                  textDecoration: 'none',
                }}
              >
                Open in IDE →
              </Link>
            </div>
          )}

          {activeTab === 'instances' && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Instances</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Active agent/claw instances for this project. Configure from Workforce.
              </p>
              <Link href="/workforce" style={{ fontSize: 13, color: 'var(--coral-bright)', marginTop: 8, display: 'inline-block' }}>
                Workforce →
              </Link>
            </div>
          )}

          {activeTab === 'workspace' && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Workspace</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Workspace and file system for this project. Open the IDE to edit files.
              </p>
              <Link href={`/ide/${project.id}`} style={{ fontSize: 13, color: 'var(--coral-bright)', marginTop: 8, display: 'inline-block' }}>
                Open in IDE →
              </Link>
            </div>
          )}

          {activeTab === 'observability' && <ObservabilityContent />}
        </div>
      </div>
    </>
  );
}
