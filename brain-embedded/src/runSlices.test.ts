import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from './brainTriage';
import type { BrainMessage } from './types';
import { splitRuns } from './runSlices';
import { computeRunProgress, isCacheAnswered } from './runProgress';
import { formatRunProgress } from './runProgressReport';

const at = (min: number): string => new Date(Date.UTC(2026, 9, 26, 0, min)).toISOString();
const ask = (min: number, content: string): BrainMessage =>
  ({ id: min, role: 'user', content, metadata: null, seq: min, createdAt: at(min) }) as BrainMessage;
const turn = (min: number): BrainTraceEvent => ({ ts: at(min), category: 'llm', label: 'llm.complete', args: { toolCalls: 1 } });
const read = (min: number, path: string, result: unknown = { ok: true }): BrainTraceEvent =>
  ({ ts: at(min), category: 'tool', label: 'read_file', args: { path }, result });
const edit = (min: number, path: string): BrainTraceEvent =>
  ({ ts: at(min), category: 'tool', label: 'edit_file', args: { path, old: 'a', new: 'b' }, result: { ok: true } });
const STUB = { note: 'Duplicate read_file call — identical arguments to an earlier call this turn.' };

describe('splitRuns', () => {
  it('cuts a chat at each message from the person; earlier events join the first run', () => {
    const slices = splitRuns(
      [turn(0), read(1, 'a.ts'), turn(11), read(12, 'b.ts')],
      [ask(1, 'remove the title'), ask(10, 'complete the implementation')],
    );
    expect(slices.map((s) => s.ask)).toEqual(['remove the title', 'complete the implementation']);
    expect(slices[0]!.events).toHaveLength(2);
    expect(slices[1]!.events).toHaveLength(2);
  });

  it('keeps a message steered into a running run inside it — a run starts where its step count resets', () => {
    const step = (min: number, n: number): BrainTraceEvent => ({ ts: at(min), category: 'llm', label: 'llm.complete', args: { step: n } });
    const slices = splitRuns(
      [step(1, 0), step(2, 1), step(4, 2), step(5, 3), step(11, 0), step(12, 1)],
      [ask(1, 'remove the title'), ask(3, 'also fix the steer images'), ask(10, 'complete the implementation')],
    );
    expect(slices.map((s) => s.ask)).toEqual(['remove the title', 'complete the implementation']);
    expect(slices[0]!.events).toHaveLength(4);
    expect(slices[0]!.messages.map((m) => m.content)).toContain('also fix the steer images');
  });

  it('is one slice when the messages carry no times (or there is one)', () => {
    expect(splitRuns([turn(0)], [])).toHaveLength(1);
    expect(splitRuns([turn(0)], [ask(0, 'x')])).toHaveLength(1);
  });
});

describe('computeRunProgress over a chat', () => {
  it("scores the LATEST run and names the run that spun (chat #5739's run 5)", () => {
    const spun = Array.from({ length: 8 }, (_, i) => read(21 + i, 'useBrainConversation.ts', i === 0 ? { ok: true } : STUB));
    const p = computeRunProgress(
      [turn(1), read(2, 'VsCodeChatHeader.tsx'), turn(20), ...spun, turn(41), edit(42, 'VsCodeChatHeader.tsx')],
      [ask(1, 'remove the title from the top of the VSIX'), ask(20, 'complete the implementation detail'), ask(40, 'remove the title')],
    );
    expect(p.runs).toHaveLength(3);
    expect(p.runs[1]).toMatchObject({ spinning: true, cacheAnswered: 7, mutationsSucceeded: 0 });
    expect(p.spinning).toBe(false);
    expect(p.mutationsSucceeded).toBe(1);
    const runsLine = formatRunProgress(p).find((l) => l.startsWith('Runs'))!;
    expect(runsLine).toContain('#2 "complete the implementation detail"');
    expect(runsLine).toContain('⚠ SPUN');
  });

  it('a re-read after the run edited the file is new ground, not a revisit', () => {
    const p = computeRunProgress([read(1, 'a.ts'), edit(2, 'a.ts'), read(3, 'a.ts'), edit(4, 'a.ts'), read(5, 'a.ts')]);
    expect(p.duplicateCalls).toBe(0);
    expect(p.revisitRatio).toBe(0);
  });

  it('treats ./a.ts, src\\a.ts spellings as one target, and names revisits the way the ratio counts them', () => {
    const p = computeRunProgress([read(1, 'src/a.ts'), edit(2, './src/a.ts'), read(3, 'src\\a.ts'), read(4, 'src/a.ts')]);
    expect(p.revisitRatio).toBeCloseTo(1 / 4);
    expect(p.repeatedTargets).toEqual([{ label: 'read_file:src/a.ts', count: 2 }]);
  });

  it("does not count a steer's skipped remainder as a cache answer", () => {
    const steered: BrainTraceEvent = { ts: at(1), category: 'tool', label: 'write_file', args: { path: 'a.ts' }, result: { ok: false, skipped: true, error: 'skipped by steer' } };
    expect(isCacheAnswered(steered)).toBe(false);
  });

  it('counts cache answers on their own, never as a mutation', () => {
    const skipped: BrainTraceEvent = { ts: at(3), category: 'tool', label: 'write_file', args: { path: 'a.ts' }, result: { skipped: true, note: 'same bytes' } };
    const p = computeRunProgress([read(1, 'a.ts'), read(2, 'a.ts', STUB), skipped]);
    expect(p.cacheAnswered).toBe(2);
    expect(p.mutationsSucceeded).toBe(0);
    expect(formatRunProgress(p)[0]).toContain('2 call(s) answered from the read cache, never re-run');
  });
});

describe('isCacheAnswered', () => {
  it('recognises every shape the read guards answer with', () => {
    for (const result of [STUB, { covered: true }, { replayed: true }, { derived: true }, { skipped: true, note: "same bytes" }]) {
      expect(isCacheAnswered({ ts: at(0), category: 'tool', label: 'read_file', result })).toBe(true);
    }
    expect(isCacheAnswered(read(0, 'a.ts'))).toBe(false);
  });
});
