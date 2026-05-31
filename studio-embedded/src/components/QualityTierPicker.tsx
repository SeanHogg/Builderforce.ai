/**
 * QualityTierPicker — the simple-mode replacement for raw model selection.
 *
 * Users describe what they want, not which checkpoint to load. The three
 * tiers map onto a primary model + (optional) refinement model:
 *
 *   fast      → lcm-tiny-sd                                   (~2 GB, fastest)
 *   balanced  → lcm-dreamshaper-v7                            (~6 GB, sharper)
 *   refined   → lcm-tiny-sd draft → lcm-dreamshaper-v7 refine (~6 GB sequential)
 *
 * "Refined" is the two-pass chain — the answer to "why don't we use two LLMs?"
 * Sequential load (no 2× VRAM) makes it usable on the same hardware that runs
 * Balanced; it's slower wall-clock but combines the tiny model's speed for
 * composition with the larger model's detail for finishing.
 *
 * Owns its own labels/descriptions/tier mapping — the consumer passes the
 * current tier + change handler, never has to know which model id each tier
 * resolves to. DRY: every "what does each tier mean" decision lives here.
 */

import type { DiffusionModelId, QualityMode } from '@seanhogg/builderforce-studio';

interface QualityTierDef {
  id: QualityMode;
  label: string;
  primary: DiffusionModelId;
  refinement?: DiffusionModelId;
  description: string;
}

export const QUALITY_TIERS: readonly QualityTierDef[] = [
  {
    id: 'fast',
    label: 'Fast',
    primary: 'lcm-tiny-sd',
    description: 'Smallest model (~2 GB), 4 steps per frame. Best for previews and weaker GPUs.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    primary: 'lcm-dreamshaper-v7',
    description: 'LCM Dreamshaper (~6 GB), 4 steps per frame. Sharper detail than Fast.',
  },
  {
    id: 'refined',
    label: 'Refined (two-pass)',
    primary: 'lcm-tiny-sd',
    refinement: 'lcm-dreamshaper-v7',
    description:
      'Two-pass chain: tiny model lays in composition, Dreamshaper refines each frame via img2img at 40 % strength. Sequential load — no extra VRAM cost vs Balanced. Slower wall-clock, higher quality finish.',
  },
];

/** Resolve a tier id to (primary, refinement) so the consumer can pass them
 *  to `VideoEngine.create`. Falls back to fast if the id is unknown. */
export function resolveQualityTier(tier: QualityMode): {
  primary: DiffusionModelId;
  refinement: DiffusionModelId | undefined;
} {
  const found = QUALITY_TIERS.find((t) => t.id === tier) ?? QUALITY_TIERS[0];
  return { primary: found.primary, refinement: found.refinement };
}

interface QualityTierPickerProps {
  value: QualityMode;
  onChange: (mode: QualityMode) => void;
  disabled?: boolean;
}

export function QualityTierPicker({ value, onChange, disabled }: QualityTierPickerProps) {
  const current = QUALITY_TIERS.find((t) => t.id === value) ?? QUALITY_TIERS[0];
  return (
    <div className="bfs-field">
      <label className="bfs-label">Quality</label>
      <div className="bfs-radio-row">
        {QUALITY_TIERS.map((tier) => {
          const active = tier.id === value;
          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => onChange(tier.id)}
              disabled={disabled}
              className="bfs-btn bfs-btn-secondary"
              aria-pressed={active}
              style={{
                flex: 1,
                padding: '8px 10px',
                fontSize: '0.85rem',
                fontWeight: 600,
                background: active ? 'var(--bfs-accent)' : 'transparent',
                color: active ? 'white' : 'var(--bfs-fg)',
                borderColor: active ? 'var(--bfs-accent)' : 'var(--bfs-border)',
              }}
            >
              {tier.label}
            </button>
          );
        })}
      </div>
      <p className="bfs-hint">{current.description}</p>
    </div>
  );
}
