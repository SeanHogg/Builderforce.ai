import type { CoherenceMode } from '@seanhogg/builderforce-studio';

interface CoherenceControlsProps {
  mode: CoherenceMode;
  strength: number;
  onModeChange: (mode: CoherenceMode) => void;
  onStrengthChange: (strength: number) => void;
  disabled?: boolean;
}

const MODE_DESCRIPTIONS: Record<CoherenceMode, string> = {
  'prompt-bias':
    'Mamba state biases the prompt embedding. Lightweight, works with any U-Net.',
  'latent-residual':
    'Mamba state biases the initial latent noise. Stronger temporal lock, slightly more compute.',
};

export function CoherenceControls({
  mode,
  strength,
  onModeChange,
  onStrengthChange,
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

      <label className="bfs-label" style={{ marginTop: 12 }}>
        Coherence strength: <span className="bfs-mono">{strength.toFixed(2)}</span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={strength}
        onChange={(e) => onStrengthChange(Number(e.target.value))}
        disabled={disabled}
        className="bfs-range"
      />
      <p className="bfs-hint">0 = i.i.d. frames · 1 = maximum lock to previous frame.</p>
    </div>
  );
}
