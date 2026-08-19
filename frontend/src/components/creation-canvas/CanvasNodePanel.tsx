// No 'use client' directive: only ever rendered by `CreationCanvas`, which is already a
// client component — see `CanvasSessionActions` for why a second directive costs a slot
// on the architecture ratchet and buys nothing.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import {
  canvasNodePanel,
  type CanvasNodeMessage,
  type CanvasNodePanelId,
} from '@/lib/canvasNodeAffordances';
import { CanvasObjectSurfaceButton } from './CanvasObjectSurfaceButton';
import { KindSettingsFields } from './KindSettingsFields';
import { TimingFields } from './TimingFields';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * The panel that opens BESIDE the card it configures.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * Configuration lived in a full-height right rail forty controls deep, with nothing tying
 * it to the object it edited. On a board of fifteen cards, "which one am I changing" was
 * answered only by remembering what you last clicked — and the rail covered the board
 * while you worked, so you could not check.
 *
 * An anchored panel answers it structurally: it is next to the thing, with a tail pointing
 * at it. That is not decoration; the tail is the only part of the design that makes the
 * association survive a glance away.
 *
 * ── ONE SHELL, FOUR BODIES ───────────────────────────────────────────────────────
 * Config, schedule, messages and persona are ONE component because they are one
 * interaction: open beside a card, edit, Escape to close, click-away to close. Built
 * separately they would each have invented their own focus trap and their own idea of
 * what Escape does — which is precisely how a board ends up with four popovers that close
 * differently.
 *
 * ── ADVANCED ─────────────────────────────────────────────────────────────────────
 * Hidden by default, and the registry says which panels have one. The reason is not
 * tidiness: two of Twilio's eleven fields are the two anyone fills in, and a panel that
 * shows all eleven teaches people that this product is for somebody else.
 *
 * ── WIDE, NOT ELSEWHERE ──────────────────────────────────────────────────────────
 * There is no second inspector to escape to. This panel used to carry an "open the full
 * inspector" button that closed it and opened a full-height rail on the far side of the
 * board — which put every value, every setting and the activity log somewhere that no
 * longer pointed at the card it belonged to, so you were back to guessing which of
 * fifteen objects you were editing. That is the exact problem anchoring exists to solve,
 * undone one press in.
 *
 * So the same panel gets WIDER instead. `expanded` swaps the compact field list for the
 * object's whole inspector (`children`, supplied by the board because that is where the
 * kind handlers live), and the panel stays anchored to its card throughout. One surface,
 * two widths, always attached to the thing it edits.
 *
 * Click-away closes the compact panel and NOT the wide one: an expanded inspector is a
 * surface you work in — it opens file pickers, convert dialogs and confirmations that
 * mount outside this element — and a popover that vanished on the first of those would
 * be unusable. Escape and the close button still close it from either width.
 */

export interface CanvasNodePanelProps {
  panel: CanvasNodePanelId;
  nodeId: string;
  data: CreationNodeData;
  /** Board coordinates of the card's right edge, in screen px. The panel sits beside it. */
  anchor: { x: number; y: number };
  messages: readonly CanvasNodeMessage[];
  editable: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
  onClose: () => void;
  /** Wide: the panel is showing this object's whole inspector rather than the short list. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Opening this object at full size, when its kind has a surface — the button decides
   *  its own visibility from the registry, so no kind list is kept here. */
  onOpenSurface: (surface: CanvasSurfaceId) => void;
  /** The object's whole inspector. Rendered in place of the compact body when `expanded`,
   *  and passed in rather than built here because every one of its actions belongs to the
   *  board (deliver a mockup, import a dataset, publish a site). */
  children?: ReactNode;
}

export function CanvasNodePanel({
  panel,
  nodeId,
  data,
  anchor,
  messages,
  editable,
  onChange,
  onClose,
  expanded,
  onToggleExpanded,
  onOpenSurface,
  children,
}: CanvasNodePanelProps) {
  const t = useTranslations('creationCanvas.nodePanel');
  const tMsg = useTranslations('creationCanvas.nodeMessage');
  const def = canvasNodePanel(panel);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Escape closes, and a press outside closes. ONE listener pair for all four bodies,
  // which is the practical payoff of them sharing a shell rather than each being a card
  // with its own idea of dismissal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !ref.current?.contains(target)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Deferred a frame: the very click that OPENED this panel is still propagating, and
    // a listener attached synchronously catches it and closes what just opened.
    // Not armed at all while WIDE — see the note above the component: the inspector's own
    // pickers and dialogs mount outside this element, so click-away would close the panel
    // the moment you used one of them.
    const timer = expanded ? null : window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('mousedown', onDown);
    };
  }, [expanded, onClose]);

  const title = t(def.titleKey as 'config');
  /* Wide, the panel is no longer "Settings" or "Persona" — it is everything about the
     object, so it says so rather than keeping the name of the short list it replaced. */
  const wideTitle = t('everything');
  const heading = expanded ? wideTitle : title;

  return (
    <div
      ref={ref}
      className={styles.anchoredPanel}
      data-testid={`canvas-node-panel-${panel}`}
      data-panel={panel}
      data-expanded={expanded ? 'true' : 'false'}
      role="dialog"
      aria-label={`${heading} — ${data.title}`}
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
    >
      <header className={styles.anchoredPanelHeader}>
        <b>{heading}</b>
        <span className={styles.anchoredPanelSubject}>{data.title}</span>
        {/* Renders only for a kind whose medium has an axis a card cannot draw — it reads
            the registry, so a new runtime needs nothing here. */}
        <CanvasObjectSurfaceButton data={data} onOpen={onOpenSurface} />
        {/* The panel gets WIDER; it never hands you off to a second panel somewhere else.
            See the note above the component for why that distinction is the whole point. */}
        <button
          type="button"
          data-testid={`canvas-node-panel-expand-${nodeId}`}
          aria-pressed={expanded}
          aria-label={expanded ? t('narrowPanel') : t('widenPanel')}
          title={expanded ? t('narrowPanel') : t('widenPanel')}
          onClick={onToggleExpanded}
        ><Icon name={expanded ? 'collapse-horizontal' : 'expand-horizontal'} size={15} /></button>
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>

      <div className={styles.anchoredPanelBody}>
        {expanded ? children : <>
          {panel === 'messages' && <MessagesBody messages={messages} translate={(key) => tMsg(key as 'emptyShell')} />}
          {panel === 'schedule' && <TimingFields data={data} editable={editable} advancedOpen={advancedOpen} onChange={onChange} />}
          {(panel === 'config' || panel === 'persona') && <KindSettingsFields data={data} editable={editable} advancedOpen={advancedOpen} onChange={onChange} onExpand={onToggleExpanded} />}
        </>}
      </div>

      {!expanded && def.advanced && <footer className={styles.anchoredPanelFooter}>
        {/* A switch, not a chevron: it reports a STATE the panel is in, and it keeps that
            state while you work rather than springing back the way a disclosure does. */}
        <button
          type="button"
          className={styles.advancedSwitch}
          data-testid={`canvas-node-panel-advanced-${nodeId}`}
          aria-pressed={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        ><i aria-hidden />{t('advanced')}</button>
      </footer>}
    </div>
  );
}

/* ── the four bodies ─────────────────────────────────────────────────────────────── */

function MessagesBody({ messages, translate }: { messages: readonly CanvasNodeMessage[]; translate: (key: string) => string }) {
  const t = useTranslations('creationCanvas.nodePanel');
  if (!messages.length) return <p className={styles.anchoredPanelEmpty}>{t('noMessages')}</p>;
  return <ul className={styles.nodeMessageList}>
    {messages.map((message) => <li key={message.id} data-severity={message.severity}>
      <span className={styles.nodeMessageMark} aria-hidden />
      <span>
        {message.text ?? translate(message.textKey ?? '')}
        {message.actionHref && <> <a href={message.actionHref}>{t('fixThis')}</a></>}
      </span>
    </li>)}
  </ul>;
}

/* `ScheduleBody`, `ConfigBody` and `PersonaBody` were folded into `TimingFields` and
 * `KindSettingsFields` — one manifest-driven renderer per surface, shared with the wide
 * body, instead of each anchored-panel body hand-writing its own fields. */
