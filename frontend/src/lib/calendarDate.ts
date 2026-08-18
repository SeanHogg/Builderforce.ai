/**
 * Formatting for a CALENDAR DATE — a `YYYY-MM-DD` with no time and no zone.
 *
 * A calendar date is not an instant. "2026-08-15" is the day an article was
 * published, the same day for every reader on earth, and it must render as that
 * day everywhere. `new Date('2026-08-15')` disagrees: the ECMAScript spec parses
 * a date-ONLY string as UTC midnight, and `toLocaleDateString` then renders that
 * instant in whatever zone the runtime happens to be in. Anywhere west of UTC
 * lands on the previous evening, so the post printed "August 14, 2026" in New
 * York and "August 15, 2026" on the build machine.
 *
 * That was two bugs, not one. The visible bug: every article card and article
 * page showed the wrong day to roughly half the world. The louder one: the
 * homepage is statically prerendered in UTC and hydrated in the visitor's zone,
 * so the two renders disagreed on a text node and React threw #418 — "Hydration
 * failed because the server rendered text didn't match the client" — discarding
 * and re-rendering the tree on every load west of UTC.
 *
 * Pinning `timeZone: 'UTC'` makes the render depend only on the string, which is
 * the only thing a calendar date actually carries. It is deliberately NOT the
 * rule for timestamps: `receivedAt`, `acknowledgedAt`, `expiresAt` and friends
 * are real instants, and showing those in the reader's own zone is correct.
 */

/** Month-name form: "August 15, 2026". */
export function formatCalendarDate(iso: string, locale: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
