import { memo, type ReactNode } from 'react';

/**
 * WHERE a turn goes, as one chip in the composer's tool row — extracted from the canvas's
 * scope chip (IN the whole board / the selection / a frame). A host supplies the options
 * and decides whether there is anything to choose; the chip is a native select so it is
 * keyboard- and screen-reader-complete everywhere. (Who a turn is addressed TO is the
 * shared `RecipientPicker`.)
 */
export interface ContextChipOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface ContextChipProps<V extends string> {
  /** Accessible name — what this chip chooses. */
  label: string;
  value: V;
  options: readonly ContextChipOption<V>[];
  onChange: (value: V) => void;
  /** A small leading glyph. */
  icon?: ReactNode;
  /** A host's own class (the canvas paints the chip in its own palette). */
  className?: string;
}

function ContextChipImpl<V extends string>({ label, value, options, onChange, icon, className }: ContextChipProps<V>) {
  return (
    <label className={['bf-ctxchip', className].filter(Boolean).join(' ')}>
      {icon && <span className="bf-ctxchip__icon" aria-hidden>{icon}</span>}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as V)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export const ContextChip = memo(ContextChipImpl) as typeof ContextChipImpl;
