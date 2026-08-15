'use client';

/**
 * Capability picker — "what are we making?" for a Brain chat.
 *
 * Two presentations of ONE option list (see lib/brain/capabilities.ts):
 *   - `layout="tiles"` — the empty state, under "Start new chat".
 *   - `layout="compact"` — a select in the composer toolbar, to change or clear
 *     the capability mid-chat.
 *
 * Self-gating: renders nothing when the surface offers no capabilities, so
 * callers never have to compute visibility.
 */

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { Icon } from '@/components/ui/Icon';
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
    <div style={{ width: '100%', maxWidth: 640, padding: '0 16px' }}>
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10 }}>
        {t(surface === 'build' ? 'tilesHintBuild' : 'tilesHintBrainstorm')}
      </div>
      <div
        role="group"
        aria-label={t('pickerAria')}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}
      >
        {options.map((c) => {
          const active = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(active ? null : c.id)}
              disabled={disabled}
              aria-pressed={active}
              title={t(`${c.id}.hint`)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                minHeight: 84,
                padding: '12px 8px',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                background: active ? 'var(--accent-subtle, rgba(59,130,246,0.12))' : 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                cursor: disabled ? 'default' : 'pointer',
                textAlign: 'center',
              }}
            >
              <span aria-hidden><Icon source={c.icon} size={24} /></span>
              <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 600 }}>{t(`${c.id}.label`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
