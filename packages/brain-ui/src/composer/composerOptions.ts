/**
 * The composer's run-shaping state, as ONE contract every host fills — and the ONE
 * builder that turns it into the `/` menu's grouped sections.
 *
 * Before this each host built the mode choices, the Memory row's wording and the
 * Effort/Thinking descriptions itself (the web in `ComposerOptionsMenu`, the editor
 * inline in its chat surface), so the same row said different things on each surface.
 * Hosts now hand over plain state and their copy; this builds the rest.
 */
import { CHAT_MODES, CHAT_MODE_ICON, effortProfile, type ChatMode, type Effort } from '@seanhogg/builderforce-brain-embedded';
import type {
  PromptOptionsAutoMode,
  PromptOptionsMemory,
  PromptOptionsMode,
  PromptOptionsSession,
} from '../promptOptions/ModePane';
import type { PromptOptionsModel } from '../promptOptions/ModelPane';
import type { PromptOptionsInferenceMode } from '../inferenceMode/InferenceModeControl';
import type { PromptOptionsMenuProps, PromptOptionsOpenRequest } from '../promptOptions/PromptOptionsMenu';
import type { ComposerLabels } from './labels';

export interface ComposerOptions {
  /** Chat | Work for this conversation. */
  mode?: { value: ChatMode; onChange: (mode: ChatMode) => void };
  /** The per-chat Memory switch (`brain_chats.memory_enabled`). `available: false` when
   *  no project memory stands behind the chat — the row shows, inert, and says why. */
  memory?: { enabled: boolean; onChange: (on: boolean) => void; available: boolean };
  /** `minAnswerTokens`: the host's own answer ceiling when it never sends less than that
   *  (the canvas's 3,200), so a level's copy states the budget the request really carries. */
  effort?: { value: Effort; onChange: (effort: Effort) => void; minAnswerTokens?: number };
  thinking?: { value: boolean; onChange: (on: boolean) => void };
  model?: PromptOptionsModel;
  /** Where models run (Hybrid · Local only · Specific). `needsChoice` holds the next turn
   *  behind the first-run question. */
  inferenceMode?: PromptOptionsInferenceMode;
  /** Open the `/` menu on a tab (a remedy sending the person to the Model tab). */
  openMenu?: PromptOptionsOpenRequest;
  autoMode?: { enabled: boolean; onChange: (on: boolean) => void };
  session?: PromptOptionsSession;
}

type OptionGroups = Pick<
  PromptOptionsMenuProps,
  'mode' | 'memory' | 'autoMode' | 'session' | 'effort' | 'onEffortChange' | 'describeEffort'
  | 'thinking' | 'onThinkingChange' | 'describeThinking' | 'model' | 'inferenceMode' | 'openOn'
>;

/** Build the `/` menu's sections from the host's state. Pure. */
export function composerOptionGroups(options: ComposerOptions, labels: ComposerLabels): OptionGroups {
  const { mode, memory, effort, thinking, model, inferenceMode, openMenu, autoMode, session } = options;
  const thinkingOn = thinking?.value ?? false;
  const modeGroup: PromptOptionsMode | undefined = mode
    ? {
        value: mode.value,
        onChange: (next) => mode.onChange(next as ChatMode),
        choices: CHAT_MODES.map((m) => ({ value: m, label: labels.modeLabel(m), hint: labels.modeHint(m), icon: CHAT_MODE_ICON[m] })),
      }
    : undefined;
  const memoryGroup: PromptOptionsMemory | undefined = memory
    ? {
        enabled: memory.enabled,
        onChange: memory.onChange,
        describe: (on) => (on ? labels.memoryOnHint : labels.memoryOffHint),
        ...(memory.available ? {} : { unavailableReason: labels.memoryUnavailable }),
      }
    : undefined;
  const autoGroup: PromptOptionsAutoMode | undefined = autoMode
    ? { enabled: autoMode.enabled, onChange: autoMode.onChange, description: labels.autoModeHint }
    : undefined;
  return {
    mode: modeGroup,
    memory: memoryGroup,
    autoMode: autoGroup,
    session,
    ...(effort
      ? {
          effort: effort.value,
          onEffortChange: effort.onChange,
          // What a level REALLY costs, read from the shared effort table, so the copy can
          // never promise a budget the request does not send.
          describeEffort: (level: Effort) => {
            const { maxTokens, thinkingBudgetTokens } = effortProfile(level);
            const base = labels.effortDesc(level, Math.max(maxTokens, effort.minAnswerTokens ?? 0));
            return thinkingOn ? `${base} ${labels.effortThinkingSuffix(thinkingBudgetTokens)}` : base;
          },
        }
      : {}),
    ...(thinking
      ? {
          thinking: thinking.value,
          onThinkingChange: thinking.onChange,
          describeThinking: (on: boolean) => (on
            ? labels.thinkingOnDesc(effortProfile(effort?.value ?? 'balanced').thinkingBudgetTokens)
            : labels.thinkingOffDesc),
        }
      : {}),
    model,
    inferenceMode,
    openOn: openMenu,
  };
}
