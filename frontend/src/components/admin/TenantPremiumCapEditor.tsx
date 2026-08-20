'use client';

import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { TenantIntegerOverrideEditor } from './TenantIntegerOverrideEditor';

/**
 * Superadmin override for a tenant's daily PREMIUM spend ceiling (migration 0952).
 *
 * The sibling of {@link TenantPaidOverflowCapEditor}, and a deliberately SEPARATE
 * ceiling: that one bounds spend Builderforce funds on its own keys, this one bounds
 * what the tenant runs up on the metered any-paid-OpenRouter tier — including
 * Opus-class ids at ~$75/M output, which until 0952 nothing capped at all.
 *
 * Stored in MILLICENTS (1/100000 USD); presented in dollars.
 *   null → plan default ($10/day) · -1 → unlimited · >= 0 → millicents/day.
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

export function TenantPremiumCapEditor({ tenantId, value, onChange }: Props) {
  const t = useTranslations('admin');
  return (
    <TenantIntegerOverrideEditor
      tenantId={tenantId}
      value={value}
      onChange={onChange}
      config={{
        label: t('tenants.premiumCap.label'),
        fieldKey: 'pdc',
        summary: (v) =>
          v === null ? t('tenants.premiumCap.summaryPlanDefault')
          : v === -1 ? t('tenants.premiumCap.summaryUnlimited')
          : t('tenants.premiumCap.summaryCustom', { value: millicentsToUsdStr(v) }),
        toInput: (stored) => millicentsToUsdStr(stored),
        fromInput: (input) => {
          const dollars = Number(input);
          if (!Number.isFinite(dollars) || dollars < 0) return null;
          return Math.round(dollars * MILLICENTS_PER_USD);
        },
        customPrefix: '$',
        customSuffix: t('tenants.premiumCap.suffix'),
        placeholder: t('tenants.premiumCap.placeholder'),
        step: 1,
        save: async (id, next) => (await adminApi.setTenantPremiumCap(id, next)).premiumDailyCap,
      }}
    />
  );
}
