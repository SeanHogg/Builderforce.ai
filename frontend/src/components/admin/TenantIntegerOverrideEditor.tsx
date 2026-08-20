'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TenantOverrideEditor } from './TenantOverrideEditor';

/**
 * Superadmin override for a per-tenant integer cap with the shared three-mode
 * semantics used across the platform:
 *
 *   plan default (null) · unlimited (-1) · custom (>= 0)
 *
 * The daily token cap, the funded paid-overflow cap and the image-credit cap are all
 * the SAME control — only the label, unit and display↔stored transform differ.
 *
 * This is now a thin THREE-MODE configuration of {@link TenantOverrideEditor}, which
 * owns the card chrome, the radio row, Save and the error line. The boolean premium
 * override is a two-mode configuration of the same component, so the two no longer
 * hold separate copies of that markup.
 */

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
  const [customStr, setCustomStr] = useState<string>(
    value !== null && value >= 0 ? config.toInput(value) : '',
  );

  return (
    <TenantOverrideEditor<number | null>
      tenantId={tenantId}
      value={value}
      onChange={onChange}
      label={config.label}
      fieldKey={config.fieldKey}
      summary={config.summary}
      save={config.save}
      modes={[
        {
          id: 'plan_default',
          label: t('tenants.intOverride.planDefault'),
          matches: (v) => v === null,
          resolve: () => ({ ok: true, value: null }),
        },
        {
          id: 'unlimited',
          label: t('tenants.intOverride.unlimited'),
          matches: (v) => v === -1,
          resolve: () => ({ ok: true, value: -1 }),
        },
        {
          id: 'custom',
          label: `${t('tenants.intOverride.custom')}${config.customPrefix ? ` ${config.customPrefix}` : ''}`,
          matches: (v) => v !== null && v >= 0,
          resolve: () => {
            const parsed = config.fromInput(customStr);
            return parsed === null
              ? { ok: false, error: t('tenants.intOverride.invalidValue') }
              : { ok: true, value: parsed };
          },
          control: ({ selectMode, disabled }) => (
            <>
              <input
                type="number"
                min={0}
                step={config.step ?? 1}
                value={customStr}
                onChange={(e) => { setCustomStr(e.target.value); selectMode(); }}
                placeholder={config.placeholder}
                disabled={disabled}
                style={{
                  width: 120, padding: '4px 8px', fontSize: 12,
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                }}
              />
              {config.customSuffix}
            </>
          ),
        },
      ]}
    />
  );
}
