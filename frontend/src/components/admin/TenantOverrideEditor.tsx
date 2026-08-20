'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * The superadmin per-tenant override control, once.
 *
 * Every one of these overrides is the same interaction: a titled card, the current
 * effective value on the right, a row of mutually-exclusive MODES, one Save, one error
 * line. Only the modes differ — an integer cap offers plan-default / unlimited / custom,
 * a boolean flag offers plan-default / forced — and that difference was previously
 * expressed by copying the whole card.
 *
 * So the modes are DATA. A new override kind is an array of {@link OverrideMode}s, not
 * another component that re-types the chrome and then drifts from it.
 *
 * Generic in the stored value so a boolean override and an `number | null` override
 * share this without either widening to `unknown`.
 */

export interface OverrideMode<T> {
  /** Stable id, unique within one editor — also the radio's value. */
  id: string;
  label: string;
  /** True when the stored value means this mode is the current one. */
  matches: (value: T) => boolean;
  /**
   * What Save should persist when this mode is selected. Returns a failure instead of
   * throwing so a bad custom input renders the same inline error as a failed PATCH,
   * rather than surfacing as an exception.
   */
  resolve: () => { ok: true; value: T } | { ok: false; error: string };
  /**
   * Optional inline control rendered inside this mode's label (e.g. the custom number
   * input). Receives `selectMode` so typing in it selects its own mode — the caller
   * should not have to wire that up, and every copy of this card previously did.
   */
  control?: (args: { selectMode: () => void; disabled: boolean }) => ReactNode;
}

interface Props<T> {
  tenantId: number;
  value: T;
  onChange: (next: T) => void;
  /** Heading, e.g. "Daily token cap". */
  label: string;
  /** Stable id fragment for the radio group name (unique per editor kind). */
  fieldKey: string;
  /** Render the current effective value as a human summary. */
  summary: (value: T) => string;
  modes: ReadonlyArray<OverrideMode<T>>;
  /** Persist the new value; returns the value the backend echoes. */
  save: (tenantId: number, next: T) => Promise<T>;
}

export function TenantOverrideEditor<T>({
  tenantId, value, onChange, label, fieldKey, summary, modes, save,
}: Props<T>) {
  const t = useTranslations('admin');
  const initial = modes.find((mode) => mode.matches(value)) ?? modes[0];
  const [modeId, setModeId] = useState<string>(initial.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const mode = modes.find((m) => m.id === modeId);
    if (!mode) return;
    const resolved = mode.resolve();
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    setSaving(true);
    try {
      onChange(await save(tenantId, resolved.value));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tenants.intOverride.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const name = `${fieldKey}-${tenantId}`;

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('tenants.intOverride.current', { value: summary(value) })}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12 }}>
        {modes.map((mode) => (
          <label key={mode.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="radio"
              name={name}
              value={mode.id}
              checked={modeId === mode.id}
              onChange={() => setModeId(mode.id)}
              disabled={saving}
            />
            {mode.label}
            {mode.control?.({ selectMode: () => setModeId(mode.id), disabled: saving })}
          </label>
        ))}

        <button
          type="button"
          className="btn-primary"
          style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px' }}
          onClick={(e) => { e.stopPropagation(); void submit(); }}
          disabled={saving}
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
