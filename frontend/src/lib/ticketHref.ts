/**
 * ticketHref — the ONE way to deep-link a ticket.
 *
 * There is no `/tasks/[id]` route in this app: `/tasks` is a list page with no dynamic
 * segment, so `/tasks/169` is a hard 404. The board's own deep-link has always been
 * `/projects?tab=tasks&task=<id>`, but two manager panels hand-wrote `/tasks/${id}`
 * instead — and because Next prefetches every visible `<Link>`, a Stuck tab listing a
 * dozen tickets fired a dozen 404s on render (measured: `/tasks/169`, `/tasks/158`,
 * `/tasks/180` — exactly the register's first rows — as `_rsc` prefetch failures).
 *
 * A route shape duplicated at each call site is a route shape that drifts, so it lives
 * here and every ticket link resolves through it.
 */
export function ticketHref(taskId: number | string): string {
  return `/projects?tab=tasks&task=${taskId}`;
}
