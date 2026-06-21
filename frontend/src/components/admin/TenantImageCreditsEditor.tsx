'use client';

import { adminApi } from '@/lib/adminApi';
import { TenantIntegerOverrideEditor } from './TenantIntegerOverrideEditor';

/**
 * Superadmin override for a tenant's daily image-generation credit budget
 * (1 credit = 1 returned image), metered independently of the text token cap
 * (migration 0131).
 *   null → plan default (free 10 · pro 1000 · teams 5000) · -1 → unlimited · >= 0 → images/day.
 * Thin config over the shared {@link TenantIntegerOverrideEditor}.
 */
interface Props {
  tenantId: number;
  value: number | null;
  onChange: (next: number | null) => void;
}

export function TenantImageCreditsEditor({ tenantId, value, onChange }: Props) {
  return (
    <TenantIntegerOverrideEditor
      tenantId={tenantId}
      value={value}
      onChange={onChange}
      config={{
        label: 'Daily image credits',
        fieldKey: 'imgc',
        summary: (v) =>
          v === null ? 'Using plan default (free 10 · pro 1000)'
          : v === -1 ? 'Unlimited (gate skipped)'
          : `${v.toLocaleString()} images / day`,
        toInput: (stored) => String(stored),
        fromInput: (input) => {
          const n = Number(input);
          return Number.isInteger(n) && n >= 0 ? n : null;
        },
        customSuffix: 'images / day',
        placeholder: 'e.g. 100',
        step: 10,
        save: async (id, next) => (await adminApi.setTenantImageCreditsLimit(id, next)).imageCreditsDailyLimit,
      }}
    />
  );
}
