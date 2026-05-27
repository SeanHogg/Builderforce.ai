import { MODEL_REGISTRY } from '../engine/diffusion-engine';
import type { DiffusionModelId } from '../types';

interface ModelPickerProps {
  value: DiffusionModelId;
  onChange: (next: DiffusionModelId) => void;
  disabled?: boolean;
}

const MODEL_LABELS: Record<DiffusionModelId, string> = {
  'lcm-dreamshaper-v7': 'LCM Dreamshaper v7 — 4-step, balanced quality',
  'sd-turbo': 'SD-Turbo — 1-step, fastest',
};

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  const entries = Object.keys(MODEL_REGISTRY) as DiffusionModelId[];
  return (
    <div className="bfs-field">
      <label className="bfs-label">Diffusion model</label>
      <select
        className="bfs-select"
        value={value}
        onChange={(e) => onChange(e.target.value as DiffusionModelId)}
        disabled={disabled}
      >
        {entries.map((id) => (
          <option key={id} value={id}>
            {MODEL_LABELS[id]}
          </option>
        ))}
      </select>
      <p className="bfs-hint">
        {MODEL_REGISTRY[value].defaultSteps} step{MODEL_REGISTRY[value].defaultSteps > 1 ? 's' : ''}{' '}
        · ~{Math.round(MODEL_REGISTRY[value].minVramMb / 1024)} GB VRAM minimum
      </p>
    </div>
  );
}
