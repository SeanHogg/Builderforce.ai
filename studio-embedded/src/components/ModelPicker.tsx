import { MODEL_REGISTRY, type DiffusionModelId } from '@seanhogg/builderforce-studio';

interface ModelPickerProps {
  value: DiffusionModelId;
  onChange: (next: DiffusionModelId) => void;
  disabled?: boolean;
}

const MODEL_LABELS: Record<DiffusionModelId, string> = {
  'lcm-tiny-sd': 'LCM Tiny SD — 4-step, lightest (~2 GB, fp16)',
  'sd-turbo': 'SD-Turbo — 1-step, fastest (~4 GB)',
  'lcm-dreamshaper-v7': 'LCM Dreamshaper v7 — 4-step, best quality (~6 GB)',
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
