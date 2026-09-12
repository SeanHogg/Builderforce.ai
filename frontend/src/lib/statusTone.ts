import type { CSSProperties } from 'react';

/**
 * THE status → colour vocabulary.
 *
 * Eighteen-plus components each declared a private `STATUS_COLOR` / `STATUS_TONE` map,
 * and they had drifted three ways: some picked tokens, some picked raw `rgba(34,197,94,…)`
 * literals tuned against dark stock (unreadable on paper), and the same word — "running",
 * "connected", "funded" — came out coral in one panel, cyan in the next and amber in a
 * third. A status map now says only what a status MEANS (one of six tones); what a tone
 * LOOKS like is decided here, once, from theme tokens that are defined for light AND dark.
 *
 * The six tones are the `ui/Badge` tones, so a map can feed `<Badge tone>` directly.
 *
 *   - `neutral` — metadata, not-yet-started, finished-and-inert (draft, archived, skipped)
 *   - `accent`  — the brand's "this is the live one" (open PR, running, in flight)
 *   - `info`    — informational progress (submitted, in progress, mediating, done-for-the-record)
 *   - `success` — the good outcome (approved, merged, healthy, paid)
 *   - `warning` — needs attention soon (at risk, pending review, paused on a person)
 *   - `danger`  — failed, breached, blocked, overdue
 *
 * Four renderings, because a status is drawn four ways in this product:
 *   - `text`   — a label or pill foreground (`--*-text`, AA contrast on its `bg`)
 *   - `solid`  — a dot, bar, graph stroke or chart fill (`--success`, `--error`, …)
 *   - `bg`     — a pill / row background (`--*-bg`)
 *   - `border` — a pill / card outline (`--*-border`)
 */
export type StatusTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

export const STATUS_TONES: readonly StatusTone[] = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'];

export type ToneRendering = 'text' | 'solid' | 'bg' | 'border';

const TONE_TOKENS: Record<ToneRendering, Record<StatusTone, string>> = {
  text: {
    neutral: 'var(--text-muted)',
    accent: 'var(--accent)',
    info: 'var(--info-text)',
    success: 'var(--success-text)',
    warning: 'var(--warning-text)',
    danger: 'var(--error-text)',
  },
  solid: {
    neutral: 'var(--text-muted)',
    accent: 'var(--accent)',
    info: 'var(--info)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--error)',
  },
  bg: {
    neutral: 'var(--surface-interactive)',
    accent: 'var(--accent-subtle)',
    info: 'var(--info-bg)',
    success: 'var(--success-bg)',
    warning: 'var(--warning-bg)',
    danger: 'var(--error-bg)',
  },
  border: {
    neutral: 'var(--border-default)',
    accent: 'var(--border-accent)',
    info: 'var(--info-border)',
    success: 'var(--success-border)',
    warning: 'var(--warning-border)',
    danger: 'var(--error-border)',
  },
};

/** The CSS colour (a `var(--token)`) for a tone in one rendering. Defaults to `text`. */
export function toneColor(tone: StatusTone, rendering: ToneRendering = 'text'): string {
  return TONE_TOKENS[rendering][tone];
}

/**
 * The pill/chip style for a tone — foreground, background and outline from the same
 * tone, so the three can never disagree. Spread it into a `style` beside layout.
 */
export function tonePillStyle(tone: StatusTone): Pick<CSSProperties, 'color' | 'background' | 'borderColor'> {
  return {
    color: TONE_TOKENS.text[tone],
    background: TONE_TOKENS.bg[tone],
    borderColor: TONE_TOKENS.border[tone],
  };
}

/**
 * A status map: the ONLY thing a component declares. Keys are the component's own status
 * vocabulary (typed where it has one, `string` where it arrives from the API unchecked).
 */
export type StatusToneMap<S extends string = string> = Readonly<Partial<Record<S, StatusTone>>>;

/**
 * Resolve a status through its map. An unknown / missing status falls back (default
 * `neutral`) instead of rendering `undefined` — a status the API added after the UI
 * shipped reads as metadata, never as an invisible label.
 */
export function statusTone<S extends string>(
  map: StatusToneMap<S>,
  status: S | string | null | undefined,
  fallback: StatusTone = 'neutral',
): StatusTone {
  if (status == null) return fallback;
  return (map as Readonly<Record<string, StatusTone | undefined>>)[status] ?? fallback;
}

/** `toneColor(statusTone(map, status), rendering)` — the one-liner most call sites want. */
export function statusColor<S extends string>(
  map: StatusToneMap<S>,
  status: S | string | null | undefined,
  rendering: ToneRendering = 'text',
  fallback: StatusTone = 'neutral',
): string {
  return toneColor(statusTone(map, status, fallback), rendering);
}

/** `tonePillStyle(statusTone(map, status))`. */
export function statusPillStyle<S extends string>(
  map: StatusToneMap<S>,
  status: S | string | null | undefined,
  fallback: StatusTone = 'neutral',
): Pick<CSSProperties, 'color' | 'background' | 'borderColor'> {
  return tonePillStyle(statusTone(map, status, fallback));
}
