import type { ReactNode } from 'react';
import { BrainMark } from './BrainMark';

/**
 * The ONE way back into a closed AI surface — extracted from the app-wide floating
 * launcher and now also the canvas's edge pill. It wears the header's mark (breathing
 * while a turn runs), an optional visible label (the pill form), and one count badge:
 * `awaiting` (a person must answer — pulses) outranks `unread` (informational).
 *
 * Placement is the host's (`className`): a fixed corner FAB, or an edge pill on the board.
 */
export interface SurfaceLauncherBadge {
  count: number;
  tone: 'awaiting' | 'unread';
  /** Accessible sentence for the count ("2 runs need you"). */
  label: string;
}

export interface SurfaceLauncherProps {
  onOpen: () => void;
  /** Accessible name / tooltip — what opening does, or what is happening. */
  label: string;
  running?: boolean;
  /** Visible text beside the mark (the pill form); omitted ⇒ icon-only. */
  text?: ReactNode;
  badge?: SurfaceLauncherBadge | null;
  /** Mark size (any CSS length). */
  markSize?: number | string;
  className?: string;
  /** Extra attributes a host's tests and styles key on (data-side, data-testid…). */
  dataAttrs?: Record<`data-${string}`, string>;
}

export function SurfaceLauncher({ onOpen, label, running = false, text, badge, markSize, className, dataAttrs }: SurfaceLauncherProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={['bf-launcher', className].filter(Boolean).join(' ')}
      data-state={running ? 'running' : badge ? badge.tone : 'idle'}
      {...dataAttrs}
    >
      <BrainMark running={running} {...(markSize !== undefined ? { size: markSize } : {})} />
      {text}
      {badge && badge.count > 0 && (
        <span
          className={`bf-launcher__badge bf-launcher__badge--${badge.tone}`}
          role="status"
          aria-label={badge.label}
          title={badge.label}
        >
          {badge.count > 99 ? '99+' : badge.count}
        </span>
      )}
    </button>
  );
}
