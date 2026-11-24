import { Fragment, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRunSnapshot, type BrainRunSnapshot } from '@seanhogg/builderforce-brain-embedded';
import { manifestAgentDeclarationRows, manifestAgents, type ManifestAgent } from '@/lib/canvas/manifestAgents';
import { ATTENTION_STATES, agentRunKey, agentStateFromSnapshot, type AgentRunState } from '@/lib/canvas/agentRunState';
import { runAgentControl, type AgentRunControl } from '@/lib/canvas/agentRunControl';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { useCanvasBoardBridge } from '../canvasBoardBridge';
import { useCanvasPhase } from '../phase/CanvasPhaseContext';
import { AcademicFace } from './academic/AcademicFace';
import type { RoomStationModel, RoomStationView } from './types';
import styles from './roomStations.module.css';
import agentStyles from './agentStation.module.css';

/**
 * AN AGENT IN THE ROOM (W12 phase 5) — one stand per agent the session app's manifest
 * declares, showing what its run is doing NOW.
 *
 * The state is read off the agent's run cell (`useRunSnapshot`) through the one pure
 * mapping (`agentStateFromSnapshot`), never off an animation: a stand that looks busy is
 * a run that is busy. Steer and cancel go through the canvas's existing MCP tool-call
 * client (`runAgentControl`); talking ABOUT the agent goes through the canvas's ONE turn
 * door (`askBrain`), so there is never a second composer in the room.
 */

/** The panel's run controls, as data — one button each. */
const CONTROLS: ReadonlyArray<{ id: AgentRunControl; className: string; needsMessage: boolean }> = [
  { id: 'steer', className: styles.primary, needsMessage: true },
  { id: 'cancel', className: styles.quiet, needsMessage: false },
];

/** A run in one of these has nothing left to cancel. */
const SETTLED_STATES: ReadonlySet<AgentRunState> = new Set<AgentRunState>(['idle', 'failed']);

/** How many settled steps the history lists, newest first. */
const HISTORY_ROWS = 6;

interface AgentReading {
  agent: ManifestAgent;
  snapshot: BrainRunSnapshot;
  state: AgentRunState;
}

function useAgent(instance: RoomStationInstance): AgentReading | null {
  const board = useCanvasBoardBridge();
  const objects = board?.objects ?? null;
  const agentId = instance.resourceId ?? '';
  const agent = useMemo(() => (objects ? manifestAgents(objects).find((candidate) => candidate.id === agentId) ?? null : null), [objects, agentId]);
  const snapshot = useRunSnapshot(board && agent ? agentRunKey(board.sessionId, agent.id) : null);
  const state = useMemo(() => agentStateFromSnapshot(snapshot), [snapshot]);
  return board && agent ? { agent, snapshot, state } : null;
}

function useAgentModel(instance: RoomStationInstance): RoomStationModel | null {
  const t = useTranslations('roomAgents');
  const reading = useAgent(instance);
  if (!reading) return null;
  const { agent, state } = reading;
  const role = agent.role ?? agent.workload ?? t('noRole');
  const stateLabel = t(`state.${state}` as 'state.idle');
  return {
    title: agent.id,
    summary: t('summary', { role, state: stateLabel }),
    face: <AcademicFace figure={stateLabel} headline={role} lines={agent.tools.slice(0, 3)} tone={ATTENTION_STATES.has(state) ? 'attention' : 'calm'} />,
  };
}

function AgentPanel({ instance }: { instance: RoomStationInstance }) {
  const t = useTranslations('roomAgents');
  const reading = useAgent(instance);
  const askBrain = useCanvasPhase()?.askBrain;
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<{ tone: 'done' | 'refused'; text: string } | null>(null);
  if (!reading) return null;
  const { agent, snapshot, state } = reading;
  const role = agent.role ?? agent.workload ?? t('noRole');
  const history = snapshot.trace.slice(-HISTORY_ROWS).reverse();

  const run = async (control: AgentRunControl) => {
    try {
      await runAgentControl(control, { agentId: agent.id, runId: snapshot.turn?.id ?? null, message });
      setStatus({ tone: 'done', text: t(`done.${control}` as 'done.steer') });
      if (control === 'steer') setMessage('');
    } catch {
      setStatus({ tone: 'refused', text: t('unreachable') });
    }
  };
  const disabled = (control: (typeof CONTROLS)[number]) => (control.needsMessage ? !message.trim() : SETTLED_STATES.has(state));

  return (
    <div className={`${styles.panel} ${styles.canvasTokens}`} data-testid="agent-station-panel" data-state={state}>
      <p className={styles.insight} data-attention={ATTENTION_STATES.has(state)} data-testid="agent-station-status">
        {t('status', { state: t(`state.${state}` as 'state.idle') })}
      </p>

      <h3 className={agentStyles.heading}>{t('declaration')}</h3>
      <dl className={agentStyles.declaration}>
        {manifestAgentDeclarationRows(agent, t('noRole')).map(([field, value]) => (
          <Fragment key={field}>
            <dt>{t(`field.${field}` as 'field.role')}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>

      <h3 className={agentStyles.heading}>{t('tools')}</h3>
      {agent.tools.length ? (
        <ul className={styles.rows}>
          {agent.tools.map((tool) => <li key={tool} className={styles.row}><span className={styles.rowName}><strong>{tool}</strong></span></li>)}
        </ul>
      ) : <p className={styles.empty}>{t('noTools')}</p>}

      <h3 className={agentStyles.heading}>{t('history')}</h3>
      {history.length ? (
        <ul className={styles.rows} data-testid="agent-station-history">
          {history.map((row, index) => (
            <li key={`${row.ts}-${index}`} className={styles.row}>
              <span className={styles.rowName}>
                <strong>{row.label}</strong>
                <small>{row.isError ? t('stepFailed') : t(`category.${row.category}` as 'category.tool')}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className={styles.empty}>{t('noHistory')}</p>}

      <label className={agentStyles.field}>
        {t('steerLabel')}
        <textarea value={message} placeholder={t('steerPlaceholder')} onChange={(event) => setMessage(event.target.value)} />
      </label>
      <div className={styles.actions}>
        {CONTROLS.map((control) => (
          <button key={control.id} type="button" className={control.className} disabled={disabled(control)} onClick={() => void run(control.id)}>
            {t(`control.${control.id}` as 'control.steer')}
          </button>
        ))}
        {askBrain && (
          <button type="button" className={styles.secondary} onClick={() => askBrain(t('chatPrompt', { name: agent.id, role }))}>
            {t('chat')}
          </button>
        )}
      </div>
      <p className={styles.live} role="status" aria-live="polite" data-tone={status?.tone}>{status?.text ?? ''}</p>
    </div>
  );
}

export const agentStationView: RoomStationView = { useModel: (instance) => useAgentModel(instance), Panel: AgentPanel };
