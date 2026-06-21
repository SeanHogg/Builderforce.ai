'use client';

import { adminApi } from '@/lib/adminApi';
import { TenantIntegerOverrideEditor } from './TenantIntegerOverrideEditor';

/**
 * Superadmin override for a tenant's daily LLM token cap.
 *   null → plan default · -1 → unlimited · >= 0 → exact daily cap.
 * Thin config over the shared {@link TenantIntegerOverrideEditor}.
 */
interface Props {
  tenantId: number;
  value: number | null;
  onChange: (next: number | null) => void;
}

export function TenantTokenLimitOverrideEditor({ tenantId, value, onChange }: Props) {
  return (
    <TenantIntegerOverrideEditor
      tenantId={tenantId}
      value={value}
      onChange={onChange}
      config={{
        label: 'Daily token cap',
        fieldKey: 'tdlo',
        summary: (v) =>
          v === null ? 'Using plan default'
          : v === -1 ? 'Unlimited (gate skipped)'
          : `${v.toLocaleString()} tokens / day`,
        toInput: (stored) => String(stored),
        fromInput: (input) => {
          const n = Number(input);
          return Number.isInteger(n) && n >= 0 ? n : null;
        },
        customSuffix: 'tokens / day',
        placeholder: 'e.g. 250000',
        step: 1000,
        save: async (id, next) => (await adminApi.setTenantTokenLimitOverride(id, next)).tokenDailyLimitOverride,
      }}
    />
  );
}
