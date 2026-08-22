'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TenantOverrideCard } from './TenantOverrideCard';

/**
 * Generic superadmin override editor for a per-tenant integer cap with the
 * shared three-mode semantics used across the platform:
 *
 *   plan default (null) · unlimited (-1) · custom (>= 0)
 *
 * The daily token cap, the funded paid-overflow cap, and the image-credit cap
 * are all the SAME control — only the label, unit, and display↔stored transform
 * differ. This holds the three radios and the number input once (DRY); callers
 * pass a thin config + the PATCH call.
 *
 * The chrome, the save and the error live one level down, in
 * {@link TenantOverrideCard}, which the boolean premium override wears too.
 */

type Mode = 'plan_default' | 'unlimited' | 'custom';

function modeFor(value: number | null): Mode {
  if (value === null) return 'plan_default';
  if (value === -1) return 'unlimited';
  return 'custom';
}

export interface IntegerOverrideConfig {
  /** Heading, e.g. "Daily token cap". */
  label: string;
  /** Stable id fragment for the radio group name (unique per editor kind). */
  fieldKey: string;
  /** Render the current effective value as a human summary. */
  summary: (value: number | null) => string;
  /** Stored value (e.g. millicents) → the string shown in the custom input. */
  toInput: (stored: number) => string;
  /** Custom input string → stored value, or null if invalid. */
  fromInput: (input: string) => number | null;
  /** Optional prefix shown before the input (e.g. "$"). */
  customPrefix?: string;
  /** Suffix after the input (e.g. "tokens / day"). */
  customSuffix: string;
  placeholder: string;
  step?: number;
  /** Persist the new value; returns the saved value the backend echoes. */
  save: (tenantId: number, next: number | null) => Promise<number | null>;
}

interface Props {
  tenantId: number;
  value: number | null;
  onChange: (next: number | null) => void;
  config: IntegerOverrideConfig;
}

export function TenantIntegerOverrideEditor({ tenantId, value, onChange, config }: Props) {
  const t = useTranslations('admin');
  const [mode, setMode] = useState<Mode>(modeFor(value));
  const [customStr, setCustomStr] = useState<string>(value !== null && value >= 0 ? config.toInput(value) : '');

  const name = `${config.fieldKey}-${tenantId}`;

  /**
   * Validation failure is thrown, not branched on: the card shows whatever an
   * `Error` carries, so an invalid custom value and a rejected request reach the
   * user through one path.
   */
  const save = async () => {
    let next: number | null;
    if (mode === 'plan_default') next = null;
    else if (mode === 'unlimited') next = -1;
    else {
      const parsed = config.fromInput(customStr);
      if (parsed === null) throw new Error(t('tenants.intOverride.invalidValue'));
      next = parsed;
    }
    onChange(await config.save(tenantId, next));
  };

  return (
    <TenantOverrideCard
      title={config.label}
      current={t('tenants.intOverride.current', { value: config.summary(value) })}
      fallbackError={t('tenants.intOverride.updateFailed')}
      onSave={save}
    >
      {(saving) => (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name={name}
              checked={mode === 'plan_default'}
              onChange={() => setMode('plan_default')}
              disabled={saving}
            />
            {t('tenants.intOverride.planDefault')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name={name}
              checked={mode === 'unlimited'}
              onChange={() => setMode('unlimited')}
              disabled={saving}
            />
            {t('tenants.intOverride.unlimited')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name={name}
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
              disabled={saving}
            />
            {t('tenants.intOverride.custom')}
            {config.customPrefix ? ` ${config.customPrefix}` : ''}
            <input
              type="number"
              min={0}
              step={config.step ?? 1}
              value={customStr}
              onChange={(e) => {
                setCustomStr(e.target.value);
                setMode('custom');
              }}
              placeholder={config.placeholder}
              disabled={saving}
              className="ui-text-small"
              style={{
                width: 120,
                padding: '4px 8px',
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            />
            {config.customSuffix}
          </label>
        </>
      )}
    </TenantOverrideCard>
  );
}
