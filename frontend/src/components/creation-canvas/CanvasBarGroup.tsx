// No 'use client' directive, for the reason `CanvasCommandBar.tsx` and
// `CanvasSessionActions.tsx` each state at the top of themselves: every importer sits
// inside the `CreationCanvas` client boundary already, so the directive marks nothing
// that has not already begun.
import { useTranslations } from 'next-intl';
import { canvasBarGroup, type CanvasBarGroupId } from '@/lib/canvasBarGroups';
import styles from './CreationCanvas.module.css';

/**
 * ONE captioned group in the canvas command bar.
 *
 * ── WHAT IT FIXES ────────────────────────────────────────────────────────────────
 * The bar had grouping and no LABELLING. Undo/redo sat in a trough, the three inspect
 * commands sat in another, the view commands in a bare row, the add-object door on its
 * own — and the only thing that said what any of them were for was an `aria-label` a
 * sighted reader never sees plus a tooltip you have to hover one icon at a time to
 * collect. A trough can say "these belong together"; nothing on the bar said WHAT they
 * belong to. The ••• sheet already captioned its sections and the bar did not.
 *
 * So this draws the group's name above it — the same 8px uppercase heading the sheet
 * uses (`.chromeHeading`, shared by both, so the two chromes cannot drift into two
 * typographies for one idea) — and keeps the trough underneath.
 *
 * ── WHY EVERY GROUP IN THE BAR GOES THROUGH HERE ─────────────────────────────────
 * Because captioning is the kind of decision that decays into six half-migrations. The
 * bar draws groups from four places — the session-action registry, the host's view
 * commands, the roster, and whatever the SURFACE contributed — and before this each one
 * spelled its own wrapper, its own `role="group"`, its own idea of whether a trough was
 * warranted and its own accessible name. One component, one row shell, one caption
 * treatment, and a group added next year is captioned by construction.
 *
 * ── THE TWO WAYS TO NAME ONE ─────────────────────────────────────────────────────
 * `group` — a host group, named by `lib/canvasBarGroups.ts`. Caption and accessible name
 *           both come from that table, so they cannot say different things.
 * `caption`/`label` — a SURFACE's own contribution (an app runtime's Run/Stop, an
 *           insights window). The surface owns its vocabulary; a host registry naming an
 *           app's controls would be the host learning what an app is.
 */

type CanvasBarGroupNaming =
  | { group: CanvasBarGroupId; caption?: never; label?: never }
  /** A surface naming its own contribution. `caption` is optional for the same reason
   *  `captionKey` is: a group whose controls are already worded has nothing to add. */
  | { group?: never; caption?: string; label: string };

export type CanvasBarGroupProps = {
  /**
   * `trough` — the segmented shell that says "one control, several segments". For sets
   * of glyphs.
   * `bare` — no shell, for a lone control or for members that carry their own chrome
   * (a worded button, an avatar). A single button in a segmented trough reads as a group
   * with a member missing.
   */
  shell?: 'trough' | 'bare';
  /** Published to the stylesheet by the caller when it has something to hang on it. */
  'data-testid'?: string;
  children: React.ReactNode;
} & CanvasBarGroupNaming;

export function CanvasBarGroup({ group, caption, label, shell = 'bare', children, ...rest }: CanvasBarGroupProps) {
  const t = useTranslations('creationCanvas');
  const def = group ? canvasBarGroup(group) : null;
  // The registry's keys are catalog keys; the cast is the same one every other consumer
  // of a registry-declared key makes (see `CanvasSessionActions`), because next-intl types
  // the key as a literal union and a registry deals in strings.
  const name = def ? t(def.labelKey as 'share') : (label as string);
  const heading = def ? (def.captionKey ? t(def.captionKey as 'share') : null) : caption ?? null;

  return (
    <div className={styles.barGroup} role="group" aria-label={name} data-group={group} {...rest}>
      {/* Hidden from assistive tech, not from the reader: the group is already NAMED by
          `aria-label`, and a caption exposed as text as well would have a screen reader
          read the same word twice — once as the group's name, once as stray text inside
          it. It is drawn for the eye that cannot hover eight tooltips. */}
      {heading && <span className={styles.barGroupCaption} aria-hidden>{heading}</span>}
      <div className={styles.barGroupRow} data-shell={shell}>{children}</div>
    </div>
  );
}
