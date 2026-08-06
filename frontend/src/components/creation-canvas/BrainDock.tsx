'use client';

import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Avatar, BrainTimeline } from '@seanhogg/builderforce-brain-ui';
import '@seanhogg/builderforce-brain-ui/styles.css';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import type { Edge } from '@xyflow/react';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition } from './creationObjectRegistry';
import type { CreationFlowNode } from './CreationNode';
import { BrainActivityBar, brainActivityLine, useBrainActivity } from './BrainActivityView';
import type { BrainSurfaceCollaborator } from './brainSurfaceContext';
import {
  BRAIN_DOCK_MAX_WIDTH,
  BRAIN_DOCK_MIN_WIDTH,
  clampBrainDockWidth,
  type BrainDockMode,
  type BrainDockSide,
  type BrainDockSize,
} from './brainDockPreferences';

/**
 * The ONE Brain surface on the Canvas — this file owns both of its placements.
 *
 * The Canvas used to show a transcript inside the Brain Object, a second transcript
 * in the details panel, and a floating prompt at the bottom; people could not tell
 * which one they were talking to. The conversation, what Brain is doing right now,
 * what the turn cost, and its connected work were consolidated into one surface.
 *
 * That surface has two placements, and both render the SAME body:
 *   - docked  (`BrainDock`)  — a full-height panel on the left or right edge
 *   - inline  (the Brain Object on the graph, via `BrainSurfaceBody` in CreationNode)
 *
 * There is no small floating card any more. A card hovering over a board that
 * already carries a Brain Object put two live transcripts of one conversation on
 * screen at once — the very confusion this consolidation exists to remove. When the
 * surface is small it is now simply the Object, where Brain's connections already are.
 *
 * The prompt is NOT in here — it stays in the centre of the page where every chat
 * product people already use puts it.
 */

/** How far one arrow-key press resizes the surface. */
const RESIZE_STEP = 24;

/** The live conversation, identical wherever the surface is placed. */
export interface BrainSurfaceBodyProps {
  /** When false the transcript narrates progress only and hides the step list. */
  showExecutionDetail: boolean;
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  running: boolean;
  /** Epoch ms the in-flight turn began, so every surface narrates the same phase. */
  runStartedAt?: number | null;
  /** The Brain Object this surface is bound to, when the canvas has one yet. */
  node: CreationFlowNode | null;
  nodes: CreationFlowNode[];
  edges: Edge[];
  collaborators?: BrainSurfaceCollaborator[];
  joinedCollaborator?: BrainSurfaceCollaborator | null;
}

export interface BrainDockProps extends BrainSurfaceBodyProps {
  mode: BrainDockMode;
  side: BrainDockSide;
  size: BrainDockSize;
  /** Current rendered width in px, preset or dragged. */
  width: number;
  onModeChange: (mode: BrainDockMode) => void;
  onSideChange: (side: BrainDockSide) => void;
  onSizeChange: (size: BrainDockSize) => void;
  /** commit=false during a drag (live reflow only); true when the user settles. */
  onWidthChange: (width: number, commit: boolean) => void;
  onExecutionDetailChange: (show: boolean) => void;
  onClose: () => void;
}

/**
 * Tabs, presence, transcript, and the activity bar — everything below the title.
 * Shared verbatim by the edge dock and the Brain Object so the two placements can
 * never drift into two subtly different chats.
 */
export function BrainSurfaceBody({
  showExecutionDetail, messages, trace, running, runStartedAt = null,
  node, nodes, edges, collaborators = [], joinedCollaborator = null,
}: BrainSurfaceBodyProps) {
  const t = useTranslations('creationCanvas');
  const [tab, setTab] = useState<'chat' | 'context'>('chat');
  // Derived ONCE and shared: the transcript's live node and the footer strip are two
  // views of the same moment, so they must never narrate it in different words.
  const activity = useBrainActivity(running, trace, runStartedAt);
  const liveLine = brainActivityLine(activity.live);
  const timelineLabels = useMemo(() => ({
    you: t('you'),
    assistant: t('brain'),
    empty: t('brainEmpty'),
    thinking: liveLine ?? t('brainPhase.thinking'),
    thoughtFor: t('thoughtFor', { duration: '{duration}' }),
  }), [liveLine, t]);
  const typingCollaborators = collaborators.filter((member) => member.typing);
  const showPresence = joinedCollaborator != null || typingCollaborators.length > 0;

  return <>
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
          labels={timelineLabels}
        />
      </div>
      : <div className={styles.brainDockContext}>
        <BrainContextPanel node={node} nodes={nodes} edges={edges} />
      </div>}
    <BrainActivityBar state={activity} />
  </>;
}

export interface BrainSurfaceActionsProps {
  mode: BrainDockMode;
  showExecutionDetail: boolean;
  onModeChange: (mode: BrainDockMode) => void;
  onExecutionDetailChange: (show: boolean) => void;
  onClose: () => void;
  /** Edge-only placement controls; an inline surface is sized by its Object. */
  side?: BrainDockSide;
  size?: BrainDockSize;
  onSideChange?: (side: BrainDockSide) => void;
  onSizeChange?: (size: BrainDockSize) => void;
}

/**
 * The surface's controls. It decides for itself which of them apply: which edge and
 * how wide are meaningless for a surface that lives in an Object on the graph, where
 * the Object's own resize handles already do that job.
 */
export function BrainSurfaceActions({
  mode, showExecutionDetail, onModeChange, onExecutionDetailChange, onClose,
  side, size, onSideChange, onSizeChange,
}: BrainSurfaceActionsProps) {
  const t = useTranslations('creationCanvas');
  const inline = mode === 'inline';
  const expanded = size === 'expanded';
  const docked = !inline && !!side && !!onSideChange && !!onSizeChange;

  return (
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
        aria-pressed={inline}
        aria-label={inline ? t('dockBrainToEdge') : t('showBrainInObject')}
        title={inline ? t('dockBrainToEdge') : t('showBrainInObject')}
        onClick={() => onModeChange(inline ? 'docked' : 'inline')}
      >{inline ? '▤' : '▣'}</button>
      {/* data-dock-side, not the label, is what the stylesheet hides on a phone:
          a selector keyed on English copy would stop matching in every other locale. */}
      {docked && <button
        type="button"
        data-dock-side="left"
        aria-pressed={side === 'left'}
        aria-label={t('dockBrainLeft')}
        title={t('dockBrainLeft')}
        onClick={() => onSideChange!('left')}
      >⇤</button>}
      {docked && <button
        type="button"
        data-dock-side="right"
        aria-pressed={side === 'right'}
        aria-label={t('dockBrainRight')}
        title={t('dockBrainRight')}
        onClick={() => onSideChange!('right')}
      >⇥</button>}
      {docked && <button
        type="button"
        aria-pressed={expanded}
        aria-label={expanded ? t('slimBrain') : t('expandBrain')}
        title={expanded ? t('slimBrain') : t('expandBrain')}
        onClick={() => onSizeChange!(expanded ? 'slim' : 'expanded')}
      >{expanded ? '⤡' : '⤢'}</button>}
      <button type="button" aria-label={t('closeBrain')} title={t('closeBrain')} onClick={onClose}>×</button>
    </div>
  );
}

/** The edge placement: a full-height panel the board reserves width for. */
export function BrainDock({
  mode, side, size, width, showExecutionDetail,
  onModeChange, onSideChange, onSizeChange, onWidthChange, onExecutionDetailChange, onClose,
  messages, trace, running, runStartedAt = null, node, nodes, edges, collaborators = [], joinedCollaborator = null,
}: BrainDockProps) {
  const t = useTranslations('creationCanvas');

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
        <BrainSurfaceActions
          mode={mode}
          side={side}
          size={size}
          showExecutionDetail={showExecutionDetail}
          onModeChange={onModeChange}
          onSideChange={onSideChange}
          onSizeChange={onSizeChange}
          onExecutionDetailChange={onExecutionDetailChange}
          onClose={onClose}
        />
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
      <BrainSurfaceBody
        showExecutionDetail={showExecutionDetail}
        messages={messages}
        trace={trace}
        running={running}
        runStartedAt={runStartedAt}
        node={node}
        nodes={nodes}
        edges={edges}
        collaborators={collaborators}
        joinedCollaborator={joinedCollaborator}
      />
    </aside>
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
