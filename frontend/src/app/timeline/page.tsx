import { redirect } from 'next/navigation';

/**
 * The execution timeline is a view of the consolidated Settings log surface.
 *
 * `middleware.ts` redirects `/timeline` and `/timeline/*` to `/settings?sub=logs`,
 * so the page that used to render `<ObservabilityContent initialView="timeline"/>`
 * here had been unreachable — and, being `'use client'`, was still counted
 * against the client-bundle ratchet for a route nobody could open.
 *
 * Restated in the route for the same reason as `/logs`: the deep link should
 * survive an edit to the middleware matcher.
 */
export default function TimelinePage() {
  redirect('/settings?sub=logs');
}
