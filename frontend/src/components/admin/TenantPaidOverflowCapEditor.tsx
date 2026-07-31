'use client';

import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { TenantIntegerOverrideEditor } from './TenantIntegerOverrideEditor';

/**
 * Superadmin override for a tenant's daily FUNDED paid-overflow ceiling.
 * Stored in MILLICENTS (1/100000 USD); presented in dollars.
 *   null → plan default (free $0.50/day · pro unlimited) · -1 → unlimited · >= 0 → millicents/day.
 * Thin config over the shared {@link TenantIntegerOverrideEditor}.
 */

/** 1 USD = 100,000 millicents. */
const MILLICENTS_PER_USD = 100_000;

function millicentsToUsdStr(millicents: number): string {
  return (millicents / MILLICENTS_PER_USD).toFixed(2).replace(/\.00$/, '');
}

interface Props {
  tenantId: number;
  value: number | null;
  onChange: (next: number | null) => void;
}

export function TenantPaidOverflowCapEditor({ tenantId, value, onChange }: Props) {
  const t = useTranslations('admin');
  return (
    <TenantIntegerOverrideEditor
      tenantId={tenantId}
      value={value}
      onChange={onChange}
      config={{
        label: t('tenants.overflowCap.label'),
        fieldKey: 'pofc',
        summary: (v) =>
          v === null ? t('tenants.overflowCap.summaryPlanDefault')
          : v === -1 ? t('tenants.overflowCap.summaryUnlimited')
          : t('tenants.overflowCap.summaryCustom', { value: millicentsToUsdStr(v) }),
        toInput: (stored) => millicentsToUsdStr(stored),
        fromInput: (input) => {
          const dollars = Number(input);
          if (!Number.isFinite(dollars) || dollars < 0) return null;
          return Math.round(dollars * MILLICENTS_PER_USD);
        },
        customPrefix: '$',
        customSuffix: t('tenants.overflowCap.suffix'),
        placeholder: t('tenants.overflowCap.placeholder'),
        step: 0.25,
        save: async (id, next) => (await adminApi.setTenantPaidOverflowCap(id, next)).paidOverflowDailyCap,
      }}
    />
  );
}
