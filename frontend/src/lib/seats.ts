/**
 * The seats, and the ONE place a seat's colour is decided (PRD 21 §11.10.1).
 *
 * A seat's hue was being invented three times over — BurnRateOS assigned each
 * domain a colour on its marketing cards, the roster picked its own, and the
 * canvas picked a third for agent objects. Twelve seats across three surfaces is
 * how one CFO ends up green in one place and blue in another; it is the colour
 * form of the four-name problem §11.1 describes.
 *
 * Every value resolves to a categorical hue already declared in `globals.css`
 * for BOTH themes, so this list spends no new colour — it only stops three
 * surfaces from each picking their own. Read it through {@link seatHue}; never
 * hard-code a seat colour at a call site.
 *
 * Note the constraint this creates and take it deliberately: twelve seats
 * consume all eleven categorical hues plus the brand, so a THIRTEENTH always-on
 * seat needs a twelfth hue declared before it needs a menu entry.
 */

export const SEATS = [
  'CEO', 'CFO', 'CRO', 'CMO', 'CTO', 'CPO',
  'HR', 'Recruiter', 'Security', 'Support', 'Manager', 'Brain',
] as const;

export type Seat = (typeof SEATS)[number];

/** A destination nobody sits behind — panel only, per PRD 21 §4. */
export type SeatOrPlatform = Seat | 'platform';

/**
 * Seat → CSS custom property. The properties themselves are declared once in
 * `globals.css` as aliases of the categorical family, which is why this map
 * holds variable NAMES and never a literal.
 */
const SEAT_HUE: Record<SeatOrPlatform, string> = {
  CEO: '--seat-ceo',
  CFO: '--seat-cfo',
  CRO: '--seat-cro',
  CMO: '--seat-cmo',
  CTO: '--seat-cto',
  CPO: '--seat-cpo',
  HR: '--seat-hr',
  Recruiter: '--seat-recruiter',
  Security: '--seat-security',
  Support: '--seat-support',
  Manager: '--seat-manager',
  Brain: '--seat-brain',
  // Not a seat: a platform-owned destination takes the brand rather than
  // borrowing somebody's identity.
  platform: '--coral-bright',
};

/** `var(--seat-…)` for a seat — the only way a surface should reach a seat colour. */
export function seatHue(seat: SeatOrPlatform): string {
  return `var(${SEAT_HUE[seat] ?? SEAT_HUE.platform})`;
}

/** The raw custom-property name, for the guard and for `style` custom properties. */
export function seatHueVar(seat: SeatOrPlatform): string {
  return SEAT_HUE[seat] ?? SEAT_HUE.platform;
}

/** A tinted fill of the seat's hue. Derived rather than declared, so the mix
 *  follows the base through both themes and there is still one declaration. */
export function seatTint(seat: SeatOrPlatform, percent = 12): string {
  return `color-mix(in srgb, ${seatHue(seat)} ${percent}%, transparent)`;
}

/** Is this a real teammate (a chip in the footer) rather than the platform? */
export function isSeat(value: SeatOrPlatform): value is Seat {
  return value !== 'platform';
}

/** Initials for a seat chip. Acronym seats are their own initials. */
export function seatInitials(seat: SeatOrPlatform): string {
  if (seat === 'platform') return 'BF';
  return seat.length <= 3 ? seat.toUpperCase() : seat.slice(0, 2).toUpperCase();
}
