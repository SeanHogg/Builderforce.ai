/**
 * Run-findings detectors, planning side: one fires / does-not-fire pair per kind, each over a trace built in its
 * producers' shapes (`fixtures/traceBuilder.ts`).
 */
import { describe, expect, it } from 'vitest';
import { detectRunFindings } from './detectRunFindings';
import { TraceBuilder, type BuiltCall } from './fixtures/traceBuilder';
import type { RunFindingKind } from './types';

const readCall: BuiltCall = { name: 'read_file', args: { path: 'src/a.ts' } };
const writeCall = (path = 'src/a.ts', content = 'export const a = 1;\n'): BuiltCall => ({ name: 'write_file', args: { path, content } });

const of = (b: TraceBuilder, kind: RunFindingKind) => detectRunFindings(b.events, b.messages()).findings.filter((f) => f.kind === kind);

function reads(b: TraceBuilder, n: number, role = 'plan', text?: (i: number) => string | undefined): TraceBuilder {
  for (let i = 0; i < n; i++) {
    const t = text?.(i);
    b.turn({ role, calls: [readCall], ...(t ? { text: t } : {}) });
  }
  return b;
}

describe('analysis_overrun', () => {
  it('warns at 8 read-only turns before the first write', () => {
    const b = reads(new TraceBuilder(), 8).turn({ role: 'code', calls: [writeCall()] });
    expect(of(b, 'analysis_overrun')).toEqual([expect.objectContaining({ severity: 'warn', params: { readTurns: 8, firstWriteTurn: 9 } })]);
  });
  it('is an error when the plan budget forced the hand-off', () => {
    const b = reads(new TraceBuilder(), 3).marker('loop.hand_off_due', { planTurns: 3 })
      .turn({ role: 'plan', loopAnswered: [{ name: 'hand_off', args: {} }], advertisedTools: 1 })
      .turn({ role: 'code', calls: [writeCall()] });
    expect(of(b, 'analysis_overrun')[0]).toMatchObject({ severity: 'error', params: { readTurns: 3, firstWriteTurn: 5 } });
  });
  it('stays quiet for a short analysis', () => {
    expect(of(reads(new TraceBuilder(), 7).turn({ role: 'code', calls: [writeCall()] }), 'analysis_overrun')).toEqual([]);
  });
});

describe('unkept_readiness', () => {
  it('fires on a readiness claim followed by two read-only turns', () => {
    const b = reads(new TraceBuilder(), 4, 'plan', (i) => (i === 0 ? 'Now I have the full picture of the registry.' : undefined));
    expect(of(b, 'unkept_readiness')[0]).toMatchObject({ severity: 'warn', params: { claims: 1, readTurnsAfter: 3 } });
  });
  it('stays quiet when the claim is acted on', () => {
    const b = reads(new TraceBuilder(), 1, 'plan', () => 'Now I have the full picture of the registry.')
      .turn({ role: 'code', calls: [writeCall()] });
    expect(of(b, 'unkept_readiness')).toEqual([]);
  });
});

describe('same_model_roles', () => {
  const handOff = (b: TraceBuilder) => b.turn({ role: 'plan', loopAnswered: [{ name: 'hand_off', args: {} }] })
    .marker('llm.role_handoff', { tasks: 1, via: 'hand_off' });
  it('fires when one model served plan and code across a hand-off', () => {
    const b = handOff(reads(new TraceBuilder(), 2)).turn({ role: 'code', calls: [writeCall()] });
    expect(of(b, 'same_model_roles')[0]).toMatchObject({ severity: 'info', params: { model: 'local/kimi-code/kimi-for-coding' } });
  });
  it('stays quiet when a different model coded', () => {
    const b = handOff(reads(new TraceBuilder(), 2)).turn({ role: 'code', model: 'anthropic/claude-sonnet', calls: [writeCall()] });
    expect(of(b, 'same_model_roles')).toEqual([]);
  });
  it('stays quiet with no hand-off', () => {
    expect(of(reads(new TraceBuilder(), 2).turn({ role: 'code', calls: [writeCall()] }), 'same_model_roles')).toEqual([]);
  });
});

describe('filed_then_inline', () => {
  const ticket: BuiltCall = { name: 'ticket-create', args: { title: 'Do it', description: 'brief' }, result: { ok: true, id: 'abc-1' } };
  it('fires when tickets were filed, nobody dispatched, and the session wrote code after', () => {
    const b = new TraceBuilder().turn({ role: 'plan', calls: [ticket, ticket] }).turn({ role: 'code', calls: [writeCall()] });
    expect(of(b, 'filed_then_inline')[0]).toMatchObject({ severity: 'info', params: { tickets: 2 } });
  });
  it('stays quiet when the work was dispatched', () => {
    const b = new TraceBuilder()
      .turn({ role: 'plan', calls: [ticket, { name: 'chats.dispatch_agent', args: { agent: 'coder' }, result: { ok: true } }] })
      .turn({ role: 'code', calls: [writeCall()] });
    expect(of(b, 'filed_then_inline')).toEqual([]);
  });
});

describe('oversized_args', () => {
  it('fires on a non-write call over 4 KB', () => {
    const b = new TraceBuilder().turn({ role: 'plan', calls: [{ name: 'remember_fact', args: { fact: 'x'.repeat(5000) } }] });
    expect(of(b, 'oversized_args')[0]).toMatchObject({ severity: 'warn', params: { tool: 'remember_fact', calls: 1 } });
  });
  it('fires on two calls of one tool sharing a 1 KB block', () => {
    const block = 'shared context '.repeat(80);
    const call = (t: string): BuiltCall => ({ name: 'ticket-create', args: { title: t, description: `${t}\n\nContext: ${block}` } });
    const b = new TraceBuilder().turn({ role: 'plan', calls: [call('a'), call('b')] });
    expect(of(b, 'oversized_args')[0]?.params).toMatchObject({ tool: 'ticket-create', calls: 2 });
  });
  it('attributes a loop-answered hand_off through its turn', () => {
    const b = new TraceBuilder().turn({ role: 'plan', loopAnswered: [{ name: 'hand_off', args: { summary: 's'.repeat(6000) } }] })
      .marker('llm.role_handoff', { tasks: 1, via: 'hand_off' });
    expect(of(b, 'oversized_args')[0]?.params).toMatchObject({ tool: 'hand_off', calls: 1 });
  });
  it('ignores large writes and small calls', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [writeCall('src/big.ts', `export const s = '${'y'.repeat(6000)}';`), readCall] });
    expect(of(b, 'oversized_args')).toEqual([]);
  });
});

describe('slow_turns', () => {
  it('fires on a turn of 60 s or more', () => {
    const b = new TraceBuilder().turn({ role: 'plan', durationMs: 61_000 }).turn({ role: 'plan', durationMs: 90_500 });
    expect(of(b, 'slow_turns')[0]).toMatchObject({ severity: 'warn', params: { turns: 2, slowestMs: 90_500 } });
  });
  it('stays quiet under the line', () => {
    expect(of(new TraceBuilder().turn({ role: 'plan', durationMs: 59_999 }), 'slow_turns')).toEqual([]);
  });
});
