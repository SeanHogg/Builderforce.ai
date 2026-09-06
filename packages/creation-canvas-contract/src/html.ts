/**
 * HTML escaping — the ONE escape set for every string interpolated into markup.
 *
 * Twelve copies of this function existed across the api, the frontend and this
 * package, with THREE different escape sets: some skipped `"` (unsafe inside an
 * attribute), some skipped `'` (unsafe inside a single-quoted attribute), and the
 * mail templates disagreed with each other. An escaper that is correct for text
 * nodes but not attributes is a bug waiting for the first template that puts a
 * user-authored string in `title="…"`.
 *
 * This set is safe in BOTH positions, so a caller never has to know which one it
 * is writing into. Everything that reaches markup — creator-authored website
 * fields, email bodies, game titles, unsubscribe confirmations, print documents —
 * goes through here.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape for text and attribute positions alike. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
