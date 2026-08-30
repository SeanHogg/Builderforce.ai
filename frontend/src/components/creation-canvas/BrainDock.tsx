'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePointerResize } from '@/lib/usePointerResize';
import { Avatar, BrainTimeline } from '@seanhogg/builderforce-brain-ui';
import { useChatActivityLabels } from '@/i18n/useChatActivityLabels';
import '@seanhogg/builderforce-brain-ui/styles.css';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import { GuestSignupCta, type GuestSignupPrompt } from '@/components/GuestSignupCta';
import { useModelIdentity } from '@/lib/useLlmModels';
import { Icon } from '@/components/ui/Icon';
import type { Edge } from '@xyflow/react';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition, creationObjectName } from './creationObjectRegistry';
import type { CreationFlowNode } from './CreationNode';
import { BrainActivityBar, brainActivityLine, useBrainActivity } from './BrainActivityView';
import type { BrainSurfaceCollaborator } from './brainSurfaceContext';
import { useCanvasSurfaceDefinition } from './canvasSurfaceContext';
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
 * The prompt is not OWNED here — it belongs to the canvas, which keeps it in the centre
 * of the page where every chat product people already use puts it. But it has a docked
 * placement (`lib/canvasPromptPlacement.ts`), and when the reader chooses that, this panel
 * RENDERS it as the last row of its own column: header, transcript, prompt.
 *
 * It used to be docked by being drawn as a separate floating card underneath this panel,
 * with the panel shortened by the card's measured height to make room. Two absolutely
 * positioned boxes claiming one edge is not a column — it read as a prompt that had fallen
 * out of the bottom of the chat, with its own header, its own border and its own copy of
 * the activity line the panel was already showing. Passing the node in costs one prop and
 * makes the docked placement what it says it is.
 *
 * The copyright/version/Terms/Privacy row (`LegalStrip`) lives ONLY in the sidebar rail
 * (`Sidebar`) now, on every route including a stage route — this panel used to carry its
 * own copy as a footer here, which put the same row in two places depending on whether the
 * reader was on a stage route. One row, one home.
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
  /** Re-send a transcript message as the next canvas turn. Omitted on a board the
   *  viewer cannot drive, which hides the action rather than failing on click. */
  onReplayMessage?: (message: BrainMessage, role: 'user' | 'assistant') => void;
  /** Rate a Brain reply. Omitted on a board that cannot file one (guest session, or
   *  a turn with no resolved model), which hides the thumbs. */
  onRateMessage?: (message: BrainMessage, rating: 1 | -1 | 0) => void;
  /** This viewer's thumb per message id. */
  ratings?: Record<number, 1 | -1>;
  /** The guest wall this conversation ran into, when a turn was refused for want of
   *  an account. Null on every signed-in board, where the CTA renders nothing. */
  guestSignup?: GuestSignupPrompt | null;
}

export interface BrainDockProps extends BrainSurfaceBodyProps {
  /**
   * The canvas prompt, when the reader has docked it into this panel. Absent while it
   * floats over the board, is closed, or has nowhere else to be — the canvas decides,
   * and this panel only gives it the last row of the column.
   */
  composer?: ReactNode;
  /** Move the prompt back out onto the board. Passed only when the prompt is in here,
   *  which is the only state in which this panel is the one thing that can release it. */
  onUndockPrompt?: () => void;
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
  node, nodes, edges, collaborators = [], joinedCollaborator = null, onReplayMessage,
  onRateMessage, ratings,
  guestSignup = null,
}: BrainSurfaceBodyProps) {
  const t = useTranslations('creationCanvas');
  const [tab, setTab] = useState<'chat' | 'context'>('chat');
  // Read straight from the shared source rather than accepting it as a prop: the canvas
  // surface renders in two placements and inside a guest session, and each of those
  // would otherwise have to remember to thread the same fact through.
  const modelIdentity = useModelIdentity();
  // Derived ONCE and shared: the transcript's live node and the footer strip are two
  // views of the same moment, so they must never narrate it in different words.
  const activity = useBrainActivity(running, trace, runStartedAt);
  const activityLabels = useChatActivityLabels();
  const liveLine = brainActivityLine(activity.live);
  const timelineLabels = useMemo(() => ({
    you: t('you'),
    assistant: t('brain'),
    empty: t('brainEmpty'),
    thinking: liveLine ?? t('brainPhase.thinking'),
    thoughtFor: t('thoughtFor', { duration: '{duration}' }),
    // The per-message copy / send-again actions are part of the shared transcript, so
    // the dock has to name them too — otherwise they fall back to the package's
    // English defaults on a board the user is reading in another language.
    copy: t('copyMessage'),
    copied: t('copiedMessage'),
    replay: t('replayMessage'),
    rateUp: t('rateUp'),
    rateDown: t('rateDown'),
    // Same activity templates as the Brain panel — one hook, so a milestone can never be
    // worded one way on the board and another in the panel.
    activity: activityLabels,
  }), [liveLine, t, activityLabels]);
  const typingCollaborators = collaborators.filter((member) => member.typing);
  const showPresence = joinedCollaborator != null || typingCollaborators.length > 0;

  return <>
    {/* Chat is the panel's own content, not a tab beside another tab — the reader
        already knows they are in chat because the surface switcher says so. Context
        is a CONFIGURATION of this same panel, not a second destination, so it is one
        icon toggle rather than a second tab fighting the first for the same label. */}
    <div className={styles.brainDockTabs}>
      <span className={styles.brainDockTitle}>{t('chat')}</span>
      <button
        type="button"
        className={styles.brainDockContextToggle}
        aria-pressed={tab === 'context'}
        aria-label={t('context')}
        title={t('context')}
        onClick={() => setTab((current) => (current === 'context' ? 'chat' : 'context'))}
      ><Icon source="ⓘ" size="1em" /></button>
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
      ? <>
        <div className={styles.brainDockTimeline} role="log" aria-label={t('brainChatHistory')} tabIndex={0}>
          <BrainTimeline
            messages={messages}
            trace={showExecutionDetail ? trace : []}
            streamingText=""
            isRunning={running}
            assistantName={t('brain')}
            labels={timelineLabels}
            modelIdentity={modelIdentity}
            onReplayMessage={onReplayMessage}
            onRateMessage={onRateMessage}
            ratings={ratings}
          />
        </div>
        {/* The refusal that ended the last turn is already the final message in the
            transcript above; this is the button that sentence was asking for. It
            sits OUTSIDE the scroller so a blocked guest cannot scroll away from the
            only thing they can still do, and carries no body of its own — the
            transcript is the statement. */}
        <GuestSignupCta prompt={guestSignup} />
      </>
      : <div className={styles.brainDockContext}>
        <BrainContextPanel node={node} nodes={nodes} edges={edges} />
      </div>}
    <BrainActivityBar state={activity} />
  </>;
}

export interface BrainSurfaceActionsProps {
  mode: BrainDockMode;
  showExecutionDetail: boolean;
  /** Move the conversation between the edge and the Brain Object. Not offered — and
   *  therefore never called — while a surface other than the board is drawn. */
  onModeChange: (mode: BrainDockMode) => void;
  onExecutionDetailChange: (show: boolean) => void;
  /** Put the conversation away. Omitted by a placement that IS the conversation, where
   *  there is nothing left on screen once it goes — the way out of that one is the
   *  surface switcher, not a dismiss. */
  onClose?: () => void;
  /** Edge-only placement controls; an inline surface is sized by its Object. */
  side?: BrainDockSide;
  size?: BrainDockSize;
  onSideChange?: (side: BrainDockSide) => void;
  onSizeChange?: (size: BrainDockSize) => void;
  /**
   * Put the prompt back on the board. Passed ONLY by the placement that currently holds
   * it, so the control lives beside the thing it releases and exists in exactly one
   * place: the way IN is the prompt's own header while it floats, the way OUT is here
   * once it no longer has a header of its own to carry it.
   */
  onUndockPrompt?: () => void;
}

/**
 * The surface's controls. It decides for itself which of them apply: which edge and
 * how wide are meaningless for a surface that lives in an Object on the graph, where
 * the Object's own resize handles already do that job — and both placement and dismiss
 * are meaningless for a surface that IS the whole canvas.
 */
export function BrainSurfaceActions({
  mode, showExecutionDetail, onModeChange, onExecutionDetailChange, onClose,
  side, size, onSideChange, onSizeChange, onUndockPrompt,
}: BrainSurfaceActionsProps) {
  const t = useTranslations('creationCanvas');
  const inline = mode === 'inline';
  const expanded = size === 'expanded';
  const docked = !inline && !!side && !!onSideChange && !!onSizeChange;
  // Read, not passed in: the canvas publishes which surface it is drawing, so this
  // control can tell for itself that the board it would move INTO is not on screen.
  // Offering "show this in the Brain Object" while a 3D scene — or the conversation
  // surface itself — has taken the centre is a control that hides the chat and gives
  // back nothing, so it is simply not offered until the board is there again.
  const boardAvailable = useCanvasSurfaceDefinition().showsBoard;

  return (
    <div className={styles.brainDockActions}>
      <button
        type="button"
        aria-pressed={showExecutionDetail}
        aria-label={showExecutionDetail ? t('hideExecutionSteps') : t('showExecutionSteps')}
        title={showExecutionDetail ? t('hideExecutionSteps') : t('showExecutionSteps')}
        onClick={() => onExecutionDetailChange(!showExecutionDetail)}
      >⋮⋮</button>
      {/* The prompt is in this panel's column, so the panel carries the way out of it.
          Pressed, the prompt floats over the board again — the placement it came from. */}
      {onUndockPrompt && <button
        type="button"
        aria-pressed
        aria-label={t('floatPrompt')}
        title={t('floatPrompt')}
        onClick={onUndockPrompt}
      ><Icon name="external-link" size={14} /></button>}
      {boardAvailable && <button
        type="button"
        aria-pressed={inline}
        aria-label={inline ? t('dockBrainToEdge') : t('showBrainInObject')}
        title={inline ? t('dockBrainToEdge') : t('showBrainInObject')}
        onClick={() => onModeChange(inline ? 'docked' : 'inline')}
      >{inline ? '▤' : '▣'}</button>}
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
      {onClose && <button type="button" aria-label={t('closeBrain')} title={t('closeBrain')} onClick={onClose}>×</button>}
    </div>
  );
}

/** The edge placement: a full-height panel the board reserves width for. */
export function BrainDock({
  mode, side, size, width, showExecutionDetail, composer, onUndockPrompt,
  onModeChange, onSideChange, onSizeChange, onWidthChange, onExecutionDetailChange, onClose,
  messages, trace, running, runStartedAt = null, node, nodes, edges, collaborators = [], joinedCollaborator = null,
  onReplayMessage, onRateMessage, ratings, guestSignup = null,
}: BrainDockProps) {
  const t = useTranslations('creationCanvas');

  // Dragging the inner edge. The delta is inverted for a right-hand surface, where
  // pulling left makes it wider. Only the settled width is persisted, so a drag
  // does not write localStorage (or a preference signal) on every pointer move.
  const resize = usePointerResize({
    axis: 'x',
    value: width,
    step: RESIZE_STEP,
    invert: side === 'right',
    clamp: clampBrainDockWidth,
    onChange: onWidthChange,
  });

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
        <span className={styles.brainDockMark} aria-hidden><Icon source="✦" size="1em" /></span>
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
          {...(composer && onUndockPrompt ? { onUndockPrompt } : {})}
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
        {...resize}
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
        onReplayMessage={onReplayMessage}
        onRateMessage={onRateMessage}
        ratings={ratings}
        guestSignup={guestSignup}
      />
      {/* Last row of the column, under the transcript — where a chat puts its prompt.
          Nothing is positioned: it is in normal flow, so the transcript above it flexes
          to whatever is left and the panel can never paint over the box you type in. */}
      {composer}
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
      <span aria-hidden><Icon source={creationObjectDefinition(item.data.kind).icon} size={18} /></span>
      <p><b>{creationObjectName(item.data)}</b><small>{item.data.status || creationObjectDefinition(item.data.kind).label}</small></p>
    </div>)}</div>
    : <p className={styles.brainEmpty}>{empty}</p>;

  return <div className={styles.brainDetails}>
    <section aria-labelledby="brain-agents-heading"><div className={styles.brainSectionHeading}><h3 id="brain-agents-heading">{t('agents')}</h3><span>{agents.length}</span></div>{roster(agents, t('noAgentsAssociated'))}</section>
    <section aria-labelledby="brain-tickets-heading"><div className={styles.brainSectionHeading}><h3 id="brain-tickets-heading">{t('associatedTickets')}</h3><span>{tickets.length}</span></div>{roster(tickets, t('noTicketsAssociated'))}</section>
    <section aria-labelledby="brain-objects-heading"><div className={styles.brainSectionHeading}><h3 id="brain-objects-heading">{t('connectedObjects')}</h3><span>{related.length}</span></div>{roster(related, t('noObjectsConnected'))}</section>
  </div>;
}
