'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Project } from '@/lib/types';
import { updateProject } from '@/lib/api';

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
  /** Optional: project base path for links (e.g. /projects/123). */
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
  width: 'min(1100px, 96vw)',
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
  projectHref,
}: ProjectDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<ProjectPanelTab>(initialTab);
  const [observabilityView, setObservabilityView] = useState<'logs' | 'timeline'>('logs');
  const [taskMgmtView, setTaskMgmtView] = useState<'board' | 'list'>('board');
  const [editingProject, setEditingProject] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDescription, setEditDescription] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    setEditName(project.name);
    setEditDescription(project.description ?? '');
  }, [project.id, project.name, project.description]);

  if (!open) return null;

  const href = projectHref ?? `/projects/${project.id}`;
  const taskCount = project.taskCount ?? 0;

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updateProject(project.id, {
        name: editName.trim() || project.name,
        description: editDescription.trim() || undefined,
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
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Overview</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 14 }}>
                  {project.description || 'No project description yet.'}
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Project key</span>
                    <span>{project.key ?? `#${project.id}`}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Status</span>
                    <span>{project.status ?? 'active'}</span>
                  </div>
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
                  {!editingProject ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingProject(true);
                        setEditName(project.name);
                        setEditDescription(project.description ?? '');
                      }}
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      Edit project
                    </button>
                  ) : null}
                </div>
                {editingProject && (
                  <form onSubmit={handleSaveProject} style={{ marginTop: 14 }}>
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
                )}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>View:</span>
                <button
                  type="button"
                  onClick={() => setTaskMgmtView('board')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: taskMgmtView === 'board' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
                    color: taskMgmtView === 'board' ? 'var(--coral-bright)' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Board
                </button>
                <button
                  type="button"
                  onClick={() => setTaskMgmtView('list')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: taskMgmtView === 'list' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
                    color: taskMgmtView === 'list' ? 'var(--coral-bright)' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  List
                </button>
              </div>
              {taskMgmtView === 'board' && (
                <div style={cardStyle}>
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>Task board</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Kanban board will show here. Create tasks from the List view or from Brain.
                  </div>
                  <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                    {['To Do', 'In Progress', 'In Review', 'Done'].map((col) => (
                      <div
                        key={col}
                        style={{
                          background: 'var(--bg-deep)',
                          border: '1px dashed var(--border-subtle)',
                          borderRadius: 10,
                          padding: 12,
                          minHeight: 120,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>{col}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tasks</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {taskMgmtView === 'list' && (
                <div style={cardStyle}>
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>Create task</div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Task creation and list will be available when the tasks API is connected.
                  </p>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Tasks for this project: {taskCount}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'prds' && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>PRDs</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Product requirements documents. Use Brain to draft a PRD, then save it here.
              </p>
              <Link
                href="/brainstorm"
                style={{
                  display: 'inline-block',
                  marginTop: 12,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--coral-bright)',
                  border: '1px solid var(--coral-bright)',
                  borderRadius: 8,
                  textDecoration: 'none',
                }}
              >
                Generate with Brain →
              </Link>
            </div>
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

          {activeTab === 'observability' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>View:</span>
                <button
                  type="button"
                  onClick={() => setObservabilityView('logs')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: observabilityView === 'logs' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
                    color: observabilityView === 'logs' ? 'var(--coral-bright)' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Logs
                </button>
                <button
                  type="button"
                  onClick={() => setObservabilityView('timeline')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: observabilityView === 'timeline' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
                    color: observabilityView === 'timeline' ? 'var(--coral-bright)' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Timeline
                </button>
              </div>

              {observabilityView === 'logs' && (
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active Claw</span>
                    <select
                      style={{
                        padding: '6px 10px',
                        fontSize: 13,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-primary)',
                        minWidth: 200,
                      }}
                    >
                      <option value="">No agent selected</option>
                    </select>
                  </div>
                  <div
                    style={{
                      background: 'var(--bg-deep)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      padding: 12,
                      minHeight: 280,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      overflow: 'auto',
                    }}
                  >
                    Streaming logs will appear here when an agent is selected and running.
                  </div>
                </div>
              )}

              {observabilityView === 'timeline' && (
                <div style={cardStyle}>
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>Timeline</div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Visualize execution and task flow over time. Timeline view will show task states and agent activity.
                  </p>
                  <div
                    style={{
                      background: 'var(--bg-deep)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      padding: 24,
                      minHeight: 240,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      fontSize: 13,
                    }}
                  >
                    Timeline visualization will appear here when execution data is available.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
