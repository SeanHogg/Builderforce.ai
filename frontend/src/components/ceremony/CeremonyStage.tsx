'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { useIsMobile } from '@/lib/useIsMobile';
import { useMediaRoom } from '@/lib/useMediaRoom';
import { VideoGrid } from '@/components/video/VideoGrid';
import { MediaControls } from '@/components/video/MediaControls';
import {
  tasksApi, sprintsApi, ceremonySessionsApi, membersApi,
  type Task, type Sprint, type CeremonySession, type CeremonySessionDetail, type CeremonyParticipant, type MemberProfile,
} from '@/lib/builderforceApi';
import { listTeamsByProject, getTeam, listWorkforceDirectory } from '@/lib/teams';
import { useAuth } from '@/lib/AuthContext';
import { useCeremonyRoom, type CeremonyRoomFrame } from '@/lib/ceremonyRoom';
import { ViewToggle } from '@/components/ViewToggle';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { CeremonySeat } from './CeremonySeat';
import { BacklogRail } from './BacklogRail';
import { EpicRail } from './EpicRail';
import { StandupControls } from './StandupControls';
import { ScorecardPanel } from './ScorecardPanel';
import { AssignedWorkPanel } from './AssignedWorkPanel';
import { DRAG_TASK, memberAssigneePatch, memberKey, taskBelongsToMember, type CeremonyMember } from './types';

export type CeremonyMode = 'standup' | 'planning';

/** Active-work statuses that count toward a member's load (power meter). */
const ACTIVE_STATUSES = new Set(['in_progress', 'in_review', 'ready']);
/** Default per-member WIP cap when no member profile sets one. */
const DEFAULT_CAP = 8;
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
  const tMeet = useTranslations('meetings');
  const t = useTranslations('ceremony');
  // Narrow viewports can't fit the two 240px rails + the absolute round table side
  // by side, so on mobile the stage stacks vertically and the seats render as a
  // centered wrap-grid instead of the (overlapping) circle.
  const isMobile = useIsMobile();
  const [camerasOn, setCamerasOn] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<CeremonyMember[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [activeSprintId, setActiveSprintId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerTask, setDrawerTask] = useState<Task | null>(null);
  const [cursors, setCursors] = useState<Record<string, PeerCursor>>({});
  // Tracked-session state (start/turn/complete + per-person timing).
  const [session, setSession] = useState<CeremonySession | null>(null);
  const [participants, setParticipants] = useState<CeremonyParticipant[]>([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [profiles, setProfiles] = useState<MemberProfile[]>([]);
  // Slide-out targets (scorecard / assigned work) for a clicked seat.
  const [scorecardMember, setScorecardMember] = useState<CeremonyMember | null>(null);
  const [assignedMember, setAssignedMember] = useState<CeremonyMember | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksData, sprintsData, memberData, sessionData, profileData] = await Promise.all([
        tasksApi.list(projectId),
        sprintsApi.list(projectId).catch(() => [] as Sprint[]),
        loadProjectMembers(projectId),
        ceremonySessionsApi.active(projectId, mode).catch((): CeremonySessionDetail => ({ session: null })),
        membersApi.profiles().then((r) => r.profiles).catch(() => [] as MemberProfile[]),
      ]);
      setTasks(tasksData);
      setSprints(sprintsData);
      setMembers(memberData);
      setSession(sessionData.session ?? null);
      setParticipants(sessionData.participants ?? []);
      setProfiles(profileData);
      setActiveSprintId((prev) =>
        prev || sprintsData.find((s) => s.status === 'active')?.id || sprintsData[0]?.id || '',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [projectId, mode, t]);

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

  // Live cameras/mics for the round-table — one media room per project ceremony.
  // Mesh P2P; joins only while the user turns cameras on (no forced capture).
  const media = useMediaRoom(
    camerasOn ? `ceremony-${projectId}` : null,
    { name: me.name, ref: me.ref },
    { enabled: camerasOn },
  );

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

  const ownedByMember = useCallback((m: CeremonyMember) => tasks.filter((t) => taskBelongsToMember(t, m)), [tasks]);
  const tasksForMember = useCallback(
    (m: CeremonyMember) => {
      const owned = ownedByMember(m);
      return mode === 'standup' ? owned.filter((t) => IN_FLIGHT.has(t.status)) : owned;
    },
    [ownedByMember, mode],
  );

  // Capacity per member (real maxConcurrentWip from the member profile, else default).
  const capByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of profiles) m.set(memberKey({ kind: p.memberKind, ref: p.memberRef }), p.maxConcurrentWip ?? DEFAULT_CAP);
    return m;
  }, [profiles]);

  // The seat whose turn it is (standup): participant at session.currentTurn → memberKey.
  const currentSpeakerKey = useMemo(() => {
    if (session?.currentTurn == null) return null;
    const p = participants.find((x) => x.turnOrder === session.currentTurn);
    return p ? memberKey({ kind: p.memberKind, ref: p.memberRef }) : null;
  }, [session?.currentTurn, participants]);

  const isFacilitator = !session || session.facilitatorId === (user?.id ?? '');

  // --- mutations (all broadcast `changed` so peers re-fetch) ----------------
  const mutate = useCallback(
    async (id: number, patch: Parameters<typeof tasksApi.update>[1]) => {
      try {
        const updated = await tasksApi.update(id, patch);
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
        setDrawerTask((d) => (d?.id === id ? updated : d));
        send({ type: 'changed' });
      } catch (e) {
        setError(e instanceof Error ? e.message : t('errorUpdate'));
      }
    },
    [send, t],
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
    const title = window.prompt(t('newEpicPrompt'));
    if (!title?.trim()) return;
    try {
      const epic = await tasksApi.create({ projectId, title: title.trim(), taskType: 'epic' });
      setTasks((prev) => [epic, ...prev]);
      send({ type: 'changed' });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorCreateEpic'));
    }
  }, [projectId, send, t]);

  const createSprint = useCallback(async () => {
    const name = window.prompt(t('newSprintPrompt'));
    if (!name?.trim()) return;
    try {
      const sprint = await sprintsApi.create({ name: name.trim(), status: 'active', projectId });
      setSprints((prev) => [sprint, ...prev]);
      setActiveSprintId(sprint.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorCreateSprint'));
    }
  }, [projectId, t]);

  // --- session lifecycle (start / advance turn / complete) -----------------
  const applySession = useCallback((d: { session: CeremonySession | null; participants?: CeremonyParticipant[] }) => {
    setSession(d.session ?? null);
    setParticipants(d.participants ?? []);
    send({ type: 'changed' });
  }, [send]);

  const startSession = useCallback(async () => {
    setSessionBusy(true);
    try {
      const parts = members.map((m) => ({ kind: m.kind, ref: m.ref, name: m.name }));
      applySession(await ceremonySessionsApi.start(projectId, mode, parts));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorStart'));
    } finally {
      setSessionBusy(false);
    }
  }, [members, projectId, mode, applySession, t]);

  const advanceTurn = useCallback(async (nextTurn: number) => {
    if (!session) return;
    setSessionBusy(true);
    try {
      applySession(await ceremonySessionsApi.advanceTurn(session.id, nextTurn));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorAdvance'));
    } finally {
      setSessionBusy(false);
    }
  }, [session, applySession, t]);

  // On Complete: just end the session. The auto-dispatch of agent-owned work now
  // happens SERVER-SIDE inside POST /sessions/:id/complete, through the canonical
  // lane-entry gate (which applies the capability/cooldown/token/live-run checks
  // this client loop used to approximate with its own execution-dedupe map).
  // Previously this ran here, so the automation depended on the tab staying open,
  // only saw the tasks this client had fetched, and swallowed every failure.
  const completeSession = useCallback(async () => {
    if (!session) return;
    setSessionBusy(true);
    try {
      applySession(await ceremonySessionsApi.complete(session.id));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorComplete'));
    } finally {
      setSessionBusy(false);
    }
  }, [session, applySession, reload, t]);

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
              { value: 'standup', label: t('standup') },
              { value: 'planning', label: t('planning') },
            ]}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('atTable', { count: members.length })}
            {connected && (
              <span style={{ marginLeft: 8, color: 'var(--cyan-bright)' }}>
                ● {t('live', { count: peers.length + 1 })}
              </span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setCamerasOn((v) => !v)}
            aria-pressed={camerasOn}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              background: camerasOn ? 'var(--coral-bright)' : 'var(--bg-deep)',
              color: camerasOn ? 'var(--bg-deep)' : 'var(--text-secondary)',
              border: `1px solid ${camerasOn ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            {camerasOn ? tMeet('cameraOn') : tMeet('joinWithCamera')}
          </button>
          {members.length > 0 && (
            <StandupControls
              session={session}
              participants={participants}
              isFacilitator={isFacilitator}
              busy={sessionBusy}
              onStart={startSession}
              onNext={advanceTurn}
              onComplete={completeSession}
            />
          )}
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
            {t('close')}
          </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {camerasOn && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 12, background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }}>
          {media.mediaError ? (
            <div style={{ fontSize: 12, color: 'var(--error-text)' }}>{tMeet('cameraError', { error: media.mediaError })}</div>
          ) : (
            <VideoGrid
              self={{ name: me.name, stream: media.localStream, camOn: media.camOn, micOn: media.micOn }}
              tiles={media.tiles}
              compact
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <MediaControls
              camOn={media.camOn}
              micOn={media.micOn}
              onToggleCam={media.toggleCam}
              onToggleMic={media.toggleMic}
              onLeave={() => setCamerasOn(false)}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, flex: 1, minHeight: 0 }}>
          {/* Backlog rail */}
          <BacklogRail
            tasks={backlogTasks}
            title={mode === 'standup' ? t('toDiscuss') : t('backlog')}
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
                  {t('sprint')}
                </span>
                {sprints.length > 0 ? (
                  <Select
                    value={activeSprintId}
                    onChange={(e) => setActiveSprintId(e.target.value)}
                    style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                  >
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
                    ))}
                  </Select>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noSprint')}</span>
                )}
                {activeSprint && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('sprintScheduled', { count: sprintTaskCount })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={createSprint}
                  style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {t('newSprint')}
                </button>
              </div>
            )}

            <div
              onMouseMove={isMobile ? undefined : onTableMouseMove}
              style={{
                position: 'relative',
                flex: 1,
                minHeight: isMobile ? 'auto' : 360,
                borderRadius: 16,
                background: 'radial-gradient(circle at 50% 50%, var(--surface-card), var(--bg-deep))',
                border: '1px solid var(--border-subtle)',
                overflow: 'hidden',
                // On mobile the seats flow as a centered wrap-grid rather than an
                // absolute circle (which collapses/overlaps at narrow widths).
                ...(isMobile
                  ? { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignContent: 'flex-start', padding: 12 }
                  : {}),
              }}
            >
              {/* Center disc (desktop) / full-width banner (mobile). On standup it's a
                  drop target that marks a dropped ticket Done. */}
              <div
                onDragOver={mode === 'standup' ? (e) => e.preventDefault() : undefined}
                onDrop={mode === 'standup' ? (e) => {
                  e.preventDefault();
                  const id = Number(e.dataTransfer.getData(DRAG_TASK));
                  if (id) setStatus(id, 'done');
                } : undefined}
                style={isMobile ? {
                  flexBasis: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'center',
                } : {
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
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t(mode)}
                </span>
                {mode === 'standup' ? (
                  // Drag-to-Done is a desktop-only affordance (HTML5 DnD doesn't fire
                  // on touch), so the hint is hidden on mobile.
                  isMobile ? null : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('dropToDone')}</span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('inBacklog', { count: backlogTasks.length })}</span>
                )}
              </div>

              {/* Seats: absolute around the ellipse on desktop, wrap-grid on mobile. */}
              {members.map((m, i) => {
                const k = memberKey(m);
                const owned = ownedByMember(m);
                const seat = (
                  <CeremonySeat
                    member={m}
                    stackTasks={tasksForMember(m)}
                    assignedTasks={owned}
                    activeLoad={owned.filter((t) => ACTIVE_STATUSES.has(t.status)).length}
                    cap={capByKey.get(k) ?? DEFAULT_CAP}
                    present={presentKeys.has(k)}
                    isCurrentTurn={currentSpeakerKey === k}
                    showStack={mode === 'standup'}
                    onDropTask={(id) => assignToMember(id, m)}
                    onOpen={setDrawerTask}
                    onOpenScorecard={() => setScorecardMember(m)}
                    onOpenAssigned={() => setAssignedMember(m)}
                  />
                );
                if (isMobile) return <div key={k}>{seat}</div>;
                const angle = (2 * Math.PI * i) / Math.max(members.length, 1) - Math.PI / 2;
                const x = 50 + 42 * Math.cos(angle);
                const y = 50 + 40 * Math.sin(angle);
                return (
                  <div key={k} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
                    {seat}
                  </div>
                );
              })}

              {members.length === 0 && (
                <div style={isMobile
                  ? { flexBasis: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' }
                  : { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  {t('noMembers')}
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
              <span style={{ textTransform: 'capitalize' }}>{t('priority', { priority: drawerTask.priority })}</span>
              <span style={{ textTransform: 'capitalize' }}>· {t('status', { status: drawerTask.status })}</span>
            </div>
            {drawerTask.description && <p style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{drawerTask.description}</p>}
            <a
              href={`/projects?tab=tasks&project=${drawerTask.projectId}`}
              style={{ color: 'var(--coral-bright)', fontWeight: 600, textDecoration: 'none' }}
            >
              {t('openOnBoard')}
            </a>
          </div>
        )}
      </SlideOutPanel>

      {/* Scorecard (agile stats) for a clicked seat — power meter "expanded". */}
      <SlideOutPanel open={!!scorecardMember} onClose={() => setScorecardMember(null)} title={scorecardMember ? t('scorecardTitle', { name: scorecardMember.name }) : ''}>
        {scorecardMember && <ScorecardPanel member={scorecardMember} />}
      </SlideOutPanel>

      {/* Assigned work (briefcase) for a clicked seat. */}
      <SlideOutPanel open={!!assignedMember} onClose={() => setAssignedMember(null)} title={assignedMember ? t('assignedTitle', { name: assignedMember.name }) : ''}>
        {assignedMember && (
          <AssignedWorkPanel
            member={assignedMember}
            tasks={ownedByMember(assignedMember)}
            onOpenTask={(t) => { setAssignedMember(null); setDrawerTask(t); }}
          />
        )}
      </SlideOutPanel>
    </div>
  );
}
