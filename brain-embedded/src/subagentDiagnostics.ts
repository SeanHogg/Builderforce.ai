/**
 * The sub-agents of a chat, as a triage report reads them.
 *
 * A sub-agent is a run of its own — its turns, tool calls and failures live in ITS trace,
 * not its owner's. A report built from the owner's trace alone shows `wait_agents`
 * sitting for minutes and nothing about the three runs it is waiting on, which is exactly
 * where the answer to "why is it waiting / what went wrong" lives. This renders each
 * child from its own trace, so the report names who was spawned, by whom, what each did,
 * where each failed, and what it reported.
 *
 * Pure: the surface hands in each child's trace and state; nothing here reads a store.
 */

import { isFailedToolResult, modelsUsedInTrace, type BrainTraceEvent } from './brainTriage';
import { codeChangesOf } from './codeChanges';
import { describeLiveStep, type BrainRunActivity } from './runActivity';

export interface SubagentDiagnosticsInput {
  /** How it is addressed, e.g. `a3`. */
  handle: string;
  name: string;
  /** Its slice of the work. */
  label: string;
  /** Who spawned it. */
  owner: string;
  /** 1 for a child, 2 for a grandchild … */
  depth: number;
  ticket?: string;
  /** Still running at capture. */
  running: boolean;
  /** Its own run's trace. */
  events: BrainTraceEvent[];
  /** What it is doing right now, when running. */
  activity?: BrainRunActivity | null;
  /** The run's error, when it failed. */
  error?: string;
  /** Its last assistant message — the report it gave (or is writing). */
  lastMessage?: string;
}

/** Longest excerpt of a failure or a report kept in the report. */
const EXCERPT_CHARS = 280;
/** Failures listed per child; the rest are counted. */
const MAX_FAILURES = 3;

const excerpt = (v: unknown): string => {
  const text = (typeof v === 'string' ? v : JSON.stringify(v ?? '')).replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
};

function stateOf(c: SubagentDiagnosticsInput): string {
  if (c.running) return 'running';
  if (c.error) return 'failed';
  return c.lastMessage?.trim() ? 'done' : 'ended without a report';
}

function spanOf(events: BrainTraceEvent[]): string {
  const times = events.map((e) => Date.parse(e.ts)).filter(Number.isFinite);
  if (times.length < 2) return '';
  const s = Math.round((Math.max(...times) - Math.min(...times)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** The "Sub-agents" block of a triage report. Empty when the chat spawned none. */
export function formatSubagentDiagnostics(children: readonly SubagentDiagnosticsInput[], capturedAtMs: number): string[] {
  if (children.length === 0) return [];
  const running = children.filter((c) => c.running).length;
  const lines = [`--- Sub-agents (${children.length}${running ? ` · ${running} running` : ''}) ---`];
  for (const c of children) {
    const tools = c.events.filter((e) => e.category === 'tool');
    const failures = tools.filter((e) => e.isError || isFailedToolResult(e.result));
    const files = new Set<string>();
    for (const e of tools) for (const f of codeChangesOf(e.label, e.args, e.result) ?? []) files.add(f);
    const models = modelsUsedInTrace(c.events);
    const span = spanOf(c.events);

    lines.push(
      `• ${c.handle} ${c.name} — "${c.label}" · sub-agent of ${c.owner}${c.depth > 1 ? ` (depth ${c.depth})` : ''}${c.ticket ? ` · ticket ${c.ticket}` : ''}`,
    );
    lines.push(
      `  State: ${stateOf(c)} · Turns: ${c.events.filter((e) => e.category === 'llm').length} · Tool calls: ${tools.length} · Failed: ${failures.length}${span ? ` · ${span}` : ''}`,
    );
    if (models.length) lines.push(`  Models: ${models.join(', ')}`);
    if (c.running && c.activity) lines.push(`  Now: ${describeLiveStep(c.activity, capturedAtMs)}`);
    if (files.size) lines.push(`  Changed: ${[...files].join(', ')}`);
    for (const f of failures.slice(0, MAX_FAILURES)) lines.push(`  Failed step: ${f.label} — ${excerpt(f.result)}`);
    if (failures.length > MAX_FAILURES) lines.push(`  …and ${failures.length - MAX_FAILURES} more failed step(s)`);
    if (c.error) lines.push(`  Error: ${excerpt(c.error)}`);
    if (c.lastMessage?.trim()) lines.push(`  ${c.running ? 'Last message' : 'Report'}: ${excerpt(c.lastMessage)}`);
  }
  return lines;
}
