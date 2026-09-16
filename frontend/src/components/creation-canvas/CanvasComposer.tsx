// No 'use client' directive: rendered only by `CreationCanvas`, which already declares
// the boundary — the same reason `CanvasCommandBar` and `CanvasSessionActions` each
// state at the top of themselves.
import { useCallback, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChatInput, type ChatInputProps } from '@/components/ChatInput';
import { Icon } from '@/components/ui/Icon';
import { mergeRefs } from '@/lib/mergeRefs';
import {
  canvasComposerIntent,
  offeredCanvasComposerIntents,
  type CanvasComposerIntentId,
} from '@/lib/canvasComposerIntents';
import { CanvasComposerIntent } from './CanvasComposerIntent';
import { PanelDragHandle } from './PanelDragHandle';
import { usePanelDragOffset } from './usePanelDragOffset';
import styles from './CreationCanvas.module.css';

/**
 * THE ONE COMPOSER. One box per screen, whatever surface is under it.
 *
 * ── THE DEFECT IT CLOSES ─────────────────────────────────────────────────────────
 * This markup used to be ~190 lines inline in `CreationCanvas.tsx`, and the Ideas
 * surface drew a SECOND text field of its own beside it (`IdeaCaptureForm`). Two
 * boxes, one screen, both asking for a sentence, and nothing saying which one the
 * Enter key you were about to press belonged to. On a phone the pair cost the screen
 * two lots of chrome for one act.
 *
 * The composer is now a component with a narrow contract, and a surface contributes a
 * VERB rather than an input: `intents` comes straight off `CanvasSurfaceDef`
 * (`lib/canvasComposerIntents.ts`). The scratchpad offers `captureIdea` first and
 * `ask` beside it; every other surface offers `ask` alone, so it draws no segment at
 * all and looks exactly as it always did.
 *
 * ── WHO OWNS WHAT ────────────────────────────────────────────────────────────────
 * THIS owns the armed intent, the prompt's height (its resize grip is chrome of this
 * card, and nothing outside it ever read the number) and its drag offset. The HOST
 * owns the text — templates seed it, an @-mention appends to it and Brain's tools
 * read it — so `value`/`onChange` arrive with the rest of the `ChatInput` wiring as
 * one typed group rather than as twenty loose props.
 *
 * ── THE ONE-INSTANCE RULE ────────────────────────────────────────────────────────
 * Not enforced here, deliberately. Where the composer is drawn — floating over the
 * board, or as the last row of the Brain panel's column — is the HOST's decision
 * (`CanvasPromptPlacement`), and it renders exactly one of the two. A component that
 * also had an opinion would be a second answer to a question with one.
 *
 * ── WHY `hostRef` IS A PROP AND NOT A HOOK IN HERE ───────────────────────────────
 * `--composer-space` is measured against the BOARD's own box, which this component
 * cannot see. Same seam `CanvasCommandBar` uses for `--canvas-command-bar-space`: the
 * host owns the measurement, this owns the node. It is absent while docked, because
 * inside the Brain panel this is that panel's last row rather than the board's chrome
 * and the band the board reserves for it is zero.
 */

/**
 * The composer's text box, typed by `ChatInput` itself rather than re-declared here.
 *
 * A `Pick` and not a hand-written interface on purpose: the alternative is a grab-bag
 * that drifts from what `ChatInput` actually accepts, and the canvas's composer wiring
 * is twenty props long. Adding one is one name in this list.
 */
export type CanvasComposerInputProps = Pick<ChatInputProps,
  | 'value'
  | 'onChange'
  | 'running'
  | 'onStop'
  | 'queuedCount'
  | 'contextControls'
  | 'onAttach'
  | 'onAddContext'
  | 'autoMode'
  | 'onAutoModeChange'
  | 'modelSelection'
  | 'modelOptions'
  | 'onModelSelectionChange'
  | 'modelIdentity'
  | 'chatMode'
  | 'onChatModeChange'
  | 'memoryEnabled'
  | 'onMemoryChange'
  | 'memoryUnavailableReason'
>;

/** How the reader has placed the prompt. `closed` is the host's business: it draws nothing. */
export type CanvasComposerPlacement = 'float' | 'docked';

export interface CanvasComposerProps {
  placement: CanvasComposerPlacement;
  /** The verbs this surface offers, first = its default. From `CanvasSurfaceDef`. */
  intents: readonly CanvasComposerIntentId[];
  /**
   * Whether this viewer may change the board. False narrows the offer to `ask` — a
   * verb that creates a card is a button whose only outcome would be a silent no.
   */
  editable: boolean;
  /**
   * Arm this verb instead of the surface's default, while the condition that asked
   * for it holds. The phone Brain sheet passes `'ask'`: a reader who has just opened
   * the conversation is talking to it, and a line typed with the sheet open landing
   * silently on the board as a card is the surprise this prevents. Withdrawing it
   * restores the surface's own default.
   */
  preferIntent?: CanvasComposerIntentId;
  /** Enter, or Send, while `ask` is armed. */
  onAsk: (text: string) => void;
  /** Enter, or Send, while `captureIdea` is armed. */
  onCaptureIdea: (text: string) => void;
  /**
   * The phone's "+" — the trigger for the actions sheet that IS the command bar at
   * that width. A node rather than a flag because the sheet, its state and its
   * handlers all belong to the host; this only gives it the slot in front of the
   * field. CSS stands it down above the phone breakpoint.
   */
  leading?: ReactNode;
  /** The "choose a starting point" picker. Host-built: it dispatches template entries. */
  starter?: ReactNode;
  /** The run receipt. Host-built, and absent while docked — the panel narrates its own. */
  activity?: ReactNode;
  /**
   * Put the prompt away, or move it into the Brain panel. Absent when Brain IS the
   * surface: there is nothing to dock into and no board to hand the space back to.
   */
  dockControls?: {
    docked: boolean;
    onToggleDock: () => void;
    onClose: () => void;
  };
  /** Publishes `--composer-space`. Absent while docked — see the header. */
  hostRef?: (node: HTMLElement | null) => void;
  input: CanvasComposerInputProps;
}

const MIN_PROMPT_HEIGHT = 34;
const MAX_PROMPT_HEIGHT = 240;

export function CanvasComposer({
  placement,
  intents,
  editable,
  preferIntent,
  onAsk,
  onCaptureIdea,
  leading,
  starter,
  activity,
  dockControls,
  hostRef,
  input,
}: CanvasComposerProps) {
  const t = useTranslations('creationCanvas');
  const offered = offeredCanvasComposerIntents(intents, editable);
  const fallback = offered[0]!;

  /**
   * The armed verb, reset whenever the OFFER changes.
   *
   * The previous offer is held IN state beside the choice — React's documented way to
   * adjust state during render — rather than in a ref or an effect. An effect would
   * paint one frame with a verb this surface does not offer, and that frame is the one
   * somebody presses; a ref read during render is the pattern the hooks ratchet exists
   * to stop this file from adding.
   *
   * Keyed on the joined ids and not on the array's identity: the host rebuilds the list
   * on every render (it is a `readonly` row off a registry), so an identity check would
   * throw the reader's choice away on every keystroke.
   */
  const offerKey = offered.join(',');
  const [chosen, setChosen] = useState<{ offer: string; id: CanvasComposerIntentId }>(
    { offer: offerKey, id: fallback },
  );
  if (chosen.offer !== offerKey) {
    setChosen({ offer: offerKey, id: fallback });
  }
  // A preference the host asserts (the phone Brain sheet) overrides the reader's
  // standing choice for as long as it holds, and never permanently — closing the sheet
  // hands the surface's own default back.
  const active = preferIntent && offered.includes(preferIntent)
    ? preferIntent
    : chosen.offer === offerKey && offered.includes(chosen.id) ? chosen.id : fallback;
  const activeDef = canvasComposerIntent(active);

  /**
   * How tall the reader has pulled the box. Local, because nothing outside this card
   * has ever read it — it lived in `CreationCanvas` only because the markup did.
   */
  const [height, setHeight] = useState(MIN_PROMPT_HEIGHT);
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const clamp = useCallback((value: number) => Math.min(MAX_PROMPT_HEIGHT, Math.max(MIN_PROMPT_HEIGHT, value)), []);
  const onResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [height]);
  const onResizeMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setHeight(clamp(resize.startHeight + resize.startY - event.clientY));
  }, [clamp]);
  const onResizeEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  const onResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === 'ArrowUp') setHeight((current) => clamp(current + step));
    else if (event.key === 'ArrowDown') setHeight((current) => clamp(current - step));
    else if (event.key === 'Home') setHeight(MIN_PROMPT_HEIGHT);
    else if (event.key === 'End') setHeight(MAX_PROMPT_HEIGHT);
    else return;
    event.preventDefault();
  }, [clamp]);

  // One of the floating cards a reader can pull clear of the board with its own
  // handle. Only meaningful while it floats: docked, it is a row in the Brain panel's
  // column, not a positioned card of its own.
  const drag = usePanelDragOffset('composer');
  const docked = placement === 'docked';

  /**
   * The ONE submit branch. Enter and the Send button go through it, so the two can
   * never disagree about what a line meant — which is the whole point of naming the
   * verb on screen.
   */
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    if (active === 'captureIdea') onCaptureIdea(text);
    else onAsk(text);
  };

  return (
    <div
      // Measured ONLY while it floats over the board. In the Brain panel it is that
      // panel's last row rather than the board's chrome, so the band the board reserves
      // for it is zero — `useChromeSpace` publishes `0px` the moment this ref stops
      // being handed the node.
      ref={docked ? undefined : mergeRefs(hostRef, drag.elementRef)}
      data-testid="canvas-composer"
      className={styles.composerDock}
      data-placement={placement}
      data-intent={active}
      data-tour="creation-brain-dock"
      style={docked ? undefined : drag.style}
    >
      {/* The prompt's own header, and the only place the dock decision is made. Closing
          is offered from here and from the command bar; DOCKING is deliberate enough to
          belong only on the thing being docked. Inside the Brain panel the whole row
          stands down: that panel has a header of its own naming this conversation, and
          the way back out is a control in it. */}
      {!docked && <div className={styles.promptChrome}>
        <PanelDragHandle isMoved={drag.isMoved} {...drag.handleProps} />
        <span className={styles.promptChromeName}>{t('promptName')}</span>
        {dockControls && <>
          <button
            type="button"
            data-testid="canvas-prompt-dock"
            aria-pressed={dockControls.docked}
            aria-label={dockControls.docked ? t('floatPrompt') : t('dockPrompt')}
            title={dockControls.docked ? t('floatPrompt') : t('dockPrompt')}
            onClick={dockControls.onToggleDock}
          ><Icon name={dockControls.docked ? 'external-link' : 'message'} size={14} /></button>
          <button
            type="button"
            data-testid="canvas-prompt-close"
            aria-label={t('hidePrompt')}
            title={t('hidePrompt')}
            onClick={dockControls.onClose}
          ><Icon name="close" size={15} /></button>
        </>}
      </div>}
      <div className={styles.composerUtilities}>
        {/* Keep the settled receipt mounted after the run. Token consumption used to
            disappear at the exact moment the answer arrived. Absent while docked: that
            panel's own footer is the same reading of the same run, and two copies of
            "Executing… read object · 36s" eight pixels apart is one live turn reported
            twice. */}
        {!docked && activity}
        {starter}
      </div>
      {/* WHAT ENTER MEANS, then the box it means it in. The segment leads because it
          qualifies what follows — reading "Idea | Ask Brain" and then the field is the
          order the sentence is in. It draws nothing on a surface with one verb. */}
      <CanvasComposerIntent intents={offered} value={active} onChange={(id) => setChosen({ offer: offerKey, id })} />
      <div className={styles.promptComposerShell} style={{ '--canvas-prompt-height': `${height}px` } as CSSProperties}>
        <div
          role="separator"
          tabIndex={0}
          className={styles.promptResizeHandle}
          aria-label={t('resizePrompt')}
          aria-orientation="horizontal"
          aria-valuemin={MIN_PROMPT_HEIGHT}
          aria-valuemax={MAX_PROMPT_HEIGHT}
          aria-valuenow={height}
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onLostPointerCapture={() => { resizeRef.current = null; }}
          onKeyDown={onResizeKeyDown}
        >
          <span aria-hidden="true">↕</span>
        </div>
        {/* The row the finger actually uses: the phone's "+" (the whole command bar, in
            one button), then the field. `leading` is absent on a desktop and CSS-hidden
            above the phone breakpoint, so the box keeps its full width where there is
            room for a bar. */}
        <div className={styles.composerInputRow}>
          {leading}
          <ChatInput
            {...input}
            className={styles.composer}
            onSubmit={submit}
            // The active verb names the box AND its button. Two strings from one
            // registry row, so a surface cannot ask for an idea and offer to send it
            // to Brain.
            placeholder={t(activeDef.placeholderKey as 'share')}
            submitLabel={t(activeDef.submitLabelKey as 'share')}
            rows={1}
            submitOnEnter
            showVoice
          />
        </div>
      </div>
    </div>
  );
}

