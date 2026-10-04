import { ControlButton } from '@xyflow/react';
import type { ReactNode } from 'react';
import styles from '../CanvasCommands.module.css';

/**
 * A rail command that is ON or OFF, lit while it is on.
 *
 * Every mode on the rail — 3D, the mini map, the accessible outline — needs the
 * same two things: `aria-pressed` for assistive tech, and a visible lit state so
 * a sighted user can tell at a glance which view they are in. Both live here so
 * a new mode cannot ship with one and not the other.
 */
export function CanvasRailToggle({ pressed, onClick, label, activeTitle, inactiveTitle, children }: {
  pressed: boolean;
  onClick: () => void;
  /** Stable accessible name — it must not change when the mode flips. */
  label: string;
  /** Tooltip while the mode is on, and while it is off. Both fall back to `label`. */
  activeTitle?: string;
  inactiveTitle?: string;
  children: ReactNode;
}) {
  return <ControlButton
    className={styles.railToggle}
    onClick={onClick}
    aria-label={label}
    aria-pressed={pressed}
    title={(pressed ? activeTitle : inactiveTitle) ?? label}
  >{children}</ControlButton>;
}
