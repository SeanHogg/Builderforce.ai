import type { CoherenceMode } from '@seanhogg/builderforce-studio';

interface CoherenceControlsProps {
  mode: CoherenceMode;
  strength: number;
  motionAmount: number;
  imgToImgStrength: number;
  cameraDx: number;
  cameraDy: number;
  onModeChange: (mode: CoherenceMode) => void;
  onStrengthChange: (strength: number) => void;
  onMotionAmountChange: (amount: number) => void;
  onImgToImgStrengthChange: (strength: number) => void;
  onCameraDxChange: (dx: number) => void;
  onCameraDyChange: (dy: number) => void;
  disabled?: boolean;
}

const MODE_DESCRIPTIONS: Record<CoherenceMode, string> = {
  'prompt-bias':
    'Mamba state biases the prompt embedding. Lightweight, works with any U-Net. Compatible with img2img.',
  'latent-residual':
    'Mamba state biases the initial latent noise. Stronger temporal lock, slightly more compute. AUTO-SKIPPED when img2img recursion is on — broadcast bias on a partially-denoised latent disfigures the image.',
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
  imgToImgStrength,
  cameraDx,
  cameraDy,
  onModeChange,
  onStrengthChange,
  onMotionAmountChange,
  onImgToImgStrengthChange,
  onCameraDxChange,
  onCameraDyChange,
  disabled,
}: CoherenceControlsProps) {
  const img2imgOn = imgToImgStrength > 0;
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
        label={`Coherence strength${
          mode === 'latent-residual' && img2imgOn ? ' (auto-skipped — img2img on)' : ''
        }`}
        value={strength}
        min={0}
        max={1}
        step={0.05}
        marginTop={12}
        disabled={disabled || (mode === 'latent-residual' && img2imgOn)}
        onChange={onStrengthChange}
        hint="0 = i.i.d. frames · 1 = maximum lock to previous frame."
      />

      <LabeledRange
        label={`Motion amount${img2imgOn ? ' (ignored — img2img on)' : ''}`}
        value={motionAmount}
        min={0}
        max={1}
        step={0.05}
        marginTop={12}
        disabled={disabled || img2imgOn}
        onChange={onMotionAmountChange}
        hint="Per-frame noise mixed into the shared anchor latent. 0 = a still image looped · 0.15 = subtle motion, stable colors (default) · 1 = each frame is a fresh interpretation of the prompt (no continuity). Disabled when img2img recursion is on."
      />

      <LabeledRange
        label="Img2img recursion"
        value={imgToImgStrength}
        min={0}
        max={1}
        step={0.05}
        marginTop={12}
        disabled={disabled}
        onChange={onImgToImgStrengthChange}
        hint="Frames > 0 start from the previous frame's clean latent re-noised partway through the schedule. 0 = off (anchor-walk only, no scene progression) · 0.5 = strong continuity, slow evolution · 0.7 = moderate continuity, more evolution. Use this for 'walking through a scene' prompts that anchor-walk alone can't deliver. Drifts/blurs after ~30 frames."
      />

      {img2imgOn ? (
        <>
          <label className="bfs-label" style={{ marginTop: 12 }}>
            Camera motion (latent shift, 1 unit = 8 pixels)
          </label>
          <div className="bfs-row" style={{ gap: 12 }}>
            <label className="bfs-label" style={{ flex: 1 }}>
              dx <span className="bfs-mono">{cameraDx}</span>
              <input
                type="number"
                value={cameraDx}
                min={-8}
                max={8}
                step={1}
                onChange={(e) => onCameraDxChange(Number(e.target.value) | 0)}
                disabled={disabled}
                className="bfs-input"
              />
            </label>
            <label className="bfs-label" style={{ flex: 1 }}>
              dy <span className="bfs-mono">{cameraDy}</span>
              <input
                type="number"
                value={cameraDy}
                min={-8}
                max={8}
                step={1}
                onChange={(e) => onCameraDyChange(Number(e.target.value) | 0)}
                disabled={disabled}
                className="bfs-input"
              />
            </label>
          </div>
          <p className="bfs-hint">
            Per-frame shift on the prior latent before re-noising. For
            "walking forward on a path" try dy = -1 (slight upward tilt) or
            dy = 1 (looking slightly down at the ground passing under).
          </p>
        </>
      ) : null}
    </div>
  );
}
