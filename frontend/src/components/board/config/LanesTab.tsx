'use client';

/**
 * SWIMLANES — the board's columns, and the agents that act on each one.
 *
 * The lanes tab is the panel's largest single concern by a wide margin, and it is
 * three nested questions rather than one: what the lanes ARE (order, name, WIP),
 * what each lane DOES on entry (`LaneActionRow`), and what a card must satisfy
 * before it may enter (`LaneRequirementsRow`). Each is its own file, so a change
 * to one is not a change to the tab.
 *
 * A lane has TWO names. `name` is the label on the column; `key` is the status
 * every ticket in it holds. Only the first used to be editable, because changing
 * the second would have stranded every resident ticket on a status no lane
 * defined and there was no way to even find them again. `tasks.swimlane_id`
 * (migration 1115) made the lane's residents a reference, so the server can carry
 * them — and the board's other lane-key pointers — through a rename; the editor
 * reports what moved. `OrphanedTicketsRow` handles the tickets already stranded.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import {
  boardsApi,
  workflowDefinitions,
  type Board,
  type LaneRenameResult,
  type Swimlane,
  type SwimlaneAgent,
  type WorkflowDefinitionSummary,
} from '@/lib/builderforceApi';
import { OrphanedTicketsRow } from './OrphanedTicketsRow';
import { LaneActionRow } from './LaneActionRow';
import { LaneRequirementsRow } from './LaneRequirementsRow';
import { LaneAgentList } from './LaneAgentList';
import { btnPrimary, btnSubtle, inputStyle, sectionPad } from './configStyles';

export function LanesTab({ board, lanes, agentsByLane, reload }: {
  board: Board; lanes: Swimlane[]; agentsByLane: Record<string, SwimlaneAgent[]>; reload: () => void;
}) {
  const t = useTranslations('boardConfig');
  const confirm = useConfirm();
  const [laneName, setLaneName] = useState('');
  const [adding, setAdding] = useState(false);
  /** Per-lane merge target for the delete-as-merge flow, keyed by lane id. */
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  /** What the last rename moved, and what a rejected one said — keyed by lane id. */
  const [renamed, setRenamed] = useState<Record<string, LaneRenameResult>>({});
  const [keyError, setKeyError] = useState<Record<string, string>>({});
  // Workflow definitions are the targets for a lane's "Run workflow" action.
  // Loaded once for the whole tab (not per lane) to avoid an N+1.
  const [workflows, setWorkflows] = useState<WorkflowDefinitionSummary[]>([]);
  useEffect(() => {
    let live = true;
    workflowDefinitions.list().then((w) => { if (live) setWorkflows(w); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // The KEY is minted server-side from the name. It used to be derived here from
  // whatever lane list the browser happened to be holding, which is a uniqueness
  // check against a stale snapshot — two people adding a column at once, or one
  // person adding a second before a reload, both land on the same key and hit
  // UNIQUE(board_id, key) as a 500. The server's check and its insert see the
  // same rows, and there is one implementation of what a lane key looks like.
  const addLane = async () => {
    const name = laneName.trim();
    if (!name) return;
    await boardsApi.swimlanes.create(board.id, { name, position: lanes.length });
    setLaneName(''); setAdding(false); reload();
  };
  /**
   * Delete a lane = MERGE it. The tickets sitting in it have to go somewhere, and until
   * the operator could choose, the server's fallback policy silently decided — so
   * folding `Ready` into `To Do` could send its tickets to a third lane entirely. The
   * merge target is chosen here and passed through; leaving it blank keeps the policy.
   */
  const removeLane = async (id: string) => {
    const survivors = lanes.filter((l) => l.id !== id);
    if (!(await confirm(t('confirmDeleteLane')))) return;
    await boardsApi.swimlanes.remove(board.id, id, mergeTarget[id] ?? survivors[0]?.key ?? null);
    setMergeTarget((m) => { const next = { ...m }; delete next[id]; return next; });
    reload();
  };
  const patchLane = async (id: string, body: Record<string, unknown>) => { await boardsApi.swimlanes.patch(board.id, id, body); reload(); };
  /**
   * Rename the lane's KEY — the status its tickets hold. The server normalises the
   * input, refuses a collision with a sibling column, and moves every resident
   * ticket plus the board's other lane-key pointers in one operation; what it
   * moved is reported back so the operator is not left guessing what a rename did.
   */
  const renameKey = async (lane: Swimlane, requested: string) => {
    setKeyError((e) => { const next = { ...e }; delete next[lane.id]; return next; });
    try {
      const updated = await boardsApi.swimlanes.patch(board.id, lane.id, { key: requested });
      if (updated.renamed) setRenamed((r) => ({ ...r, [lane.id]: updated.renamed! }));
      reload();
    } catch (e) {
      setKeyError((prev) => ({ ...prev, [lane.id]: e instanceof Error ? e.message : t('errRenameKey') }));
    }
  };
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
    // EVERY control below WRITES, and a lane edit re-files every ticket in the lane,
    // so the whole tab is gated on `board.manageLanes` — the capability the API's
    // requireRole(DEVELOPER) on the swimlane routes mirrors. Dimmed, never hidden:
    // a read-only member still sees how the board is configured and who to ask.
    <RoleGate capability="board.manageLanes" variant="block" style={sectionPad}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t('lanesIntro')}
      </div>
      <OrphanedTicketsRow board={board} lanes={lanes} reload={reload} />
      {lanes.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noLanes')}</div>}
      {lanes.map((lane, index) => (
        <div key={lane.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 14, marginBottom: 12 }}>
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
            {/* The KEY, beside the name it belongs to. Monospace because it is a
                token a person types into filters, automations and the API — not a
                label — and rendering it like prose is how it gets mistaken for one. */}
            <input
              style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)', width: 150, minWidth: 110 }}
              defaultValue={lane.key}
              title={t('laneKeyTitle')}
              aria-label={t('laneKey')}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== lane.key) renameKey(lane, v); }}
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
            {/* PARKED — off the delivery path. Not the same as terminal: a parked lane
                does not end the ticket, it steps it out of the flow. Excluded from the
                %-complete denominator (a blocked ticket used to read ~87% complete purely
                because `Blocked` sits late in the lane order) and never auto-advanced into. */}
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 4, alignItems: 'center' }} title={t('parkingTitle')}>
              <input type="checkbox" checked={lane.isParking ?? false} onChange={(e) => patchLane(lane.id, { isParking: e.target.checked })} /> {t('parking')}
            </label>
            {/* The merge target, next to the button that needs it. */}
            {lanes.length > 1 && (
              <Select
                value={mergeTarget[lane.id] ?? ''}
                onChange={(e) => setMergeTarget((m) => ({ ...m, [lane.id]: e.target.value }))}
                style={{ ...inputStyle, minWidth: 130 }}
                title={t('mergeIntoTitle')}
                aria-label={t('mergeInto')}
              >
                <option value="">{t('mergeIntoAuto')}</option>
                {lanes.filter((l) => l.id !== lane.id).map((l) => <option key={l.id} value={l.key}>{l.name}</option>)}
              </Select>
            )}
            <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} onClick={() => removeLane(lane.id)}>{t('delete')}</button>
          </div>
          {/* A RENAME MOVED OTHER PEOPLE'S DATA — every resident ticket's status, and
              the board's other pointers at this key. Say what it touched rather than
              leaving the operator to open the board and count. */}
          {keyError[lane.id] && (
            <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{keyError[lane.id]}</div>
          )}
          {renamed[lane.id] && !keyError[lane.id] && (
            <div role="status" style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('laneKeyRenamed', { count: renamed[lane.id]!.movedTasks, key: renamed[lane.id]!.key })}
            </div>
          )}
          {/* AN UNSTAFFED AUTO-GATED LANE IS A MISCONFIGURATION, and it must LOOK like
              one. Measured: only 3 of 61 auto-gated lanes carried any agent assignment,
              so autonomy fell through to the ticket's owner — and 466 of 821 tickets
              (57%) had zero runs and zero autonomous hops as a result. The board looked
              configured. Terminal and parked lanes are excluded: neither has work to do. */}
          {!lane.isTerminal && !lane.isParking && lane.gate === 'auto' && (agentsByLane[lane.id] ?? []).length === 0 && (
            <div
              role="status"
              style={{
                marginTop: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--warning-border)', background: 'var(--warning-bg)',
                color: 'var(--warning-text)', fontSize: 12,
              }}
            >
              {t('laneUnstaffed')}
            </div>
          )}
          <LaneActionRow lane={lane} lanes={lanes} workflows={workflows} patchLane={patchLane} />
          <LaneAgentList board={board} lane={lane} agents={agentsByLane[lane.id] ?? []} reload={reload} />
          <LaneRequirementsRow board={board} lane={lane} patchLane={patchLane} />
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
    </RoleGate>
  );
}

/** Per-lane "when the stage's agents finish, do X (if quorum Y is met)" editor. */
