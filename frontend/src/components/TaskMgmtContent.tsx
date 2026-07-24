'use client';

import { Select } from '@/components/Select';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';
import {
  tasksApi,
  kanbanApi,
  agentHosts,
  workflowDefinitions,
  approvalsApi,
  type Task,
  type TaskPriority,
  type AgentHost,
  type Approval,
  type Execution,
  type SwimlaneAgent,
  type BoardDispatch,
} from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { getProjectWorkforce } from '@/lib/teams';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import {
  assigneeSelectValue,
  parseAssigneeSelectValue,
  assigneeName,
  type AssigneePatch,
  type CloudAgentTarget,
  type TeamMember,
} from '@/lib/taskAssignee';
import { BoardConfigPanel } from './board/BoardConfigPanel';
import { AssigneeProfilesProvider } from './workforce/AssigneeProfilesContext';
import AssigneeHovercard, { AssigneePersonalityInline } from './workforce/AssigneeHovercard';
import { MemberProfileEditor } from './workforce/MemberProfileEditor';
import type { MemberKind } from '@/lib/builderforceApi';
import { AgentChip, ACTIVE_EXECUTION_STATUSES } from './board/AgentChip';
import { SwimlaneTriageButton } from './board/SwimlaneTriageButton';
import { trackActivity } from '@/lib/activity/tracker';
import { TeamMemberAvatarFilter } from './board/TeamMemberAvatarFilter';
import { useBoardConfig } from './board/useBoardConfig';
import { useBoardLiveRuns } from './board/useBoardLiveRuns';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';
import { SlideOutPanel } from './SlideOutPanel';
import { ReleasePicker } from './ReleasePicker';
import { DelayReasonTag } from './DelayReasonTag';
import { MoveToBoardControl } from './MoveToBoardControl';
import { AgentTab } from './agent/AgentTab';
import { TaskChangesPanel } from './agent/TaskChangesPanel';
import { TaskPrdTab } from './task/TaskPrdTab';
import { AccountabilityTab } from './task/AccountabilityTab';
import { RunTaskButton } from './task/RunTaskButton';
import { ApprovalResolveControl } from './humanRequests/ApprovalResolveControl';
import { ChatMessageContent } from './ChatMessageContent';
import { PublishToMarketplaceModal } from './PublishToMarketplaceModal';
import { getTicketPosting, unpublishTicket, type TicketPosting } from '@/lib/freelancerApi';
import { ViewToggle } from './ViewToggle';
import { CeremonyStage, type CeremonyMode } from './ceremony/CeremonyStage';
import { ScheduleCalendar } from './ScheduleCalendar';
import { ScheduleGantt } from './ScheduleGantt';
import {
  TASK_STATUSES as BOARD_STATUSES,
  taskStatusLabel,
  taskStatusBadgeClass,
} from '@/lib/taskStatus';
import { taskTypeBadgeClass, taskTypeLabelKey } from '@/lib/taskType';

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
  const t = useTranslations('taskMgmt');
  return (
    <Select
      autoFocus={autoFocus}
      disabled={disabled}
      onBlur={onBlur}
      value={assigneeSelectValue(hostId, agentRef, userId)}
      onChange={(e) => onChange(parseAssigneeSelectValue(e.target.value))}
      style={style}
    >
      <option value="">{t('unassigned')}</option>
      {members.length > 0 && (
        <optgroup label={t('teamMembers')}>
          {members.map((m) => (
            <option key={`u:${m.id}`} value={`u:${m.id}`}>{m.name}</option>
          ))}
        </optgroup>
      )}
      {hosts.length > 0 && (
        <optgroup label={t('agentHosts')}>
          {hosts.map((h) => (
            <option key={`h:${h.id}`} value={`h:${h.id}`}>{h.name}</option>
          ))}
        </optgroup>
      )}
      {cloudAgents.length > 0 && (
        <optgroup label={t('cloudAgents')}>
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
  const tApproval = useTranslations('boardConfig');
  const confirm = useConfirm();
  const tBoard = useTranslations('board');
  const tCommon = useTranslations('common');
  const tTask = useTranslations('taskMgmt');
  const tGigs = useTranslations('gigs');
  // Global project scope (present in the app shell, absent in embed/standalone).
  // When present it is the single project picker — the board's own project filter
  // is hidden and the TopBar tenant→project selector drives scope instead.
  const globalScope = useOptionalProjectScope();
  const [tasks, setTasks] = useState<Task[]>([]);
  // Ticket audit: ids of tickets flagged by the role/diagnostic audit (a required
  // role or check was skipped). Fetched once per project (server-side cached) and
  // rendered as a flag chip on the card — no per-card round-trip.
  const [flaggedIds, setFlaggedIds] = useState<Set<number>>(new Set());
  // Participation progress per ticket (X of Y required roles complete) — the
  // Coordinated Role Participation %-complete chip. One cached project fetch.
  const [participantProgress, setParticipantProgress] = useState<Map<number, { completed: number; required: number; percent: number }>>(new Map());
  const [projects, setProjects] = useState<Project[]>(projectsProp ?? globalScope?.projects ?? []);
  const [agentHostsList, setAgentHostsList] = useState<AgentHost[]>([]);
  const [cloudAgentsList, setCloudAgentsList] = useState<CloudAgentTarget[]>([]);
  const [membersList, setMembersList] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalGate, setApprovalGate] = useState<{ approvalId: string; taskId: number; reason: string } | null>(null);
  // Full approval row behind the gate, so a manager can approve inline (which
  // auto-starts the run) instead of leaving the board for the approvals queue.
  const [gateApproval, setGateApproval] = useState<Approval | null>(null);
  const [view, setView] = useState<TaskView>('board');
  // Standup mode: pivot the board so rows = teammates/agents and columns = stages,
  // surfacing each person's in-flight work at a glance. Board-view only, session-only.
  const [groupByAssignee, setGroupByAssignee] = useState(false);
  // Assignee swimlanes can contain hundreds of cards. Keep every row collapsed
  // until the viewer explicitly opens it; this state is intentionally session-only.
  const [expandedAssigneeRows, setExpandedAssigneeRows] = useState<Set<string>>(new Set());
  const [profileAssignee, setProfileAssignee] = useState<{
    kind: MemberKind; refId: string; name: string; tasks: Task[];
  } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterProject, setFilterProject] = useState<string>(projectId != null ? String(projectId) : '');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [search, setSearch] = useState('');
  // Team member avatar filter: an array of assigneeKeys (e.g. "u:123", "h:456", "c:abc").
  // Empty array means "All" (no filter).
  const [filterAssignees, setFilterAssignees] = useState<string[]>([]);
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
  // Which tab the board-config panel opens on: the cog opens 'lanes'; the
  // approval banner's shortcut opens 'settings' (where the override toggle lives).
  const [boardConfigTab, setBoardConfigTab] = useState<'lanes' | 'settings'>('lanes');
  // Live ceremony overlay (standup/planning round-table) for the selected board.
  const [ceremony, setCeremony] = useState<CeremonyMode | null>(null);
  const [prdOpen, setPrdOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'details' | 'agent' | 'changes' | 'prd' | 'accountability'>('details');
  // Inline per-field editing in the task drawer. Only one field is editable at a
  // time; `fieldDraft` holds the in-progress value (string for text/date inputs).
  const [editingField, setEditingField] = useState<
    null | 'title' | 'description' | 'dueDate' | 'assignee' | 'priority' | 'status' | 'project' | 'businessValue'
  >(null);
  const [fieldDraft, setFieldDraft] = useState('');
  const [fieldSaving, setFieldSaving] = useState(false);
  // Marketplace posting state for the open drawer ticket: `undefined` = not yet
  // loaded, `null` = not published, else the live posting. Drives the "Publish to
  // Marketplace" action + the "Published" badge / Unpublish control.
  const [posting, setPosting] = useState<TicketPosting | null | undefined>(undefined);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);

  // Open a task drawer on a specific tab (defaults to Details). Used so clicking
  // a running-agent chip jumps straight to the Agent tab.
  const openTask = useCallback((t: Task, tab: 'details' | 'agent' | 'changes' | 'prd' = 'details') => {
    setDrawerTab(tab);
    setDrawerTask(t);
  }, []);

  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedTaskRef = useRef<string | null>(null);

  // Close the drawer AND strip a lingering `?task=` deep-link param, so the board
  // URL stays clean and the drawer can't re-open on the next render. Every
  // user-facing close affordance (overlay, close button) goes through this.
  // Programmatic closes (delete/move) call setDrawerTask(null) directly — the row
  // is gone, so there's no deep-link left to honour.
  const closeDrawer = useCallback(() => {
    setDrawerTask(null);
    if (searchParams?.get('task')) {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.delete('task');
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    }
  }, [searchParams, router]);

  // Deep-link to a ticket's DETAIL drawer via a `?task=<id>` query param — the target
  // the Brain ChatTicketsPanel "Open" routes to for a linked task/epic/gap (so the
  // chip opens the ticket's details, not just the board). Resolve from the loaded
  // board list when the ticket is present (instant), otherwise FETCH it directly:
  // the global ProjectScope resolving `?project=` and the scoped task list loading
  // race, so at the moment this runs the target may not yet be in `tasks` (or may sit
  // in a different project scope). A list-only lookup would silently no-op there.
  // We deliberately KEEP the `?task=` param in place while the drawer is open
  // (closeDrawer strips it) so a transient remount during auth/scope hydration
  // RE-opens the drawer instead of dropping to the bare board — the "redirects back
  // with no panel" symptom. The ref guards against re-opening the same id per mount.
  useEffect(() => {
    const raw = searchParams?.get('task');
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return;
    if (drawerTask?.id === id) return;             // already open on this ticket
    if (deepLinkedTaskRef.current === raw) return; // handled this id already this mount
    const inList = tasks.find((t) => t.id === id);
    if (inList) {
      deepLinkedTaskRef.current = raw;
      openTask(inList);
      return;
    }
    // Not in the (scoped) list — fetch it directly. GET /api/tasks/:id is tenant-
    // scoped server-side (404s for a foreign / other-tenant id), so an inaccessible
    // id just leaves the board unchanged. Guarded so a late resolve can't open a
    // drawer the list-path already opened.
    let alive = true;
    tasksApi.get(id)
      .then((full) => {
        if (alive && full && deepLinkedTaskRef.current !== raw) {
          deepLinkedTaskRef.current = raw;
          openTask(full);
        }
      })
      .catch(() => { /* not found / not accessible — leave the board as-is */ });
    return () => { alive = false; };
  }, [searchParams, tasks, openTask, drawerTask?.id]);

  // Load whether the open ticket is already published to the marketplace, so the
  // drawer can show a "Published" badge + Unpublish, or offer to publish. Best-effort:
  // a tenantless/unauthorized viewer just sees the not-published state.
  useEffect(() => {
    const id = drawerTask?.id;
    if (id == null || drawerTask?.restricted) { setPosting(undefined); return; }
    let alive = true;
    setPosting(undefined);
    getTicketPosting(id).then((p) => { if (alive) setPosting(p); }).catch(() => { if (alive) setPosting(null); });
    return () => { alive = false; };
  }, [drawerTask?.id, drawerTask?.restricted]);

  const unpublishDrawerTicket = async () => {
    if (!drawerTask) return;
    setPublishBusy(true);
    try { await unpublishTicket(drawerTask.id); setPosting(null); }
    catch { /* surfaced by leaving the badge; best-effort */ }
    finally { setPublishBusy(false); }
  };

  // A SECURITY ticket the viewer isn't cleared for arrives masked (`restricted`),
  // its title blanked server-side — everywhere a task title renders we show the
  // localized "clearance needed" placeholder instead. One helper, used at every site.
  const titleOf = useCallback(
    (task: Task): string => (task.restricted ? tCommon('clearanceNeeded') : task.title),
    [tCommon],
  );

  // Fetch the gated approval so the banner can resolve it inline. Cleared with the gate.
  useEffect(() => {
    const approvalId = approvalGate?.approvalId;
    if (!approvalId) { setGateApproval(null); return; }
    let alive = true;
    approvalsApi.get(approvalId)
      .then((a) => { if (alive) setGateApproval(a); })
      .catch(() => { if (alive) setGateApproval(null); });
    return () => { alive = false; };
  }, [approvalGate?.approvalId]);

  // `background:true` refetches WITHOUT flipping the full-screen "Loading…" state,
  // so a live refresh (a realtime echo of the user's own drag, the brain bus, an
  // approval/ceremony/agent update) reconciles in place instead of blanking the
  // board. Only the initial mount / project switch shows the spinner.
  const load = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    setError(null);
    try {
      const [tasksData, agentHostsData, runTargets, membersData, projectWf, assignable] = await Promise.all([
        tasksApi.list(projectId),
        agentHosts.list().catch(() => []),
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
        // The unified assignable workforce — its `hires` are active freelance-marketplace
        // engagements (cross-tenant humans) that `tasksApi.assignees()` (tenant members)
        // doesn't return, so a hired freelancer can be assigned a ticket on the board.
        kanbanApi.assignable().catch(() => ({ agents: [], humans: [], hires: [] as Array<{ ref: string; name: string }> })),
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
      // Team members (team-scoped when the board is), then union in freelance hires —
      // explicit project engagements that should be assignable regardless of team
      // scoping — deduped by id. A hire's ref is a users.id, so `u:<id>` decodes right.
      const scopedMembers = teamSet ? membersData.filter((m) => teamSet.has(`human:${m.id}`)) : membersData;
      const hireMembers = assignable.hires.map((h) => ({ id: h.ref, name: h.name }));
      setMembersList([...scopedMembers, ...hireMembers.filter((h) => !scopedMembers.some((m) => m.id === h.id))]);
      // Always resolve the full project list (unless the parent supplied one or
      // the global scope already holds it): it backs both the project filter and
      // the "Move to board" destinations, needed even in the scoped view. When a
      // global ProjectScope is present we reuse its list (kept in sync by an
      // effect below) instead of re-fetching it here.
      if (projectsProp) {
        setProjects(projectsProp);
      } else if (!globalScope) {
        const projs = await fetchProjects().catch(() => []);
        setProjects(projs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tTask('errLoad'));
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [projectId, projectsProp, globalScope]);

  // Keep the project list mirrored from the global scope (single source) when no
  // explicit list was supplied — avoids a duplicate fetchProjects round-trip.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!projectsProp && globalScope) setProjects(globalScope.projects);
  }, [projectsProp, globalScope]);

  useEffect(() => {
    load();
  }, [load]);

  // When the Brain mutates tasks/projects/executions (e.g. the user approves an
  // "update task" action in the docked drawer), the write lands via the API but
  // this board holds its own state — so listen on the brain-data bus and refetch
  // to reflect the change live instead of going stale until a manual reload.
  useBrainDataRefresh(['tasks', 'executions', 'projects', 'boards'], () => { void load({ background: true }); });

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

  // Keep an open drawer live: when a realtime push refreshes the task list (another
  // teammate or an agent edited the same ticket), re-sync the drawer from the fresh
  // row — but never while the user is mid-edit, so a live update can't clobber a
  // field they're typing into. The Agent tab streams its own run updates separately.
  useEffect(() => {
    if (!drawerTask || editingField) return;
    const fresh = tasks.find((t) => t.id === drawerTask.id);
    if (fresh && fresh !== drawerTask) setDrawerTask(fresh);
  }, [tasks, drawerTask, editingField]);

  const projectNameById = (id?: number | null) =>
    id ? projects.find((p) => p.id === id)?.name ?? String(id) : '—';
  // Resolve a task's assignee (human teammate, self-hosted host, OR cloud agent) to its display name.
  const taskAssigneeName = (t: { assignedAgentHostId?: number | null; assignedAgentRef?: string | null; assignedUserId?: string | null }) =>
    assigneeName(t.assignedAgentHostId, t.assignedAgentRef, t.assignedUserId, agentHostsList, cloudAgentsList, membersList);
  // The same encoded value the picker uses — the key the personality hovercard reads.
  const taskAssigneeSelectValue = (t: { assignedAgentHostId?: number | null; assignedAgentRef?: string | null; assignedUserId?: string | null }) =>
    assigneeSelectValue(t.assignedAgentHostId, t.assignedAgentRef, t.assignedUserId);

  // The board being configured: the scoped project, or the single project chosen
  // in the filter. Null when viewing "All projects" — the cog stays visible but disabled.
  const effectiveProjectId = projectId ?? (filterProject ? Number(filterProject) : undefined);
  const effectiveProjectName =
    projectId != null ? projectName : projectNameById(effectiveProjectId);

  // Load the flagged-ticket set for the current project's ticket audit.
  useEffect(() => {
    if (effectiveProjectId == null) { setFlaggedIds(new Set()); return; }
    let alive = true;
    kanbanApi.flaggedForProject(effectiveProjectId)
      .then((rows) => { if (alive) setFlaggedIds(new Set(rows.map((r) => r.taskId))); })
      .catch(() => { if (alive) setFlaggedIds(new Set()); });
    kanbanApi.participantsSummary(effectiveProjectId)
      .then((rows) => { if (alive) setParticipantProgress(new Map(rows.map((r) => [r.taskId, { completed: r.completed, required: r.required, percent: r.percent }]))); })
      .catch(() => { if (alive) setParticipantProgress(new Map()); });
    return () => { alive = false; };
  }, [effectiveProjectId, tasks]);

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
    // Team member avatar filter: if assignees are selected, only show tasks
    // whose assignee matches one of the selected keys (OR logic).
    if (filterAssignees.length > 0) {
      const taskAssigneeKey = assigneeSelectValue(t.assignedAgentHostId, t.assignedAgentRef, t.assignedUserId);
      if (!filterAssignees.includes(taskAssigneeKey)) return false;
    }
    return true;
  });

  // Live board run feed: recent executions + per-agent dispatches, self-refreshing
  // so cards and lane-header chips advance pending→running→done without a manual
  // reload, and a drag-triggered auto-run shows the moment it's queued. Active on
  // the chip-bearing views (board/table); idle on calendar/gantt. `refreshRuns` is
  // fired right after a status PATCH so the user's own drag updates instantly.
  const { executions, dispatches, refresh: refreshRuns } = useBoardLiveRuns(
    view === 'board' && !compact ? board?.id : undefined,
    view === 'board' || view === 'table',
  );

  // Real-time project room: the server pushes `{type:"changed"}` over a WebSocket
  // whenever ANYONE — another teammate or an agent run — mutates this project, so
  // every view (board, table, calendar, gantt) and the open drawer refetch live.
  // This is the primary liveness path; the run-feed poll above is a reconcile
  // backstop for a dropped socket (cross-isolate WS is lossy on Workers).
  const onRealtimeChange = useCallback(() => {
    // A realtime push is a LIVE reconcile (often the echo of the user's own drag) —
    // refetch in the background so the board updates in place instead of flashing
    // the full-screen "Loading…" placeholder.
    void load({ background: true });
    refreshRuns();
  }, [load, refreshRuns]);
  useRealtimeRoom(
    effectiveProjectId != null ? `/api/projects/${effectiveProjectId}/stream` : null,
    onRealtimeChange,
  );

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

  // Order tickets within a lane by the AI Manager's computed backlog rank (rank 1 =
  // highest value × urgency), nulls last, so every lane shows the most-important work
  // at the top — the same order the priority-aware autonomous dispatcher runs them in.
  // Stable: a null-rank vs null-rank pair keeps the incoming (filtered) order.
  const byManagerRank = (list: Task[]): Task[] =>
    list
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const ra = a.t.managerRank ?? Number.POSITIVE_INFINITY;
        const rb = b.t.managerRank ?? Number.POSITIVE_INFINITY;
        return ra !== rb ? ra - rb : a.i - b.i;
      })
      .map((x) => x.t);

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

  const openAssigneeProfile = useCallback((key: string, name: string) => {
    if (!key) return;
    const prefix = key.slice(0, 2);
    const refId = key.slice(2);
    const kind: MemberKind | null = prefix === 'u:' ? 'human' : prefix === 'c:' ? 'cloud_agent' : prefix === 'h:' ? 'host_agent' : null;
    if (kind && refId) {
      setProfileAssignee({
        kind,
        refId,
        name,
        // The profile is an assignee-level view, so include every task currently
        // loaded for this board even when board filters hide some of them.
        tasks: tasks.filter((task) => assigneeSelectValue(
          task.assignedAgentHostId,
          task.assignedAgentRef,
          task.assignedUserId,
        ) === key),
      });
    }
  }, [tasks]);

  const toggleAssigneeRow = useCallback((key: string) => {
    setExpandedAssigneeRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  // Stable identity for the agent that ran an execution — a cloud agent
  // (cloudAgentRef), a self-hosted host (agentHostId), or a legacy agentId — so
  // multiple runs by the same agent collapse into one chip on a card.
  const execAgentKey = (e: Execution): string =>
    e.cloudAgentRef ? `c:${e.cloudAgentRef}` :
    e.agentHostId != null ? `h:${e.agentHostId}` :
    e.agentId != null ? `a:${e.agentId}` : 'agent';

  // Resolve the human-facing name of whatever agent ran an execution. Cloud
  // agents (V1/V2) run via cloudAgentRef and MUST be resolved against the cloud
  // roster — otherwise a queued cloud agent like "Bob" renders as a generic "Agent".
  const execAgentLabel = (e: Execution): string =>
    (e.cloudAgentRef ? cloudAgentsList.find((a) => a.ref === e.cloudAgentRef)?.name ?? `Agent ${String(e.cloudAgentRef).slice(0, 6)}` : null) ??
    (e.agentHostId != null ? agentHostsList.find((c) => c.id === e.agentHostId)?.name ?? `AgentHost ${e.agentHostId}` : null) ??
    (e.agentId != null ? `Agent ${e.agentId}` : 'Agent');

  // Every distinct agent that has run (or is queued) on a task, newest-run first,
  // each carrying its latest execution status. Drives the card's agent-history
  // chips: a completed prior agent (e.g. Kevin) stays visible alongside the
  // freshly-queued one (e.g. Bob · pending) so the board shows who ran when.
  const agentRunsByTask = useMemo(() => {
    const m = new Map<number, Array<{ key: string; label: string; status: string; execId: number; ts: number }>>();
    for (const e of executions) {
      const list = m.get(e.taskId) ?? [];
      const key = execAgentKey(e);
      const ts = e.createdAt ? new Date(e.createdAt).getTime() : 0;
      const existing = list.find((x) => x.key === key);
      if (existing) {
        // Keep the most recent execution's status for this agent on the task.
        if (ts >= existing.ts) { existing.status = e.status; existing.execId = e.id; existing.ts = ts; }
      } else {
        list.push({ key, label: execAgentLabel(e), status: e.status, execId: e.id, ts });
      }
      m.set(e.taskId, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.ts - a.ts);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executions, cloudAgentsList, agentHostsList]);

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
          setError(tTask('errSelectProject'));
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
      setError(e instanceof Error ? e.message : tTask('errSave'));
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (t: Task | null, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!t?.id) return;
    if (!(await confirm(tCommon('deleteNamedConfirm', { name: t.title })))) return;
    try {
      await tasksApi.delete(t.id);
      setTasks((prev) => prev.filter((i) => i.id !== t.id));
      if (drawerTask?.id === t.id) setDrawerTask(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tTask('errDelete'));
    }
  };

  // Persist a single edited field from the drawer's inline editors. Patches the
  // open task, syncs the list + drawer, and closes the active editor on success.
  const saveTaskField = async (
    patch: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'assignedAgentHostId' | 'assignedAgentRef' | 'assignedUserId' | 'dueDate' | 'businessValue' | 'releaseId'>>
  ) => {
    if (!drawerTask) return;
    setFieldSaving(true);
    try {
      const updated = await tasksApi.update(drawerTask.id, patch);
      setTasks((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setDrawerTask(updated);
      setEditingField(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tTask('errSave'));
    } finally {
      setFieldSaving(false);
    }
  };

  // Commit the drawer's business-value editor: blank clears it (null), otherwise
  // clamp to 0–100. Setting it server-side pins the value's source to 'manual'.
  const commitBusinessValue = () => {
    const raw = fieldDraft.trim();
    if (raw === '') { void saveTaskField({ businessValue: null }); return; }
    const n = Number(raw);
    if (Number.isNaN(n)) { setEditingField(null); return; }
    void saveTaskField({ businessValue: Math.max(0, Math.min(100, Math.round(n))) });
  };

  const patchStatus = async (id: number, status: string) => {
    try {
      const updated = await tasksApi.update(id, { status });
      setTasks((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      if (drawerTask?.id === id) setDrawerTask(updated);
      // Audited "click sense": moving a ticket between swimlanes is a billable
      // engagement action (see activity tracker → timecard pipeline).
      trackActivity('ticket_move', { ref: `task:${id}`, metadata: { status } });
      // The board "autonomous trigger" (auto-run a ticket entering a lane with a
      // configured cloud agent) is now decided SERVER-SIDE on the task PATCH — see
      // maybeAutoRunOnLaneEntry / decideLaneAutoRun in the api. The frontend no
      // longer fires its own submitExecution here: doing so duplicated the logic
      // and skipped every non-board path (brain-created / API status changes). The
      // server is the single source of truth.
      //
      // The board "autonomous trigger" (auto-run a ticket entering a lane with a
      // configured cloud agent) is decided SERVER-SIDE on the task PATCH — see
      // maybeAutoRunOnLaneEntry / decideLaneAutoRun in the api. The freshly-queued
      // run arrives over the project realtime socket (broadcastProjectChanged), with
      // the run-feed poll as the dropped-socket backstop; no client-side trigger.
      refreshRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : tTask('errUpdate'));
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
      setError(e instanceof Error ? e.message : tTask('errMove'));
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
    const runs = agentRunsByTask.get(task.id) ?? [];
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
        <div style={{ fontWeight: 500, fontSize: 13, color: task.restricted ? 'var(--text-muted)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {task.restricted && <span aria-hidden style={{ flexShrink: 0 }}>🔒</span>}
          <span style={task.restricted ? { fontStyle: 'italic' } : undefined}>{titleOf(task)}</span>
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
          {taskTypeBadgeClass(task.taskType) && (
            <span
              className={taskTypeBadgeClass(task.taskType)!}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4 }}
            >
              {tCommon(taskTypeLabelKey(task.taskType))}
            </span>
          )}
          {task.reviewCount ? (
            <span
              title={
                task.lastReviewVerdict === 'complete'
                  ? tCommon('reviewComplete')
                  : task.lastReviewVerdict === 'gaps'
                    ? tCommon('reviewGaps')
                    : undefined
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--bg-elevated)',
                color:
                  task.lastReviewVerdict === 'gaps'
                    ? '#f59e0b'
                    : task.lastReviewVerdict === 'complete'
                      ? '#22c55e'
                      : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {task.lastReviewVerdict === 'complete'
                ? '✓'
                : task.lastReviewVerdict === 'gaps'
                  ? '⚠'
                  : '↻'}{' '}
              {tCommon('reviewedTimes', { count: task.reviewCount })}
            </span>
          ) : null}
          {flaggedIds.has(task.id) && (
            <span
              title={tBoard('audit.flaggedTitle')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10,
                padding: '2px 6px', borderRadius: 4, background: 'var(--danger-bg, #fee2e2)',
                color: 'var(--danger-text, #991b1b)', fontWeight: 700,
              }}
            >
              ⚑ {tBoard('audit.flagged')}
            </span>
          )}
          {(() => {
            const prog = participantProgress.get(task.id);
            if (!prog || prog.required === 0) return null;
            const complete = prog.percent >= 100;
            return (
              <span
                title={tBoard('audit.participantsTitle')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10,
                  padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                  background: complete ? 'var(--success-bg, #dcfce7)' : 'var(--bg-deep, #eef2ff)',
                  color: complete ? 'var(--success-text, #166534)' : 'var(--text-secondary, #475569)',
                }}
              >
                ✅ {prog.completed}/{prog.required}
              </span>
            );
          })()}
          {task.businessValue != null && (
            <span
              title={task.businessValueRationale ?? tBoard('businessValue.badgeTitle')}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-interactive, var(--bg-elevated))', color: 'var(--text-secondary)', fontWeight: 700 }}
            >
              {tBoard('businessValue.badge', { value: task.businessValue })}
            </span>
          )}
          {task.specCount ? (
            <span
              title={`${task.specCount} linked PRD${task.specCount > 1 ? 's' : ''}`}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              📄 PRD{task.specCount > 1 ? ` ×${task.specCount}` : ''}
            </span>
          ) : null}
          {runs.length > 0 ? (
            // One chip per agent that has touched this task, newest run first, so
            // history reads left-to-right: a freshly-queued agent (Bob · pending)
            // sits ahead of a prior one (Kevin, completed). The status meta makes
            // the live state explicit for any non-completed run.
            runs.map((r) => (
              <AgentChip
                key={r.key}
                label={r.label}
                status={r.status}
                meta={r.status !== 'completed' ? r.status : undefined}
                title={`${r.label} — execution #${r.execId} · ${r.status}. Click to open the Agent tab.`}
                onClick={(e) => {
                  e.stopPropagation();
                  openTask(task, 'agent');
                }}
              />
            ))
          ) : (task.assignedAgentHostId || task.assignedAgentRef || task.assignedUserId) ? (
            // No run yet — show who it's assigned to, flagged "pending" when an
            // agent owns it so a just-dropped card reads "Bob · pending" before its
            // execution row materializes.
            (task.assignedAgentHostId || task.assignedAgentRef) ? (
              <AssigneeHovercard selectValue={taskAssigneeSelectValue(task)}>
                <AgentChip label={taskAssigneeName(task)} status="pending" meta="pending" title={`${taskAssigneeName(task)} — queued`} />
              </AssigneeHovercard>
            ) : (
              <AssigneeHovercard selectValue={taskAssigneeSelectValue(task)}>
                <span>{taskAssigneeName(task)}</span>
              </AssigneeHovercard>
            )
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
    <AssigneeProfilesProvider>
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Resolve inline — approving auto-starts the run; otherwise the manager
                can still jump to the full approvals queue. */}
            {gateApproval && (
              <ApprovalResolveControl
                approval={gateApproval}
                compact
                onResolved={(updated) => {
                  setApprovalGate(null);
                  setGateApproval(null);
                  if (updated.status === 'approved') { void load({ background: true }); }
                }}
              />
            )}
            {/* Shortcut to the board's override setting — opens Board config →
                Board settings, where a manager can turn the gate off. Only shown
                when a single board is selected (the panel is board-scoped), and
                manager-gated (disabled, not hidden, for everyone else). */}
            {effectiveProjectId != null && (
              <RoleGate capability="board.manageApproval">
                <button
                  type="button"
                  onClick={() => { setBoardConfigTab('settings'); setBoardConfigOpen(true); }}
                  style={{
                    fontWeight: 700,
                    color: 'var(--coral-bright)',
                    textDecoration: 'none',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                  }}
                >
                  {tApproval('bannerManage')}
                </button>
              </RoleGate>
            )}
            <Link
              href="/workforce?tab=approvals"
              style={{
                fontWeight: 700,
                color: 'var(--coral-bright)',
                textDecoration: 'none',
              }}
            >
              {tTask('openApprovals')}
            </Link>
          </span>
        </div>
      )}

      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {tTask('taskCount', { count: filtered.length })}
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
                  { value: 'stage', label: tTask('byStage') },
                  { value: 'people', label: tTask('byAssignee') },
                ]}
              />
            )}
            <button type="button" onClick={openCreate} style={buttonPrimary}>
              {tTask('newTask')}
            </button>
            {effectiveProjectId != null && (
              // Launch the live round-table ceremony as a full-screen overlay over
              // this board. Standup reviews in-flight work; Planning drags backlog
              // onto seats / Epics / a sprint.
              <>
                <button type="button" onClick={() => setCeremony('standup')} style={buttonTertiary}>
                  {tTask('startStandup')}
                </button>
                <button type="button" onClick={() => setCeremony('planning')} style={buttonTertiary}>
                  {tTask('startPlanning')}
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
                    aria-label={tTask('viewPrdAria')}
                    title={canConfigure ? tTask('viewPrdTitle') : tTask('viewPrdDisabledTitle')}
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
                    onClick={() => { if (canConfigure) { setBoardConfigTab('lanes'); setBoardConfigOpen(true); } }}
                    disabled={!canConfigure}
                    style={iconBtn}
                    aria-label={tTask('configureBoardAria')}
                    title={canConfigure ? tTask('configureBoardTitle') : tTask('configureBoardDisabledTitle')}
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
            placeholder={tTask('searchPlaceholder')}
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
            <option value="">{tTask('allStatuses')}</option>
            {statusChoices.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          {!projectId && !globalScope && (
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
              <option value="">{tTask('allProjects')}</option>
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
            <option value="">{tTask('allPriorities')}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          {/* Avatar filter: adjacent to the priorities dropdown on the same row */}
          <TeamMemberAvatarFilter
            tasks={tasks}
            agentHosts={agentHostsList}
            cloudAgents={cloudAgentsList}
            members={membersList}
            selectedAssignees={filterAssignees}
            onSelectAssignees={setFilterAssignees}
          />
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{tCommon('loading')}</div>
      ) : view === 'board' && groupByAssignee ? (
        // Standup pivot: one row per teammate/agent, board columns as stage cells.
        // Tasks stay draggable across stages (same renderTaskCard + drop targets).
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {assigneeRows.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{tTask('noTasks')}</div>
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
              {assigneeRows.map((row) => {
                const rowStateKey = row.key || 'unassigned';
                const expanded = expandedAssigneeRows.has(rowStateKey);
                return (
                  <Fragment key={rowStateKey}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        padding: '8px 4px',
                        borderTop: '1px solid var(--border-subtle)',
                        gridColumn: expanded ? undefined : '1 / -1',
                        // An expanded assignee can own hundreds of cards. Keep the
                        // row identity visible while its tall grid row scrolls, then
                        // let the next assignee naturally replace it at the boundary.
                        position: expanded ? 'sticky' : undefined,
                        top: expanded ? 0 : undefined,
                        alignSelf: expanded ? 'start' : undefined,
                        zIndex: expanded ? 2 : undefined,
                        background: expanded ? 'var(--bg-surface)' : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleAssigneeRow(rowStateKey)}
                        aria-expanded={expanded}
                        aria-label={tTask(expanded ? 'collapseAssigneeRow' : 'expandAssigneeRow', { name: row.name })}
                        style={{ border: 0, padding: 2, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}
                      >
                        <span aria-hidden>{expanded ? '▾' : '▸'}</span>
                      </button>
                      {row.key ? (
                        <AssigneeHovercard selectValue={row.key}>
                          <a
                            href={`#assignee-${encodeURIComponent(row.key)}`}
                            onClick={(event) => { event.preventDefault(); openAssigneeProfile(row.key, row.name); }}
                            style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                          >
                            {row.name}
                          </a>
                        </AssigneeHovercard>
                      ) : row.name}
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>
                        {row.tasks.length}
                      </span>
                    </div>
                    {expanded && boardColumns.map((column) => {
                      const cellTasks = byManagerRank(row.tasks.filter((t) => t.status === column.status));
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
                );
              })}
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
            const tasksForStatus = byManagerRank(filtered.filter((t) => t.status === status));
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <SwimlaneTriageButton
                        tasks={tasksForStatus}
                        isActive={(taskId) => (agentRunsByTask.get(taskId) ?? []).some((r) => ACTIVE_EXECUTION_STATUSES.has(r.status))}
                        onDispatched={refreshRuns}
                      />
                      <span>{tasksForStatus.length}</span>
                    </span>
                  </div>
                  {column.agents.length > 0 && (
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}
                      title={tTask('swimlaneAgentsTitle')}
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
        <ScheduleCalendar items={filtered} getLabel={titleOf} onSelect={(t) => openTask(t)} />
      ) : view === 'gantt' ? (
        <ScheduleGantt items={filtered} getLabel={titleOf} onSelect={(t) => openTask(t)} noun="task" />
      ) : (
        <div style={cardStyle}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
              {tTask('noTasks')}
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
                    <option value="">{tTask('bulkChangeStatus')}</option>
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
                        {tTask('colTask')}
                      </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {tTask('status')}
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {tTask('priority')}
                    </th>
                    {!projectId && (
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {tTask('project')}
                      </th>
                    )}
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {tTask('colAssignee')}
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {tTask('colDue')}
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
                        <div style={{ fontWeight: 500, color: task.restricted ? 'var(--text-muted)' : 'var(--text-primary)', fontStyle: task.restricted ? 'italic' : undefined }}>
                          {task.restricted && <span aria-hidden style={{ marginRight: 6 }}>🔒</span>}{titleOf(task)}
                        </div>
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
                        {task.businessValue != null && (
                          <span
                            title={task.businessValueRationale ?? tBoard('businessValue.badgeTitle')}
                            style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-interactive, var(--bg-elevated))', color: 'var(--text-secondary)', fontWeight: 700 }}
                          >
                            {tBoard('businessValue.badge', { value: task.businessValue })}
                          </span>
                        )}
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
                            meta={exec.status !== 'completed' ? exec.status : undefined}
                            title={`${execAgentLabel(exec)} — execution #${exec.id} · ${exec.status}. Click to open the Agent tab.`}
                            onClick={() => openTask(task, 'agent')}
                          />
                        ) : (
                          <AssigneeHovercard selectValue={taskAssigneeSelectValue(task)}>
                            {taskAssigneeName(task)}
                          </AssigneeHovercard>
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
                            {tCommon('view')}
                          </button>
                          <button
                            type="button"
                            style={{ ...buttonTertiary, padding: '4px 8px', fontSize: 12 }}
                            onClick={(e) => openEdit(task, e)}
                          >
                            {tCommon('edit')}
                          </button>
                          <MoveToBoardControl
                            projects={projects}
                            currentProjectId={task.projectId}
                            onMove={(projectId) => moveTask(task.id, projectId)}
                            label={tTask('move')}
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
                            {tCommon('delete')}
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

      <SlideOutPanel
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editTarget ? tTask('editTask') : tTask('newTask')}
        width="min(560px, 96vw)"
      >
        <div style={{ padding: 20 }}>
            <form onSubmit={handleSave} style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {tTask('title')}
                </label>
                <input
                  required
                  placeholder={tTask('titlePlaceholder')}
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
                  {tTask('descriptionOptional')}
                </label>
                <textarea
                  placeholder={tTask('descriptionPlaceholder')}
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
                    {tTask('status')}
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
                    {tTask('priority')}
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
                    {tTask('project')}
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
                    <option value="">{tTask('selectProject')}</option>
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
                    {tTask('assignToMember')}
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
                    {tTask('dueDateOptional')}
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
                  {tTask('githubPrUrl')}
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
                  {tCommon('cancel')}
                </button>
                <button type="submit" disabled={saving} style={{ ...buttonPrimary, opacity: saving ? 0.7 : 1 }}>
                  {saving ? tCommon('saving') : editTarget ? tTask('saveChanges') : tTask('createTask')}
                </button>
              </div>
            </form>
        </div>
      </SlideOutPanel>

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
            onClick={closeDrawer}
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
                ) : drawerTask.restricted ? (
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', margin: '-4px -6px' }}>
                    <span aria-hidden>🔒</span>{tCommon('clearanceNeeded')}
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { setFieldDraft(drawerTask.title); setEditingField('title'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setFieldDraft(drawerTask.title); setEditingField('title'); } }}
                    title={tTask('editTitleTitle')}
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
              {!drawerTask.restricted && (
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
                aria-label={tTask('deleteTask')}
                title={tTask('deleteTask')}
              >
                <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
              )}
              <button
                type="button"
                onClick={closeDrawer}
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
                aria-label={tCommon('close')}
              >
                <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              </div>
            </div>

            {/* Tabs — suppressed for a restricted (masked) ticket; the clearance
                notice replaces all tab content. */}
            {!drawerTask.restricted && (
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflowX: 'auto' }}>
              {([['details', tTask('details')], ['agent', tTask('tabAgent')], ['changes', tTask('tabChanges')], ['prd', tTask('tabPrd')], ['accountability', tTask('tabAccountability')]] as const).map(([id, label]) => (
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
            )}

            {drawerTask.restricted ? (
              // Access-restricted SECURITY ticket the viewer isn't cleared for: its
              // content is masked, and the detail/agent/changes tabs are suppressed
              // (they fetch by id and would otherwise leak). Show a clearance notice.
              <div style={{ flex: 1, overflow: 'auto', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
                <div aria-hidden style={{ fontSize: 40 }}>🔒</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{tCommon('clearanceNeeded')}</div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 360, margin: 0 }}>{tCommon('clearanceNeededBody')}</p>
              </div>
            ) : drawerTab === 'agent' ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <AgentTab task={drawerTask} projectId={drawerTask.projectId} agentHosts={agentHostsList} onTaskChanged={() => load({ background: true })} />
              </div>
            ) : drawerTab === 'changes' ? (
              <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                <TaskChangesPanel taskId={drawerTask.id} maxHeight={9999} />
              </div>
            ) : drawerTab === 'prd' ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <TaskPrdTab taskId={drawerTask.id} projectId={drawerTask.projectId} />
              </div>
            ) : drawerTab === 'accountability' ? (
              <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                <AccountabilityTab taskId={drawerTask.id} />
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
                    title={tTask('changeStatusTitle')}
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
                    title={tTask('changePriorityTitle')}
                    className={PRIORITY_CLASS[drawerTask.priority]}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    {drawerTask.priority}
                  </span>
                )}
              </div>
              {(drawerTask.gitBranch || drawerTask.githubPrUrl) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{tTask('branchAndPr')}</div>
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
                        title={tTask('viewCodeChangesTitle')}
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
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{tTask('description')}</div>
                {editingField === 'description' ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <textarea
                      autoFocus
                      value={fieldDraft}
                      onChange={(e) => setFieldDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditingField(null); }}
                      rows={6}
                      placeholder={tTask('markdownPlaceholder')}
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
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={fieldSaving}
                        style={{ ...buttonPrimary, opacity: fieldSaving ? 0.7 : 1 }}
                        onClick={() => saveTaskField({ description: fieldDraft.trim() || null })}
                      >
                        {fieldSaving ? tCommon('saving') : tCommon('save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { setFieldDraft(drawerTask.description ?? ''); setEditingField('description'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setFieldDraft(drawerTask.description ?? ''); setEditingField('description'); } }}
                    title={tTask('editDescriptionTitle')}
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
                      : tTask('addDescription')}
                  </div>
                )}
              </div>
              {/* Publish-to-Marketplace: open this work item for hire, or manage the
                  live posting. Hidden until we know the posting state (undefined). */}
              {posting !== undefined && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{tGigs('publish.section')}</div>
                  {posting ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className="badge-green">{tGigs('publish.published')}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tGigs('publish.publishedHint')}</span>
                      <button
                        type="button"
                        disabled={publishBusy}
                        onClick={unpublishDrawerTicket}
                        style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        {publishBusy ? tGigs('publish.unpublishing') : tGigs('publish.unpublish')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPublishOpen(true)}
                      style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--coral-bright)', background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                    >
                      {tGigs('publish.action')}
                    </button>
                  )}
                </div>
              )}
              {publishOpen && (
                <PublishToMarketplaceModal
                  ticketId={drawerTask.id}
                  defaultRequirements={drawerTask.description ?? ''}
                  onClose={() => setPublishOpen(false)}
                  onPublished={(p) => { setPosting(p); setPublishOpen(false); }}
                />
              )}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>{tTask('details')}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tTask('project')}</span>
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
                        title={tTask('moveBoardTitle')}
                        style={{ color: 'var(--text-primary)', cursor: 'pointer', borderBottom: '1px dashed var(--border-subtle)' }}
                      >
                        {projectNameById(drawerTask.projectId)}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tTask('assigneeOwner')}</span>
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
                        title={tTask('changeAssigneeTitle')}
                        style={{ color: 'var(--text-primary)', cursor: 'pointer', borderBottom: '1px dashed var(--border-subtle)' }}
                      >
                        {taskAssigneeName(drawerTask)}
                      </span>
                    )}
                  </div>
                  {/* This assignee's personality, self-hidden when they haven't got one. */}
                  <AssigneePersonalityInline selectValue={taskAssigneeSelectValue(drawerTask)} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tTask('dueDate')}</span>
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
                        title={tTask('setDueDateTitle')}
                        style={{
                          color: drawerTask.dueDate ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          borderBottom: '1px dashed var(--border-subtle)',
                        }}
                      >
                        {formatDate(drawerTask.dueDate) || tTask('none')}
                      </span>
                    )}
                  </div>
                  {/* Release association (EMP-10a) — persists through the task update path. */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28, gap: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tTask('release')}</span>
                    <ReleasePicker
                      value={drawerTask.releaseId ?? null}
                      projectId={drawerTask.projectId}
                      onChange={(releaseId) => void saveTaskField({ releaseId })}
                    />
                  </div>
                  {/* Delay root-cause tag (EMP-9) — owns its own persistence. */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28, gap: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tTask('delayReason')}</span>
                    <DelayReasonTag taskId={drawerTask.id} value={null} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 13, minHeight: 28, gap: 12 }}>
                    <span style={{ color: 'var(--text-muted)', paddingTop: 4 }}>
                      {tBoard('businessValue.label')}
                      {drawerTask.managerRank != null && (
                        <span
                          title={tBoard('businessValue.rankTitle')}
                          style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--surface-interactive, var(--bg-elevated))', color: 'var(--text-secondary)', fontWeight: 700 }}
                        >
                          #{drawerTask.managerRank}
                        </span>
                      )}
                    </span>
                    {editingField === 'businessValue' ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        autoFocus
                        value={fieldDraft}
                        disabled={fieldSaving}
                        onChange={(e) => setFieldDraft(e.target.value)}
                        onBlur={commitBusinessValue}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitBusinessValue();
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                        placeholder="0–100"
                        style={{
                          width: 90,
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
                        onClick={() => { setFieldDraft(drawerTask.businessValue != null ? String(drawerTask.businessValue) : ''); setEditingField('businessValue'); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { setFieldDraft(drawerTask.businessValue != null ? String(drawerTask.businessValue) : ''); setEditingField('businessValue'); } }}
                        title={drawerTask.businessValueRationale ?? tBoard('businessValue.editTitle')}
                        style={{
                          color: drawerTask.businessValue != null ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          borderBottom: '1px dashed var(--border-subtle)',
                          textAlign: 'right',
                          maxWidth: 220,
                        }}
                      >
                        {drawerTask.businessValue != null
                          ? tBoard('businessValue.badge', { value: drawerTask.businessValue })
                          : tBoard('businessValue.unset')}
                      </span>
                    )}
                  </div>
                  {drawerTask.businessValue != null && drawerTask.businessValueRationale && editingField !== 'businessValue' && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -2, lineHeight: 1.5 }}>
                      {drawerTask.businessValueRationale}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, minHeight: 28 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tTask('created')}</span>
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
                {tTask.rich('runsAs', { name: taskAssigneeName(drawerTask), b: (chunks) => <strong style={{ color: 'var(--text-secondary)' }}>{chunks}</strong> })}
              </span>
              <RunTaskButton
                task={drawerTask}
                label={tTask('runThisTask')}
                // The lane move is SERVER-SIDE: the runtime transitions the ticket to
                // in_progress when the run reports RUNNING, and the change arrives over
                // the project realtime socket. The client no longer writes the status
                // itself (that pre-empted the server and forced a board re-render before
                // the run had even started). Just surface the live output + refresh runs.
                onRan={() => { setDrawerTab('agent'); refreshRuns(); }}
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
          initialTab={boardConfigTab}
        />
      )}

      {profileAssignee && (
        <MemberProfileEditor
          kind={profileAssignee.kind}
          refId={profileAssignee.refId}
          name={profileAssignee.name}
          tasks={profileAssignee.tasks}
          onClose={() => setProfileAssignee(null)}
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
              onClose={() => { setCeremony(null); void load({ background: true }); }}
            />
          </div>
        </div>
      )}
    </div>
    </AssigneeProfilesProvider>
  );
}
