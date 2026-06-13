'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tasksApi, sprintsApi, type Task, type Sprint } from '@/lib/builderforceApi';
import { listTeamsByProject, getTeam, listWorkforceDirectory } from '@/lib/teams';
import { useAuth } from '@/lib/AuthContext';
import { useCeremonyRoom, type CeremonyRoomFrame } from '@/lib/ceremonyRoom';
import { ViewToggle } from '@/components/ViewToggle';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { CeremonySeat } from './CeremonySeat';
import { BacklogRail } from './BacklogRail';
import { EpicRail } from './EpicRail';
import { DRAG_TASK, memberAssigneePatch, memberKey, taskBelongsToMember, type CeremonyMember } from './types';

export type CeremonyMode = 'standup' | 'planning';

/** Resolve the round-table seats: the project's attached team(s), else the whole workforce. */
async function loadProjectMembers(projectId: number): Promise<CeremonyMember[]> {
  try {
    const teams = await listTeamsByProject(projectId);
    if (teams.length > 0) {
      const details = await Promise.all(teams.map((t) => getTeam(t.id)));
      const map = new Map<string, CeremonyMember>();
      for (const d of details) {
        for (const m of d.members) {
          map.set(`${m.memberKind}:${m.memberRef}`, { kind: m.memberKind, ref: m.memberRef, name: m.memberName });
        }
      }
      if (map.size > 0) return [...map.values()];
    }
  } catch {
    /* fall through to the full workforce */
  }
  const dir = await listWorkforceDirectory().catch(() => []);
  return dir.map((o) => ({ kind: o.kind, ref: o.ref, name: o.name }));
}

const IN_FLIGHT = new Set(['in_progress', 'in_review']);

interface PeerCursor { x: number; y: number; name: string; at: number; }

/**
 * CeremonyStage — the reusable round-table for a live standup or planning session.
 * Used by the dedicated /ceremonies page and the board's full-screen overlay.
 *
 * Drag a backlog ticket onto a seat to assign it, onto an Epic to group it, or
 * onto the sprint bar to schedule it. Every mutation goes through the normal task
 * REST routes and is broadcast to peers (presence + live sync via the ceremony room).
 */
export function CeremonyStage({
  projectId,
  mode,
  onModeChange,
  onClose,
}: {
  projectId: number;
  mode: CeremonyMode;
  onModeChange: (mode: CeremonyMode) => void;
  onClose?: () => void;
}) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<CeremonyMember[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [activeSprintId, setActiveSprintId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerTask, setDrawerTask] = useState<Task | null>(null);
  const [cursors, setCursors] = useState<Record<string, PeerCursor>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksData, sprintsData, memberData] = await Promise.all([
        tasksApi.list(projectId),
        sprintsApi.list().catch(() => [] as Sprint[]),
        loadProjectMembers(projectId),
      ]);
      setTasks(tasksData);
      setSprints(sprintsData);
      setMembers(memberData);
      setActiveSprintId((prev) =>
        prev || sprintsData.find((s) => s.status === 'active')?.id || sprintsData[0]?.id || '',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  // --- live room: presence + sync ------------------------------------------
  const me = useMemo(
    () => ({ kind: 'human', ref: user?.id ?? '', name: user?.name ?? user?.email ?? 'You' }),
    [user?.id, user?.name, user?.email],
  );
  const onFrame = useCallback((f: CeremonyRoomFrame) => {
    if (f.type === 'cursor' && f.from) {
      setCursors((prev) => ({
        ...prev,
        [f.from as string]: { x: Number(f.x), y: Number(f.y), name: String(f.name ?? ''), at: Date.now() },
      }));
    }
  }, []);
  const { peers, connected, send } = useCeremonyRoom(projectId, me, { onChange: reload, onFrame });

  // Seats that are "live": connected peers matched by identity, plus myself.
  const presentKeys = useMemo(() => {
    const s = new Set(peers.map((p) => memberKey(p)));
    if (connected && me.ref) s.add(memberKey(me));
    return s;
  }, [peers, connected, me]);

  // Expire stale peer cursors (a peer that stopped moving / left).
  useEffect(() => {
    const t = setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        const next: Record<string, PeerCursor> = {};
        for (const [k, v] of Object.entries(prev)) if (now - v.at < 4000) next[k] = v;
        return next;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // --- derived sets ---------------------------------------------------------
  const epics = useMemo(() => tasks.filter((t) => t.taskType === 'epic'), [tasks]);
  const childCountByEpic = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tasks) if (t.parentTaskId != null) m.set(t.parentTaskId, (m.get(t.parentTaskId) ?? 0) + 1);
    return m;
  }, [tasks]);

  const isUnassigned = (t: Task) =>
    t.assignedUserId == null && t.assignedAgentRef == null && t.assignedAgentHostId == null;

  // Backlog = unassigned, non-epic work — the pool a ceremony pulls from.
  const backlogTasks = useMemo(
    () => tasks.filter((t) => t.taskType !== 'epic' && isUnassigned(t)),
    [tasks],
  );

  const tasksForMember = useCallback(
    (m: CeremonyMember) => {
      const owned = tasks.filter((t) => taskBelongsToMember(t, m));
      return mode === 'standup' ? owned.filter((t) => IN_FLIGHT.has(t.status)) : owned;
    },
    [tasks, mode],
  );

  // --- mutations (all broadcast `changed` so peers re-fetch) ----------------
  const mutate = useCallback(
    async (id: number, patch: Parameters<typeof tasksApi.update>[1]) => {
      try {
        const updated = await tasksApi.update(id, patch);
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
        setDrawerTask((d) => (d?.id === id ? updated : d));
        send({ type: 'changed' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed');
      }
    },
    [send],
  );

  const assignToMember = useCallback(
    (id: number, m: CeremonyMember) => mutate(id, memberAssigneePatch(m)),
    [mutate],
  );
  const groupIntoEpic = useCallback((id: number, epicId: number) => mutate(id, { parentTaskId: epicId }), [mutate]);
  const scheduleIntoSprint = useCallback((id: number, sprintId: string) => mutate(id, { sprintId }), [mutate]);
  const returnToBacklog = useCallback(
    (id: number) => mutate(id, { assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null }),
    [mutate],
  );
  const setStatus = useCallback((id: number, status: string) => mutate(id, { status }), [mutate]);

  const createEpic = useCallback(async () => {
    const title = window.prompt('New epic title');
    if (!title?.trim()) return;
    try {
      const epic = await tasksApi.create({ projectId, title: title.trim(), taskType: 'epic' });
      setTasks((prev) => [epic, ...prev]);
      send({ type: 'changed' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create epic failed');
    }
  }, [projectId, send]);

  const createSprint = useCallback(async () => {
    const name = window.prompt('New sprint name');
    if (!name?.trim()) return;
    try {
      const sprint = await sprintsApi.create({ name: name.trim(), status: 'active' });
      setSprints((prev) => [sprint, ...prev]);
      setActiveSprintId(sprint.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create sprint failed');
    }
  }, []);

  // --- cursor broadcast (throttled) ----------------------------------------
  const lastCursor = useRef(0);
  const onTableMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const now = Date.now();
      if (now - lastCursor.current < 60) return;
      lastCursor.current = now;
      const rect = e.currentTarget.getBoundingClientRect();
      send({
        type: 'cursor',
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
        name: me.name,
      });
    },
    [send, me.name],
  );

  const activeSprint = sprints.find((s) => s.id === activeSprintId) ?? null;
  const sprintTaskCount = activeSprintId ? tasks.filter((t) => t.sprintId === activeSprintId).length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle
            value={mode}
            onChange={(m) => onModeChange(m as CeremonyMode)}
            options={[
              { value: 'standup', label: 'Standup' },
              { value: 'planning', label: 'Planning' },
            ]}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {members.length} at the table
            {connected && (
              <span style={{ marginLeft: 8, color: 'var(--cyan-bright)' }}>
                ● {peers.length + 1} live
              </span>
            )}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--bg-deep)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          {/* Backlog rail */}
          <BacklogRail
            tasks={backlogTasks}
            title={mode === 'standup' ? 'To discuss' : 'Backlog'}
            onOpen={setDrawerTask}
            onReturn={returnToBacklog}
          />

          {/* Round table */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            {mode === 'planning' && (
              // Sprint bar — drop a task here to schedule it into the active sprint.
              <div
                onDragOver={activeSprintId ? (e) => e.preventDefault() : undefined}
                onDrop={activeSprintId ? (e) => {
                  e.preventDefault();
                  const id = Number(e.dataTransfer.getData(DRAG_TASK));
                  if (id) scheduleIntoSprint(id, activeSprintId);
                } : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--bg-deep)',
                  border: '1px dashed var(--border-subtle)',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Sprint
                </span>
                {sprints.length > 0 ? (
                  <select
                    value={activeSprintId}
                    onChange={(e) => setActiveSprintId(e.target.value)}
                    style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                  >
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No sprint yet</span>
                )}
                {activeSprint && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {sprintTaskCount} scheduled · drop a ticket to add
                  </span>
                )}
                <button
                  type="button"
                  onClick={createSprint}
                  style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  + New sprint
                </button>
              </div>
            )}

            <div
              onMouseMove={onTableMouseMove}
              style={{
                position: 'relative',
                flex: 1,
                minHeight: 360,
                borderRadius: 16,
                background: 'radial-gradient(circle at 50% 50%, var(--surface-card), var(--bg-deep))',
                border: '1px solid var(--border-subtle)',
                overflow: 'hidden',
              }}
            >
              {/* Center disc */}
              <div
                onDragOver={mode === 'standup' ? (e) => e.preventDefault() : undefined}
                onDrop={mode === 'standup' ? (e) => {
                  e.preventDefault();
                  const id = Number(e.dataTransfer.getData(DRAG_TASK));
                  if (id) setStatus(id, 'done');
                } : undefined}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 160,
                  height: 160,
                  borderRadius: '50%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  textAlign: 'center',
                  padding: 12,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                  {mode}
                </span>
                {mode === 'standup' ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Drop a ticket here to mark Done</span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{backlogTasks.length} in backlog</span>
                )}
              </div>

              {/* Seats around the ellipse */}
              {members.map((m, i) => {
                const angle = (2 * Math.PI * i) / Math.max(members.length, 1) - Math.PI / 2;
                const x = 50 + 42 * Math.cos(angle);
                const y = 50 + 40 * Math.sin(angle);
                return (
                  <div key={memberKey(m)} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
                    <CeremonySeat
                      member={m}
                      tasks={tasksForMember(m)}
                      present={presentKeys.has(memberKey(m))}
                      showStack={mode === 'standup'}
                      onDropTask={(id) => assignToMember(id, m)}
                      onOpen={setDrawerTask}
                    />
                  </div>
                );
              })}

              {members.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No team members — add a team to this project, or invite teammates.
                </div>
              )}

              {/* Peer cursors */}
              {Object.entries(cursors).map(([id, c]) => (
                <div
                  key={id}
                  style={{ position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(-2px, -2px)', pointerEvents: 'none', zIndex: 5 }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan-bright)', boxShadow: '0 0 8px var(--cyan-glow)' }} />
                  <span style={{ fontSize: 10, color: 'var(--cyan-bright)', background: 'var(--bg-deep)', padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Epics rail (planning only) */}
          {mode === 'planning' && (
            <EpicRail
              epics={epics}
              childCountByEpic={childCountByEpic}
              onDropToEpic={groupIntoEpic}
              onCreateEpic={createEpic}
              onOpen={setDrawerTask}
            />
          )}
        </div>
      )}

      {/* Lightweight task detail */}
      <SlideOutPanel open={!!drawerTask} onClose={() => setDrawerTask(null)} title={drawerTask?.title ?? ''}>
        {drawerTask && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{drawerTask.key}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ textTransform: 'capitalize' }}>Priority: {drawerTask.priority}</span>
              <span style={{ textTransform: 'capitalize' }}>· Status: {drawerTask.status}</span>
            </div>
            {drawerTask.description && <p style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{drawerTask.description}</p>}
            <a
              href={`/projects?tab=tasks&project=${drawerTask.projectId}`}
              style={{ color: 'var(--coral-bright)', fontWeight: 600, textDecoration: 'none' }}
            >
              Open on the board →
            </a>
          </div>
        )}
      </SlideOutPanel>
    </div>
  );
}
