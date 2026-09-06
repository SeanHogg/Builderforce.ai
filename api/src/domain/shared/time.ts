/**
 * Millisecond units — declared ONCE.
 *
 * `const DAY_MS = 86_400_000` (or `24 * 60 * 60 * 1000`, or `MS_PER_DAY`) was
 * written in fifty-six modules under three spellings. None disagreed — a day is
 * a day — but fifty-six copies of a constant is fifty-six lines a reader has to
 * check are the constant they think, and the `MS_PER_DAY`/`DAY_MS` split meant a
 * grep for either name found half the sites.
 *
 * Pure and dependency-free, so every layer reads from here.
 */
export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;
