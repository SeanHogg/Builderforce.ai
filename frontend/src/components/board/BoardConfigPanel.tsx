'use client';

import { useEffect, useState } from 'react';
import { SlideOutPanel } from '../SlideOutPanel';
import { BoardConnectionsManager } from '../integrations/BoardConnectionsManager';
import { useBoardConfig } from './useBoardConfig';
import {
  boardsApi,
  agentHosts,
  type Board,
  type Swimlane,
  type SwimlaneAgent,
  type AgentHost,
} from '@/lib/builderforceApi';

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

type ConfigTab = 'lanes' | 'settings' | 'external';

export interface BoardConfigPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  projectName?: string;
}

export function BoardConfigPanel({ open, onClose, projectId, projectName }: BoardConfigPanelProps) {
  const [tab, setTab] = useState<ConfigTab>('lanes');
  const { board, lanes, agentsByLane, loading, error, reload } = useBoardConfig(projectId, open);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // The cog is only reachable when a project board is selected, so a board is
  // expected to exist. If none does yet, provision it (with default swimlanes
  // mirroring the kanban columns) automatically rather than dead-ending on a
  // "no board exists" prompt that contradicts being on the board. The
  // provisionError guard stops this from retrying in a loop if creation fails.
  useEffect(() => {
    if (!open) { setProvisionError(null); return; }
    if (loading || error || board || provisioning || provisionError) return;
    setProvisioning(true);
    boardsApi
      .create({ projectId, name: `${projectName ?? 'Project'} board` })
      .then(() => reload())
      .catch((e) => setProvisionError(e instanceof Error ? e.message : 'Could not create board'))
      .finally(() => setProvisioning(false));
  }, [open, loading, error, board, provisioning, provisionError, projectId, projectName, reload]);

  const shownError = error ?? provisionError;

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title="Board configuration"
      width="min(720px, 96vw)"
      tabs={[
        { id: 'lanes', label: 'Swimlanes & agents' },
        { id: 'settings', label: 'Board settings' },
        { id: 'external', label: 'External boards' },
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
              {provisioning || !board ? 'Setting up this board…' : 'Loading…'}
            </span>
          )}
        </div>
      ) : shownError ? (
        <div style={sectionPad}><span style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{shownError}</span></div>
      ) : tab === 'lanes' ? (
        <LanesTab board={board} lanes={lanes} agentsByLane={agentsByLane} reload={reload} />
      ) : tab === 'settings' ? (
        <SettingsTab board={board} onSaved={reload} />
      ) : (
        <div style={sectionPad}>
          <BoardConnectionsManager projectId={projectId} heading="External boards feeding this board" />
        </div>
      )}
    </SlideOutPanel>
  );
}

// ---------------------------------------------------------------------------

function LanesTab({ board, lanes, agentsByLane, reload }: {
  board: Board; lanes: Swimlane[]; agentsByLane: Record<string, SwimlaneAgent[]>; reload: () => void;
}) {
  const [laneName, setLaneName] = useState('');
  const [adding, setAdding] = useState(false);

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
  const removeLane = async (id: string) => { if (confirm('Delete this swimlane?')) { await boardsApi.swimlanes.remove(board.id, id); reload(); } };
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
        Swimlanes are the columns of this project&apos;s task board. Add, rename, reorder, or assign agents and the
        board updates to match.
      </div>
      {lanes.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No swimlanes yet.</div>}
      {lanes.map((lane, index) => (
        <div key={lane.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <button type="button" style={{ ...btnSubtle, padding: '0 6px', lineHeight: 1.2 }} disabled={index === 0} title="Move left" onClick={() => moveLane(index, -1)}>▲</button>
              <button type="button" style={{ ...btnSubtle, padding: '0 6px', lineHeight: 1.2 }} disabled={index === lanes.length - 1} title="Move right" onClick={() => moveLane(index, 1)}>▼</button>
            </div>
            <input
              style={{ ...inputStyle, fontWeight: 600, fontSize: 14, flex: 1, minWidth: 140 }}
              defaultValue={lane.name}
              title="Swimlane name (shown as the board column header)"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== lane.name) patchLane(lane.id, { name: v }); }}
            />
            <select value={lane.gate} onChange={(e) => patchLane(lane.id, { gate: e.target.value })} style={inputStyle} title="Gate">
              <option value="auto">auto</option>
              <option value="human">human gate</option>
            </select>
            <select value={lane.executionMode} onChange={(e) => patchLane(lane.id, { executionMode: e.target.value })} style={inputStyle} title="Execution">
              <option value="sequential">sequential</option>
              <option value="parallel">parallel</option>
            </select>
            <select value={lane.failurePolicy} onChange={(e) => patchLane(lane.id, { failurePolicy: e.target.value })} style={inputStyle} title="On failure">
              <option value="needs_attention">needs attention</option>
              <option value="retry">retry</option>
              <option value="skip">skip</option>
            </select>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={lane.isTerminal} onChange={(e) => patchLane(lane.id, { isTerminal: e.target.checked })} /> terminal
            </label>
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => removeLane(lane.id)}>Delete</button>
          </div>
          <AgentList board={board} lane={lane} agents={agentsByLane[lane.id] ?? []} reload={reload} />
        </div>
      ))}

      {adding ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, flex: 1, minWidth: 140 }} placeholder="Column name (e.g. Design, In Review, QA)" value={laneName} onChange={(e) => setLaneName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addLane(); }} />
          <button type="button" style={btnPrimary} onClick={addLane}>Add</button>
          <button type="button" style={btnSubtle} onClick={() => { setAdding(false); setLaneName(''); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" style={btnPrimary} onClick={() => setAdding(true)}>Add swimlane</button>
      )}
    </div>
  );
}

function AgentList({ board, lane, agents, reload }: { board: Board; lane: Swimlane; agents: SwimlaneAgent[]; reload: () => void }) {
  const [role, setRole] = useState('');
  const [runtime, setRuntime] = useState('cloud');
  const [model, setModel] = useState('');
  const [target, setTarget] = useState(''); // '' = tenant default agentHost
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [adding, setAdding] = useState(false);

  // A non-browser runtime routes to a deployed agentHost (claw); load the fleet
  // so the user can pick which one. Blank target falls back to the tenant default.
  useEffect(() => {
    if (!adding) return;
    let live = true;
    agentHosts.list().then((h) => { if (live) setHosts(h); }).catch(() => {});
    return () => { live = false; };
  }, [adding]);

  const needsTarget = runtime !== 'browser';
  const hostName = (id: string | null) => hosts.find((h) => String(h.id) === id)?.name ?? `#${id}`;

  const add = async () => {
    if (!role.trim()) return;
    await boardsApi.agents.create(board.id, lane.id, {
      role: role.trim(),
      runtime,
      model: model.trim() || null,
      target: needsTarget ? (target || null) : null,
      position: agents.length,
    });
    setRole(''); setRuntime('cloud'); setModel(''); setTarget(''); setAdding(false); reload();
  };
  const remove = async (id: string) => { await boardsApi.agents.remove(board.id, lane.id, id); reload(); };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Autonomous agents</div>
      {agents.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No agents assigned to this lane.</div>}
      {agents.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
          <span style={{ fontWeight: 600 }}>{a.role}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {a.runtime}
            {a.runtime !== 'browser' && ` · ${a.target ? hostName(a.target) : 'default agentHost'}`}
            {a.model ? ` · ${a.model}` : ' · default LLM'}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...btnSubtle, color: 'var(--danger, #dc2626)' }} onClick={() => remove(a.id)}>Remove</button>
        </div>
      ))}
      {adding ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} placeholder="role (e.g. implementer)" value={role} onChange={(e) => setRole(e.target.value)} />
          <select value={runtime} onChange={(e) => setRuntime(e.target.value)} style={inputStyle}>
            <option value="cloud">cloud</option>
            <option value="browser">browser</option>
            <option value="local">local</option>
            <option value="remote">remote</option>
          </select>
          {needsTarget && (
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={inputStyle} aria-label="Target agentHost">
              <option value="">default agentHost</option>
              {hosts.map((h) => (
                <option key={h.id} value={String(h.id)}>
                  {h.name}{h.online ? ' (online)' : ' (offline)'}
                </option>
              ))}
            </select>
          )}
          <input style={{ ...inputStyle, width: 160 }} placeholder="model (blank = default)" value={model} onChange={(e) => setModel(e.target.value)} />
          <button type="button" style={btnPrimary} onClick={add}>Add</button>
          <button type="button" style={btnSubtle} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" style={{ ...btnSubtle, marginTop: 8 }} onClick={() => setAdding(true)}>+ Assign agent</button>
      )}
    </div>
  );
}

function SettingsTab({ board, onSaved }: { board: Board; onSaved: () => void }) {
  const [autonomous, setAutonomous] = useState(board.autonomous);
  const [maxConcurrent, setMaxConcurrent] = useState(board.maxConcurrentTickets);
  const [name, setName] = useState(board.name);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await boardsApi.update(board.id, { name: name.trim() || board.name, autonomous, maxConcurrentTickets: maxConcurrent });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ ...sectionPad, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
      <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Board name
        <input style={{ ...inputStyle, width: '100%', marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} />
        Autonomous — tickets advance through lanes automatically as agents finish
      </label>
      <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Max concurrent tickets
        <input type="number" min={1} style={{ ...inputStyle, width: 120, marginTop: 4 }} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} />
      </label>
      <div>
        <button type="button" style={btnPrimary} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>
    </div>
  );
}
