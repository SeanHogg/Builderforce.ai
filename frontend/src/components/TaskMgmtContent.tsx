'use client';

import { Select } from '@/components/Select';

import { useState, useEffect, useCallback, useMemo, Fragment, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  tasksApi,
  agentHosts,
  runtimeApi,
  boardsApi,
  workflowDefinitions,
  isAwaitingApprovalExecution,
  type Task,
  type TaskPriority,
  type AgentHost,
  type Execution,
  type SwimlaneAgent,
  type BoardDispatch,
} from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { getProjectWorkforce } from '@/lib/teams';
import { onBrainDataChanged } from '@/lib/brain/brainDataEvent';
import {
  assigneeSelectValue,
  parseAssigneeSelectValue,
  assigneeName,
  type AssigneePatch,
  type CloudAgentTarget,
  type TeamMember,
} from '@/lib/taskAssignee';
import { BoardConfigPanel } from './board/BoardConfigPanel';
import { AgentChip } from './board/AgentChip';
import { useBoardConfig } from './board/useBoardConfig';
import { decideLaneAutoRun } from '@/lib/laneAutoRun';
import { SlideOutPanel } from './SlideOutPanel';
import { MoveToBoardControl } from './MoveToBoardControl';
import { AgentTab } from './agent/AgentTab';
import { TaskPrdTab } from './task/TaskPrdTab';
import { RunTaskButton } from './task/RunTaskButton';
import { ChatMessageContent } from './ChatMessageContent';
import { ViewToggle } from './ViewToggle';
import { CeremonyStage, type CeremonyMode } from './ceremony/CeremonyStage';
import { ScheduleCalendar } from './ScheduleCalendar';
import { ScheduleGantt } from './ScheduleGantt';
import {
  TASK_STATUSES as BOARD_STATUSES,
  taskStatusLabel,
  taskStatusBadgeClass,
} from '@/lib/taskStatus';

type TaskView = 'board' | 'table' | 'calendar' | 'gantt';

/** A rendered kanban column = a swimlane (board column). `status` is the lane key tasks sit in. */
interface BoardColumn {
  id: string;
  status: string;
  label: string;
  agents: SwimlaneAgent[];
}
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: 'badge-gray',
  medium: 'badge-blue',
  high: 'badge-yellow',
  urgent: 'badge-red',
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

/**
 * Assignee picker shared by the create dialog and the drawer's inline editor.
 * Lists human teammates, self-hosted agent hosts, and cloud agents in grouped
 * sections and emits the mutually-exclusive
 * (assignedAgentHostId | assignedAgentRef | assignedUserId) patch.
 */
function AssigneeSelect({
  hosts,
  cloudAgents,
  members,
  hostId,
  agentRef,
  userId,
  onChange,
  autoFocus,
  disabled,
  onBlur,
  style,
}: {
  hosts: AgentHost[];
  cloudAgents: CloudAgentTarget[];
  members: TeamMember[];
  hostId?: number | null;
  agentRef?: string | null;
  userId?: string | null;
  onChange: (patch: AssigneePatch) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
  style?: CSSProperties;
}) {
  return (
    <Select
      autoFocus={autoFocus}
      disabled={disabled}
      onBlur={onBlur}
      value={assigneeSelectValue(hostId, agentRef, userId)}
      onChange={(e) => onChange(parseAssigneeSelectValue(e.target.value))}
      style={style}
    >
      <option value="">Unassigned</option>
      {members.length > 0 && (
        <optgroup label="Team members">
          {members.map((m) => (
            <option key={`u:${m.id}`} value={`u:${m.id}`}>{m.name}</option>
          ))}
        </optgroup>
      )}
      {hosts.length > 0 && (
        <optgroup label="Agent hosts">
          {hosts.map((h) => (
            <option key={`h:${h.id}`} value={`h:${h.id}`}>{h.name}</option>
          ))}
        </optgroup>
      )}
      {cloudAgents.length > 0 && (
        <optgroup label="Cloud agents">
          {cloudAgents.map((a) => (
            <option key={`c:${a.ref}`} value={`c:${a.ref}`}>{a.name}</option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

export function TaskMgmtContent({
  projectId,
  projectName,
  projects: projectsProp,
  compact = false,
}: TaskMgmtContentProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(projectsProp ?? []);
  const [agentHostsList, setAgentHostsList] = useState<AgentHost[]>([]);
  const [cloudAgentsList, setCloudAgentsList] = useState<CloudAgentTarget[]>([]);
  const [membersList, setMembersList] = useState<TeamMember[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalGate, setApprovalGate] = useState<{ approvalId: string; taskId: number; reason: string } | null>(null);
  const [view, setView] = useState<TaskView>('board');
  // Standup mode: pivot the board so rows = teammates/agents and columns = stages,
  // surfacing each person's in-flight work at a glance. Board-view only, session-only.
  const [groupByAssignee, setGroupByAssignee] = useState(false);
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
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [editingStatusId, setEditingStatusId] = useState<number | null>(null);
  const [boardConfigOpen, setBoardConfigOpen] = useState(false);
  // Live ceremony overlay (standup/planning round-table) for the selected board.
  const [ceremony, setCeremony] = useState<CeremonyMode | null>(null);
  const [prdOpen, setPrdOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'details' | 'agent' | 'prd'>('details');
  // Inline per-field editing in the task drawer. Only one field is editable at a
  // time; `fieldDraft` holds the in-progress value (string for text/date inputs).
  const [editingField, setEditingField] = useState<
    null | 'title' | 'description' | 'dueDate' | 'assignee' | 'priority' | 'status' | 'project'
  >(null);
  const [fieldDraft, setFieldDraft] = useState('');
  const [fieldSaving, setFieldSaving] = useState(false);

  // Open a task drawer on a specific tab (defaults to Details). Used so clicking
  // a running-agent chip jumps straight to the Agent tab.
  const openTask = useCallback((t: Task, tab: 'details' | 'agent' | 'prd' = 'details') => {
    setDrawerTab(tab);
    setDrawerTask(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksData, agentHostsData, execData, runTargets, membersData, projectWf] = await Promise.all([
        tasksApi.list(projectId),
        agentHosts.list().catch(() => []),
        runtimeApi.listRecent().catch(() => []),
        // Cloud agents assignable to a ticket (active, cloud-capable ide_agents).
        // run-targets already merges hosts + cloud agents and is server-cached;
        // we only take the cloud side here since hosts come from agentHosts.list.
        workflowDefinitions.runTargets().catch(() => ({ hosts: [], cloudAgents: [] })),
        // Human teammates — the human half of the unified assignee picker. Server-cached.
        tasksApi.assignees().catch(() => []),
        // Scoped board only: the teams assigned to this project narrow the assignee
        // picker to their members. Falls back to the full roster when no team is
        // assigned (scopedToTeams=false) or in the all-projects view (no projectId).
        projectId != null ? getProjectWorkforce(projectId).catch(() => null) : Promise.resolve(null),
      ]);
      setTasks(tasksData);
      // When a project has teams assigned, the assignable workforce is exactly
      // those teams' members — filter each pool to the team set so the picker
      // can't offer someone off-team. We filter the live lists (not the
      // denormalized team names) so display names stay current.
      const teamSet = projectWf?.scopedToTeams
        ? new Set(projectWf.workforce.map((w) => `${w.kind}:${w.ref}`))
        : null;
      setAgentHostsList(teamSet ? agentHostsData.filter((h) => teamSet.has(`host_agent:${h.id}`)) : agentHostsData);
      setCloudAgentsList(teamSet ? runTargets.cloudAgents.filter((a) => teamSet.has(`cloud_agent:${a.ref}`)) : runTargets.cloudAgents);
      setMembersList(teamSet ? membersData.filter((m) => teamSet.has(`human:${m.id}`)) : membersData);
      setExecutions(execData);
      // Always resolve the full project list (unless the parent supplied one):
      // it backs both the project filter and the "Move to board" destinations,
      // which are needed even in the scoped (single-project) view.
      if (projectsProp) {
        setProjects(projectsProp);
      } else {
        const projs = await fetchProjects().catch(() => []);
        setProjects(projs);
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

  // When the Brain mutates tasks/projects/executions (e.g. the user approves an
  // "update task" action in the docked drawer), the write lands via the API but
  // this board holds its own state — so listen on the brain-data bus and refetch
  // to reflect the change live instead of going stale until a manual reload.
  useEffect(
    () => onBrainDataChanged(['tasks', 'executions', 'projects'], () => { void load(); }),
    [load],
  );

  useEffect(() => {
    if (view === 'board') {
      setSelectedIds([]);
      setBulkStatus('');
    }
  }, [view]);

  // Close any open inline editor when switching tasks/tabs so a half-edited field
  // never carries over to a different task.
  useEffect(() => {
    setEditingField(null);
  }, [drawerTask?.id, drawerTab]);

  const projectNameById = (id?: number | null) =>
    id ? projects.find((p) => p.id === id)?.name ?? String(id) : '—';
  // Resolve a task's assignee (human teammate, self-hosted host, OR cloud agent) to its display name.
  const taskAssigneeName = (t: { assignedAgentHostId?: number | null; assignedAgentRef?: string | null; assignedUserId?: string | null }) =>
    assigneeName(t.assignedAgentHostId, t.assignedAgentRef, t.assignedUserId, agentHostsList, cloudAgentsList, membersList);

  // The board being configured: the scoped project, or the single project chosen
  // in the filter. Null when viewing "All projects" — the cog stays visible but disabled.
  const effectiveProjectId = projectId ?? (filterProject ? Number(filterProject) : undefined);
  const effectiveProjectName =
    projectId != null ? projectName : projectNameById(effectiveProjectId);

  // Swimlanes + their configured agents for the selected board, shown discretely
  // in each column header. Only fetched for the board view of a single project.
  const { board, lanes, agentsByLane } = useBoardConfig(
    effectiveProjectId,
    effectiveProjectId != null && view === 'board' && !compact,
  );

  // Statuses that count as "done" for the board's hide-done-items toggle: the
  // keys of every terminal lane. Falls back to the canonical `done` status when
  // the board has no configured lanes (default kanban columns).
  const doneStatuses = useMemo(() => {
    const terminal = lanes.filter((l) => l.isTerminal).map((l) => l.key);
    return new Set<string>(terminal.length > 0 ? terminal : ['done']);
  }, [lanes]);

  const filtered = tasks.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterProject && String(t.projectId) !== filterProject) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    // Board-level "hide done items": drop tickets sitting in a terminal lane.
    // Applies only on the board view (where the board/lanes are loaded).
    if (board?.hideDoneItems && view === 'board' && doneStatuses.has(t.status)) return false;
    return true;
  });

  // Live per-agent dispatch status for the board, so each lane's configured-agent
  // chips light up with their current execution status (pending→running→done/failed).
  const [dispatches, setDispatches] = useState<BoardDispatch[]>([]);
  useEffect(() => {
    // Only fetch in the board view; stale data from a prior board is harmless as
    // the status chips render only here (and a board switch refetches).
    if (!board?.id || view !== 'board' || compact) return;
    let live = true;
    boardsApi.dispatches(board.id).then((d) => { if (live) setDispatches(d); }).catch(() => {});
    return () => { live = false; };
  }, [board?.id, view, compact]);

  // Latest dispatch per assignment (configured agent), keyed by assignment id.
  const latestDispatchByAssignment = useMemo(() => {
    const m = new Map<string, BoardDispatch>();
    for (const d of dispatches) {
      if (!d.assignmentId) continue;
      const prev = m.get(d.assignmentId);
      const dc = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
      const pc = prev?.updatedAt ? new Date(prev.updatedAt).getTime() : -1;
      if (!prev || dc >= pc) m.set(d.assignmentId, d);
    }
    return m;
  }, [dispatches]);

  // The board's columns ARE its swimlanes (fully configurable): each lane is a
  // column whose key is the status a task holds while sitting in it. Renaming /
  // reordering / adding / removing lanes and assigning agents all flow straight
  // through to the board. When a project has no board yet, fall back to the
  // default status columns so the board still works out of the box.
  const boardColumns = useMemo<BoardColumn[]>(() => {
    const defaults = (): BoardColumn[] =>
      BOARD_STATUSES.map((s) => ({ id: s, status: s, label: taskStatusLabel(s), agents: [] }));
    if (lanes.length === 0) return defaults();

    const cols: BoardColumn[] = [];
    const covered = new Set<string>();
    for (const l of lanes) {
      if (covered.has(l.key)) continue;
      cols.push({ id: l.id, status: l.key, label: l.name, agents: agentsByLane[l.id] ?? [] });
      covered.add(l.key);
    }
    // Surface any status still held by tasks but with no lane (e.g. after a lane
    // is deleted, or a legacy/custom status) so no task is ever hidden.
    for (const t of tasks) {
      if (!covered.has(t.status)) {
        cols.push({ id: `orphan:${t.status}`, status: t.status, label: taskStatusLabel(t.status), agents: [] });
        covered.add(t.status);
      }
    }
    return cols.length > 0 ? cols : defaults();
  }, [lanes, agentsByLane, tasks]);

  // Status choices for dropdowns / move-to / filters = the board's columns.
  const statusChoices = boardColumns.map((c) => ({ value: c.status, label: c.label }));
  // Label for a task's status: prefer its column's name, else a humanized label.
  const columnLabel = (status: string) =>
    boardColumns.find((c) => c.status === status)?.label ?? taskStatusLabel(status);

  // Standup pivot: group the (filtered) tasks by assignee so each teammate/agent
  // is a row and the board columns become the stage cells. A task with no
  // assignee collapses into one "Unassigned" row (sorted last). Built from the
  // same `filtered` set as the board so search/status/priority filters carry over.
  const assigneeRows = useMemo(() => {
    const rows = new Map<string, { key: string; name: string; tasks: Task[] }>();
    for (const t of filtered) {
      const key = assigneeSelectValue(t.assignedAgentHostId, t.assignedAgentRef, t.assignedUserId);
      const row = rows.get(key);
      if (row) row.tasks.push(t);
      else rows.set(key, { key, name: taskAssigneeName(t), tasks: [t] });
    }
    return Array.from(rows.values()).sort((a, b) => {
      // Keep "Unassigned" (empty key) at the bottom; otherwise alphabetical.
      if (a.key === '' !== (b.key === '')) return a.key === '' ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, taskAssigneeName]);

  // Latest execution per task → which agent is actively running (or last ran) it.
  const latestExecByTask = useMemo(() => {
    const m = new Map<number, Execution>();
    for (const e of executions) {
      const prev = m.get(e.taskId);
      const ec = e.createdAt ? new Date(e.createdAt).getTime() : 0;
      const pc = prev?.createdAt ? new Date(prev.createdAt).getTime() : -1;
      if (!prev || ec >= pc) m.set(e.taskId, e);
    }
    return m;
  }, [executions]);

  // Resolve the human-facing name of whatever agent ran an execution.
  const execAgentLabel = (e: Execution): string =>
    (e.agentHostId != null ? agentHostsList.find((c) => c.id === e.agentHostId)?.name : null) ??
    (e.agentHostId != null ? `AgentHost ${e.agentHostId}` : null) ??
    (e.agentId != null ? `Agent ${e.agentId}` : 'Agent');

  const openCreate = () => {
    setEditTarget(null);
    setForm({
      status: boardColumns[0]?.status ?? 'todo',
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
          status: form.status ?? editTarget.status,
          priority: (form.priority as TaskPriority) ?? editTarget.priority,
          assignedAgentHostId: form.assignedAgentHostId ?? null,
          assignedAgentRef: form.assignedAgentRef ?? null,
          assignedUserId: form.assignedUserId ?? null,
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
          assignedAgentHostId: form.assignedAgentHostId ?? undefined,
          assignedAgentRef: form.assignedAgentRef ?? undefined,
          assignedUserId: form.assignedUserId ?? undefined,
          dueDate: form.dueDate || undefined,
        });
        const statusToSet = form.status ?? 'todo';
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

  // Persist a single edited field from the drawer's inline editors. Patches the
  // open task, syncs the list + drawer, and closes the active editor on success.
  const saveTaskField = async (
    patch: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'assignedAgentHostId' | 'assignedAgentRef' | 'assignedUserId' | 'dueDate'>>
  ) => {
    if (!drawerTask) return;
    setFieldSaving(true);
    try {
      const updated = await tasksApi.update(drawerTask.id, patch);
      setTasks((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setDrawerTask(updated);
      setEditingField(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setFieldSaving(false);
    }
  };

  const patchStatus = async (
    id: number,
    status: string,
    opts?: { skipAutoSubmit?: boolean }
  ) => {
    try {
      const updated = await tasksApi.update(id, { status });
      setTasks((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (drawerTask?.id === id) setDrawerTask(updated);

      // Autonomous trigger: when a ticket enters a lane, decide whether to auto-run
      // and — critically — AS WHICH AGENT. A lane configured with a cloud agent
      // (e.g. a Coder Agent V2) must run AS that agent: pass its ref + model so the
      // backend resolves the right engine instead of falling back to the V1
      // gateway-default. The decision lives in one place (decideLaneAutoRun).
      if (!opts?.skipAutoSubmit) {
        const column = boardColumns.find((c) => c.status === status);
        // Autonomy is per-lane: a lane with agents + an `auto` gate fires; a
        // `human` gate waits. (board.autonomous is legacy/unused — always false.)
        const laneGate = lanes.find((l) => l.key === status)?.gate;
        const decision = decideLaneAutoRun(column?.agents, status, laneGate);
        if (decision.autoRun) {
          const payloadObj: { cloudAgentRef?: string; model?: string } = {};
          if (decision.cloudAgentRef) payloadObj.cloudAgentRef = decision.cloudAgentRef;
          if (decision.model) payloadObj.model = decision.model;
          try {
            const result = await runtimeApi.submitExecution({
              taskId: id,
              agentHostId: updated.assignedAgentHostId ?? undefined,
              payload: Object.keys(payloadObj).length > 0 ? JSON.stringify(payloadObj) : undefined,
            });

            if (isAwaitingApprovalExecution(result)) {
              setApprovalGate({
                approvalId: result.approvalId,
                taskId: result.taskId,
                reason: result.reason,
              });
            }
          } catch {
            // Non-blocking: status was updated; execution may fail if no agentHost connected
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const onDragOver = (e: React.DragEvent) => e.preventDefault();

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const toggleAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((t) => t.id));
    }
  };

  const applyBulkStatus = async (status: string) => {
    const toUpdate = selectedIds.slice();
    setSelectedIds([]);
    setBulkStatus('');
    for (const id of toUpdate) {
      await patchStatus(id, status);
    }
  };

  // Move a task to another project ("board"). The server re-keys it; we swap the
  // returned task into state so it leaves any board-scoped/filtered view on its own.
  const moveTask = async (id: number, targetProjectId: number) => {
    try {
      const moved = await tasksApi.move(id, targetProjectId);
      setTasks((prev) => prev.map((t) => (t.id === moved.id ? moved : t)));
      if (drawerTask?.id === id) setDrawerTask(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
    }
  };

  const applyBulkMove = async (targetProjectId: number) => {
    const toMove = selectedIds.slice();
    setSelectedIds([]);
    for (const id of toMove) {
      await moveTask(id, targetProjectId);
    }
  };
  const onDrop = (e: React.DragEvent, status: string) => {
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

  // One draggable task card, shared by the status board and the standup pivot so
  // both render an identical card (inline status editor, priority/PR/exec chips).
  const renderTaskCard = (task: Task) => {
    const exec = latestExecByTask.get(task.id);
    return (
      <div
        key={task.id}
        draggable
        onDragStart={() => setDragTaskId(String(task.id))}
        onClick={() => openTask(task)}
        style={{ ...cardStyle, padding: 12, cursor: 'grab', position: 'relative' }}
      >
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          {editingStatusId === task.id ? (
            <Select
              value={task.status}
              onChange={(e) => {
                e.stopPropagation();
                patchStatus(task.id, e.target.value);
                setEditingStatusId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {statusChoices.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          ) : (
            <span
              className={taskStatusBadgeClass(task.status)}
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 4,
                textTransform: 'capitalize',
                cursor: 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
                setEditingStatusId(task.id);
              }}
            >
              {columnLabel(task.status)}
            </span>
          )}
        </div>
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
            style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, textTransform: 'capitalize' }}
          >
            {task.priority}
          </span>
          {task.specCount ? (
            <span
              title={`${task.specCount} linked PRD${task.specCount > 1 ? 's' : ''}`}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              📄 PRD{task.specCount > 1 ? ` ×${task.specCount}` : ''}
            </span>
          ) : null}
          {exec ? (
            <AgentChip
              label={execAgentLabel(exec)}
              status={exec.status}
              title={`${execAgentLabel(exec)} — execution #${exec.id} · ${exec.status}. Click to open the Agent tab.`}
              onClick={(e) => {
                e.stopPropagation();
                openTask(task, 'agent');
              }}
            />
          ) : (task.assignedAgentHostId || task.assignedAgentRef || task.assignedUserId) ? (
            <span>{taskAssigneeName(task)}</span>
          ) : null}
          {task.githubPrUrl && (
            <a
              href={task.githubPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 600 }}
            >
              PR#{task.githubPrNumber ?? '—'}
            </a>
          )}
          {task.dueDate && <span style={{ marginLeft: 'auto' }}>{formatDate(task.dueDate)}</span>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
            color: 'var(--error-text)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {approvalGate && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning-border)',
            color: 'var(--warning-text)',
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {approvalGate.reason}
            {' '}
            (Task #{approvalGate.taskId}, approval {approvalGate.approvalId.slice(0, 8)}...)
          </span>
          <Link
            href="/workforce?tab=approvals"
            style={{
              fontWeight: 700,
              color: 'var(--coral-bright)',
              textDecoration: 'none',
            }}
          >
            Open approvals
          </Link>
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
            <ViewToggle value={view} onChange={setView} board table calendar gantt />
            {view === 'board' && (
              // Standup pivot toggle — board-view only. Off = group by stage
              // (columns), On = group by assignee (rows). Session-only state.
              <ViewToggle
                value={groupByAssignee ? 'people' : 'stage'}
                onChange={(m) => setGroupByAssignee(m === 'people')}
                options={[
                  { value: 'stage', label: 'By stage' },
                  { value: 'people', label: 'By assignee' },
                ]}
              />
            )}
            <button type="button" onClick={openCreate} style={buttonPrimary}>
              New task
            </button>
            {effectiveProjectId != null && (
              // Launch the live round-table ceremony as a full-screen overlay over
              // this board. Standup reviews in-flight work; Planning drags backlog
              // onto seats / Epics / a sprint.
              <>
                <button type="button" onClick={() => setCeremony('standup')} style={buttonTertiary}>
                  Start standup
                </button>
                <button type="button" onClick={() => setCeremony('planning')} style={buttonTertiary}>
                  Start planning
                </button>
              </>
            )}
            {(() => {
              // Both the PRD and the board-config controls are board-scoped: they
              // act on the single selected project, so they share one enabled gate.
              const canConfigure = effectiveProjectId != null;
              const iconBtn = {
                ...buttonTertiary,
                width: 36,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: canConfigure ? 1 : 0.4,
                cursor: canConfigure ? 'pointer' : 'not-allowed',
              } as const;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => canConfigure && setPrdOpen(true)}
                    disabled={!canConfigure}
                    style={iconBtn}
                    aria-label="View PRD"
                    title={canConfigure ? 'View the PRD (shared by every agent on this board)' : 'Select a single project to view its PRD'}
                  >
                    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                      <line x1="8" y1="13" x2="16" y2="13" />
                      <line x1="8" y1="17" x2="16" y2="17" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => canConfigure && setBoardConfigOpen(true)}
                    disabled={!canConfigure}
                    style={iconBtn}
                    aria-label="Configure board"
                    title={canConfigure ? 'Configure swimlanes & agents' : 'Select a single project to configure its board'}
                  >
                    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                </>
              );
            })()}
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
          <Select
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
            {statusChoices.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          {!projectId && (
            <Select
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
            </Select>
          )}
          <Select
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
          </Select>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : view === 'board' && groupByAssignee ? (
        // Standup pivot: one row per teammate/agent, board columns as stage cells.
        // Tasks stay draggable across stages (same renderTaskCard + drop targets).
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {assigneeRows.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No tasks found</div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `minmax(140px, 200px) repeat(${boardColumns.length}, minmax(180px, 1fr))`,
                gap: 8,
                minWidth: 'min-content',
              }}
            >
              {/* Header row: empty corner + one cell per stage. */}
              <div />
              {boardColumns.map((column) => (
                <div
                  key={column.id}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', padding: '0 4px 4px' }}
                >
                  {column.label}
                </div>
              ))}
              {assigneeRows.map((row) => (
                <Fragment key={row.key || 'unassigned'}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      padding: '8px 4px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    {row.name}
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>
                      {row.tasks.length}
                    </span>
                  </div>
                  {boardColumns.map((column) => {
                    const cellTasks = row.tasks.filter((t) => t.status === column.status);
                    return (
                      <div
                        key={column.id}
                        onDragOver={onDragOver}
                        onDrop={(e) => onDrop(e, column.status)}
                        style={{
                          background: 'var(--bg-deep)',
                          border: '1px dashed var(--border-subtle)',
                          borderRadius: 10,
                          padding: 8,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          minHeight: 56,
                          borderTop: '1px solid var(--border-subtle)',
                        }}
                      >
                        {cellTasks.map((task) => renderTaskCard(task))}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          )}
        </div>
      ) : view === 'board' ? (
        <div
          className="task-kanban"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${boardColumns.length}, minmax(200px, 1fr))`,
            gap: 12,
            minHeight: 200,
            // Swipe/scroll horizontally when the columns can't all fit (mobile,
            // or just a lot of lanes). minmax(200px,1fr) keeps each column wide
            // enough to read; the grid overflows this box and scrolls instead of
            // squashing or being clipped by the content column's overflow:hidden.
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollSnapType: 'x proximity',
            paddingBottom: 4,
          }}
        >
          {boardColumns.map((column) => {
            const status = column.status;
            const tasksForStatus = filtered.filter((t) => t.status === status);
            return (
              <div
                key={column.id}
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
                  scrollSnapAlign: 'start',
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span>{column.label}</span>
                    <span>{tasksForStatus.length}</span>
                  </div>
                  {column.agents.length > 0 && (
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}
                      title="Agents configured on this swimlane"
                    >
                      {column.agents.map((a) => {
                        const disp = latestDispatchByAssignment.get(a.id);
                        const label = a.name ?? a.role;
                        return (
                          <AgentChip
                            key={a.id}
                            label={label}
                            status={disp?.status}
                            meta={a.model ?? a.runtime}
                            title={`${label} · ${a.runtime}${a.model ? ` · ${a.model}` : ''}${disp ? ` — ${disp.status}` : ''}`}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  {tasksForStatus.map((task) => renderTaskCard(task))}
                  {!compact && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm({
                          status,
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
      ) : view === 'calendar' ? (
        <ScheduleCalendar items={filtered} getLabel={(t) => t.title} onSelect={(t) => openTask(t)} />
      ) : view === 'gantt' ? (
        <ScheduleGantt items={filtered} getLabel={(t) => t.title} onSelect={(t) => openTask(t)} noun="task" />
      ) : (
        <div style={cardStyle}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
              No tasks found
            </div>
          ) : (
            <>
              {selectedIds.length > 0 && (
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {selectedIds.length} selected
                  </span>
                  <Select
                    value={bulkStatus}
                    onChange={(e) => {
                      const s = e.target.value;
                      if (s) applyBulkStatus(s);
                    }}
                    style={{ padding: '4px 8px', fontSize: 13 }}
                  >
                    <option value="">Bulk change status…</option>
                    {statusChoices.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                  <MoveToBoardControl
                    projects={projects}
                    currentProjectId={effectiveProjectId}
                    onMove={applyBulkMove}
                  />
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '8px 12px' }}>
                        <input
                          type="checkbox"
                          checked={filtered.length > 0 && selectedIds.length === filtered.length}
                          onChange={toggleAll}
                        />
                      </th>
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
                  {filtered.map((task) => {
                    const exec = latestExecByTask.get(task.id);
                    return (
                    <tr
                      key={task.id}
                      onClick={() => openTask(task)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '10px 12px' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(task.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelect(task.id);
                          }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{task.title}</div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {task.key}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                        {editingStatusId === task.id ? (
                          <Select
                            value={task.status}
                            onChange={(e) => {
                              patchStatus(task.id, e.target.value);
                              setEditingStatusId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {statusChoices.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span
                            className={taskStatusBadgeClass(task.status)}
                            style={{
                              fontSize: 10,
                              padding: '2px 8px',
                              borderRadius: 4,
                              textTransform: 'capitalize',
                              cursor: 'pointer',
                            }}
                            onClick={() => setEditingStatusId(task.id)}
                          >
                            {columnLabel(task.status)}
                          </span>
                        )}
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
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }} onClick={(e) => e.stopPropagation()}>
                        {exec ? (
                          <AgentChip
                            label={execAgentLabel(exec)}
                            status={exec.status}
                            title={`${execAgentLabel(exec)} — execution #${exec.id} · ${exec.status}. Click to open the Agent tab.`}
                            onClick={() => openTask(task, 'agent')}
                          />
                        ) : (
                          taskAssigneeName(task)
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatDate(task.dueDate)}
                      </td>
                      <td style={{ padding: '10px 12px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            style={{ ...buttonTertiary, padding: '4px 8px', fontSize: 12 }}
                            onClick={() => openTask(task)}
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
                          <MoveToBoardControl
                            projects={projects}
                            currentProjectId={task.projectId}
                            onMove={(projectId) => moveTask(task.id, projectId)}
                            label="Move…"
                            style={{ padding: '4px 6px', fontSize: 12 }}
                          />
                          <button
                            type="button"
                            style={{
                              ...buttonTertiary,
                              padding: '4px 8px',
                              fontSize: 12,
                              color: 'var(--error-text)',
                              borderColor: 'var(--error-border)',
                            }}
                            onClick={(e) => removeTask(task, e)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>  
          )}
        </div>
      )}

      {showModal && (
        <div
          className="modal-overlay"
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
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
                  <Select
                    value={form.status ?? 'todo'}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
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
                    {statusChoices.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Priority
                  </label>
                  <Select
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
                  </Select>
                </div>
              </div>
              {!projectId && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Project
                  </label>
                  <Select
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
                  </Select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Assign to team member
                  </label>
                  <AssigneeSelect
                    hosts={agentHostsList}
                    cloudAgents={cloudAgentsList}
                    members={membersList}
                    hostId={form.assignedAgentHostId}
                    agentRef={form.assignedAgentRef}
                    userId={form.assignedUserId}
                    onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
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
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  GitHub PR URL (optional)
                </label>
                <input
                  type="url"
                  placeholder="https://github.com/org/repo/pull/123"
                  value={(form as Record<string, unknown>).githubPrUrl as string ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, githubPrUrl: e.target.value || null } as typeof f))}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 13,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-deep)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                  }}
                />
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
            className="slide-panel-overlay"
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10002,
            }}
            onClick={() => setDrawerTask(null)}
          />
          <div
            className="slide-panel-drawer"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(864px, 96vw)',
              borderLeft: '1px solid var(--border-subtle)',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
              zIndex: 10003,
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
              <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                {editingField === 'title' ? (
                  <input
                    autoFocus
                    value={fieldDraft}
                    onChange={(e) => setFieldDraft(e.target.value)}
                    onBlur={() => {
                      const next = fieldDraft.trim();
                      if (next && next !== drawerTask.title) saveTaskField({ title: next });
                      else setEditingField(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                      if (e.key === 'Escape') setEditingField(null);
                    }}
                    style={{
                      width: '100%',
                      fontWeight: 700,
                      fontSize: 16,
                      padding: '4px 8px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      background: 'var(--bg-deep)',
                      color: 'var(--text-primary)',
                    }}
                  />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { setFieldDraft(drawerTask.title); setEditingField('title'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setFieldDraft(drawerTask.title); setEditingField('title'); } }}
                    title="Click to edit title"
                    style={{ fontWeight: 700, fontSize: 16, cursor: 'text', borderRadius: 6, padding: '4px 6px', margin: '-4px -6px' }}
                  >
                    {drawerTask.title}
                  </div>
                )}
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2, paddingLeft: 6 }}>
                  {drawerTask.key}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                onClick={(e) => removeTask(drawerTask, e)}
                style={{
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--error-border)',
                  borderRadius: 8,
                  background: 'var(--bg-base)',
                  color: 'var(--error-text)',
                  cursor: 'pointer',
                }}
                aria-label="Delete task"
                title="Delete task"
              >
                <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
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
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflowX: 'auto' }}>
              {([['details', 'Details'], ['agent', 'Agent / Capabilities'], ['prd', 'PRD']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDrawerTab(id)}
                  style={{
                    padding: '10px 16px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                    borderBottom: `2px solid ${drawerTab === id ? 'var(--coral-bright, #f4726e)' : 'transparent'}`,
                    color: drawerTab === id ? 'var(--coral-bright, #f4726e)' : 'var(--text-muted)',
                    fontWeight: drawerTab === id ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {drawerTab === 'agent' ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <AgentTab task={drawerTask} projectId={drawerTask.projectId} agentHosts={agentHostsList} onTaskChanged={load} />
              </div>
            ) : drawerTab === 'prd' ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <TaskPrdTab taskId={drawerTask.id} projectId={drawerTask.projectId} />
              </div>
            ) : (
            <>
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
                {editingField === 'status' ? (
                  <Select
                    autoFocus
                    value={drawerTask.status}
                    onChange={(e) => { patchStatus(drawerTask.id, e.target.value); setEditingField(null); }}
                    onBlur={() => setEditingField(null)}
                    style={{
                      fontSize: 12,
                      padding: '3px 6px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      background: 'var(--bg-deep)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {statusChoices.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                ) : (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditingField('status')}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditingField('status'); }}
                    title="Click to change status"
                    className={taskStatusBadgeClass(drawerTask.status)}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    {columnLabel(drawerTask.status)}
                  </span>
                )}
                {editingField === 'priority' ? (
                  <Select
                    autoFocus
                    value={drawerTask.priority}
                    disabled={fieldSaving}
                    onChange={(e) => saveTaskField({ priority: e.target.value as TaskPriority })}
                    onBlur={() => setEditingField(null)}
                    style={{
                      fontSize: 12,
                      padding: '3px 6px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      background: 'var(--bg-deep)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </Select>
                ) : (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditingField('priority')}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditingField('priority'); }}
                    title="Click to change priority"
                    className={PRIORITY_CLASS[drawerTask.priority]}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    {drawerTask.priority}
                  </span>
                )}
              </div>
              {(drawerTask.gitBranch || drawerTask.githubPrUrl) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Branch &amp; PR</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {drawerTask.gitBranch && (
                      <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                        {drawerTask.gitBranch}
                      </span>
                    )}
                    {drawerTask.githubPrUrl && (
                      <a
                        href={drawerTask.githubPrUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View the code changes on GitHub"
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--coral-bright, #f4726e)',
                          textDecoration: 'none',
                          padding: '2px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--bg-deep)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        PR{drawerTask.githubPrNumber ? ` #${drawerTask.githubPrNumber}` : ''} →
                      </a>
                    )}
                  </div>
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Description</div>
                {editingField === 'description' ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <textarea
                      autoFocus
                      value={fieldDraft}
                      onChange={(e) => setFieldDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditingField(null); }}
                      rows={6}
                      placeholder="Markdown supported…"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        background: 'var(--bg-deep)',
                        color: 'var(--text-primary)',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" style={buttonTertiary} onClick={() => setEditingField(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={fieldSaving}
                        style={{ ...buttonPrimary, opacity: fieldSaving ? 0.7 : 1 }}
                        onClick={() => saveTaskField({ description: fieldDraft.trim() || null })}
                      >
                        {fieldSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { setFieldDraft(drawerTask.description ?? ''); setEditingField('description'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setFieldDraft(drawerTask.description ?? ''); setEditingField('description'); } }}
                    title="Click to edit description (Markdown)"
                    style={{
                      fontSize: 13,
                      color: drawerTask.description ? 'var(--text-secondary)' : 'var(--text-muted)',
                      lineHeight: 1.6,
                      cursor: 'text',
                      borderRadius: 8,
                      padding: 8,
                      margin: -8,
                      minHeight: 24,
                    }}
                  >
                    {drawerTask.description
                      ? <ChatMessageContent content={drawerTask.description} />
                      : 'Add a description…'}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>Details</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Project</span>
                    {editingField === 'project' ? (
                      <MoveToBoardControl
                        projects={projects}
                        currentProjectId={drawerTask.projectId}
                        onMove={(projectId) => { moveTask(drawerTask.id, projectId); setEditingField(null); }}
                        label={`${projectNameById(drawerTask.projectId)} →`}
                        style={{ fontSize: 13, padding: '3px 6px' }}
                      />
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingField('project')}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingField('project'); }}
                        title="Click to move this task to another board"
                        style={{ color: 'var(--text-primary)', cursor: 'pointer', borderBottom: '1px dashed var(--border-subtle)' }}
                      >
                        {projectNameById(drawerTask.projectId)}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Assignee / Owner</span>
                    {editingField === 'assignee' ? (
                      <AssigneeSelect
                        autoFocus
                        hosts={agentHostsList}
                        cloudAgents={cloudAgentsList}
                        members={membersList}
                        hostId={drawerTask.assignedAgentHostId}
                        agentRef={drawerTask.assignedAgentRef}
                        userId={drawerTask.assignedUserId}
                        disabled={fieldSaving}
                        onChange={(patch) => saveTaskField(patch)}
                        onBlur={() => setEditingField(null)}
                        style={{
                          fontSize: 13,
                          padding: '3px 6px',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 6,
                          background: 'var(--bg-deep)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingField('assignee')}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingField('assignee'); }}
                        title="Click to change assignee"
                        style={{ color: 'var(--text-primary)', cursor: 'pointer', borderBottom: '1px dashed var(--border-subtle)' }}
                      >
                        {taskAssigneeName(drawerTask)}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Due date</span>
                    {editingField === 'dueDate' ? (
                      <input
                        type="date"
                        autoFocus
                        value={drawerTask.dueDate?.split('T')[0] ?? ''}
                        disabled={fieldSaving}
                        onChange={(e) => saveTaskField({ dueDate: e.target.value || null })}
                        onBlur={() => setEditingField(null)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingField(null); }}
                        style={{
                          fontSize: 13,
                          padding: '3px 6px',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 6,
                          background: 'var(--bg-deep)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingField('dueDate')}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingField('dueDate'); }}
                        title="Click to set a due date"
                        style={{
                          color: drawerTask.dueDate ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          borderBottom: '1px dashed var(--border-subtle)',
                        }}
                      >
                        {formatDate(drawerTask.dueDate) || 'None'}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Created</span>
                    <span style={{ color: 'var(--text-primary)' }}>{formatDate(drawerTask.createdAt)}</span>
                  </div>
                </div>
              </div>
            </div>
            {/* One-click Run: submits with the task's assignee-derived runtime (no
                picker) and jumps to the Agent tab to watch. The full runtime/model
                picker + live output live there — this shares the same submit path
                (useTaskRunner), so there is no duplicated run control. */}
            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid var(--border-subtle)',
                padding: '12px 20px',
                background: 'var(--bg-base)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Runs as <strong style={{ color: 'var(--text-secondary)' }}>{taskAssigneeName(drawerTask)}</strong>. Change the runtime in the Agent tab.
              </span>
              <RunTaskButton
                task={drawerTask}
                label="Run this task"
                onRan={() => { patchStatus(drawerTask.id, 'in_progress', { skipAutoSubmit: true }); setDrawerTab('agent'); }}
                onAwaitingApproval={(g) => setApprovalGate({ approvalId: g.approvalId, taskId: g.taskId, reason: g.reason })}
              />
            </div>
            </>
            )}
          </div>
        </>
      )}

      {effectiveProjectId != null && (
        <BoardConfigPanel
          open={boardConfigOpen}
          onClose={() => setBoardConfigOpen(false)}
          projectId={effectiveProjectId}
          projectName={effectiveProjectName}
        />
      )}

      {effectiveProjectId != null && (
        <SlideOutPanel
          open={prdOpen}
          onClose={() => setPrdOpen(false)}
          title={`PRD${effectiveProjectName ? ` · ${effectiveProjectName}` : ''}`}
          width="min(720px, 96vw)"
        >
          <TaskPrdTab projectId={effectiveProjectId} />
        </SlideOutPanel>
      )}

      {effectiveProjectId != null && ceremony && (
        // Full-screen ceremony overlay over the board. On close we reload tasks so
        // any drag-assign / group / schedule done at the table shows on the board.
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, zIndex: 10000, padding: 24 }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              maxWidth: 1400,
              margin: '0 auto',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 16,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <CeremonyStage
              projectId={effectiveProjectId}
              mode={ceremony}
              onModeChange={setCeremony}
              onClose={() => { setCeremony(null); load(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
