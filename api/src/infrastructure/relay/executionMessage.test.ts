import { describe, expect, it } from 'vitest';
import { buildExecutionMessageFrame, buildExecutionCancelFrame } from './executionMessage';

describe('buildExecutionMessageFrame', () => {
  it('builds an execution.message frame from a valid payload', () => {
    const r = buildExecutionMessageFrame({ executionId: 12, text: 'use Go, not Rust' });
    expect(r).toEqual({ ok: true, frame: { type: 'execution.message', executionId: 12, text: 'use Go, not Rust' } });
  });

  it('trims the text', () => {
    const r = buildExecutionMessageFrame({ executionId: 1, text: '  hi  ' });
    expect(r.ok && r.frame.text).toBe('hi');
  });

  it('omits executionId when missing or non-finite', () => {
    expect(buildExecutionMessageFrame({ text: 'x' })).toEqual({
      ok: true,
      frame: { type: 'execution.message', executionId: undefined, text: 'x' },
    });
    const r = buildExecutionMessageFrame({ executionId: Number.NaN, text: 'x' });
    expect(r.ok && r.frame.executionId).toBeUndefined();
  });

  it('rejects empty / whitespace / missing / non-string text', () => {
    expect(buildExecutionMessageFrame({ text: '' })).toEqual({ ok: false, error: 'text_required' });
    expect(buildExecutionMessageFrame({ text: '   ' })).toEqual({ ok: false, error: 'text_required' });
    expect(buildExecutionMessageFrame({ executionId: 1 })).toEqual({ ok: false, error: 'text_required' });
    expect(buildExecutionMessageFrame({ text: 99 })).toEqual({ ok: false, error: 'text_required' });
  });

  it('does not throw on null / non-object payloads', () => {
    expect(buildExecutionMessageFrame(null)).toEqual({ ok: false, error: 'text_required' });
    expect(buildExecutionMessageFrame('nope')).toEqual({ ok: false, error: 'text_required' });
    expect(buildExecutionMessageFrame(undefined)).toEqual({ ok: false, error: 'text_required' });
  });
});

describe('buildExecutionCancelFrame', () => {
  it('builds an execution.cancel frame with the executionId', () => {
    expect(buildExecutionCancelFrame({ executionId: 7 })).toEqual({ type: 'execution.cancel', executionId: 7 });
  });

  it('omits executionId when missing or non-finite', () => {
    expect(buildExecutionCancelFrame({})).toEqual({ type: 'execution.cancel', executionId: undefined });
    expect(buildExecutionCancelFrame({ executionId: Number.NaN })).toEqual({ type: 'execution.cancel', executionId: undefined });
  });

  it('does not throw on null / non-object payloads', () => {
    expect(buildExecutionCancelFrame(null)).toEqual({ type: 'execution.cancel', executionId: undefined });
    expect(buildExecutionCancelFrame('nope')).toEqual({ type: 'execution.cancel', executionId: undefined });
  });
});
