/**
 * PRD 39 §4b — write-ahead re-run allowlist: prove only idempotent reads are on the
 * path that pays no ack round trip, and that anything NOT named is treated as
 * non-allowlisted (so a mutating tool forces the server ack / no re-run path).
 */
import { describe, expect, it } from 'vitest';
import { isAllowlistedTool, parseWriteAheadSupport, withWriteAheadSupport, WRITE_AHEAD_PROTOCOL_VERSION } from './writeAheadAllowlist';

describe('writeAheadAllowlist', () => {
  it('isAllowlistedTool is exact — allowlisted reads are true, anything else is false', () => {
    expect(isAllowlistedTool('read_file')).toBe(true);
    expect(isAllowlistedTool('search_code')).toBe(true);
    expect(isAllowlistedTool('git_push')).toBe(false);
    expect(isAllowlistedTool('write_file')).toBe(false);
    expect(isAllowlistedTool('run_command')).toBe(false);
    expect(isAllowlistedTool('')).toBe(false);
    // near-miss must not slip through prefix/exact-match
    expect(isAllowlistedTool('read_files')).toBe(false);
  });

  it('withWriteAheadSupport stamps the protocol version and preserves existing payload', () => {
    const stamped = JSON.parse(withWriteAheadSupport('{"model":"m"}'));
    expect(stamped.writeAhead).toBe(WRITE_AHEAD_PROTOCOL_VERSION);
    expect(stamped.model).toBe('m');
  });

  it('withWriteAheadSupport starts clean from an empty / unparseable payload', () => {
    expect(JSON.parse(withWriteAheadSupport(null))).toEqual({ writeAhead: WRITE_AHEAD_PROTOCOL_VERSION });
    expect(JSON.parse(withWriteAheadSupport('not json'))).toEqual({ writeAhead: WRITE_AHEAD_PROTOCOL_VERSION });
  });

  it('round-trips: parse reads what withWriteAheadSupport stamped', () => {
    const stamped = withWriteAheadSupport('{"taskId":7}');
    expect(parseWriteAheadSupport(stamped)).toBe(WRITE_AHEAD_PROTOCOL_VERSION);
  });

  it('parseWriteAheadSupport returns null when the host never advertised (old host)', () => {
    expect(parseWriteAheadSupport('{"model":"m"}')).toBeNull();
    expect(parseWriteAheadSupport(null)).toBeNull();
    expect(parseWriteAheadSupport('')).toBeNull();
  });
});
