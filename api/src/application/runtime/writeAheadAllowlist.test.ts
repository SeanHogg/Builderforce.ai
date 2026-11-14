/**
 * writeAheadAllowlist — the PRD 39 §4b explicit re-run allowlist (reads / idempotent),
 * and the write-ahead support advertisement helpers stamped on the run payload.
 *
 * The allowlist is an ENUMERATED config list, NOT a free-form `category` match, so
 * `category` never decides safety. Only a host that advertised support (payload
 * `writeAhead: 1`) is a failover candidate; old hosts (no flag) are failed as today.
 */
import { describe, expect, it } from 'vitest';
import {
  WRITE_AHEAD_ALLOWLIST,
  WRITE_AHEAD_PROTOCOL_VERSION,
  isAllowlistedTool,
  withWriteAheadSupport,
  parseWriteAheadSupport,
} from './writeAheadAllowlist';

describe('WRITE_AHEAD_ALLOWLIST — explicit list, not a category match', () => {
  it('is a non-empty enumerated set of read / idempotent tools', () => {
    expect(WRITE_AHEAD_ALLOWLIST.size).toBeGreaterThan(0);
    // Reads only — nothing here may repeat a side effect on re-run.
    for (const name of WRITE_AHEAD_ALLOWLIST) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
    expect(WRITE_AHEAD_ALLOWLIST.has('read_file')).toBe(true);
  });

  it('isAllowlistedTool is exact — allowlisted reads are true, anything else is false', () => {
    expect(isAllowlistedTool('read_file')).toBe(true);
    expect(isAllowlistedTool('search_code')).toBe(true);
    // Mutating / unknown tools are NOT allowlisted → they pay the ack round trip.
    expect(isAllowlistedTool('git_push')).toBe(false);
    expect(isAllowlistedTool('write_file')).toBe(false);
    expect(isAllowlistedTool('run_command')).toBe(false);
    expect(isAllowlistedTool('')).toBe(false);
    // Not a prefix/substring/category match — exact names only.
    expect(isAllowlistedTool('read_files')).toBe(false);
  });
});

describe('write-ahead support advertisement (payload stamp)', () => {
  it('withWriteAheadSupport stamps the protocol version and preserves existing payload', () => {
    const stamped = JSON.parse(withWriteAheadSupport('{"model":"m"}'));
    expect(stamped.writeAhead).toBe(WRITE_AHEAD_PROTOCOL_VERSION);
    expect(stamped.model).toBe('m'); // existing keys survive
  });

  it('withWriteAheadSupport starts clean from an empty / unparseable payload', () => {
    expect(JSON.parse(withWriteAheadSupport(null))).toEqual({ writeAhead: WRITE_AHEAD_PROTOCOL_VERSION });
    expect(JSON.parse(withWriteAheadSupport('not json'))).toEqual({ writeAhead: WRITE_AHEAD_PROTOCOL_VERSION });
  });

  it('parseWriteAheadSupport reads the version back, or null for old hosts / garbage', () => {
    expect(parseWriteAheadSupport('{"writeAhead":1}')).toBe(1);
    expect(parseWriteAheadSupport('{"model":"m"}')).toBeNull(); // old host — no advertisement
    expect(parseWriteAheadSupport(null)).toBeNull();
    expect(parseWriteAheadSupport('not json')).toBeNull();
  });

  it('round-trips: parse reads what withWriteAheadSupport stamped', () => {
    const stamped = withWriteAheadSupport('{"taskId":7}');
    expect(parseWriteAheadSupport(stamped)).toBe(WRITE_AHEAD_PROTOCOL_VERSION);
    expect(JSON.parse(stamped).taskId).toBe(7);
  });
});
