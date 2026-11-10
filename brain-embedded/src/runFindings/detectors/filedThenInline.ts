/**
 * `filed_then_inline` — the run filed tickets, nobody was put on them, and the session wrote the code itself. The
 * tickets bought nothing but their own cost. Counts are `staffingSummaryInTrace`'s; the ticket predicate is
 * `isTicketWriteTool`, the one every triage check uses.
 */
import { isTicketWriteTool } from '../../brainTriage';
import { callEvidence, finding } from '../findingParts';
import type { RunFinding, RunView } from '../types';

export function filedThenInline(view: RunView): RunFinding[] {
  const { staffing } = view;
  if (staffing.ticketsCreated === 0 || staffing.dispatched > 0 || staffing.personaSubagents.some((p) => p.ok)) return [];
  const filed = view.calls.filter((c) => c.ok && isTicketWriteTool(c.name));
  const last = filed[filed.length - 1];
  if (!last) return [];
  const inline = view.calls.find((c) => c.write && c.step > last.step);
  if (!inline) return [];
  return [finding('filed_then_inline', 'info', { tickets: staffing.ticketsCreated }, [
    ...filed.map((c) => callEvidence(c, undefined, typeof c.args.title === 'string' ? c.args.title : undefined)),
    callEvidence(inline, inline.paths[0]),
  ])];
}
