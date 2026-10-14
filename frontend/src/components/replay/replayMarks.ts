/**
 * How a timeline mark looks, as data.
 *
 * The player's markers, its event list and the journey tab all draw marks; one
 * table decides the icon, the ink and the label key so the three can never
 * disagree about what a rage click looks like. A kind the table does not know
 * (a recorder newer than this build) falls back to the neutral `event` style.
 */

import type { MarkKind } from '@builderforce/interaction-contract';
import type { IconName } from '@/components/ui/Icon';

export interface MarkStyle {
  icon: IconName;
  /** A token, never a literal colour. */
  tone: string;
  /** Under the `replay.player` namespace. */
  labelKey: string;
}

export const MARK_STYLES: Readonly<Record<MarkKind, MarkStyle>> = {
  page: { icon: 'document', tone: 'var(--text-secondary)', labelKey: 'mark.page' },
  click: { icon: 'target', tone: 'var(--text-secondary)', labelKey: 'mark.click' },
  event: { icon: 'flag', tone: 'var(--accent)', labelKey: 'mark.event' },
  rage: { icon: 'alert', tone: 'var(--error)', labelKey: 'mark.rage' },
  dead: { icon: 'cursor', tone: 'var(--warning)', labelKey: 'mark.dead' },
  quickback: { icon: 'chevron-left', tone: 'var(--warning)', labelKey: 'mark.quickback' },
  excessive_scroll: { icon: 'activity', tone: 'var(--warning)', labelKey: 'mark.excessive_scroll' },
  error: { icon: 'warning', tone: 'var(--error)', labelKey: 'mark.error' },
  vital: { icon: 'clock', tone: 'var(--text-secondary)', labelKey: 'mark.vital' },
  scroll: { icon: 'arrow-up', tone: 'var(--text-secondary)', labelKey: 'mark.scroll' },
};

export function markStyle(kind: string): MarkStyle {
  return (MARK_STYLES as Readonly<Record<string, MarkStyle | undefined>>)[kind] ?? MARK_STYLES.event;
}

/** Marks drawn on the scrubber. Click / scroll / vital marks are list-only — they would bury the signals. */
export const TIMELINE_MARK_KINDS: ReadonlySet<string> = new Set<MarkKind>(['rage', 'dead', 'quickback', 'excessive_scroll', 'error', 'event', 'page']);

/** `m:ss`, or `h:mm:ss` past the hour. Digits only, so it reads the same in every locale. */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
