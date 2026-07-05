'use client';

import { Select } from '@/components/Select';
import { useLlmModels } from '@/lib/useLlmModels';

/**
 * ModelSelect — the ONE picker that merges the tenant's named "LLM" configs
 * (migration 0211, selected by their `tenant_model:<slug>` ref) with the gateway
 * model pool. Reused by the run picker, the cloud-agent base-model field, and the
 * Designer Brain so every surface shows the same list and a tenant LLM is
 * selectable everywhere. The option-list composition lives here only — consumers
 * pass value/onChange and styling, never re-build the list.
 */
export interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** 'coding' restricts the pool to the curated tool-calling subset (cloud-agent
   *  runs pin one model for the whole loop); 'all' uses the full plan pool. */
  variant?: 'all' | 'coding';
  /** Render a leading "default" option (value ''). */
  includeDefault?: boolean;
  defaultLabel?: string;
  /** Keep a previously-saved model selectable even if it's no longer in the current
   *  plan list (so opening an existing config never silently drops its model). */
  preserveValue?: string;
  style?: React.CSSProperties;
  title?: string;
  disabled?: boolean;
}

export function ModelSelect({
  value,
  onChange,
  variant = 'all',
  includeDefault = true,
  defaultLabel = 'builderforce.ai (default)',
  preserveValue,
  style,
  title,
  disabled,
}: ModelSelectProps) {
  const { models, codingModels, tenantModels, byoModels } = useLlmModels();
  const pool = variant === 'coding' && codingModels.length > 0 ? codingModels : models;
  const known = preserveValue
    && !pool.includes(preserveValue)
    && !byoModels.includes(preserveValue)
    && !tenantModels.some((m) => m.ref === preserveValue);

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} style={style} title={title} disabled={disabled}>
      {includeDefault && <option value="">{defaultLabel}</option>}
      {tenantModels.length > 0 && (
        <optgroup label="Your LLMs">
          {tenantModels.map((m) => (
            <option key={m.id} value={m.ref}>{m.name}</option>
          ))}
        </optgroup>
      )}
      {/* Models the tenant's OWN connected providers (BYO) can serve — the model
          choices follow the connected providers, and run on the tenant's account. */}
      {byoModels.length > 0 && (
        <optgroup label="Connected providers">
          {byoModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </optgroup>
      )}
      {pool.length > 0 && (
        <optgroup label="Models">
          {pool.map((m) => <option key={m} value={m}>{m}</option>)}
        </optgroup>
      )}
      {known && preserveValue && <option value={preserveValue}>{preserveValue} (current)</option>}
    </Select>
  );
}
