/**
 * Security finding severity → swatch, shared by the SOC 2 audit panel and the
 * website scan panel (each had declared it verbatim).
 *
 * An ordinal ramp (critical > high > medium > low > info), not a status map, so it
 * names colours rather than `StatusTone`s: `high` and `low` need rungs (orange,
 * coral) the six status tones do not have. Every swatch is a theme token.
 */
export const SEVERITY_COLOR: Readonly<Record<string, string>> = {
  critical: 'var(--error)', high: 'var(--orange-bright)', medium: 'var(--warning)', low: 'var(--coral-bright)', info: 'var(--text-muted)',
};
