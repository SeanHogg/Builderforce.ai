// No 'use client' directive: only ever rendered by `CreationCanvas`, which is already a
// client component — see `CanvasSessionActions` for why a second directive costs a slot
// on the architecture ratchet and buys nothing.
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import {
  CANVAS_SCHEDULE_INTERVALS,
  canvasNodePanel,
  canvasNodeSchedule,
  canvasPersonOrigin,
  type CanvasNodeMessage,
  type CanvasNodePanelId,
  type CanvasNodeSchedule,
} from '@/lib/canvasNodeAffordances';
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
        {panel === 'schedule' && <ScheduleBody
          schedule={canvasNodeSchedule(data)}
          editable={editable}
          advancedOpen={advancedOpen}
          onChange={(schedule) => onChange({ schedule } as Partial<CreationNodeData>)}
        />}
        {panel === 'config' && <ConfigBody data={data} editable={editable} advancedOpen={advancedOpen} onChange={onChange} onOpenFull={onOpenFull} />}
        {panel === 'persona' && <PersonaBody data={data} editable={editable} advancedOpen={advancedOpen} onChange={onChange} />}
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

function ScheduleBody({ schedule, editable, advancedOpen, onChange }: {
  schedule: CanvasNodeSchedule;
  editable: boolean;
  advancedOpen: boolean;
  onChange: (schedule: CanvasNodeSchedule) => void;
}) {
  const t = useTranslations('creationCanvas.nodePanel');
  return <>
    <label className={styles.anchoredField}>
      <span>{t('runOnItsOwn')}</span>
      <button
        type="button"
        className={styles.advancedSwitch}
        aria-pressed={schedule.enabled}
        disabled={!editable}
        onClick={() => onChange({ ...schedule, enabled: !schedule.enabled })}
      ><i aria-hidden />{schedule.enabled ? t('scheduleOn') : t('scheduleOff')}</button>
    </label>
    <label className={styles.anchoredField}>
      <span>{t('every')}</span>
      <select
        value={schedule.everyMinutes}
        disabled={!editable || !schedule.enabled}
        onChange={(event) => onChange({ ...schedule, everyMinutes: Number(event.target.value) as CanvasNodeSchedule['everyMinutes'] })}
      >{CANVAS_SCHEDULE_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{t('everyMinutes', { minutes })}</option>)}</select>
    </label>
    {/* The floor is fifteen minutes and it is a cost decision, not a taste one — every
        entry on that list is a poll, and the platform's own cron work-gate is tuned to
        the same floor. Saying so here is cheaper than somebody discovering it from a bill. */}
    <p className={styles.anchoredHint}>{t('scheduleFloorHint')}</p>
    {advancedOpen && <>
      <label className={styles.anchoredField}>
        <span>{t('onlyBetween')}</span>
        <span className={styles.anchoredRange}>
          <input type="time" aria-label={t('fromHour')} value={schedule.fromHour ?? ''} disabled={!editable} onChange={(event) => onChange({ ...schedule, fromHour: event.target.value })} />
          <input type="time" aria-label={t('toHour')} value={schedule.toHour ?? ''} disabled={!editable} onChange={(event) => onChange({ ...schedule, toHour: event.target.value })} />
        </span>
      </label>
      <label className={styles.anchoredField}>
        <span>{t('weekdaysOnly')}</span>
        <button
          type="button"
          className={styles.advancedSwitch}
          aria-pressed={schedule.weekdaysOnly === true}
          disabled={!editable}
          onClick={() => onChange({ ...schedule, weekdaysOnly: !schedule.weekdaysOnly })}
        ><i aria-hidden />{schedule.weekdaysOnly ? t('scheduleOn') : t('scheduleOff')}</button>
      </label>
    </>}
  </>;
}

function ConfigBody({ data, editable, advancedOpen, onChange, onOpenFull }: {
  data: CreationNodeData;
  editable: boolean;
  advancedOpen: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
  onOpenFull: () => void;
}) {
  const t = useTranslations('creationCanvas.nodePanel');
  return <>
    <label className={styles.anchoredField}>
      <span>{t('name')}</span>
      <input value={data.title} disabled={!editable} onChange={(event) => onChange({ title: event.target.value })} />
    </label>
    <label className={styles.anchoredField}>
      <span>{t('status')}</span>
      <input value={data.status ?? ''} disabled={!editable} placeholder={t('statusPlaceholder')} onChange={(event) => onChange({ status: event.target.value })} />
    </label>
    {advancedOpen && <>
      <label className={styles.anchoredField}>
        <span>{t('subtitle')}</span>
        <input value={data.subtitle ?? ''} disabled={!editable} onChange={(event) => onChange({ subtitle: event.target.value })} />
      </label>
      {/* Naming the inspector and then not going there is what a dead end reads like:
          somebody who opens Advanced looking for their object's OWN settings — a
          dashboard's date range, a dataset's import — is told where those live and left
          to find the door themselves. The sentence IS the door. Same `onOpenFull` the
          header icon takes, so there is one route to the inspector, not two. */}
      <button type="button" className={styles.anchoredHintAction} onClick={onOpenFull}>{t('configAdvancedHint')}</button>
    </>}
  </>;
}

function PersonaBody({ data, editable, advancedOpen, onChange }: {
  data: CreationNodeData;
  editable: boolean;
  advancedOpen: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.nodePanel');
  const origin = canvasPersonOrigin(data.kind);
  // A seat's identity comes WITH the seat — its brief, its tools and its review rights are
  // the catalog's, not this board's. What you set here is how this one works on this
  // board, which is the same set of controls a custom agent gets. ONE panel, one trait
  // engine; the only difference is which fields are read-only.
  const identityLocked = origin === 'builtin';
  return <>
    <span className={styles.personaOrigin} data-origin={origin}>{t(origin === 'builtin' ? 'builtinSeat' : 'customAgent')}</span>
    <label className={styles.anchoredField}>
      <span>{t('name')}</span>
      <input value={data.title} disabled={!editable || identityLocked} onChange={(event) => onChange({ title: event.target.value })} />
    </label>
    <label className={styles.anchoredField}>
      <span>{t('role')}</span>
      <input value={data.role ?? ''} disabled={!editable || identityLocked} onChange={(event) => onChange({ role: event.target.value })} />
    </label>
    <label className={styles.anchoredField}>
      <span>{t('focus')}</span>
      <input value={data.focus ?? ''} disabled={!editable} onChange={(event) => onChange({ focus: event.target.value })} />
    </label>
    {identityLocked && <p className={styles.anchoredHint}>{t('builtinSeatHint')}</p>}
    {advancedOpen && <label className={styles.anchoredField}>
      <span>{t('model')}</span>
      <input value={data.model ?? ''} disabled={!editable} placeholder={t('modelPlaceholder')} onChange={(event) => onChange({ model: event.target.value })} />
    </label>}
  </>;
}
