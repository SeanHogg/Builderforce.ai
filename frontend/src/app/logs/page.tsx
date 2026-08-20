import { redirect } from 'next/navigation';

/**
 * Workspace logging is consolidated in Settings.
 *
 * `middleware.ts` already redirects `/logs` and `/logs/*` here, so the 384-line
 * audit-log UI this file used to hold had been unreachable since that
 * consolidation landed — a whole client-rooted page kept alive by nothing.
 *
 * The redirect is restated in the route rather than the route being left empty:
 * a middleware matcher is a list someone edits, and a deep link that outlives an
 * edit to that list should still land on the log viewer instead of a blank page.
 * Server component on purpose — the decision is a location, not an interaction.
 */
export default function LogsPage() {
  redirect('/settings?sub=logs&log=audit');
}
