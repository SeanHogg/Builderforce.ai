'use client';

import { useTranslations } from 'next-intl';
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
  const t = useTranslations('admin');
  return (
    <TenantIntegerOverrideEditor
      tenantId={tenantId}
      value={value}
      onChange={onChange}
      config={{
        label: t('tenants.tokenOverride.label'),
        fieldKey: 'tdlo',
        summary: (v) =>
          v === null ? t('tenants.tokenOverride.summaryPlanDefault')
          : v === -1 ? t('tenants.tokenOverride.summaryUnlimited')
          : t('tenants.tokenOverride.summaryCustom', { value: v.toLocaleString() }),
        toInput: (stored) => String(stored),
        fromInput: (input) => {
          const n = Number(input);
          return Number.isInteger(n) && n >= 0 ? n : null;
        },
        customSuffix: t('tenants.tokenOverride.suffix'),
        placeholder: t('tenants.tokenOverride.placeholder'),
        step: 1000,
        save: async (id, next) => (await adminApi.setTenantTokenLimitOverride(id, next)).tokenDailyLimitOverride,
      }}
    />
  );
}
