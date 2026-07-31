'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';

/**
 * Superadmin override for premium LLM routing.
 *
 *   true  → tenant routes through the top PREMIUM-tier models with the
 *           extended per-vendor timeout (60s), regardless of plan/billing.
 *   false → tenant routes through their plan default (Free/Pro/Teams pool).
 *
 * Mirrors TenantTokenLimitOverrideEditor: owns its own state and PATCH call,
 * caller passes tenantId + initial value and a callback for the parent row.
 */

interface Props {
  tenantId: number;
  value: boolean;
  onChange: (next: boolean) => void;
}

export function TenantPremiumOverrideEditor({ tenantId, value, onChange }: Props) {
  const t = useTranslations('admin');
  const [pending, setPending] = useState<boolean>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = pending !== value;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const updated = await adminApi.setTenantPremiumOverride(tenantId, pending);
      onChange(updated.premiumOverride);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tenants.premiumOverride.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{t('tenants.premiumOverride.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('tenants.premiumOverride.current', { value: value ? t('tenants.premiumOverride.currentPremium') : t('tenants.premiumOverride.currentDefault') })}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12 }}>
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

        <button
          type="button"
          className="btn-primary"
          style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px', opacity: dirty ? 1 : 0.5 }}
          onClick={(e) => { e.stopPropagation(); void save(); }}
          disabled={saving || !dirty}
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--coral-bright)' }}>{error}</div>
      )}
    </div>
  );
}
