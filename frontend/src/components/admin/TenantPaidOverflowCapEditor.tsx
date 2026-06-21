'use client';

import { useState } from 'react';
import { adminApi } from '@/lib/adminApi';

/**
 * Superadmin override for a tenant's daily FUNDED paid-overflow ceiling.
 *
 * The gateway always appends a premium-fallback + reliability-backstop chain to
 * every cascade so a saturated free pool never surfaces a hard LLM_UNAVAILABLE.
 * Those calls run on Builderforce's OWN keys, so this caps how much funded
 * overflow a tenant can drive per UTC day (migration 0130). Stored in
 * MILLICENTS (1/100000 USD); this editor presents it in dollars.
 *
 *   null → plan default (free = $0.50/day; pro/teams = unlimited)
 *   -1   → unlimited (gate skipped)
 *   >= 0 → explicit millicents/day ceiling
 *
 * Owns its own state + PATCH call (mirrors TenantTokenLimitOverrideEditor).
 */

type Mode = 'plan_default' | 'unlimited' | 'custom';

/** 1 USD = 100,000 millicents (millicent = 1/100000 USD; see usageLedger). */
const MILLICENTS_PER_USD = 100_000;

function modeFor(value: number | null): Mode {
  if (value === null) return 'plan_default';
  if (value === -1) return 'unlimited';
  return 'custom';
}

function millicentsToUsdStr(millicents: number): string {
  // Trim trailing zeros so $0.50 shows as "0.50" and $2 as "2".
  return (millicents / MILLICENTS_PER_USD).toFixed(2).replace(/\.00$/, '');
}

interface Props {
  tenantId: number;
  value: number | null;
  onChange: (next: number | null) => void;
}

export function TenantPaidOverflowCapEditor({ tenantId, value, onChange }: Props) {
  const [mode, setMode] = useState<Mode>(modeFor(value));
  const [customUsd, setCustomUsd] = useState<string>(
    value !== null && value >= 0 ? millicentsToUsdStr(value) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary =
    value === null ? 'Plan default (free $0.50/day · pro unlimited)'
    : value === -1 ? 'Unlimited (gate skipped)'
    : `$${millicentsToUsdStr(value)} / day`;

  const save = async () => {
    setError(null);
    let next: number | null;
    if (mode === 'plan_default') next = null;
    else if (mode === 'unlimited') next = -1;
    else {
      const dollars = Number(customUsd);
      if (!Number.isFinite(dollars) || dollars < 0) {
        setError('Enter a non-negative dollar amount (or pick a different option).');
        return;
      }
      next = Math.round(dollars * MILLICENTS_PER_USD);
    }

    setSaving(true);
    try {
      const updated = await adminApi.setTenantPaidOverflowCap(tenantId, next);
      onChange(updated.paidOverflowDailyCap);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
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
        <div style={{ fontSize: 13, fontWeight: 700 }}>Funded overflow cap</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Current: {summary}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name={`pofc-${tenantId}`}
            checked={mode === 'plan_default'}
            onChange={() => setMode('plan_default')}
            disabled={saving}
          />
          Plan default
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name={`pofc-${tenantId}`}
            checked={mode === 'unlimited'}
            onChange={() => setMode('unlimited')}
            disabled={saving}
          />
          Unlimited
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name={`pofc-${tenantId}`}
            checked={mode === 'custom'}
            onChange={() => setMode('custom')}
            disabled={saving}
          />
          Custom: $
          <input
            type="number"
            min={0}
            step={0.25}
            value={customUsd}
            onChange={(e) => { setCustomUsd(e.target.value); setMode('custom'); }}
            placeholder="e.g. 0.50"
            disabled={saving}
            style={{
              width: 100, padding: '4px 8px', fontSize: 12,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 6,
            }}
          />
          / day
        </label>

        <button
          type="button"
          className="btn-primary"
          style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px' }}
          onClick={(e) => { e.stopPropagation(); void save(); }}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--coral-bright)' }}>{error}</div>
      )}
    </div>
  );
}
