'use client';

import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { useTranslations } from 'next-intl';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideOutPanel } from '../SlideOutPanel';
import { BoardConnectionsManager } from '../integrations/BoardConnectionsManager';
import { useBoardConfig } from './useBoardConfig';
import {
  boardsApi,
  workflowDefinitions,
  type Board,
  type Swimlane,
  type SwimlaneAgent,
  type WorkflowDefinitionSummary,
} from '@/lib/builderforceApi';
import { loadAgentPool, type PoolAgent } from '@/lib/agentPool';
import {
  listTeams,
  listTeamsByProject,
  addTeamProject,
  removeTeamProject,
  type TeamSummary,
  type AttachedTeam,
} from '@/lib/teams';

/**
 * Board-config slide-out opened from the Task-Mgmt COG. Configures the project's
 * kanban board: swimlanes, the autonomous agents assigned to each lane, board
 * settings, and which external PM boards feed it. Reuses SlideOutPanel and the
 * shared BoardConnectionsManager.
 */

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 8,
  background: 'var(--bg-deep)', color: 'var(--text-primary)', boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  padding: '7px 12px', fontSize: 12, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '5px 9px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};
const sectionPad: React.CSSProperties = { padding: 20 };

type ConfigTab = 'lanes' | 'teams' | 'settings' | 'external';

export interface BoardConfigPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  projectName?: string;
  /** Which tab to open on. Defaults to 'lanes'; the approval banner opens 'settings'. */
  initialTab?: ConfigTab;
}

export function BoardConfigPanel({ open, onClose, projectId, projectName, initialTab = 'lanes' }: BoardConfigPanelProps) {
  const t = useTranslations('boardConfig');
  const [tab, setTab] = useState<ConfigTab>(initialTab);
  // Re-sync the active tab each time the panel is (re)opened so a caller that
  // requests 'settings' always lands there, even after a prior open left another
  // tab selected.
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const { board, lanes, agentsByLane, loading, error, reload } = useBoardConfig(projectId, open);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Tracks the board we've already auto-seeded lanes for during this open, so
  // the empty-board heal fires at most once and never re-seeds after a user
  // deliberately deletes lanes (each delete reload()s back through this effect).
  const healedBoardRef = useRef<string | null>(null);

  // The cog is only reachable when a project board is selected, so a board is
  // expected to exist, with its default swimlanes (mirroring the kanban
  // columns). Heal both broken states automatically rather than dead-ending on
  // a prompt that contradicts being on the board:
  //   1. No board    -> create one (the create route seeds default lanes).
  //   2. Empty board -> seed default lanes (covers a board left lane-less by a
  //      pre-transaction creation failure: kanban still showed columns, but the
  //      panel said "No swimlanes yet").
  // The provisionError guard stops a retry loop if either step fails.
  useEffect(() => {
    if (!open) { setProvisionError(null); healedBoardRef.current = null; return; }
    if (loading || error || provisioning || provisionError) return;
    if (!board) {
      setProvisioning(true);
      boardsApi
        .create({ projectId, name: t('boardNameDefault', { name: projectName ?? t('projectFallback') }) })
        .then(() => reload())
        .catch((e) => setProvisionError(e instanceof Error ? e.message : t('errCreateBoard')))
        .finally(() => setProvisioning(false));
      return;
    }
    if (lanes.length === 0 && healedBoardRef.current !== board.id) {
      healedBoardRef.current = board.id;
      setProvisioning(true);
      boardsApi.swimlanes
        .ensureDefaults(board.id)
        .then(() => reload())
        .catch((e) => setProvisionError(e instanceof Error ? e.message : t('errSetupLanes')))
        .finally(() => setProvisioning(false));
    }
  }, [open, loading, error, board, lanes.length, provisioning, provisionError, projectId, projectName, reload, t]);

  const shownError = error ?? provisionError;

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('title')}
      width="min(720px, 96vw)"
      tabs={[
        { id: 'lanes', label: t('tab.lanes') },
        { id: 'teams', label: t('tab.teams') },
        { id: 'settings', label: t('tab.settings') },
        { id: 'external', label: t('tab.external') },
      ]}
      activeTabId={tab}
      onTabChange={(t) => setTab(t as ConfigTab)}
    >
      {loading || provisioning || !board ? (
        <div style={sectionPad}>
          {shownError ? (
            <span style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{shownError}</span>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {provisioning || !board ? t('settingUp') : t('loading')}
            </span>
          )}
        </div>
      ) : shownError ? (
        <div style={sectionPad}><span style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{shownError}</span></div>
      ) : tab === 'lanes' ? (
        <LanesTab board={board} lanes={lanes} agentsByLane={agentsByLane} reload={reload} />
      ) : tab === 'teams' ? (
        <TeamsTab projectId={projectId} />
      ) : tab === 'settings' ? (
        <SettingsTab board={board} onSaved={reload} />
      ) : (
        <div style={sectionPad}>
          <BoardConnectionsManager projectId={projectId} heading={t('externalHeading')} />
        </div>
      )}
    </SlideOutPanel>
  );
}

// ---------------------------------------------------------------------------

function LanesTab({ board, lanes, agentsByLane, reload }: {
  board: Board; lanes: Swimlane[]; agentsByLane: Record<string, SwimlaneAgent[]>; reload: () => void;
}) {
  const t = useTranslations('boardConfig');
  const [laneName, setLaneName] = useState('');
  const [adding, setAdding] = useState(false);
  // Workflow definitions are the targets for a lane's "Run workflow" action.
  // Loaded once for the whole tab (not per lane) to avoid an N+1.
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  useEffect(() => {
    let live = true;
    workflowDefinitions.list().then((w) => { if (live) setWorkflows(w); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Derive a unique, stable lane key from the name — this is the status a task
  // holds while sitting in the lane, so it must be unique on the board.
  const keyFor = (name: string): string => {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'lane';
    const existing = new Set(lanes.map((l) => l.key));
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(`${base}_${i}`)) i += 1;
    return `${base}_${i}`;
  };

  const addLane = async () => {
    const name = laneName.trim();
    if (!name) return;
    await boardsApi.swimlanes.create(board.id, { key: keyFor(name), name, position: lanes.length });
    setLaneName(''); setAdding(false); reload();
  };
  const removeLane = async (id: string) => { if (confirm(t('confirmDeleteLane'))) { await boardsApi.swimlanes.remove(board.id, id); reload(); } };
  const patchLane = async (id: string, body: Record<string, unknown>) => { await boardsApi.swimlanes.patch(board.id, id, body); reload(); };
  // Swap a lane's position with its neighbour to reorder the board columns.
  const moveLane = async (index: number, dir: -1 | 1) => {
    const target = lanes[index + dir];
    const current = lanes[index];
    if (!target || !current) return;
    await boardsApi.swimlanes.patch(board.id, current.id, { position: target.position });
    await boardsApi.swimlanes.patch(board.id, target.id, { position: current.position });
    reload();
  };

  return (
    <div style={sectionPad}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t('lanesIntro')}
      </div>
      {lanes.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noLanes')}</div>}
      {lanes.map((lane, index) => (
        <div key={lane.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <button type="button" style={{ ...btnSubtle, padding: '0 6px', lineHeight: 1.2 }} disabled={index === 0} title={t('moveLeft')} onClick={() => moveLane(index, -1)}>▲</button>
              <button type="button" style={{ ...btnSubtle, padding: '0 6px', lineHeight: 1.2 }} disabled={index === lanes.length - 1} title={t('moveRight')} onClick={() => moveLane(index, 1)}>▼</button>
            </div>
            <input
              style={{ ...inputStyle, fontWeight: 600, fontSize: 14, flex: 1, minWidth: 140 }}
              defaultValue={lane.name}
              title={t('laneNameTitle')}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== lane.name) patchLane(lane.id, { name: v }); }}
            />
            <Select value={lane.gate} onChange={(e) => patchLane(lane.id, { gate: e.target.value })} style={inputStyle} title={t('gate')}>
              <option value="auto">{t('gateAuto')}</option>
              <option value="human">{t('gateHuman')}</option>
            </Select>
            <Select value={lane.executionMode} onChange={(e) => patchLane(lane.id, { executionMode: e.target.value })} style={inputStyle} title={t('execution')}>
              <option value="sequential">{t('execSequential')}</option>
              <option value="parallel">{t('execParallel')}</option>
            </Select>
            <Select value={lane.failurePolicy} onChange={(e) => patchLane(lane.id, { failurePolicy: e.target.value })} style={inputStyle} title={t('onFailure')}>
              <option value="needs_attention">{t('failNeedsAttention')}</option>
              <option value="retry">{t('failRetry')}</option>
              <option value="skip">{t('failSkip')}</option>
            </Select>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={lane.isTerminal} onChange={(e) => patchLane(lane.id, { isTerminal: e.target.checked })} /> {t('terminal')}
            </label>
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => removeLane(lane.id)}>{t('delete')}</button>
          </div>
          <LaneActionRow lane={lane} lanes={lanes} workflows={workflows} patchLane={patchLane} />
          <AgentList board={board} lane={lane} agents={agentsByLane[lane.id] ?? []} reload={reload} />
        </div>
      ))}

      {adding ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, flex: 1, minWidth: 140 }} placeholder={t('columnNamePlaceholder')} value={laneName} onChange={(e) => setLaneName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addLane(); }} />
          <button type="button" style={btnPrimary} onClick={addLane}>{t('add')}</button>
          <button type="button" style={btnSubtle} onClick={() => { setAdding(false); setLaneName(''); }}>{t('cancel')}</button>
        </div>
      ) : (
        <button type="button" style={btnPrimary} onClick={() => setAdding(true)}>{t('addSwimlane')}</button>
      )}
    </div>
  );
}

/** Per-lane "when the stage's agents finish, do X (if quorum Y is met)" editor. */
function LaneActionRow({ lane, lanes, workflows, patchLane }: {
  lane: Swimlane;
  lanes: Swimlane[];
  workflows: WorkflowDefinitionSummary[];
  patchLane: (id: string, body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('boardConfig');
  const actionType = lane.actionType ?? 'advance';
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
      <span style={labelStyle}>{t('whenDone')}</span>
      <Select
        value={actionType}
        onChange={(e) => patchLane(lane.id, { actionType: e.target.value, actionTarget: '' })}
        style={inputStyle}
        title={t('whenDoneTitle')}
      >
        <option value="advance">{t('actionAdvance')}</option>
        <option value="move_ticket">{t('actionMoveTicket')}</option>
        <option value="run_workflow">{t('actionRunWorkflow')}</option>
        <option value="do_nothing">{t('actionDoNothing')}</option>
      </Select>
      {actionType === 'move_ticket' && (
        <Select value={lane.actionTarget ?? ''} onChange={(e) => patchLane(lane.id, { actionTarget: e.target.value })} style={inputStyle} title={t('destinationLane')}>
          <option value="">{t('selectLane')}</option>
          {lanes.filter((l) => l.id !== lane.id).map((l) => <option key={l.id} value={l.key}>{l.name}</option>)}
        </Select>
      )}
      {actionType === 'run_workflow' && (
        <Select value={lane.actionTarget ?? ''} onChange={(e) => patchLane(lane.id, { actionTarget: e.target.value })} style={inputStyle} title={t('workflowToRun')}>
          <option value="">{t('selectWorkflow')}</option>
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      )}
      <span style={{ width: 1, height: 18, background: 'var(--border-subtle)' }} />
      <span style={labelStyle}>{t('succeedsWhen')}</span>
      <Select
        value={lane.successPolicy ?? 'all'}
        onChange={(e) => patchLane(lane.id, { successPolicy: e.target.value, ...(e.target.value === 'n_of_m' ? {} : { successThreshold: null }) })}
        style={inputStyle}
        title={t('succeedsWhenTitle')}
      >
        <option value="all">{t('successAll')}</option>
        <option value="any">{t('successAny')}</option>
        <option value="n_of_m">{t('successNofM')}</option>
      </Select>
      {lane.successPolicy === 'n_of_m' && (
        <input
          type="number" min={1} style={{ ...inputStyle, width: 64 }} defaultValue={lane.successThreshold ?? 1}
          onBlur={(e) => patchLane(lane.id, { successThreshold: Math.max(1, Number(e.target.value) || 1) })} title={t('nLabel')}
        />
      )}
    </div>
  );
}

function AgentList({ board, lane, agents, reload }: { board: Board; lane: Swimlane; agents: SwimlaneAgent[]; reload: () => void }) {
  const t = useTranslations('boardConfig');
  // The user picks an agent from the project's registered/workforce agents; that
  // agent already carries its runtime/host/model defaults, so the form is just
  // "which agent" + an optional model override.
  const [agentSel, setAgentSel] = useState(''); // 'kind:ref'
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [model, setModel] = useState('');
  const [available, setAvailable] = useState<PoolAgent[]>([]);
  const [adding, setAdding] = useState(false);

  // Any agent registered to the tenant (workforce + registered) can be assigned
  // to a lane — register once, assign anywhere — not just project-attached ones.
  useEffect(() => {
    if (!adding) return;
    let live = true;
    loadAgentPool().then((a) => { if (live) setAvailable(a); }).catch(() => {});
    return () => { live = false; };
  }, [adding]);

  const add = async () => {
    if (!agentSel) return;
    const [agentKind, agentRef] = agentSel.split(':') as ['workforce' | 'registered', string];
    await boardsApi.agents.create(board.id, lane.id, {
      agentKind,
      agentRef,
      name: name.trim() || null,
      role: role.trim() || null,
      model: model.trim() || null,
      position: agents.length,
    });
    setAgentSel(''); setName(''); setRole(''); setModel(''); setAdding(false); reload();
  };
  const remove = async (id: string) => { await boardsApi.agents.remove(board.id, lane.id, id); reload(); };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>{t('autonomousAgents')}</div>
      {agents.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noAgentsInLane')}</div>}
      {agents.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
          <span style={{ fontWeight: 600 }}>{a.name ?? a.role}</span>
          <span className="badge-blue" style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, textTransform: 'capitalize' }} title={t('roleTitle')}>
            {a.role}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {a.runtime}
            {a.model ? ` · ${a.model}` : ` · ${t('defaultLlm')}`}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(a.id)}>{t('remove')}</button>
        </div>
      ))}
      {adding ? (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Select value={agentSel} onChange={(e) => setAgentSel(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 180 }} aria-label={t('selectAgent')}>
              <option value="">{t('selectAgent')}</option>
              {available.map((a) => (
                <option key={`${a.kind}:${a.ref}`} value={`${a.kind}:${a.ref}`}>{a.name}</option>
              ))}
            </Select>
            <input style={{ ...inputStyle, width: 140 }} placeholder={t('namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} title={t('nameTitle')} />
            <input style={{ ...inputStyle, width: 120 }} placeholder={t('rolePlaceholder')} value={role} onChange={(e) => setRole(e.target.value)} title={t('roleTitle')} />
            <input style={{ ...inputStyle, width: 160 }} placeholder={t('modelPlaceholder')} value={model} onChange={(e) => setModel(e.target.value)} />
            <button type="button" style={btnPrimary} onClick={add} disabled={!agentSel}>{t('add')}</button>
            <button type="button" style={btnSubtle} onClick={() => { setAdding(false); setAgentSel(''); setName(''); setRole(''); setModel(''); }}>{t('cancel')}</button>
          </div>
          {available.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              {t('noAgentsRegistered')}
            </div>
          )}
        </>
      ) : (
        <button type="button" style={{ ...btnSubtle, marginTop: 8 }} onClick={() => setAdding(true)}>{t('assignAgent')}</button>
      )}
    </div>
  );
}

/**
 * Assign workforce Teams to this board. A board is 1:1 with its project, so
 * "assign a team to the board" attaches the team to the board's project
 * (team_projects). Members of an attached team are managed in Workforce → Teams;
 * this tab only governs which teams work this board.
 */
function TeamsTab({ projectId }: { projectId: number }) {
  const t = useTranslations('boardConfig');
  const [allTeams, setAllTeams] = useState<TeamSummary[]>([]);
  const [attached, setAttached] = useState<AttachedTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, here] = await Promise.all([listTeams(), listTeamsByProject(projectId)]);
      setAllTeams(all);
      setAttached(here);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errLoadTeams'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  const attachedIds = new Set(attached.map((t) => t.id));
  const available = allTeams.filter((t) => !attachedIds.has(t.id));

  const mutate = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('errUpdate')); }
    finally { setBusy(false); }
  };

  const workforceLink = (chunks: React.ReactNode) => (
    <a href="/workforce?tab=teams" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>{chunks}</a>
  );

  return (
    <div style={sectionPad}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t.rich('teamsIntro', { link: workforceLink })}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger, #dc2626)', marginBottom: 10 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingTeams')}</div>
      ) : (
        <>
          {attached.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{t('noTeamsAssigned')}</div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              {attached.map((tm) => (
                <div key={tm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{tm.name}</div>
                    {tm.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tm.description}</div>
                    )}
                  </div>
                  <span style={{ flex: 1 }} />
                  <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} disabled={busy} onClick={() => void mutate(() => removeTeamProject(tm.id, projectId))}>
                    {t('remove')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {allTeams.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t.rich('noTeamsExist', { link: workforceLink })}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                aria-label={t('selectTeamToAssign')}
                disabled={busy || available.length === 0}
              >
                <option value="">{available.length === 0 ? t('allTeamsAssigned') : t('assignTeam')}</option>
                {available.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </Select>
              <button
                type="button"
                style={{ ...btnPrimary, opacity: !pick || busy ? 0.6 : 1 }}
                disabled={!pick || busy}
                onClick={() => { const id = Number(pick); if (id) void mutate(async () => { await addTeamProject(id, projectId); setPick(''); }); }}
              >
                {t('assign')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SettingsTab({ board, onSaved }: { board: Board; onSaved: () => void }) {
  const t = useTranslations('boardConfig');
  const [maxConcurrent, setMaxConcurrent] = useState(board.maxConcurrentTickets);
  const [name, setName] = useState(board.name);
  const [turnMode, setTurnMode] = useState<'facilitator' | 'timeboxed'>(board.standupTurnMode ?? 'facilitator');
  const [turnSeconds, setTurnSeconds] = useState(board.standupTurnSeconds ?? 90);
  const [hideDoneItems, setHideDoneItems] = useState(board.hideDoneItems ?? false);
  // Default true: a board with the flag unset still gates high/urgent work.
  const [requireApproval, setRequireApproval] = useState(board.requireExecutionApproval ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await boardsApi.update(board.id, {
        name: name.trim() || board.name,
        maxConcurrentTickets: maxConcurrent,
        standupTurnMode: turnMode,
        standupTurnSeconds: turnSeconds,
        hideDoneItems,
        requireExecutionApproval: requireApproval,
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ ...sectionPad, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
      <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {t('boardNameLabel')}
        <input style={{ ...inputStyle, width: '100%', marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {/* Autonomy is implicit now: a lane with agents + an auto gate advances on
          its own; a human gate waits. There is no board-level autonomous toggle. */}
      <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {t('maxConcurrent')}
        <input type="number" min={1} style={{ ...inputStyle, width: 120, marginTop: 4 }} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} />
      </label>

      {/* Hide tickets sitting in a terminal (Done) lane so the board shows only
          live work. Display-only — the tickets and their history are untouched. */}
      <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={hideDoneItems} onChange={(e) => setHideDoneItems(e.target.checked)} />
        {t('hideDoneItems')}
      </label>

      {/* Governance: whether HIGH/URGENT tickets must clear a manager-approval
          request before an agent runs them. Manager-gated (disabled, not hidden,
          for non-managers) — the same control the board banner points to when it
          blocks a run. Off = the override: high/urgent work runs without approval. */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          {t('approvalHeading')}
        </div>
        <RoleGate capability="board.manageApproval" variant="block">
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              {t('approvalToggle')}
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {requireApproval ? t('approvalOnHint') : t('approvalOffHint')}
              </span>
            </span>
          </label>
        </RoleGate>
      </div>

      {/* Standup turn timer — drives the ceremony round-table's "who's next". */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{t('standupTimer')}</div>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block' }}>
          {t('mode')}
          <Select
            style={{ ...inputStyle, width: '100%', marginTop: 4 }}
            value={turnMode}
            onChange={(e) => setTurnMode(e.target.value as 'facilitator' | 'timeboxed')}
          >
            <option value="facilitator">{t('modeFacilitator')}</option>
            <option value="timeboxed">{t('modeTimeboxed')}</option>
          </Select>
        </label>
        {turnMode === 'timeboxed' && (
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginTop: 10 }}>
            {t('secondsPerPerson')}
            <input type="number" min={10} step={5} style={{ ...inputStyle, width: 120, marginTop: 4 }} value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value))} />
          </label>
        )}
      </div>

      <div>
        <button type="button" style={btnPrimary} disabled={saving} onClick={save}>{saving ? t('saving') : t('saveSettings')}</button>
      </div>
    </div>
  );
}
