'use client';

import { useCallback, useEffect, useId, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import styles from './InlineConfirmButton.module.css';

/** How long an armed button waits for the second click before standing down. */
const DEFAULT_DISARM_MS = 6000;

export interface InlineConfirmButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children' | 'type'> {
  /** The idle label — what the button says before it is armed. */
  children: ReactNode;
  /** The armed label. Defaults (localized) to "Confirm". */
  confirmLabel?: ReactNode;
  /** The consequence, shown (and announced) while armed — say what will happen. */
  hint?: string;
  /** Runs on the SECOND click only. */
  onConfirm: () => unknown;
  /** Stand down after this long without the second click. Default 6s. */
  disarmAfterMs?: number;
  /** Fill the container's width (for full-width action buttons). */
  block?: boolean;
}

/**
 * The inline two-step control — the ONE replacement for a non-destructive
 * "Are you sure?" modal.
 *
 * Modals are reserved for destructive approvals (`useConfirm()`). An action that
 * loses nothing but still deserves a deliberate gesture — resubscribe, approve a
 * skill, run maintenance, put a release back on sale — arms on the first click
 * (the label turns into the confirm label, the consequence appears beside it) and
 * runs on the second. It stands down on its own after `disarmAfterMs`, on Escape,
 * on its Cancel link, or when it becomes disabled, so an armed button never waits
 * around to be hit by accident.
 *
 * Styling stays the caller's: `className` / `style` land on the trigger exactly
 * as on a plain `<button>`, so each surface keeps its own button chrome and only
 * the armed ring (a theme token) is added.
 */
export function InlineConfirmButton({
  children,
  confirmLabel,
  hint,
  onConfirm,
  disarmAfterMs = DEFAULT_DISARM_MS,
  block = false,
  className,
  disabled,
  onKeyDown,
  ...buttonProps
}: InlineConfirmButtonProps) {
  const t = useTranslations('common');
  const [armed, setArmed] = useState(false);
  const hintId = useId();
  const disarm = useCallback(() => setArmed(false), []);

  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(disarm, disarmAfterMs);
    return () => clearTimeout(id);
  }, [armed, disarmAfterMs, disarm]);

  // A control that went disabled mid-arm (busy, lost permission) must not come
  // back armed when it is re-enabled — adjusted while rendering, not in an effect.
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled);
    if (disabled) setArmed(false);
  }

  const handleClick = () => {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    void onConfirm();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (armed && event.key === 'Escape') { event.preventDefault(); disarm(); }
  };

  return (
    <span className={block ? `${styles.root} ${styles.block}` : styles.root}>
      <button
        {...buttonProps}
        type="button"
        className={[className, styles.trigger].filter(Boolean).join(' ')}
        data-armed={armed || undefined}
        disabled={disabled}
        aria-describedby={armed ? hintId : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {armed ? (confirmLabel ?? t('inlineConfirm.confirm')) : children}
      </button>
      {armed && (
        <button type="button" className={styles.cancel} onClick={disarm}>
          {t('cancel')}
        </button>
      )}
      {/* Always mounted so the change is announced; visible only when there is a
          consequence to read. Without one, the armed state is announced to AT. */}
      <span id={hintId} aria-live="polite" className={armed && hint ? styles.hint : styles.srOnly}>
        {armed ? (hint ?? t('inlineConfirm.armed')) : ''}
      </span>
    </span>
  );
}
