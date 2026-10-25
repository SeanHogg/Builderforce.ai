import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Avatar, BrainTimeline } from '@seanhogg/builderforce-brain-ui';
import { WebAiSurface } from '@/components/ai-surface/WebAiSurface';
import { useBrainTimelineLabels } from '@/i18n/useBrainTimelineLabels';
import '@seanhogg/builderforce-brain-ui/styles.css';
import type { BrainMessage, BrainTraceEvent, ChatErrorAction } from '@seanhogg/builderforce-brain-embedded';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import { GuestSignupCta, type GuestSignupPrompt } from '@/components/GuestSignupCta';
import { BrainErrorBanner } from '@/components/brain/BrainErrorBanner';
import { useModelIdentity } from '@/lib/useLlmModels';
import { Icon } from '@/components/ui/Icon';
import type { Edge } from '@xyflow/react';
import styles from './styles/brain.module.css';
import { creationObjectDefinition, creationObjectName } from './creationObjectRegistry';
import type { CreationFlowNode } from './CreationNode';
import { useCanvasRunActivity } from './CanvasRunActivity';
import type { BrainSurfaceCollaborator } from './brainSurfaceContext';
import { useBrainSurfaceView } from './brainSurfaceView';

/**
 * THE Brain surface on the Canvas — one body for all three placements: the edge dock
 * (`BrainDock`), the Chat lens (`CanvasChatSurface`) and the inline Brain Object
 * (`BrainObjectBody`). It renders through THE web surface (`WebAiSurface`) — the same
 * container as the Brain panel and the guest drawer — in the design's anatomy:
 *
 *   header · rail (who else is here) · thread (transcript, or its Context view)
 *   · notices (the guest wall's CTA) · footer (tool approval, open question, the prompt)
 *
 * The placements pass only what is theirs — a header, and the prompt when they host it —
 * so they can never drift into three subtly different chats. Palette: the canvas declares
 * its Brain identity as `--bf-*` (CreationCanvas.module.css), which every shared part
 * reads by inheritance.
 */

/** The live conversation, identical wherever the surface is placed. */
export interface BrainSurfaceBodyProps {
  /** When false the transcript narrates progress only and hides the step list. */
  showExecutionDetail: boolean;
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  running: boolean;
  /** Epoch ms the in-flight turn began — narrates a collaborator's run, which has no entry in this browser's run store. */
  runStartedAt?: number | null;
  /** The session's run (`canvasRunKey`) — its pending tool approval shows in the footer. */
  runKey?: string;
  /** The Brain Object this surface is bound to, when the canvas has one yet. */
  node: CreationFlowNode | null;
  nodes: CreationFlowNode[];
  edges: Edge[];
  collaborators?: BrainSurfaceCollaborator[];
  joinedCollaborator?: BrainSurfaceCollaborator | null;
  /** Re-send a transcript message as the next canvas turn. Omitted on a board the
   *  viewer cannot drive, which hides the action rather than failing on click. */
  onReplayMessage?: (message: BrainMessage, role: 'user' | 'assistant') => void;
  /** Answer an ask_user card; omitted on a board the viewer cannot drive. */
  onAnswerQuestion?: (answer: string) => void;
  /** Rate a Brain reply. Omitted on a board that cannot file one (guest session, or
   *  a turn with no resolved model), which hides the thumbs. */
  onRateMessage?: (message: BrainMessage, rating: 1 | -1 | 0) => void;
  /** This viewer's thumb per message id. */
  ratings?: Record<number, 1 | -1>;
  /** The guest wall this conversation ran into, when a turn was refused for want of
   *  an account. Null on every signed-in board, where the CTA renders nothing. */
  guestSignup?: GuestSignupPrompt | null;
  /**
   * The last turn's no-model refusal (`brainTurn/modelRefusal.ts`) — rendered by THE web
   * banner (`BrainErrorBanner`, the shared `ChatErrorBanner`) with its remedies: Switch to
   * Hybrid (which re-sends `onRetry`), Download a local model, Pick a model — the last two
   * open the `/` menu of the composer `composerId` names. Null when the last turn was not
   * refused that way.
   */
  refusal?: {
    error: string;
    action: ChatErrorAction;
    composerId: string;
    onDismiss: () => void;
    onRetry: () => void;
  } | null;
  /**
   * Scroll this transcript message into view and highlight it. Used by the room: a
   * speech bubble quotes a reply whose full text lives here. The nonce lets the same
   * bubble be clicked twice. Absent ⇒ the transcript does not jump.
   */
  revealMessage?: { id: number; nonce: number } | null;
}

/** What a placement adds around the shared conversation. */
export interface BrainSurfaceProps extends BrainSurfaceBodyProps {
  /** The placement's own title row (`SurfaceHeader`, or the Object's action bar). */
  header?: ReactNode;
  /** THE canvas prompt, when this placement hosts it — the footer's last row. */
  composer?: ReactNode;
  /** A quiet row under the prompt (the Chat lens's way back to the board). */
  footnote?: ReactNode;
  className?: string;
  footerClassName?: string;
  /** Accessible name for the region, when the host does not already name it. */
  label?: string;
  /** Attributes a host keys on (test ids). */
  dataAttrs?: Record<`data-${string}`, string>;
}

export function BrainSurface({
  header, composer, footnote, className, footerClassName, label, dataAttrs,
  showExecutionDetail, messages, trace, running, runStartedAt = null, runKey,
  node, nodes, edges, collaborators = [], joinedCollaborator = null, onReplayMessage, onAnswerQuestion,
  onRateMessage, ratings,
  guestSignup = null,
  refusal = null,
  revealMessage = null,
}: BrainSurfaceProps) {
  const t = useTranslations('creationCanvas');
  // Shared with the header's Context toggle — see `brainSurfaceView`.
  const { view: tab, setView: setTab } = useBrainSurfaceView();
  // Read straight from the shared source rather than accepting it as a prop: the canvas
  // surface renders in three placements and inside a guest session, and each of those
  // would otherwise have to remember to thread the same fact through.
  const modelIdentity = useModelIdentity();
  // THE run's in-flight step (the run store's `activity`, by `runKey`) — the same reading
  // the panel and VS Code animate their transcript's live row off.
  const activity = useCanvasRunActivity(runKey, running, runStartedAt);
  // Only the copy the BOARD words differently: who is speaking and what an empty board
  // says. Everything else — the live row's phase lines included — comes from the ONE
  // shared transcript bundle.
  const timelineOverrides = useMemo(() => ({
    you: t('you'),
    assistant: t('brain'),
    empty: t('brainEmpty'),
    thoughtFor: t('thoughtFor', { duration: '{duration}' }),
    thought: t('thought'),
    copy: t('copyMessage'),
    copied: t('copiedMessage'),
    replay: t('replayMessage'),
    rateUp: t('rateUp'),
    rateDown: t('rateDown'),
  }), [t]);
  const timelineLabels = useBrainTimelineLabels(timelineOverrides);
  // A room bubble asked to show a reply: the transcript is on the chat tab, so leave
  // Context if that is where the reader was.
  useEffect(() => {
    if (revealMessage != null) setTab('chat');
  }, [revealMessage, setTab]);
  const typingCollaborators = collaborators.filter((member) => member.typing);
  // Who the running animation below is for, when it is not this viewer's own turn.
  const askingCollaborators = collaborators.filter((member) => member.askingBrain);
  const showPresence = joinedCollaborator != null || typingCollaborators.length > 0 || askingCollaborators.length > 0;

  return (
    <WebAiSurface
      className={[styles.brainSurface, className].filter(Boolean).join(' ')}
      {...(label ? { label } : {})}
      {...(dataAttrs ? { dataAttrs } : {})}
      header={<>{header}</>}
      rail={showPresence ? <div className={styles.humanChatActivity} aria-live="polite">
        {joinedCollaborator && <span data-state="joined">
          <Avatar name={joinedCollaborator.displayName || t('collaborator')} kind="human" size={22} />
          <b>{t('collaboratorJoined', { name: joinedCollaborator.displayName || t('collaborator') })}</b>
        </span>}
        {typingCollaborators.map((member) => <span key={member.userId} data-state="typing">
          <Avatar name={member.displayName || t('collaborator')} kind="human" size={22} />
          <b>{t('collaboratorWriting', { name: member.displayName || t('collaborator') })}</b>
          <i aria-hidden>•••</i>
        </span>)}
        {askingCollaborators.map((member) => <span key={`asking:${member.userId}`} data-state="asking">
          <Avatar name={member.displayName || t('collaborator')} kind="human" size={22} />
          <b>{t('collaboratorAskingBrain', { name: member.displayName || t('collaborator') })}</b>
          <i aria-hidden>•••</i>
        </span>)}
      </div> : undefined}
      thread={tab === 'chat'
        ? <div className={styles.brainDockTimeline} role="log" aria-label={t('brainChatHistory')} tabIndex={0}>
          <BrainTimeline
            conversationKey={runKey ?? null}
            messages={messages}
            trace={showExecutionDetail ? trace : []}
            streamingText=""
            isRunning={running}
            activity={activity}
            assistantName={t('brain')}
            labels={timelineLabels}
            modelIdentity={modelIdentity}
            onReplayMessage={onReplayMessage}
            onAnswerQuestion={onAnswerQuestion}
            onRateMessage={onRateMessage}
            ratings={ratings}
            revealMessage={revealMessage}
          />
        </div>
        : <div className={styles.brainDockContext}>
          <BrainContextPanel node={node} nodes={nodes} edges={edges} transcript={messages} />
        </div>}
      // The refusal that ended the last turn is already the final message in the
      // transcript; this is the button that sentence was asking for. A notice, OUTSIDE
      // the scroller, so a blocked guest cannot scroll away from the only thing they can
      // still do.
      notices={tab === 'chat' && (guestSignup || refusal) ? <>
        {refusal && <BrainErrorBanner error={refusal.error} action={refusal.action} onDismiss={refusal.onDismiss} onRetry={refusal.onRetry} composerId={refusal.composerId} />}
        {guestSignup && <GuestSignupCta prompt={guestSignup} />}
      </> : undefined}
      // No activity strip above the prompt: the transcript's live node already says what
      // Brain is doing right now, and a strip here reported the same moment twice.
      // THE web footer: the run's tool approval (from the run store, by `runKey`), the
      // open question, then the prompt when this placement hosts it.
      runKey={runKey ?? null}
      messages={messages}
      timelineLabels={timelineLabels}
      {...(onAnswerQuestion ? { onAnswerQuestion } : {})}
      composer={composer}
      footnote={footnote}
      footerClassName={[styles.brainSurfaceFooter, footerClassName].filter(Boolean).join(' ')}
    />
  );
}

/**
 * What this conversation is wired to — the agents contributing, the tickets it
 * created or opened, and every other connected Object. Previously duplicated in the
 * details panel; it belongs beside the conversation it describes.
 */
function BrainContextPanel({ node, nodes, edges, transcript }: { node: CreationFlowNode | null; nodes: CreationFlowNode[]; edges: Edge[]; transcript?: BrainMessage[] }) {
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
    <ChatTicketsPanel chatId={Number(canonicalChatId)} projectId={connectedProjectId ? Number(connectedProjectId) : null} chatList={[{ id: Number(canonicalChatId), title: node.data.title }]} transcript={transcript} />
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
