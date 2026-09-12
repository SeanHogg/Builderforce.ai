/**
 * <CodingGateNote> — the Evermind coding-quality gate, legible in the console.
 *
 * Operator decision 2026-09-12: a head serves IDE coding turns only when a coding eval
 * recorded for THIS version scores ≥ 90% of the frontier baseline. Routing enforces it
 * silently (a closed gate just keeps coding turns on the normal model), so without this
 * line "why is my Evermind not answering in the editor?" has no visible answer.
 *
 * Says nothing for an unseeded head (the status pill covers it) or a quarantined one
 * (the quarantine box does) — one explanation per state, never two.
 */
import type { EvermindCodingGateView, EvermindConsoleLabels } from './types';
import { verdictTag } from './consoleStyles';

/** Whole-percent display. Floors (with a hair of float tolerance) so 89.9% reads 89,
 *  never a misleading "90% — needs 90%" on a head the gate refused. */
function wholePct(fraction: number): number {
  return Math.floor(fraction * 100 + 1e-6);
}

/** The gate's message + tone, or null when another console element already explains
 *  the state. Pure — exported for tests. */
export function codingGateMessage(
  gate: EvermindCodingGateView | null | undefined,
  t: Pick<EvermindConsoleLabels, 'codingGateQualified' | 'codingGateBelowBar' | 'codingGateNoEval' | 'codingGateStale'>,
): { text: string; tone: 'ok' | 'warn' } | null {
  if (!gate) return null;
  const bar = Math.round(gate.bar * 100);
  switch (gate.reason) {
    case 'qualified':
      return { text: t.codingGateQualified(wholePct(gate.ratio ?? gate.bar), bar), tone: 'ok' };
    case 'below_bar':
      return { text: t.codingGateBelowBar(wholePct(gate.ratio ?? 0), bar), tone: 'warn' };
    case 'no_eval':
      return { text: t.codingGateNoEval(bar), tone: 'warn' };
    case 'stale_eval':
      return { text: t.codingGateStale(gate.evaluatedVersion ?? 0, gate.headVersion, bar), tone: 'warn' };
    default:
      return null; // unseeded / quarantined — explained elsewhere in the console
  }
}

export function CodingGateNote({ gate, t }: { gate: EvermindCodingGateView | null | undefined; t: EvermindConsoleLabels }) {
  const message = codingGateMessage(gate, t);
  if (!message) return null;
  return (
    <p style={{ margin: 0, fontSize: '0.72rem', lineHeight: 1.5 }} role="note" data-testid="evermind-coding-gate">
      <span style={verdictTag(message.tone)}>{message.text}</span>
    </p>
  );
}
