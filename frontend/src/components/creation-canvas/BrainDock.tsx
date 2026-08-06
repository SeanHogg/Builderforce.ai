'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Avatar, BrainTimeline } from '@seanhogg/builderforce-brain-ui';
import '@seanhogg/builderforce-brain-ui/styles.css';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import type { Edge } from '@xyflow/react';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition } from './creationObjectRegistry';
import type { CreationFlowNode } from './CreationNode';
import {
  brainActivityPhase,
  brainActivityTokens,
  brainRunSummary,
  formatElapsed,
  formatTokenCount,
  type BrainRunSummary,
} from './brainActivity';
import {
  BRAIN_DOCK_MAX_WIDTH,
  BRAIN_DOCK_MIN_WIDTH,
  clampBrainDockWidth,
  type BrainDockMode,
  type BrainDockSide,
  type BrainDockSize,
} from './brainDockPreferences';

/**
 * BrainDock — the ONE Brain surface on the Canvas.
 *
 * The Canvas used to show a transcript inside the Brain Object, a second transcript
 * in the details panel, and a floating prompt at the bottom; people could not tell
 * which one they were talking to. The conversation, what Brain is doing right now,
 * what the turn cost, and its connected work all live here.
 *
 * It takes three placements: floating ON the canvas (small, claims no board width),
 * or docked full-height to the left or the right edge. Either one is dragged to any
 * width. The prompt is NOT in here — it stays in the centre of the page where every
 * chat product people already use puts it.
 */

/** How far one arrow-key press resizes the surface. */
const RESIZE_STEP = 24;

export interface BrainDockProps {
  mode: BrainDockMode;
  side: BrainDockSide;
  size: BrainDockSize;
  /** Current rendered width in px, preset or dragged. */
  width: number;
  /** When false the transcript narrates progress only and hides the step list. */
  showExecutionDetail: boolean;
  onModeChange: (mode: BrainDockMode) => void;
  onSideChange: (side: BrainDockSide) => void;
  onSizeChange: (size: BrainDockSize) => void;
  /** commit=false during a drag (live reflow only); true when the user settles. */
  onWidthChange: (width: number, commit: boolean) => void;
  onExecutionDetailChange: (show: boolean) => void;
  onClose: () => void;
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  running: boolean;
  /** The Brain Object this dock is bound to, when the canvas has one yet. */
  node: CreationFlowNode | null;
  nodes: CreationFlowNode[];
  edges: Edge[];
  collaborators?: Array<{ userId: string; displayName: string | null; typing?: boolean }>;
  joinedCollaborator?: { userId: string; displayName: string | null } | null;
}

export function BrainDock({
  mode, side, size, width, showExecutionDetail,
  onModeChange, onSideChange, onSizeChange, onWidthChange, onExecutionDetailChange, onClose,
  messages, trace, running, node, nodes, edges, collaborators = [], joinedCollaborator = null,
}: BrainDockProps) {
  const t = useTranslations('creationCanvas');
  const [tab, setTab] = useState<'chat' | 'context'>('chat');
  const expanded = size === 'expanded';
  const floating = mode === 'floating';
  const typingCollaborators = collaborators.filter((member) => member.typing);
  const showPresence = joinedCollaborator != null || typingCollaborators.length > 0;

  // Dragging the inner edge. The delta is inverted for a right-hand surface, where
  // pulling left makes it wider. Only the settled width is persisted, so a drag
  // does not write localStorage (or a preference signal) on every pointer move.
  const drag = useRef<{ pointerX: number; width: number } | null>(null);
  const startResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerX: event.clientX, width };
  }, [width]);
  const moveResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const delta = event.clientX - active.pointerX;
    onWidthChange(clampBrainDockWidth(active.width + (side === 'left' ? delta : -delta)), false);
  }, [onWidthChange, side]);
  const endResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onWidthChange(width, true);
  }, [onWidthChange, width]);
  const keyResize = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const towardsBoard = event.key === (side === 'left' ? 'ArrowLeft' : 'ArrowRight');
    const awayFromBoard = event.key === (side === 'left' ? 'ArrowRight' : 'ArrowLeft');
    if (!towardsBoard && !awayFromBoard) return;
    event.preventDefault();
    onWidthChange(clampBrainDockWidth(width + (awayFromBoard ? RESIZE_STEP : -RESIZE_STEP)), true);
  }, [onWidthChange, side, width]);

  return (
    <aside
      className={styles.brainDock}
      data-mode={mode}
      data-side={side}
      data-size={size}
      style={{ '--brain-dock-size': `${width}px` } as CSSProperties}
      aria-label={t('brainDock')}
    >
      <header className={styles.brainDockHeader}>
        <span className={styles.brainDockMark} aria-hidden>✦</span>
        <strong>{t('brain')}</strong>
        <div className={styles.brainDockActions}>
          <button
            type="button"
            aria-pressed={showExecutionDetail}
            aria-label={showExecutionDetail ? t('hideExecutionSteps') : t('showExecutionSteps')}
            title={showExecutionDetail ? t('hideExecutionSteps') : t('showExecutionSteps')}
            onClick={() => onExecutionDetailChange(!showExecutionDetail)}
          >⋮⋮</button>
          <button
            type="button"
            aria-pressed={floating}
            aria-label={floating ? t('dockBrainToEdge') : t('floatBrainOnCanvas')}
            title={floating ? t('dockBrainToEdge') : t('floatBrainOnCanvas')}
            onClick={() => onModeChange(floating ? 'docked' : 'floating')}
          >{floating ? '▤' : '▣'}</button>
          {/* data-dock-side, not the label, is what the stylesheet hides on a phone:
              a selector keyed on English copy would stop matching in every other locale. */}
          <button
            type="button"
            data-dock-side="left"
            aria-pressed={side === 'left'}
            aria-label={t('dockBrainLeft')}
            title={t('dockBrainLeft')}
            onClick={() => onSideChange('left')}
          >⇤</button>
          <button
            type="button"
            data-dock-side="right"
            aria-pressed={side === 'right'}
            aria-label={t('dockBrainRight')}
            title={t('dockBrainRight')}
            onClick={() => onSideChange('right')}
          >⇥</button>
          <button
            type="button"
            aria-pressed={expanded}
            aria-label={expanded ? t('slimBrain') : t('expandBrain')}
            title={expanded ? t('slimBrain') : t('expandBrain')}
            onClick={() => onSizeChange(expanded ? 'slim' : 'expanded')}
          >{expanded ? '⤡' : '⤢'}</button>
          <button type="button" aria-label={t('closeBrain')} title={t('closeBrain')} onClick={onClose}>×</button>
        </div>
      </header>
      <div
        className={styles.brainDockResizer}
        data-side={side}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resizeBrain')}
        aria-valuenow={width}
        aria-valuemin={BRAIN_DOCK_MIN_WIDTH}
        aria-valuemax={BRAIN_DOCK_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={keyResize}
      />
      <div className={styles.brainDockTabs} role="tablist" aria-label={t('brainDock')}>
        <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? styles.activeTab : ''} onClick={() => setTab('chat')}>{t('chat')}</button>
        <button type="button" role="tab" aria-selected={tab === 'context'} className={tab === 'context' ? styles.activeTab : ''} onClick={() => setTab('context')}>{t('context')}</button>
      </div>
      {showPresence && <div className={styles.humanChatActivity} aria-live="polite">
        {joinedCollaborator && <span data-state="joined">
          <Avatar name={joinedCollaborator.displayName || t('collaborator')} kind="human" size={22} />
          <b>{t('collaboratorJoined', { name: joinedCollaborator.displayName || t('collaborator') })}</b>
        </span>}
        {typingCollaborators.map((member) => <span key={member.userId} data-state="typing">
          <Avatar name={member.displayName || t('collaborator')} kind="human" size={22} />
          <b>{t('collaboratorWriting', { name: member.displayName || t('collaborator') })}</b>
          <i aria-hidden>•••</i>
        </span>)}
      </div>}
      {tab === 'chat'
        ? <div className={styles.brainDockTimeline} role="log" aria-label={t('brainChatHistory')} tabIndex={0}>
          <BrainTimeline
            messages={messages}
            trace={showExecutionDetail ? trace : []}
            streamingText=""
            isRunning={running}
            assistantName={t('brain')}
            labels={{ you: t('you'), assistant: t('brain'), empty: t('brainEmpty') }}
          />
        </div>
        : <div className={styles.brainDockContext}>
          <BrainContextPanel node={node} nodes={nodes} edges={edges} />
        </div>}
      <BrainActivityStrip running={running} trace={trace} />
    </aside>
  );
}

/**
 * The live "what is it doing" strip: an animated mark, the current phase word, the
 * tool it is running, and the tokens spent so far — then, once the turn settles, a
 * receipt of how long it took and what it cost. This is the feedback people asked
 * for INSTEAD of a wall of steps; the step list stays behind the toggle above.
 */
export function BrainActivityStrip({ running, trace }: { running: boolean; trace: BrainTraceEvent[] }) {
  const t = useTranslations('creationCanvas');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [summary, setSummary] = useState<BrainRunSummary | null>(null);
  const startedAt = useRef(0);
  const elapsedRef = useRef(0);
  const traceRef = useRef<BrainTraceEvent[]>(trace);
  traceRef.current = trace;

  useEffect(() => {
    if (!running) {
      // Settle the receipt from the run that just ended rather than clearing it:
      // "Thought for 52s" is the answer to "did that actually do anything?".
      if (elapsedRef.current > 0) setSummary(brainRunSummary(traceRef.current, elapsedRef.current));
      elapsedRef.current = 0;
      setElapsedMs(0);
      return;
    }
    setSummary(null);
    startedAt.current = Date.now();
    elapsedRef.current = 0;
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      elapsedRef.current = Date.now() - startedAt.current;
      setElapsedMs(elapsedRef.current);
    }, 400);
    return () => window.clearInterval(timer);
  }, [running]);

  if (running) {
    const phase = brainActivityPhase(trace, elapsedMs);
    const tokens = brainActivityTokens(trace);
    return (
      <div className={styles.brainActivity} role="status" aria-live="polite" data-state="running">
        <span className={styles.brainActivitySpark} aria-hidden>✳</span>
        <b>{t(`brainPhase.${phase.id}`)}</b>
        {phase.detail && <small>{phase.detail}</small>}
        <em>{tokens > 0 ? t('tokensSpent', { count: formatTokenCount(tokens) }) : formatElapsed(elapsedMs)}</em>
      </div>
    );
  }

  if (!summary) return null;
  return (
    <div className={styles.brainActivity} role="status" data-state="settled">
      <span className={styles.brainActivitySpark} aria-hidden>✓</span>
      <b>{t('thoughtFor', { duration: formatElapsed(summary.durationMs) })}</b>
      {summary.toolCount > 0 && <small>{t('ranActions', { count: summary.toolCount })}</small>}
      {summary.tokens > 0 && <em>{t('tokensSpent', { count: formatTokenCount(summary.tokens) })}</em>}
    </div>
  );
}

/**
 * What this conversation is wired to — the agents contributing, the tickets it
 * created or opened, and every other connected Object. Previously duplicated in the
 * details panel; it belongs beside the conversation it describes.
 */
export function BrainContextPanel({ node, nodes, edges }: { node: CreationFlowNode | null; nodes: CreationFlowNode[]; edges: Edge[] }) {
  const t = useTranslations('creationCanvas');
  if (!node) return <p className={styles.brainEmpty}>{t('brainContextEmpty')}</p>;
  const connectedIds = new Set(edges.flatMap((edge) => edge.source === node.id ? [edge.target] : edge.target === node.id ? [edge.source] : []));
  const connected = nodes.filter((candidate) => candidate.id !== node.id && connectedIds.has(candidate.id));
  const agents = connected.filter((candidate) => candidate.data.kind === 'agent');
  const tickets = connected.filter((candidate) => candidate.data.kind === 'task');
  const related = connected.filter((candidate) => candidate.data.kind !== 'agent' && candidate.data.kind !== 'task');
  const canonicalChatId = node.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
  const connectedProjectId = connected.find((candidate) => candidate.data.kind === 'project')?.data.resourceId?.match(/^project:(\d+)$/)?.[1];

  if (canonicalChatId) return <section aria-label={t('brainContext')} className={styles.brainCanonicalAssociations}>
    <ChatTicketsPanel chatId={Number(canonicalChatId)} projectId={connectedProjectId ? Number(connectedProjectId) : null} chatList={[{ id: Number(canonicalChatId), title: node.data.title }]} />
  </section>;

  const roster = (items: CreationFlowNode[], empty: string) => items.length
    ? <div className={styles.brainAssociationList}>{items.map((item) => <div key={item.id}>
      <span aria-hidden>{creationObjectDefinition(item.data.kind).icon}</span>
      <p><b>{item.data.title}</b><small>{item.data.status || creationObjectDefinition(item.data.kind).label}</small></p>
    </div>)}</div>
    : <p className={styles.brainEmpty}>{empty}</p>;

  return <div className={styles.brainDetails}>
    <section aria-labelledby="brain-agents-heading"><div className={styles.brainSectionHeading}><h3 id="brain-agents-heading">{t('agents')}</h3><span>{agents.length}</span></div>{roster(agents, t('noAgentsAssociated'))}</section>
    <section aria-labelledby="brain-tickets-heading"><div className={styles.brainSectionHeading}><h3 id="brain-tickets-heading">{t('associatedTickets')}</h3><span>{tickets.length}</span></div>{roster(tickets, t('noTicketsAssociated'))}</section>
    <section aria-labelledby="brain-objects-heading"><div className={styles.brainSectionHeading}><h3 id="brain-objects-heading">{t('connectedObjects')}</h3><span>{related.length}</span></div>{roster(related, t('noObjectsConnected'))}</section>
  </div>;
}
