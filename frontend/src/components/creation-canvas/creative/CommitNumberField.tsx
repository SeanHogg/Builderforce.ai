import { useEffect, useId, useState } from 'react';
import styles from '../styles/creativeEditors.module.css';

export interface CommitNumberFieldProps {
  label: string;
  value: number;
  disabled?: boolean;
  /** The smallest value the field accepts; a smaller entry snaps back instead of committing. */
  min?: number;
  step?: number;
  onCommit: (value: number) => void;
}

/**
 * A number input that writes once, on blur or Enter, rather than on every keystroke.
 *
 * The editors persist their whole document on each change, and typing "120" would
 * otherwise write the object as 1, 12 and 120. An entry that is not a number, or is
 * below `min`, is dropped and the field shows the stored value again.
 */
export function CommitNumberField({ label, value, disabled, min, step, onCommit }: CommitNumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(next) || (min !== undefined && next < min)) { setDraft(String(value)); return; }
    if (next !== value) onCommit(next);
  };

  return <label className={styles.field} htmlFor={id}>
    <span>{label}</span>
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      {...(min !== undefined ? { min } : {})}
      {...(step !== undefined ? { step } : {})}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
    />
  </label>;
}
