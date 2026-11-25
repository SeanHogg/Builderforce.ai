import { describe, expect, it } from 'vitest';
import { classifyTriggerError } from './triggerErrorClass';

describe('classifyTriggerError', () => {
  it('flags cross-request I/O', () => {
    expect(classifyTriggerError(new Error('Cannot perform I/O on behalf of a different request'))).toBe('cross_request_io');
  });

  it('flags transient database failures', () => {
    expect(classifyTriggerError(new Error('connection terminated unexpectedly'))).toBe('db_transient');
    expect(classifyTriggerError(new Error('read ECONNRESET'))).toBe('db_transient');
  });

  it('flags 4xx as refused_client', () => {
    expect(classifyTriggerError(Object.assign(new Error('nope'), { status: 403 }))).toBe('refused_client');
  });

  it('flags 5xx as server_error', () => {
    expect(classifyTriggerError(Object.assign(new Error('boom'), { status: 502 }))).toBe('server_error');
  });

  it('falls back to unknown', () => {
    expect(classifyTriggerError(new Error('x'))).toBe('unknown');
  });

  it('handles non-Error inputs', () => {
    expect(classifyTriggerError('fetch failed')).toBe('db_transient');
    expect(classifyTriggerError('plain')).toBe('unknown');
    expect(classifyTriggerError(null)).toBe('unknown');
  });
});
