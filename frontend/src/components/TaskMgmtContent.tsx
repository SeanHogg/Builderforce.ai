'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  tasksApi,
  claws,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type Claw,
} from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';

const BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  ready: 'Ready',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
};
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: 'badge-gray',
  medium: 'badge-blue',
  high: 'badge-yellow',
  urgent: 'badge-red',
};
const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  backlog: 'badge-gray',
  todo: 'badge-gray',
  ready: 'badge-blue',
  in_progress: 'badge-blue',
  in_review: 'badge-yellow',
  done: 'badge-green',
  blocked: 'badge-red',
};

export interface TaskMgmtContentProps {
  /** When set, tasks are scoped to this project and project filter is hidden. */
  projectId?: number;
  /** Optional project name for context when scoped. */
  projectName?: string;
  /** Optional list of projects when not scoped (e.g. from parent). */
  projects?: Project[];
  /** Compact mode: hide header actions and filters (e.g. inside panel). */
  compact?: boolean;
}

function formatDate(d?: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function TaskMgmtContent({
  projectId,
  projectName,
  projects: projectsProp,
  compact = false,
}: TaskMgmtContentProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(projectsProp ?? []);
  const [clawsList, setClawsList] = useState<Claw[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterProject, setFilterProject] = useState<string>(projectId != null ? String(projectId) : '');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Task | null>(null);
  const [form, setForm] = useState<Partial<Task> & { title?: string }>({
    status: 'todo',
    priority: 'medium',
  });
  const [saving, setSaving] = useState(false);
  const [drawerTask, setDrawerTask] = useState<Task | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksData, clawsData] = await Promise.all([
        tasksApi.list(projectId),
        claws.list().catch(() => []),
      ]);
      setTasks(tasksData);
      setClawsList(clawsData);
      if (projectsProp === undefined && !projectId) {
        const projs = await fetchProjects().catch(() => []);
        setProjects(projs);
      } else if (projectsProp) {
        setProjects(projectsProp);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [projectId, projectsProp]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = tasks.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterProject && String(t.projectId) !== filterProject) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const projectNameById = (id?: number | null) =>
    id ? projects.find((p) => p.id === id)?.name ?? String(id) : '—';
  const clawNameById = (id?: number | null) =>
    id ? clawsList.find((c) => c.id === id)?.name ?? String(id) : 'Unassigned';

  const openCreate = () => {
    setEditTarget(null);
    setForm({
      status: 'todo',
      priority: 'medium',
      ...(projectId != null ? { projectId } : {}),
    });
    setShowModal(true);
  };

  const openEdit = (t: Task, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditTarget(t);
    setForm({ ...t });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) return;
    setSaving(true);
    try {
      if (editTarget) {
        const updated = await tasksApi.update(editTarget.id, {
          title: form.title,
          description: form.description ?? null,
          status: (form.status as TaskStatus) ?? editTarget.status,
          priority: (form.priority as TaskPriority) ?? editTarget.priority,
          assignedClawId: form.assignedClawId ?? null,
          dueDate: form.dueDate ?? null,
        });
        setTasks((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        if (drawerTask?.id === updated.id) setDrawerTask(updated);
      } else {
        const projectIdToUse = projectId ?? (form.projectId as number);
        if (projectIdToUse == null) {
          setError('Select a project');
          return;
        }
        const created = await tasksApi.create({
          projectId: projectIdToUse,
          title: form.title.trim(),
          description: form.description || undefined,
          priority: (form.priority as TaskPriority) ?? 'medium',
          assignedClawId: form.assignedClawId ?? undefined,
          dueDate: form.dueDate || undefined,
        });
        const statusToSet = (form.status as TaskStatus) ?? 'todo';
        const final =
          statusToSet !== 'backlog'
            ? await tasksApi.update(created.id, { status: statusToSet })
            : created;
        setTasks((prev) => [final, ...prev]);
      }
      setShowModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (t: Task | null, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!t?.id) return;
    if (!confirm(`Delete "${t.title}"?`)) return;
    try {
      await tasksApi.delete(t.id);
      setTasks((prev) => prev.filter((i) => i.id !== t.id));
      if (drawerTask?.id === t.id) setDrawerTask(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const patchStatus = async (id: number, status: TaskStatus) => {
    try {
      const updated = await tasksApi.update(id, { status });
      setTasks((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (drawerTask?.id === id) setDrawerTask(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    if (dragTaskId) {
      patchStatus(Number(dragTaskId), status);
      setDragTaskId('');
    }
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 12,
    padding: 16,
  };

  const buttonTertiary = {
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--bg-deep)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    cursor: 'pointer' as const,
  };
  const buttonPrimary = {
    ...buttonTertiary,
    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
    color: '#fff',
    border: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.5)',
            color: '#fca5a5',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {filtered.length} task{filtered.length !== 1 ? 's' : ''}
              {projectName ? ` · ${projectName}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {(['board', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  style={{
                    ...buttonTertiary,
                    borderRadius: 0,
                    background: view === v ? 'var(--surface-coral-soft)' : 'transparent',
                    color: view === v ? 'var(--coral-bright)' : 'var(--text-secondary)',
                  }}
                >
                  {v === 'board' ? 'Board' : 'List'}
                </button>
              ))}
            </div>
            <button type="button" onClick={openCreate} style={buttonPrimary}>
              New task
            </button>
          </div>
        </div>
      )}

      {!compact && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              maxWidth: 200,
              height: 32,
              padding: '4px 10px',
              fontSize: 13,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-deep)',
              color: 'var(--text-primary)',
            }}
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              maxWidth: 160,
              height: 32,
              padding: '4px 10px',
              fontSize: 13,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-deep)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {!projectId && (
            <select
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              style={{
                maxWidth: 180,
                height: 32,
                padding: '4px 10px',
                fontSize: 13,
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            style={{
              maxWidth: 140,
              height: 32,
              padding: '4px 10px',
              fontSize: 13,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-deep)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : view === 'board' ? (
        <div
          className="task-kanban"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${BOARD_STATUSES.length}, minmax(200px, 1fr))`,
            gap: 12,
            minHeight: 200,
          }}
        >
          {BOARD_STATUSES.map((status) => {
            const tasksForStatus = filtered.filter((t) => t.status === status);
            return (
              <div
                key={status}
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, status)}
                style={{
                  background: 'var(--bg-deep)',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 10,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 120,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>{STATUS_LABELS[status]}</span>
                  <span>{tasksForStatus.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  {tasksForStatus.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragTaskId(String(task.id))}
                      onClick={() => setDrawerTask(task)}
                      style={{
                        ...cardStyle,
                        padding: 12,
                        cursor: 'grab',
                      }}
                    >
                      <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)' }}>
                        {task.title}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginTop: 6,
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{task.key}</span>
                        <span
                          className={PRIORITY_CLASS[task.priority]}
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 4,
                            textTransform: 'capitalize',
                          }}
                        >
                          {task.priority}
                        </span>
                        {task.assignedClawId && (
                          <span>{clawNameById(task.assignedClawId)}</span>
                        )}
                        {task.dueDate && (
                          <span style={{ marginLeft: 'auto' }}>{formatDate(task.dueDate)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {!compact && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm({
                          status: status as TaskStatus,
                          priority: 'medium',
                          ...(projectId != null ? { projectId } : {}),
                        });
                        setEditTarget(null);
                        setShowModal(true);
                      }}
                      style={{
                        ...buttonTertiary,
                        borderStyle: 'dashed',
                        width: '100%',
                        marginTop: 4,
                      }}
                    >
                      + Add task
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={cardStyle}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
              No tasks found
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Task
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Status
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Priority
                    </th>
                    {!projectId && (
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                        Project
                      </th>
                    )}
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Assignee
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Due
                    </th>
                    <th style={{ width: 1 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => setDrawerTask(task)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{task.title}</div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {task.key}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          className={STATUS_BADGE_CLASS[task.status]}
                          style={{
                            fontSize: 10,
                            padding: '2px 8px',
                            borderRadius: 4,
                            textTransform: 'capitalize',
                          }}
                        >
                          {STATUS_LABELS[task.status]}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          className={PRIORITY_CLASS[task.priority]}
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 4,
                            textTransform: 'capitalize',
                          }}
                        >
                          {task.priority}
                        </span>
                      </td>
                      {!projectId && (
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                          {projectNameById(task.projectId)}
                        </td>
                      )}
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                        {clawNameById(task.assignedClawId)}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatDate(task.dueDate)}
                      </td>
                      <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            style={{ ...buttonTertiary, padding: '4px 8px', fontSize: 12 }}
                            onClick={() => setDrawerTask(task)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonTertiary, padding: '4px 8px', fontSize: 12 }}
                            onClick={(e) => openEdit(task, e)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            style={{
                              ...buttonTertiary,
                              padding: '4px 8px',
                              fontSize: 12,
                              color: 'var(--danger, #f87171)',
                              borderColor: 'rgba(248,113,113,0.5)',
                            }}
                            onClick={(e) => removeTask(task, e)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 540,
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
              {editTarget ? 'Edit task' : 'New task'}
            </div>
            <form onSubmit={handleSave} style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Title
                </label>
                <input
                  required
                  placeholder="What needs to be done?"
                  value={form.title ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
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
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Description (optional)
                </label>
                <textarea
                  placeholder="Additional context…"
                  value={form.description ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Status
                  </label>
                  <select
                    value={form.status ?? 'todo'}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}
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
                    {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Priority
                  </label>
                  <select
                    value={form.priority ?? 'medium'}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}
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
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {!projectId && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Project
                  </label>
                  <select
                    value={form.projectId ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, projectId: e.target.value ? Number(e.target.value) : undefined }))
                    }
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
                    <option value="">Select project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Assign to Claw
                  </label>
                  <select
                    value={form.assignedClawId ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        assignedClawId: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
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
                    <option value="">Unassigned</option>
                    {clawsList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Due date (optional)
                  </label>
                  <input
                    type="date"
                    value={form.dueDate?.split('T')[0] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value || undefined }))}
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
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" style={buttonTertiary} onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={{ ...buttonPrimary, opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : editTarget ? 'Save changes' : 'Create task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {drawerTask && (
        <>
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.25)',
              zIndex: 9998,
            }}
            onClick={() => setDrawerTask(null)}
          />
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(480px, 96vw)',
              background: 'var(--bg-elevated)',
              borderLeft: '1px solid var(--border-subtle)',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 16,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{drawerTask.title}</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {drawerTask.key}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerTask(null)}
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
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <span
                  className={STATUS_BADGE_CLASS[drawerTask.status]}
                  style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
                >
                  {STATUS_LABELS[drawerTask.status]}
                </span>
                <span
                  className={PRIORITY_CLASS[drawerTask.priority]}
                  style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
                >
                  {drawerTask.priority}
                </span>
              </div>
              {drawerTask.description && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Description</div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {drawerTask.description}
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Details</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {[
                    ['Project', projectNameById(drawerTask.projectId)],
                    ['Assignee', clawNameById(drawerTask.assignedClawId)],
                    ['Due date', formatDate(drawerTask.dueDate) || 'None'],
                    ['Created', formatDate(drawerTask.createdAt)],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                      <span style={{ color: 'var(--text-primary)' }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Move to</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(Object.keys(STATUS_LABELS) as TaskStatus[])
                    .filter((s) => s !== drawerTask.status)
                    .map((s) => (
                      <button
                        key={s}
                        type="button"
                        style={buttonTertiary}
                        onClick={() => patchStatus(drawerTask.id, s)}
                      >
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={buttonTertiary} onClick={(e) => openEdit(drawerTask, e)}>
                  Edit
                </button>
                <button
                  type="button"
                  style={{
                    ...buttonTertiary,
                    color: 'var(--danger, #f87171)',
                    borderColor: 'rgba(248,113,113,0.5)',
                  }}
                  onClick={(e) => removeTask(drawerTask, e)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
