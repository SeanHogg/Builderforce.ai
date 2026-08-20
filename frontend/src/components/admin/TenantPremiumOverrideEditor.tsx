'use client';

import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { TenantOverrideEditor } from './TenantOverrideEditor';

/**
 * Superadmin override for premium LLM routing.
 *
 *   true  → tenant routes through the top PREMIUM-tier models with the
 *           extended per-vendor timeout (60s), regardless of plan/billing.
 *   false → tenant routes through their plan default (Free/Pro/Teams pool).
 *
 * A TWO-mode configuration of {@link TenantOverrideEditor} — the same component the
 * integer caps use with three modes. It previously hand-rolled the card, the radio row,
 * the dirty-tracking Save and the error line, which is how it drifted: the integer
 * editor's Save stayed enabled while this one greyed out unless dirty, so the two
 * override screens behaved differently for no reason a user could see.
 */

interface Props {
  tenantId: number;
  value: boolean;
  onChange: (next: boolean) => void;
}

export function TenantPremiumOverrideEditor({ tenantId, value, onChange }: Props) {
  const t = useTranslations('admin');

  return (
    <TenantOverrideEditor<boolean>
      tenantId={tenantId}
      value={value}
      onChange={onChange}
      label={t('tenants.premiumOverride.title')}
      fieldKey="tpo"
      summary={(v) => (v
        ? t('tenants.premiumOverride.currentPremium')
        : t('tenants.premiumOverride.currentDefault'))}
      save={async (id, next) => (await adminApi.setTenantPremiumOverride(id, next)).premiumOverride}
      modes={[
        {
          id: 'plan_default',
          label: t('tenants.premiumOverride.planDefault'),
          matches: (v) => !v,
          resolve: () => ({ ok: true, value: false }),
        },
        {
          id: 'premium',
          label: t('tenants.premiumOverride.premiumOption'),
          matches: (v) => v,
          resolve: () => ({ ok: true, value: true }),
        },
      ]}
    />
  );
}
