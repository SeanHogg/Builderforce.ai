import type { ReactNode } from 'react';
import { BrainMark } from './BrainMark';

/**
 * <SurfaceEmptyState> — an AI conversation before its first message: a greeting, the
 * host's controls and the starting points. Moved from the web Brain panel
 * (`BrainEmptyState`) so the editor and Rovr open on the same screen.
 *
 * `page` — a centred hero with the composer in the middle (the full Brain page).
 * `docked` — a side column: a compact greeting and the starters scroll ABOVE a composer
 * the host pins in its `SurfaceFooter`, in the same place it stays once the chat has
 * started, so the first message does not make the input jump.
 *
 * There is no "Start new chat" button: this IS a new chat, and sending (or picking a
 * starter) creates it. Mode is chosen in the composer's `/` menu, not a second toggle here.
 */
export interface SurfaceEmptyStateProps {
  layout: 'page' | 'docked';
  /** The greeting line (docked) / the surface's name (page). */
  title: string;
  /** One line under it — follows the armed mode. */
  hint: string;
  /** Host-owned controls above the starters (the new-chat project picker). */
  controls?: ReactNode;
  /** Page layout only — docked hosts render the composer in their pinned footer. */
  composer?: ReactNode;
  /** The starting points (`StarterGroup`s of `StarterTile`s). */
  starters?: ReactNode;
}

export function SurfaceEmptyState({ layout, title, hint, controls, composer, starters }: SurfaceEmptyStateProps) {
  const docked = layout === 'docked';
  return (
    <div className={`bf-empty bf-empty--${layout}`}>
      {docked ? (
        <div className="bf-empty__greet">
          <span aria-hidden className="bf-empty__mark"><BrainMark /></span>
          <div className="bf-empty__copy">
            <div className="bf-empty__title">{title}</div>
            <div className="bf-empty__hint">{hint}</div>
          </div>
        </div>
      ) : (
        <>
          <span aria-hidden className="bf-empty__mark bf-empty__mark--hero"><BrainMark /></span>
          <div className="bf-empty__title">{title}</div>
          <div className="bf-empty__hint">{hint}</div>
        </>
      )}
      {controls != null && <div className="bf-empty__controls">{controls}</div>}
      {!docked && composer != null && <div className="bf-empty__composer">{composer}</div>}
      {starters != null && <div className="bf-empty__starters">{starters}</div>}
    </div>
  );
}
