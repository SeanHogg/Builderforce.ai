/**
 * The rating scale, stated once for the browser.
 *
 * The server owns the authoritative bounds (`application/reviews/objectReviews.ts`
 * validates against them and refuses anything outside). These constants exist so
 * the UI draws the right number of stars and disables submit on an out-of-range
 * value — a duplicate of a NUMBER, not of the rule, and the smallest thing that
 * could be duplicated instead of hard-coding `5` in four components.
 *
 * If the scale ever changes it changes in two files, and the server's refusal is
 * what keeps the browser honest in the meantime.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Every score, low to high — for a histogram, which reads top-down from 5. */
export const RATING_SCORES = [1, 2, 3, 4, 5] as const;
