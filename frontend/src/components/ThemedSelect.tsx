'use client';

/**
 * ThemedSelect — the canonical native `<select>` for the app.
 *
 * Why this exists: a native `<option>` popup is drawn by the OS/webview and does
 * NOT inherit the `<select>`'s background. Our theme surface tokens are often
 * translucent, so an option that only inherits `color` lands on a white OS popup
 * as light-on-white (unreadable). Every option must therefore carry its OWN
 * opaque background+foreground pair, ending in the `Canvas`/`CanvasText` system
 * colors, which follow the OS light/dark setting and are guaranteed legible.
 *
 * Use this instead of a raw `<select>` so that fix lives in exactly one place.
 */
import type { CSSProperties } from 'react';

export interface ThemedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Opaque bg/fg duo for native option rows — see the file comment for why. */
export const themedOptionStyle: CSSProperties = {
  background: 'var(--bg-surface, Canvas)',
  color: 'var(--text-primary, CanvasText)',
};

export function ThemedSelect({
  options,
  value,
  onChange,
  disabled,
  id,
  ariaLabel,
  style,
}: {
  options: ThemedSelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '6px 8px',
        borderRadius: 8,
        fontSize: 13,
        maxWidth: '100%',
        background: 'var(--surface-2)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} style={themedOptionStyle}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
