import type { CoherenceMode } from '@seanhogg/builderforce-studio';

interface CoherenceControlsProps {
  mode: CoherenceMode;
  strength: number;
  motionAmount: number;
  onModeChange: (mode: CoherenceMode) => void;
  onStrengthChange: (strength: number) => void;
  onMotionAmountChange: (amount: number) => void;
  disabled?: boolean;
}

const MODE_DESCRIPTIONS: Record<CoherenceMode, string> = {
  'prompt-bias':
    'Mamba state biases the prompt embedding. Lightweight, works with any U-Net.',
  'latent-residual':
    'Mamba state biases the initial latent noise. Stronger temporal lock, slightly more compute.',
};

/** Inline labeled range slider — used for every numeric coherence control so
 *  the label / range / value / hint scaffold isn't duplicated per slider. */
function LabeledRange(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  disabled?: boolean;
  marginTop?: number;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <label className="bfs-label" style={props.marginTop ? { marginTop: props.marginTop } : undefined}>
        {props.label}: <span className="bfs-mono">{props.value.toFixed(2)}</span>
      </label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        disabled={props.disabled}
        className="bfs-range"
      />
      <p className="bfs-hint">{props.hint}</p>
    </>
  );
}

export function CoherenceControls({
  mode,
  strength,
  motionAmount,
  onModeChange,
  onStrengthChange,
  onMotionAmountChange,
  disabled,
}: CoherenceControlsProps) {
  return (
    <div className="bfs-field">
      <label className="bfs-label">Temporal coherence (Mamba state)</label>
      <div className="bfs-radio-row">
        {(['prompt-bias', 'latent-residual'] as const).map((m) => (
          <label key={m} className="bfs-radio">
            <input
              type="radio"
              name="bfs-coherence"
              value={m}
              checked={mode === m}
              onChange={() => onModeChange(m)}
              disabled={disabled}
            />
            <span>{m === 'prompt-bias' ? 'Prompt bias' : 'Latent residual'}</span>
          </label>
        ))}
      </div>
      <p className="bfs-hint">{MODE_DESCRIPTIONS[mode]}</p>

      <LabeledRange
        label="Coherence strength"
        value={strength}
        min={0}
        max={1}
        step={0.05}
        marginTop={12}
        disabled={disabled}
        onChange={onStrengthChange}
        hint="0 = i.i.d. frames · 1 = maximum lock to previous frame."
      />

      <LabeledRange
        label="Motion amount"
        value={motionAmount}
        min={0}
        max={1}
        step={0.05}
        marginTop={12}
        disabled={disabled}
        onChange={onMotionAmountChange}
        hint="Per-frame noise mixed into the shared anchor latent. 0 = a still image looped · 0.15 = subtle motion, stable colors (default) · 1 = each frame is a fresh interpretation of the prompt (no continuity)."
      />
    </div>
  );
}
