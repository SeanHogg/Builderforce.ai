'use client';

import { Select } from './Select';

export interface ThemeSelectOption {
  value: string;
  label: string;
}

export interface ThemeSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemeSelectOption[];
  /** Optional label for aria */
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Theme-aware dropdown with an options-array API. Thin wrapper over the drop-in
 * {@link Select} (which owns the themed, portaled popup) so options are readable
 * in both light and dark mode — native `<select>` popups can't be reliably
 * themed on Chrome/Windows.
 */
export function ThemeSelect({ value, onChange, options, ariaLabel, style, className }: ThemeSelectProps) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={className}
      style={{ display: 'block', width: '100%', fontSize: 12, ...style }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
