'use client';

import { useState } from 'react';
import { adminApi } from '@/lib/adminApi';

/**
 * Superadmin override for a tenant's daily LLM token cap.
 *
 *   null → use plan default
 *   -1   → unlimited (gate skipped)
 *   >= 0 → use this exact value as the daily cap
 *
 * Owns its own state and PATCH call — caller just passes tenantId + initial
 * value and a callback for the new value so the parent can update its row.
 */

type Mode = 'plan_default' | 'unlimited' | 'custom';

function modeFor(value: number | null): Mode {
  if (value === null) return 'plan_default';
  if (value === -1) return 'unlimited';
  return 'custom';
}

interface Props {
  tenantId: number;
  value: number | null;
  onChange: (next: number | null) => void;
}

export function TenantTokenLimitOverrideEditor({ tenantId, value, onChange }: Props) {
  const [mode, setMode] = useState<Mode>(modeFor(value));
  const [customStr, setCustomStr] = useState<string>(
    value !== null && value >= 0 ? String(value) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary =
    value === null ? 'Using plan default'
    : value === -1 ? 'Unlimited (gate skipped)'
    : `${value.toLocaleString()} tokens / day`;

  const save = async () => {
    setError(null);
    let next: number | null;
    if (mode === 'plan_default') next = null;
    else if (mode === 'unlimited') next = -1;
    else {
      const n = Number(customStr);
      if (!Number.isInteger(n) || n < 0) {
        setError('Enter a non-negative integer (or pick a different option).');
        return;
      }
      next = n;
    }

    setSaving(true);
    try {
      const updated = await adminApi.setTenantTokenLimitOverride(tenantId, next);
      onChange(updated.tokenDailyLimitOverride);
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
        <div style={{ fontSize: 13, fontWeight: 700 }}>Daily token cap</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Current: {summary}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name={`tdlo-${tenantId}`}
            checked={mode === 'plan_default'}
            onChange={() => setMode('plan_default')}
            disabled={saving}
          />
          Plan default
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name={`tdlo-${tenantId}`}
            checked={mode === 'unlimited'}
            onChange={() => setMode('unlimited')}
            disabled={saving}
          />
          Unlimited
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name={`tdlo-${tenantId}`}
            checked={mode === 'custom'}
            onChange={() => setMode('custom')}
            disabled={saving}
          />
          Custom:
          <input
            type="number"
            min={0}
            step={1000}
            value={customStr}
            onChange={(e) => { setCustomStr(e.target.value); setMode('custom'); }}
            placeholder="e.g. 250000"
            disabled={saving}
            style={{
              width: 130, padding: '4px 8px', fontSize: 12,
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 6,
            }}
          />
          tokens / day
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
