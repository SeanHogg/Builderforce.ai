import { describe, expect, it } from 'vitest';
import { computeBrainDiagnostics, type BrainTraceEvent } from './brainTriage';
import { computeRunProgress } from './runProgress';
import { formatRunProgress, runProgressVerdict } from './runProgressReport';
import { toolExposureInTrace } from './toolExposure';
import type { BrainMessage } from './types';

// VS Code chat #165961: "fix the regression … Add unit tests". The run read for 24 turns, filed and moved one ticket, updated it,
// wrote NO file — and the diagnostics said `mutationsSucceeded 1`, `noEffect: false`, likely cause "healthy".

let clock = 0;
const ts = () => new Date(Date.UTC(2026, 10, 21, 12, 0, clock++)).toISOString();
const llm = (advertisedTools = 38, extra: Record<string, unknown> = {}): BrainTraceEvent =>
  ({ ts: ts(), category: 'llm', label: 'llm.complete', durationMs: 1_000, args: { advertisedTools, catalogTools: 60, ...extra }, usage: { prompt: 4_000, completion: 200 }, finishReason: 'tool_calls' });
const tool = (label: string, args: Record<string, unknown> = {}, result: unknown = { ok: true }): BrainTraceEvent =>
  ({ ts: ts(), category: 'tool', label, durationMs: 50, args, result });
const msg = (role: string, content: string): BrainMessage => ({ role, content } as BrainMessage);

const REQUEST = 'fix the regression where an interrupted run loses its title, and add unit tests';

function bookkeepingOnlyRun(): BrainTraceEvent[] {
  clock = 0;
  const reads = Array.from({ length: 8 }, (_, i) => [llm(), tool('read_file', { path: `src/run/f${i}.ts` })]).flat();
  return [
    ...reads,
    // The hand-off's own filing and start, then the coder's status update.
    tool('ticket-create', { title: 'Restore interrupted-run title' }, { ok: true, id: 'T-1' }),
    tool('ticket-move', { id: 'T-1', status: 'in_progress' }),
    llm(), tool('builtin_tasks_update', { id: 7, status: 'in_progress', note: 'The fix is not in the tree.' }),
    // The progress guard's finish, then the final report: offered no tools on purpose.
    { ts: ts(), category: 'message', label: 'loop.progress_forced', args: { step: 10, trip: 3, signal: 'read_only_streak', forced: 'finish' }, result: 'finish' },
    llm(0),
  ];
}

describe('regression: chat #165961 — a change request whose only writes were ticket bookkeeping had NO effect', () => {
  it('regression: chat #165961 — ticket-create / ticket-move / tasks_update do not satisfy a change request (noEffect)', () => {
    const p = computeRunProgress(bookkeepingOnlyRun(), [msg('user', REQUEST)]);
    expect(p.editIntent).toBe(true);
    // ticket-create + ticket-move (the device's hyphenated writes) + builtin_tasks_update.
    expect(p.mutationsSucceeded).toBe(3);
    expect(p.bookkeepingWrites).toBe(3);
    expect(p.noEffect).toBe(true);
    expect(runProgressVerdict(p)).toMatch(/change requested, no code changed/i);
  });

  it('regression: chat #165961 — the triage names it no-progress, not healthy', () => {
    const d = computeBrainDiagnostics(bookkeepingOnlyRun(), undefined, [msg('user', REQUEST), msg('assistant', 'The fix is not in the tree.')]);
    expect(d.likelyCause).toBe('no-progress');
  });

  it('regression: chat #165961 — linking a ticket to the chat is bookkeeping too, never the change', () => {
    const events = [...bookkeepingOnlyRun(), tool('builtin_chats_link_ticket', { chatId: 9, taskId: 7 })];
    const p = computeRunProgress(events, [msg('user', REQUEST)]);
    expect(p.mutationsSucceeded).toBe(4);
    expect(p.bookkeepingWrites).toBe(4);
    expect(p.noEffect).toBe(true);
  });

  it('regression: chat #165961 — the per-run and chat totals count ticket writes apart from changes', () => {
    const at = (min: number): string => new Date(Date.UTC(2026, 10, 21, 13, min)).toISOString();
    const ask = (min: number, content: string): BrainMessage =>
      ({ id: min, role: 'user', content, metadata: null, seq: min, createdAt: at(min) }) as BrainMessage;
    const ev = (min: number, e: Omit<BrainTraceEvent, 'ts'>): BrainTraceEvent => ({ ...e, ts: at(min) });
    const events = [
      ev(1, { category: 'llm', label: 'llm.complete', args: { toolCalls: 1 } }),
      ev(2, { category: 'tool', label: 'edit_file', args: { path: 'a.ts' }, result: { ok: true } }),
      ev(11, { category: 'llm', label: 'llm.complete', args: { toolCalls: 1 } }),
      ev(12, { category: 'tool', label: 'ticket-create', args: { title: 'x' }, result: { ok: true, id: 'T-2' } }),
    ];
    const p = computeRunProgress(events, [ask(1, 'fix a.ts'), ask(10, 'fix b.ts')]);
    expect(p.runs).toHaveLength(2);
    const lines = formatRunProgress(p);
    expect(lines.find((l) => l.startsWith('Runs'))).toContain('#2 "fix b.ts" 1 turn(s) · 1 call(s) · 0 changed (+1 ticket/task write(s))');
    expect(lines.find((l) => l.startsWith('Chat totals'))).toContain('1 change(s) (+1 ticket/task write(s))');
  });

  it('regression: chat #165961 — a code edit beside the bookkeeping is an effect', () => {
    const events = [...bookkeepingOnlyRun(), tool('edit_file', { path: 'src/run/f1.ts' })];
    expect(computeRunProgress(events, [msg('user', REQUEST)]).noEffect).toBe(false);
  });

  it('regression: chat #165961 — when the person asked for the tickets, filing them IS the effect', () => {
    const p = computeRunProgress(bookkeepingOnlyRun(), [msg('user', 'create tickets for each remaining gap in the run recovery work')]);
    expect(p.noEffect).toBe(false);
  });

  it('regression: chat #165961 — a "create tickets" run that only used the device ticket-create HAD an effect', () => {
    clock = 0;
    const events = [llm(), tool('read_file', { path: 'docs/gaps.md' }), llm(), tool('ticket-create', { title: 'Gap 1' }, { ok: true, id: 'T-9' })];
    const p = computeRunProgress(events, [msg('user', 'create tickets for each remaining gap in docs/gaps.md')]);
    expect(p.mutationsSucceeded).toBe(1);
    expect(p.bookkeepingWrites).toBe(1);
    expect(p.noEffect).toBe(false);
  });

  it('regression: chat #165961 — the deliberate final report turn is not "a turn offered NONE"', () => {
    const exposure = toolExposureInTrace(bookkeepingOnlyRun());
    expect(exposure.min).toBe(38);
    // A working turn offered nothing still is.
    expect(toolExposureInTrace([...bookkeepingOnlyRun(), llm(0)]).min).toBe(0);
  });

  it('regression: chat #165961 — a finish with record tools excuses only its final report, not a later starved turn', () => {
    clock = 0;
    const forced = (recordTools: number): BrainTraceEvent =>
      ({ ts: ts(), category: 'message', label: 'loop.progress_forced', args: { step: 3, forced: 'finish', ...(recordTools ? { recordTools } : {}) }, result: 'finish' });
    // Record turns (ticket tools only), then the final report: excused.
    expect(toolExposureInTrace([llm(), forced(2), llm(2), llm(2), llm(0)]).min).toBe(2);
    // The finish's window ran out: a no-tool turn after it was starved.
    expect(toolExposureInTrace([llm(), forced(2), llm(2), llm(2), llm(2), llm(2), llm(0)]).min).toBe(0);
    // Only the FIRST no-tool turn of the window is the report.
    expect(toolExposureInTrace([llm(), forced(2), llm(0), llm(0)]).min).toBe(0);
    // A finish with no record tools: its very next turn is the report, and the window closes there.
    expect(toolExposureInTrace([llm(), forced(0), llm(5), llm(0)]).min).toBe(0);
  });
});
