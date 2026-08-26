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
  // The 4 WebDiT (whole-clip) models — wired end-to-end but `available: false` until a
  // pretrained bundle is exported + uploaded to R2 (see the ROADMAP entry), so these
  // never actually appear in the list above until then; the labels exist so this
  // `Record` stays total the moment `DiffusionModelId` widens to include them.
  'cogvideox-2b': 'CogVideoX 2B — 50-step, smallest WebDiT model (~8 GB)',
  'wan2.5': 'Wan 2.5 (distilled) — 20-step (~10 GB)',
  'mochi-1': 'Mochi 1 — 64-step, highest quality WebDiT model (~12 GB)',
  'ltx2-distilled': 'LTX-2 (distilled) — 8-step, fastest WebDiT model (~6 GB)',
};

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  // `available` narrows the registry to models with real weights to run — it does not
  // exist on every descriptor today (only a webdit-engine variant carries it, per the
  // studio engine's discriminated `ModelDescriptor`), so this reads it defensively
  // rather than assuming the field is always present. A model with no `available` flag
  // at all is treated as available (today's three LCM/SD-Turbo models, always runnable).
  const entries = (Object.keys(MODEL_REGISTRY) as DiffusionModelId[]).filter(
    (id) => (MODEL_REGISTRY[id] as { available?: boolean }).available !== false,
  );
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
