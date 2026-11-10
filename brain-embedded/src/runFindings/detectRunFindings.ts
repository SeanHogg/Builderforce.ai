/**
 * `detectRunFindings` — a recorded run's report (PRD 46 §3.3): its summary, its turn strip, what went wrong (every
 * {@link RUN_FINDING_REGISTRY} detector over ONE {@link buildRunView}), and the files it touched. Findings are sorted
 * by severity, then by first evidence step — the same run always reports the same list in the same order. Pure.
 */
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainMessage } from '../types';
import { fileLedger, withUniqueIds } from './findingParts';
import { RUN_FINDING_POLICY } from './policy';
import { RUN_FINDING_REGISTRY } from './registry';
import { buildRunView } from './runView';
import type { RunFinding, RunFindingSeverity, RunFindingsReport, RunFindingsSummary, RunView } from './types';

const SEVERITY_ORDER: Readonly<Record<RunFindingSeverity, number>> = { error: 0, warn: 1, info: 2 };

/** The id and title a host knows the run by; the title falls back to the run's first user turn. */
export interface RunIdentity {
  id?: string;
  title?: string;
}

const firstStep = (f: RunFinding): number => f.evidence.reduce((min, e) => Math.min(min, e.step), Number.POSITIVE_INFINITY);

/** Severity first, then where the evidence starts, then kind — a total order. */
export function compareFindings(a: RunFinding, b: RunFinding): number {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || firstStep(a) - firstStep(b)
    || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function summaryOf(view: RunView, findings: readonly RunFinding[], identity: RunIdentity): RunFindingsSummary {
  const ask = view.messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? '';
  const max = RUN_FINDING_POLICY.excerptChars;
  const counts: Record<RunFindingSeverity, number> = { info: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    id: identity.id ?? '',
    title: identity.title ?? (ask.length > max ? `${ask.slice(0, max - 1).trimEnd()}…` : ask),
    startedAt: view.events[0]?.ts ?? '',
    endedAt: view.events[view.events.length - 1]?.ts ?? '',
    models: [...new Set(view.turns.map((t) => t.model))],
    turns: view.turns.length,
    counts,
  };
}

export function detectRunFindings(events: BrainTraceEvent[], messages: BrainMessage[] = [], identity: RunIdentity = {}): RunFindingsReport {
  const view = buildRunView(events, messages);
  const findings = withUniqueIds(RUN_FINDING_REGISTRY.flatMap((d) => d.detect(view)).sort(compareFindings));
  return {
    summary: summaryOf(view, findings, identity),
    turns: view.turns.map((t) => ({
      index: t.index, role: t.role, model: t.model, kind: t.kind, toolCalls: t.toolCalls,
      promptTokens: t.promptTokens, completionTokens: t.completionTokens, durationMs: t.durationMs,
    })),
    findings,
    files: fileLedger(view).map((f) => ({ path: f.path, writes: f.writes, checked: f.checked })),
  };
}
