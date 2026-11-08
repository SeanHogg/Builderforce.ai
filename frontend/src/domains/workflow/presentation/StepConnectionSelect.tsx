import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { hintStyle, inputStyle, labelStyle, optionStyle } from './stepFieldStyles';

/**
 * THE ONE "WHICH STORED CONNECTION" CONTROL a step form draws.
 *
 * A step can run through two different stores — the integration credential vault
 * (`mcp` steps) and the connector connections (`connector` steps) — but the control
 * is the same: a list of what exists, an "automatic" choice that stores nothing, a
 * stale-pin warning, and an inline "connect new". Only WHERE the options come from
 * and WHICH existing connect flow opens differ, so that is all a caller supplies
 * (`StepConnectionSource`); the picker is not written twice.
 */
export interface StepConnectionSource {
  options: Array<{ id: string; name: string }>;
  loading: boolean;
  loadFailed: boolean;
  /** Renders the existing connect flow; null = the viewer cannot connect one here.
   *  `done(id?)` closes it (selecting `id` when the flow knows the new row). */
  connect: ((done: (createdId?: string) => void, cancel: () => void) => ReactNode) | null;
}

export interface StepConnectionSelectProps {
  source: StepConnectionSource;
  /** The picked id; '' = automatic. */
  value: string;
  onChange: (id: string) => void;
}

export function StepConnectionSelect({ source, value, onChange }: StepConnectionSelectProps) {
  const t = useTranslations('workflow.credentials');
  const [connecting, setConnecting] = useState(false);
  const { options, loading, loadFailed, connect } = source;

  // A pinned id that is no longer listed (deleted / disabled) stays visible so the
  // author sees what the step points at instead of a silently blank picker.
  const stale = Boolean(value) && !loading && !loadFailed && !options.some((o) => o.id === value);

  const done = (createdId?: string) => {
    if (createdId) onChange(createdId);
    setConnecting(false);
  };

  return (
    <div>
      <label style={labelStyle}>
        {t('label')}
        <Select style={inputStyle} value={value} disabled={loading} onChange={(e) => onChange(e.target.value)}>
          <option style={optionStyle} value="">
            {loading ? t('loading') : options.length === 0 ? t('none') : t('automatic')}
          </option>
          {options.map((o) => (
            <option key={o.id} style={optionStyle} value={o.id}>{o.name}</option>
          ))}
          {stale && <option style={optionStyle} value={value}>{t('missing')}</option>}
        </Select>
      </label>

      {loadFailed && <div role="alert" style={{ ...hintStyle, color: 'var(--danger)' }}>{t('loadFailed')}</div>}
      {stale && <div role="alert" style={{ ...hintStyle, color: 'var(--danger)' }}>{t('missingHint')}</div>}
      {!loading && !loadFailed && options.length === 0 && !connecting && (
        <div style={hintStyle}>{t('noneHint')}</div>
      )}

      {connect && !connecting && (
        <button
          type="button"
          onClick={() => setConnecting(true)}
          style={{ ...hintStyle, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--coral-bright)', textDecoration: 'underline' }}
        >
          {t('connectNew')}
        </button>
      )}

      {connect && connecting && connect(done, () => setConnecting(false))}
    </div>
  );
}
