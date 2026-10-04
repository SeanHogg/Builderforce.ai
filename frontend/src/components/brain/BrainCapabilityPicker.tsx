/**
 * Capability picker — "what are we making?" for a Brain chat.
 *
 * Two presentations of ONE option list (see lib/brain/capabilities.ts):
 *   - `layout="tiles"` — the empty state's starter list (shared `StarterTiles` shape).
 *   - `layout="compact"` — a select in the composer toolbar, to change or clear
 *     the capability mid-chat.
 *
 * Self-gating: renders nothing when the surface offers no capabilities, so
 * callers never have to compute visibility.
 */

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { StarterGroup, StarterTile } from './StarterTiles';
import {
  capabilitiesForSurface,
  type BrainCapabilityId,
  type BrainCapabilitySurface,
} from '@/lib/brain';

export interface BrainCapabilityPickerProps {
  surface: BrainCapabilitySurface;
  value: BrainCapabilityId | null;
  onSelect: (id: BrainCapabilityId | null) => void;
  layout: 'tiles' | 'compact';
  /** Disable while a turn is streaming. */
  disabled?: boolean;
}

export function BrainCapabilityPicker({ surface, value, onSelect, layout, disabled }: BrainCapabilityPickerProps) {
  const t = useTranslations('brain.capabilities');
  const options = capabilitiesForSurface(surface);
  if (options.length === 0) return null;

  if (layout === 'compact') {
    return (
      <>
        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('makingLabel')}</span>
        <Select
          value={value ?? ''}
          onChange={(e) => onSelect((e.target.value || null) as BrainCapabilityId | null)}
          aria-label={t('pickerAria')}
          disabled={disabled}
          style={{ fontSize: 'var(--font-size-small)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        >
          <option value="">{t('none')}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>{t(`${c.id}.label`)}</option>
          ))}
        </Select>
      </>
    );
  }

  return (
    <StarterGroup heading={t(surface === 'build' ? 'tilesHintBuild' : 'tilesHintBrainstorm')} ariaLabel={t('pickerAria')}>
      {options.map((c) => {
        const active = value === c.id;
        return (
          <StarterTile
            key={c.id}
            icon={c.icon}
            label={t(`${c.id}.label`)}
            hint={t(`${c.id}.hint`)}
            pressed={active}
            disabled={disabled}
            onClick={() => onSelect(active ? null : c.id)}
          />
        );
      })}
    </StarterGroup>
  );
}
