/**
 * THE inference-mode control — Hybrid · Local only · Specific model, each with its one
 * line — rendered at the top of the `/` menu's Model tab on every host. Presentational:
 * the host owns where the mode is stored and what it derives (`@builderforce/local-first`
 * `resolveInferencePolicy`); this only shows the choice and reports a pick.
 *
 * A real radio group for the keyboard — THE shared `useRovingRadioGroup`: ONE tab stop
 * (the checked mode), Arrow keys move between the modes (and wrap), Home / End jump to
 * the first / last. Moving focus does not choose — Space / Enter (the button's click)
 * does, because a choice here changes where the next turn runs and closes the menu.
 *
 * Self-gating: renders nothing without a mode to show.
 */
import { INFERENCE_MODES, type InferenceMode } from '@seanhogg/builderforce-brain-embedded';
import { useRovingRadioGroup } from '../useRovingRadioGroup';
import { inferenceModeCopy, type InferenceModeLabels } from './labels';

/** The mode wiring a host hands the composer. */
export interface PromptOptionsInferenceMode {
  /** The mode in force (the chosen one, else the host's derived default). */
  value: InferenceMode;
  onChange: (mode: InferenceMode) => void | Promise<void>;
  /**
   * The person has not chosen yet and should be asked before their next turn (a first run —
   * the host decides who is asked: signed in everywhere, and on the web an anonymous
   * visitor too, for whom it is the Hybrid opt-in). THE first-run gate
   * (`useInferenceModeGate`) then holds that turn behind the question.
   */
  needsChoice?: boolean;
}

export interface InferenceModeControlProps {
  inferenceMode?: PromptOptionsInferenceMode;
  labels: InferenceModeLabels;
  /** Called after a pick (the menu closes itself). */
  onPicked?: () => void;
}

export function InferenceModeControl({ inferenceMode, labels, onPicked }: InferenceModeControlProps) {
  const { itemProps } = useRovingRadioGroup(INFERENCE_MODES.length, inferenceMode ? INFERENCE_MODES.indexOf(inferenceMode.value) : -1);
  if (!inferenceMode) return null;
  return (
    <div className="bf-imode" role="radiogroup" aria-label={labels.inferenceMode}>
      <div className="bf-pmenu__group" aria-hidden="true">{labels.inferenceMode}</div>
      {INFERENCE_MODES.map((mode, index) => {
        const { name, hint } = inferenceModeCopy(mode, labels);
        const active = mode === inferenceMode.value;
        return (
          <button
            key={mode}
            {...itemProps(index)}
            type="button"
            role="radio"
            aria-checked={active}
            className={`bf-pmenu__item${active ? ' is-active' : ''}`}
            onClick={() => { void inferenceMode.onChange(mode); onPicked?.(); }}
          >
            <span className="bf-pmenu__lbl">
              {name}
              {mode === 'hybrid' && <span className="bf-imode__tag">{labels.inferenceModeRecommended}</span>}
              <span className="bf-pmenu__desc">{hint}</span>
            </span>
            <span className="bf-pmenu__check" aria-hidden="true">{active ? '✓' : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
