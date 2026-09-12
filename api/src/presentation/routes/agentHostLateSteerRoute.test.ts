import { describe, expect, it } from 'vitest';
import { parseLateSteerReport } from './agentHostLateSteerRoute';

describe('parseLateSteerReport — what a host may report', () => {
  it('accepts a run_finishing report with the steer row ids', () => {
    expect(parseLateSteerReport({ executionId: 42, reason: 'run_finishing', steers: [{ messageId: 7, text: ' also run the tests ' }] }))
      .toEqual({ ok: true, report: { executionId: 42, reason: 'run_finishing', steers: [{ messageId: 7, text: 'also run the tests' }] } });
  });

  it('accepts a steer without an id (a frame from an API that predates it) — matched by text server-side', () => {
    const r = parseLateSteerReport({ executionId: 42, reason: 'no_live_run', steers: [{ text: 'push' }] });
    expect(r).toEqual({ ok: true, report: { executionId: 42, reason: 'no_live_run', steers: [{ text: 'push' }] } });
  });

  it('refuses the server-only reason, a missing execution, and an empty steer list', () => {
    expect(parseLateSteerReport({ executionId: 42, reason: 'run_ended', steers: [{ text: 'x' }] })).toMatchObject({ ok: false });
    expect(parseLateSteerReport({ reason: 'run_finishing', steers: [{ text: 'x' }] })).toMatchObject({ ok: false });
    expect(parseLateSteerReport({ executionId: 42, reason: 'run_finishing', steers: [{ text: '   ' }] })).toMatchObject({ ok: false });
    expect(parseLateSteerReport(null)).toMatchObject({ ok: false });
  });

  it('drops a malformed id rather than trusting it', () => {
    const r = parseLateSteerReport({ executionId: 42, reason: 'run_finishing', steers: [{ messageId: -3, text: 'x' }, { messageId: 1.5, text: 'y' }] });
    expect(r).toEqual({ ok: true, report: { executionId: 42, reason: 'run_finishing', steers: [{ text: 'x' }, { text: 'y' }] } });
  });
});
