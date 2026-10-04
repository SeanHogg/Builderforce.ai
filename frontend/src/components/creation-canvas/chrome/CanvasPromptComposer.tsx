import { useTranslations } from 'next-intl';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasPromptPlacement } from '@/lib/canvasPromptPlacement';
import type { CanvasComposerIntentId } from '@/lib/canvasComposerIntents';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import { CanvasComposer, type CanvasComposerInputProps } from '../CanvasComposer';
import { CanvasActionsTrigger } from '../CanvasActionsTrigger';
import { BrainActivityIndicator } from '../BrainActivityView';
import type { BrainDockPreferences } from '../brainDockPreferences';
import { CanvasPromptStarter } from './CanvasPromptStarter';
import { CanvasScopeChip, type CanvasScopeMode } from './CanvasScopeChip';
import { useCanvasSessionFacts } from './canvasSessionContext';

export interface CanvasPromptComposerProps extends Pick<CanvasComposerInputProps,
  | 'onAttach' | 'onAddContext' | 'autoMode' | 'onAutoModeChange' | 'modelSelection' | 'modelOptions'
  | 'onModelSelectionChange' | 'modelIdentity' | 'chatMode' | 'onChatModeChange' | 'memoryEnabled' | 'onMemoryChange'> {
  /** Docked = the Brain panel's last row; float = over the board. */
  docked: boolean;
  intents: readonly CanvasComposerIntentId[];
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
  queuedCount: number;
  scopeMode: CanvasScopeMode;
  setScopeMode: (mode: CanvasScopeMode) => void;
  scopeLabel: string;
  selectionCount: number;
  frameSelected: boolean;
  /** An Evermind project is on (or behind) this board, so memory has somewhere to live. */
  hasMemoryProject: boolean;
  onTwilioJourney: (selected: boolean) => void;
  applyTemplate: (template: CreationTemplate) => void;
}

/**
 * THE ONE COMPOSER. Its markup, its height, its resize grip and its drag offset are
 * `CanvasComposer`'s. What stays here is what only the host knows: where the box is
 * PLACED, what its verbs DO, and the `ChatInput` wiring.
 */
export function CanvasPromptComposer({
  docked, intents, editable, preferAsk, startTurn, onCaptureIdea, hostRef, actionsOpen, onToggleActions,
  running, trace, runStartedAt, brainIsSurface, promptPlacement, setPromptPlacement, brainDockDrawn, updateBrainDock,
  prompt, setPrompt, onStop, queuedCount, scopeMode, setScopeMode, scopeLabel, selectionCount, frameSelected,
  hasMemoryProject, onTwilioJourney, applyTemplate, onAttach, onAddContext, autoMode, onAutoModeChange,
  modelSelection, modelOptions, onModelSelectionChange, modelIdentity, chatMode, onChatModeChange, memoryEnabled, onMemoryChange,
}: CanvasPromptComposerProps) {
  const t = useTranslations('creationCanvas');
  const { persistence } = useCanvasSessionFacts();
  return <CanvasComposer
    placement={docked ? 'docked' : 'float'}
    intents={intents}
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
    starter={<CanvasPromptStarter onPrompt={setPrompt} onTwilioJourney={onTwilioJourney} onPack={applyTemplate} />}
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
      queuedCount,
      contextControls: <CanvasScopeChip scopeMode={scopeMode} onScopeModeChange={setScopeMode} autoLabel={scopeLabel} selectionCount={selectionCount} frameSelected={frameSelected} />,
      onAttach,
      onAddContext,
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
      memoryUnavailableReason: !hasMemoryProject || persistence !== 'server' ? t('memoryNeedsProject') : undefined,
    }}
  />;
}
