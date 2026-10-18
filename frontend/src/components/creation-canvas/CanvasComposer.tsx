// No 'use client' directive: rendered only by `CreationCanvas`, which already declares
// the boundary — the same reason `CanvasCommandBar` and `CanvasSessionActions` each
// state at the top of themselves.
import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { ChatInput, type ChatInputProps } from '@/components/ChatInput';
import { PreviewPickChips } from '@/components/builder/PreviewPickChip';
import { Icon } from '@/components/ui/Icon';
import { mergeRefs } from '@/lib/mergeRefs';
import { canvasComposerIntent } from '@/lib/canvasComposerIntents';
import { CANVAS_RESPONSE_TOKENS } from '@/lib/canvasAiTurnBudget';
import type { CanvasPromptPlacement } from '@/lib/canvasPromptPlacement';
import { canvasSurfaceDefinition, type CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import { REPLAY_MASK } from '@/lib/replaySensitive';
import { CanvasActionsTrigger } from './CanvasActionsTrigger';
import { CanvasComposerIntent, useComposerIntent } from './CanvasComposerIntent';
import { CanvasRunActivity } from './CanvasRunActivity';
import { PanelDragHandle } from './PanelDragHandle';
import { usePanelDragOffset } from './usePanelDragOffset';
import { MAX_PROMPT_HEIGHT, MIN_PROMPT_HEIGHT, usePromptResize } from './usePromptResize';
import type { BrainDockPreferences } from './brainDockPreferences';
import { canvasRunKey } from './brainTurn/canvasRunKey';
import { CanvasScopeChip, type CanvasScopeMode } from './chrome/CanvasScopeChip';
import { useCanvasSessionFacts } from './chrome/canvasSessionContext';
import { useCanvasNextSteps, useCanvasStarters } from './chrome/useCanvasComposerOffers';
import styles from './styles/composer.module.css';

/**
 * THE ONE CANVAS PROMPT. One box per screen, whatever surface is under it.
 *
 * The text box itself is `ChatInput` — THE web adapter over the shared composer, the same
 * one the Brain panel, home and Studio mount — so its `+` menu, `/` panel, queue, model
 * and mode controls are never re-implemented here. What this owns is only what the
 * canvas adds AROUND that box:
 *
 *  - WHAT ENTER MEANS. A surface contributes a VERB, not a second input: `intents` comes
 *    off `CanvasSurfaceDef` (`lib/canvasComposerIntents.ts`). The scratchpad offers
 *    `captureIdea` first and `ask` beside it; every other surface offers `ask` alone and
 *    draws no segment. Enter and Send go through ONE submit branch.
 *  - THE FLOATING CARD'S CHROME: its drag handle, its dock/close controls, its resize grip
 *    and the run pill above it. Docked into the Brain panel the whole header stands down —
 *    that panel names the conversation and narrates the run itself.
 *  - THE CANVAS'S OFFERS: starting points and next-step chips fed with its phase and
 *    surface, the scope chip, and memory/account facts read off the session.
 *
 * The HOST owns the text — templates seed it, an @-mention appends to it and Brain's tools
 * read it — so the `ChatInput` wiring arrives as one typed `input` group. Where the box is
 * drawn (floating, or the Brain panel's last row) is the host's decision
 * (`CanvasPromptPlacement`): it renders exactly one of the two.
 *
 * `hostRef` publishes `--composer-space`, measured against the BOARD's box, which this
 * cannot see — the same seam `CanvasCommandBar` uses. It is absent while docked, where
 * the band the board reserves for the prompt is zero.
 */

/** The `ChatInput` wiring the host owns. Everything else `ChatInput` takes is set here. */
export type CanvasComposerInputProps = Omit<ChatInputProps,
  | 'onSubmit' | 'placeholder' | 'submitLabel' | 'rows' | 'submitOnEnter' | 'showVoice' | 'className'
  | 'contextControls' | 'starters' | 'suggestions' | 'memoryUnavailableReason' | 'account' | 'accountSettingsHref'
  | 'effortMinAnswerTokens'>;

export interface CanvasComposerProps {
  /** Docked = the Brain panel's last row; otherwise it floats over the board. */
  docked: boolean;
  /** The surface on screen: its verbs and its next steps come off its registry row. */
  surface: CanvasSurfaceId;
  /** False narrows the offer to `ask` — a verb that writes would be a silent no. */
  editable: boolean;
  /** Opening the conversation on a phone means you are talking to it: arm `ask`. */
  preferAsk: boolean;
  /** Enter, or Send, while `ask` is armed. */
  onAsk: (text: string) => void;
  /** Enter, or Send, while `captureIdea` is armed. */
  onCaptureIdea: (text: string) => void;
  /** Publishes `--composer-space` while floating. */
  hostRef?: (node: HTMLElement | null) => void;
  /** The phone's "+" — the actions sheet that IS the command bar at that width. */
  actions?: { open: boolean; onToggle: () => void };
  /** Epoch ms the running turn began (the run pill's clock for a collaborator's turn). */
  runStartedAt: number | null;
  /** Brain IS the surface — there is nothing to dock into and no board to hand space back to. */
  brainIsSurface: boolean;
  promptPlacement: CanvasPromptPlacement;
  setPromptPlacement: (placement: CanvasPromptPlacement) => void;
  /** The Brain panel is on screen, so docking needs no extra step to be visible. */
  brainDockDrawn: boolean;
  updateBrainDock: (patch: Partial<BrainDockPreferences>) => void;
  scope: {
    mode: CanvasScopeMode;
    setMode: (mode: CanvasScopeMode) => void;
    autoLabel: string;
    selectionCount: number;
    frameSelected: boolean;
  };
  /** The Evermind project on (or behind) this board. Null ⇒ memory has nowhere to live. */
  memoryProjectId: number | null;
  onTwilioJourney: (selected: boolean) => void;
  applyTemplate: (template: CreationTemplate) => void;
  /** The Brain conversation has turns, so next-step chips are offered above an empty box. */
  conversationStarted: boolean;
  input: CanvasComposerInputProps;
}

export function CanvasComposer({
  docked, surface, editable, preferAsk, onAsk, onCaptureIdea, hostRef, actions, runStartedAt, brainIsSurface,
  promptPlacement, setPromptPlacement, brainDockDrawn, updateBrainDock, scope, memoryProjectId,
  onTwilioJourney, applyTemplate, conversationStarted, input,
}: CanvasComposerProps) {
  const t = useTranslations('creationCanvas');
  const { persistence, sessionId } = useCanvasSessionFacts();
  const surfaceDef = canvasSurfaceDefinition(surface);
  const signedIn = persistence === 'server';
  const { offered, active, choose } = useComposerIntent(surfaceDef.composerIntents, editable, preferAsk ? 'ask' : undefined);
  const activeDef = canvasComposerIntent(active);
  const resize = usePromptResize();
  // One of the floating cards a reader can pull clear of the board with its own handle.
  // Only meaningful while it floats: docked, it is a row in the Brain panel's column.
  const drag = usePanelDragOffset('composer');
  // The two affordances every prompt has — starting points from `+`, next-step chips
  // above an empty box — fed with what the canvas knows: its phase and its surface.
  const starters = useCanvasStarters({ onPrompt: input.onChange, onTwilioJourney, onPack: applyTemplate });
  const suggestions = useCanvasNextSteps({ surface, conversationStarted, onPrompt: input.onChange });

  /** The ONE submit branch: Enter and Send cannot disagree about what a line meant. */
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    if (active === 'captureIdea') onCaptureIdea(text);
    else onAsk(text);
  };
  const toggleDock = () => {
    // Docking puts the prompt in the Brain panel, so it OPENS that panel: a control whose
    // effect is invisible until you find the launcher reads as one that did nothing.
    const next = promptPlacement === 'docked' ? 'float' : 'docked';
    setPromptPlacement(next);
    if (next === 'docked' && !brainDockDrawn) updateBrainDock({ open: true, mode: 'docked' });
  };
  const dockedPreference = promptPlacement === 'docked';

  // What a person types to the Brain is masked in session replay wherever the prompt
  // sits — floating on the board as well as docked in a masked surface footer.
  return (
    <div {...REPLAY_MASK}
      ref={docked ? undefined : mergeRefs(hostRef, drag.elementRef)}
      data-testid="canvas-composer"
      className={styles.composerDock}
      data-placement={docked ? 'docked' : 'float'}
      data-intent={active}
      data-tour="creation-brain-dock"
      style={docked ? undefined : drag.style}
    >
      {/* The prompt's own header, and the only place the dock decision is made. Neither
          control means anything once Brain IS the surface. */}
      {!docked && <div className={styles.promptChrome}>
        <PanelDragHandle isMoved={drag.isMoved} {...drag.handleProps} />
        <span className={styles.promptChromeName}>{t('promptName')}</span>
        {!brainIsSurface && <>
          <button
            type="button"
            data-testid="canvas-prompt-dock"
            aria-pressed={dockedPreference}
            aria-label={dockedPreference ? t('floatPrompt') : t('dockPrompt')}
            title={dockedPreference ? t('floatPrompt') : t('dockPrompt')}
            onClick={toggleDock}
          ><Icon name={dockedPreference ? 'external-link' : 'message'} size={14} /></button>
          <button
            type="button"
            data-testid="canvas-prompt-close"
            aria-label={t('hidePrompt')}
            title={t('hidePrompt')}
            onClick={() => setPromptPlacement('closed')}
          ><Icon name="close" size={15} /></button>
        </>}
      </div>}
      {/* The run pill — THE shared live row, off the run store. Absent while docked: that
          panel's transcript is the same reading of the same run. */}
      {!docked && input.running && <div className={styles.composerUtilities}>
        <CanvasRunActivity runKey={canvasRunKey(sessionId)} running startedAt={runStartedAt} variant="composer" />
      </div>}
      <div className={styles.composerCard} style={{ '--canvas-prompt-height': `${resize.height}px` } as CSSProperties}>
        {/* The grip is a strip along the card's top edge rather than a knob ON the border. */}
        <div
          role="separator"
          tabIndex={0}
          className={styles.promptResizeHandle}
          aria-label={t('resizePrompt')}
          aria-orientation="horizontal"
          aria-valuemin={MIN_PROMPT_HEIGHT}
          aria-valuemax={MAX_PROMPT_HEIGHT}
          aria-valuenow={resize.height}
          {...resize.handleProps}
        />
        <CanvasComposerIntent intents={offered} value={active} onChange={choose} />
        <div className={styles.composerInputRow}>
          {actions && <CanvasActionsTrigger open={actions.open} onToggle={actions.onToggle} />}
          <ChatInput
            {...input}
            className={styles.composer}
            onSubmit={submit}
            // The active verb names the box AND its button — two strings from one registry row.
            placeholder={t(activeDef.placeholderKey as 'share')}
            submitLabel={t(activeDef.submitLabelKey as 'share')}
            rows={1}
            submitOnEnter
            showVoice
            // What the next request is about: an element picked in the app's preview, and
            // the board scope — only on a surface that SHOWS the board.
            contextControls={<>
              <PreviewPickChips />
              {surfaceDef.showsBoard && <CanvasScopeChip scopeMode={scope.mode} onScopeModeChange={scope.setMode} autoLabel={scope.autoLabel} selectionCount={scope.selectionCount} frameSelected={scope.frameSelected} />}
            </>}
            starters={starters}
            {...(suggestions ? { suggestions } : {})}
            memoryUnavailableReason={memoryProjectId == null || !signedIn ? t('memoryNeedsProject') : undefined}
            // `canvasTurnShape` raises a level's ceiling to the canvas's own, never lowers it.
            effortMinAnswerTokens={CANVAS_RESPONSE_TOKENS}
            // A board that lives only on this device has no workspace behind it, so it gets
            // neither the Status tab nor the settings link.
            account={signedIn ? { projectId: memoryProjectId } : null}
            {...(signedIn ? { accountSettingsHref: '/settings' } : {})}
          />
        </div>
      </div>
    </div>
  );
}
