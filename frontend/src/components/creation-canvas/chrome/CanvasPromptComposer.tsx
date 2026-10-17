import { useTranslations } from 'next-intl';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasPromptPlacement } from '@/lib/canvasPromptPlacement';
import { CANVAS_RESPONSE_TOKENS } from '@/lib/canvasAiTurnBudget';
import { canvasSurfaceDefinition, type CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import { PreviewPickChips } from '@/components/builder/PreviewPickChip';
import { CanvasComposer, type CanvasComposerInputProps } from '../CanvasComposer';
import { CanvasActionsTrigger } from '../CanvasActionsTrigger';
import { BrainActivityIndicator } from '../BrainActivityView';
import type { BrainDockPreferences } from '../brainDockPreferences';
import { CanvasScopeChip, type CanvasScopeMode } from './CanvasScopeChip';
import { useCanvasSessionFacts } from './canvasSessionContext';
import { useCanvasNextSteps, useCanvasStarters } from './useCanvasComposerOffers';
import type { useCanvasRunShaping } from '../hooks/useCanvasRunShaping';

export interface CanvasPromptComposerProps extends Pick<CanvasComposerInputProps,
  | 'onAttach' | 'onAddContext' | 'autoMode' | 'onAutoModeChange' | 'modelSelection' | 'modelOptions'
  | 'onModelSelectionChange' | 'modelIdentity' | 'chatMode' | 'onChatModeChange' | 'memoryEnabled' | 'onMemoryChange'> {
  /** Docked = the Brain panel's last row; float = over the board. */
  docked: boolean;
  /** The surface on screen: its composer verbs and its next steps come off its registry row. */
  surface: CanvasSurfaceId;
  editable: boolean;
  /** Opening the conversation on a phone means you are talking to it. */
  preferAsk: boolean;
  /** Start a Brain turn from the composer's text. */
  startTurn: () => void;
  onCaptureIdea: (text: string) => void;
  /** Publishes `--composer-space` while floating. */
  hostRef: (node: HTMLElement | null) => void;
  actionsOpen: boolean;
  onToggleActions: () => void;
  running: boolean;
  trace: BrainTraceEvent[];
  runStartedAt: number | null;
  /** Brain IS the surface — there is nothing to dock into. */
  brainIsSurface: boolean;
  promptPlacement: CanvasPromptPlacement;
  setPromptPlacement: (placement: CanvasPromptPlacement) => void;
  /** The Brain panel is on screen, so docking needs no extra step to be visible. */
  brainDockDrawn: boolean;
  updateBrainDock: (patch: Partial<BrainDockPreferences>) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  onStop: () => void;
  queued: CanvasComposerInputProps['queued'];
  scopeMode: CanvasScopeMode;
  setScopeMode: (mode: CanvasScopeMode) => void;
  scopeLabel: string;
  selectionCount: number;
  frameSelected: boolean;
  /** The Evermind project on (or behind) this board — where memory lives, and whose
   *  Evermind the Status tab reads. Null ⇒ memory has nowhere to live. */
  memoryProjectId: number | null;
  /** Effort and Thinking for this session's turns — the `/` panel's run-shaping rows. */
  runShaping: ReturnType<typeof useCanvasRunShaping>;
  onTwilioJourney: (selected: boolean) => void;
  applyTemplate: (template: CreationTemplate) => void;
  /** The Brain conversation has turns, so next-step chips are offered above an empty box. */
  conversationStarted: boolean;
}

/**
 * THE ONE COMPOSER. Its markup, its height, its resize grip and its drag offset are
 * `CanvasComposer`'s. What stays here is what only the host knows: where the box is
 * PLACED, what its verbs DO, and the `ChatInput` wiring.
 */
export function CanvasPromptComposer({
  docked, surface, editable, preferAsk, startTurn, onCaptureIdea, hostRef, actionsOpen, onToggleActions,
  running, trace, runStartedAt, brainIsSurface, promptPlacement, setPromptPlacement, brainDockDrawn, updateBrainDock,
  prompt, setPrompt, onStop, queued, scopeMode, setScopeMode, scopeLabel, selectionCount, frameSelected,
  memoryProjectId, runShaping, onTwilioJourney, applyTemplate, conversationStarted, onAttach, onAddContext, autoMode, onAutoModeChange,
  modelSelection, modelOptions, onModelSelectionChange, modelIdentity, chatMode, onChatModeChange, memoryEnabled, onMemoryChange,
}: CanvasPromptComposerProps) {
  const t = useTranslations('creationCanvas');
  const { persistence } = useCanvasSessionFacts();
  const surfaceDef = canvasSurfaceDefinition(surface);
  const signedIn = persistence === 'server';
  // The two affordances every prompt has — starting points from `+`, next-step chips
  // above an empty box — fed with what the canvas knows: its phase and its surface.
  const starters = useCanvasStarters({ onPrompt: setPrompt, onTwilioJourney, onPack: applyTemplate });
  const suggestions = useCanvasNextSteps({ surface, conversationStarted, onPrompt: setPrompt });
  return <CanvasComposer
    placement={docked ? 'docked' : 'float'}
    intents={surfaceDef.composerIntents}
    // The same gate the scratchpad's own form used: a viewer who cannot add cards is
    // offered Ask alone rather than a verb that would silently do nothing.
    editable={editable}
    // Opening the conversation on a phone means you are talking to it.
    {...(preferAsk ? { preferIntent: 'ask' as const } : {})}
    onAsk={() => startTurn()}
    onCaptureIdea={onCaptureIdea}
    // Measured ONLY while it floats over the board; docked it is the Brain panel's last
    // row rather than the board's chrome, and the band reserved for it is zero.
    {...(docked ? {} : { hostRef })}
    leading={<CanvasActionsTrigger open={actionsOpen} onToggle={onToggleActions} />}
    activity={<BrainActivityIndicator
      running={running}
      trace={trace}
      startedAt={runStartedAt}
      variant="composer"
    />}
    // Neither control means anything once Brain IS the surface: there is nothing to dock
    // into and no board to hand the composer's space back to.
    {...(brainIsSurface ? {} : {
      dockControls: {
        docked: promptPlacement === 'docked',
        // Docking puts the prompt in the Brain panel, so it OPENS that panel: a control
        // whose effect is invisible until you find the launcher reads as one that did nothing.
        onToggleDock: () => {
          const next = promptPlacement === 'docked' ? 'float' : 'docked';
          setPromptPlacement(next);
          if (next === 'docked' && !brainDockDrawn) updateBrainDock({ open: true, mode: 'docked' });
        },
        onClose: () => setPromptPlacement('closed'),
      },
    })}
    input={{
      value: prompt,
      onChange: setPrompt,
      // NEVER disabled while Brain works: an empty composer offers Stop, typing queues the
      // next turn. A box greyed out for a research turn is how a canvas reads as hung.
      running,
      onStop,
      queued,
      // What the next request is about: an element picked in the app's preview, and the
      // board scope. Each draws nothing when there is nothing to say — and scope only on a
      // surface that SHOWS the board, since a selection you cannot see (the App surface,
      // where every turn selects the Brain card) is nothing to narrow to.
      contextControls: <>
        <PreviewPickChips />
        {surfaceDef.showsBoard && <CanvasScopeChip scopeMode={scopeMode} onScopeModeChange={setScopeMode} autoLabel={scopeLabel} selectionCount={selectionCount} frameSelected={frameSelected} />}
      </>,
      onAttach,
      onAddContext,
      starters,
      ...(suggestions ? { suggestions } : {}),
      autoMode,
      onAutoModeChange,
      modelSelection,
      modelOptions,
      onModelSelectionChange,
      modelIdentity,
      // Mode and memory live in the `/` menu, whose trigger names the armed mode — this
      // row had grown to eight unlabelled circles on a phone.
      chatMode,
      onChatModeChange,
      memoryEnabled,
      onMemoryChange,
      memoryUnavailableReason: memoryProjectId == null || !signedIn ? t('memoryNeedsProject') : undefined,
      // The SAME `/` panel the Brain panel opens: run shaping, and the Status tab (plan,
      // meters, spend & savings, this board's Evermind). A board that lives only on this
      // device has no workspace behind it, so it gets neither the tab nor the settings link.
      effort: runShaping.effort,
      onEffortChange: runShaping.setEffort,
      // `canvasTurnShape` raises a level's ceiling to the canvas's own, never lowers it.
      effortMinAnswerTokens: CANVAS_RESPONSE_TOKENS,
      thinking: runShaping.thinking,
      onThinkingChange: runShaping.setThinking,
      account: signedIn ? { projectId: memoryProjectId } : null,
      ...(signedIn ? { accountSettingsHref: '/settings' } : {}),
    }}
  />;
}
