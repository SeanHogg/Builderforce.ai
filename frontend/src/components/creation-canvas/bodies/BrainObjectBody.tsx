import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { CreationNodeData } from '../types';
import styles from '../CreationCanvas.module.css';
import { BrainMark } from '@/components/brain/BrainMark';
import { BrainActivityBar, brainActivityLine, useBrainActivity } from '../BrainActivityView';
import { BrainSurfaceBody } from '../BrainDock';
import { BrainSurfaceActions } from '../BrainSurfaceActions';
import { useBrainSurface } from '../brainSurfaceContext';
import type { CreationBodyProps } from './types';

type CanvasChatMessage = { role: string; content: string; createdAt?: string };

function canvasChatMessages(data: CreationNodeData): CanvasChatMessage[] {
  if (!Array.isArray(data.messages)) return [];
  return data.messages.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const message = value as Record<string, unknown>;
    if (typeof message.content !== 'string' || !message.content.trim()) return [];
    return [{
      role: typeof message.role === 'string' ? message.role : 'assistant',
      content: message.content,
      ...(typeof message.createdAt === 'string' ? { createdAt: message.createdAt } : {}),
    }];
  });
}

/**
 * The Brain Object — the conversation itself, its mark, or an anchor pointing at it.
 *
 * There is exactly ONE Brain transcript on the canvas at a time. Where it renders is
 * the user's placement choice: docked to an edge, or right here in the graph. When it
 * is inline the Object IS the chat, because a small chat card hovering over a board
 * that already carries a Brain Object was two live views of one conversation — the
 * "which one am I actually talking to?" confusion this canvas exists to avoid.
 *
 * When it is docked the Object collapses to Brain's MARK. A full card repeating the
 * latest exchange beside a full-height dock showing that same exchange is the same
 * confusion in a quieter form: two frames of reference for one Brain. Docked, the
 * board keeps Brain's place in the graph (its edges are what scope a prompt), shows
 * that it is working, and sends every reading of the conversation to the dock.
 *
 * The anchor — the latest exchange — survives for the cases where there is no visible
 * surface to defer to: presenting, and a Brain the user has closed. There the Object
 * is the only reading of the conversation left, so it keeps showing one.
 *
 * Reading the placement from context rather than a prop is deliberate: `nodeTypes` has
 * to keep a stable identity or React Flow remounts the whole board, and consuming the
 * context HERE (not in CreationNode) means a streaming reply re-renders this node
 * alone rather than every Object on the canvas.
 */
export function BrainObjectBody({ id: nodeId, data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas');
  const surface = useBrainSurface();

  // `open` already excludes presenting, so the mark only ever stands in for a dock
  // the user can actually see and get back to.
  if (surface && surface.open && surface.mode === 'docked') {
    return <BrainMarkerBody data={data} onOpen={() => surface.onOpen(nodeId)} />;
  }

  if (!surface || !surface.open || surface.mode !== 'inline') {
    // No handler while presenting: nothing can reveal Brain there, and an anchor that
    // offers a way in and then does nothing is worse than an anchor that stays quiet.
    return <BrainAnchorBody
      data={data}
      // Replies that landed while this conversation was not on screen. The docked
      // launcher pill wears the same number from the same count — published on the
      // surface context (`useBrainUnreadReplies`) rather than counted twice, because two
      // answers to "did anything arrive" drift the first time either changes.
      unread={surface?.unreadReplies ?? 0}
      onOpen={surface?.canOpen ? () => surface.onOpen(nodeId) : undefined}
    />;
  }

  return (
    // Clicks are contained here on purpose. Selecting the Brain Object reveals the
    // conversation, so without this every control inside the conversation would also
    // re-reveal it — closing Brain would reopen it on the way back up. The Object's
    // header is outside this section and still selects the node normally.
    <section
      className={`${styles.brainObjectChat} nodrag nowheel`}
      aria-label={t('brainDock')}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.brainObjectChatBar}>
        <BrainSurfaceActions
          mode={surface.mode}
          showExecutionDetail={surface.showExecutionDetail}
          onModeChange={surface.onModeChange}
          onExecutionDetailChange={surface.onExecutionDetailChange}
          onClose={surface.onClose}
        />
      </div>
      <BrainSurfaceBody
        showExecutionDetail={surface.showExecutionDetail}
        messages={surface.messages}
        trace={surface.trace}
        running={surface.running}
        runStartedAt={surface.runStartedAt}
        node={surface.nodes.find((candidate) => candidate.id === nodeId) ?? null}
        nodes={surface.nodes}
        edges={surface.edges}
        collaborators={surface.collaborators}
        joinedCollaborator={surface.joinedCollaborator}
        onReplayMessage={surface.onReplayMessage}
        onRateMessage={surface.onRateMessage}
        ratings={surface.ratings}
        guestSignup={surface.guestSignup}
      />
    </section>
  );
}

/**
 * The run, read off the Object's own data. The mark and the anchor narrate the same
 * turn from the same three fields, so they derive it once and can never disagree.
 */
function useBrainNodeActivity(data: CreationNodeData) {
  return useBrainActivity(
    data.brainRunning === true,
    Array.isArray(data.trace) ? data.trace as BrainTraceEvent[] : [],
    typeof data.brainRunStartedAt === 'number' ? data.brainRunStartedAt : null,
  );
}

/**
 * The mark: Brain reduced to a single object on the board while the conversation
 * lives in the edge dock.
 *
 * It carries the SAME brain mark as the dock header, so the mark on the board and the panel
 * it opens are visibly one Brain rather than two things that both say "Brain". It
 * animates from the same activity state every other surface narrates from, so a
 * working Brain is legible on the board without repeating the dock's words next to
 * it — the phase is the accessible name and the tooltip, not a second strip of copy.
 *
 * The mark is deliberately NOT marked `nodrag`: collapsed, it is the whole Object, so
 * refusing a drag on it would mean the Brain Object could no longer be moved at all.
 */
function BrainMarkerBody({ data, onOpen }: { data: CreationNodeData; onOpen: () => void }) {
  const t = useTranslations('creationCanvas.node');
  const activity = useBrainNodeActivity(data);
  const phase = brainActivityLine(activity.live);
  const label = phase ? t('brainMarkerBusy', { phase }) : t('openBrainChat');

  return <button
    type="button"
    className={styles.brainMarker}
    data-state={activity.live ? 'running' : 'idle'}
    aria-label={label}
    title={label}
    onClick={onOpen}
  >
    <BrainMark running={!!activity.live} size={26} />
  </button>;
}

/**
 * The anchor: Brain's place in the graph (its connections are what scope a prompt)
 * plus the latest exchange — the reading shown when the board is the ONLY surface
 * left. That is presenting, where nothing can reveal Brain, and an inline Brain the
 * user closed, where the Object is where the conversation would come back.
 *
 * It narrates a running turn with the SAME signal as the dock — a Brain that is
 * clearly working on the board, not a card frozen on a stale reply — and keeps the
 * newest exchange scrolled into view, since the anchor is short and the reply that
 * just landed is the only one worth reading.
 */
function BrainAnchorBody({ data, unread = 0, onOpen }: { data: CreationNodeData; unread?: number; onOpen?: () => void }) {
  const t = useTranslations('creationCanvas.node');
  const tCanvas = useTranslations('creationCanvas');
  const messages = canvasChatMessages(data);
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const lastAssistant = [...messages].reverse().find((message) => message.role !== 'user');
  const reply = lastAssistant?.content || (typeof data.aiResponse === 'string' ? data.aiResponse : '');
  const activity = useBrainNodeActivity(data);
  // The live phase is narrated ONCE, by the bar below — a turn with no reply yet
  // shows the invitation rather than repeating "Churning…" twice in one card.
  const brainText = reply || t('brainAnchorReplyFallback');

  const exchangeRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const scroller = exchangeRef.current;
    const latest = latestRef.current;
    if (!scroller || !latest) return;
    const top = latest.offsetTop - scroller.offsetTop;
    // Scroll WITHIN the anchor only — scrollIntoView would drag the board viewport.
    scroller.scrollTop = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
  }, [brainText, lastUser?.content]);

  return <div className={styles.brainAnchorBody}>
    <div className={`${styles.brainAnchorExchange} nowheel`} ref={exchangeRef}>
      <span><small>{t('brainAnchorYou')}</small><p>{lastUser?.content || data.subtitle || t('brainAnchorPromptFallback')}</p></span>
      <span ref={latestRef}><small>{t('brainAnchorBrain')}</small><p>{brainText}</p></span>
    </div>
    <BrainActivityBar state={activity} variant="inline" />
    {/* The way in NAMES what is waiting when something is. "Open Brain chat" beside a
        badge would be the control naming itself twice, so the count replaces the word —
        exactly as the docked launcher pill does it, from the same string. */}
    {onOpen && <div className={`${styles.nodeActionBar} nodrag nowheel`}><button type="button" data-unread={unread > 0 ? 'true' : 'false'} onClick={(event) => { event.stopPropagation(); onOpen(); }}>{unread > 0 ? tCanvas('brainLauncher.unread', { count: unread }) : t('openBrainChat')}</button></div>}
  </div>;
}
