// No 'use client' directive: only ever rendered by `CreationCanvas`, which is already a
// client component — see `CanvasSessionActions` for why a second directive costs a slot
// on the architecture ratchet and buys nothing.
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import {
  canvasNodePanel,
  type CanvasNodeMessage,
  type CanvasNodePanelId,
} from '@/lib/canvasNodeAffordances';
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
  /** Opens the full inspector — the panel is the common case, not a replacement. */
  onOpenFull: () => void;
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
  onOpenFull,
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
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const title = t(def.titleKey as 'config');

  return (
    <div
      ref={ref}
      className={styles.anchoredPanel}
      data-testid={`canvas-node-panel-${panel}`}
      data-panel={panel}
      role="dialog"
      aria-label={`${title} — ${data.title}`}
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
    >
      <header className={styles.anchoredPanelHeader}>
        <b>{title}</b>
        <span className={styles.anchoredPanelSubject}>{data.title}</span>
        {/* The panel is the COMMON case, not a replacement: everything the inspector can
            do is still one press away, which is what lets this stay short. */}
        <button type="button" aria-label={t('openFull')} title={t('openFull')} onClick={onOpenFull}>
          <Icon name="external-link" size={14} />
        </button>
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>

      <div className={styles.anchoredPanelBody}>
        {panel === 'messages' && <MessagesBody messages={messages} translate={(key) => tMsg(key as 'emptyShell')} />}
        {panel === 'schedule' && <TimingFields data={data} editable={editable} advancedOpen={advancedOpen} onChange={onChange} />}
        {(panel === 'config' || panel === 'persona') && <KindSettingsFields data={data} editable={editable} advancedOpen={advancedOpen} onChange={onChange} onOpenFull={onOpenFull} />}
      </div>

      {def.advanced && <footer className={styles.anchoredPanelFooter}>
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
 * `KindSettingsFields` — one manifest-driven renderer per surface, shared with the full
 * inspector, instead of each anchored-panel body hand-writing its own fields. */
