/**
 * Pick a readable foreground (#000 / #fff) for a runtime-chosen background color.
 *
 * Several badges/pills set `color: '#fff'` on a brand color drawn from a palette
 * that includes light hues (amber #f59e0b, cyan #06b6d4) — white-on-light fails
 * WCAG contrast in both themes. Use this so the text color tracks the background's
 * luminance instead of being hardcoded.
 */

/** Relative luminance (0–1) of a #rgb / #rrggbb color; ~0.5 for `null`/unparseable. */
function luminance(hex: string): number {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Perceptual weighting (Rec. 601) — adequate for a black-vs-white text choice.
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Black for light backgrounds, white for dark — whichever reads better. The 0.5
 *  cutoff is the classic YIQ threshold (≈128/255). */
export function contrastText(background: string): '#000' | '#fff' {
  return luminance(background) >= 0.5 ? '#000' : '#fff';
}
