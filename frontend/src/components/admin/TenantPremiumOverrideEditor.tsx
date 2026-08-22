'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import { TenantOverrideCard } from './TenantOverrideCard';

/**
 * Superadmin override for premium LLM routing.
 *
 *   true  → tenant routes through the top PREMIUM-tier models with the
 *           extended per-vendor timeout (60s), regardless of plan/billing.
 *   false → tenant routes through their plan default (Free/Pro/Teams pool).
 *
 * Two radios over the shared {@link TenantOverrideCard}, which owns the chrome,
 * the save and the error the way it does for the integer caps.
 */
interface Props {
  tenantId: number;
  value: boolean;
  onChange: (next: boolean) => void;
}

export function TenantPremiumOverrideEditor({ tenantId, value, onChange }: Props) {
  const t = useTranslations('admin');
  const [pending, setPending] = useState<boolean>(value);

  const current = t('tenants.premiumOverride.current', {
    value: value ? t('tenants.premiumOverride.currentPremium') : t('tenants.premiumOverride.currentDefault'),
  });

  return (
    <TenantOverrideCard
      title={t('tenants.premiumOverride.title')}
      current={current}
      dirty={pending !== value}
      fallbackError={t('tenants.premiumOverride.updateFailed')}
      onSave={async () => {
        const updated = await adminApi.setTenantPremiumOverride(tenantId, pending);
        onChange(updated.premiumOverride);
      }}
    >
      {(saving) => (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name={`tpo-${tenantId}`}
              checked={!pending}
              onChange={() => setPending(false)}
              disabled={saving}
            />
            {t('tenants.premiumOverride.planDefault')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name={`tpo-${tenantId}`}
              checked={pending}
              onChange={() => setPending(true)}
              disabled={saving}
            />
            {t('tenants.premiumOverride.premiumOption')}
          </label>
        </>
      )}
    </TenantOverrideCard>
  );
}
