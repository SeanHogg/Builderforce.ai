import { describe, expect, it } from 'vitest';
import { AGENT_HOST_STALE_MS } from '../../domain/agentHost/onlineStatus';
import {
  HEARTBEAT_WRITE_THROTTLE_MS,
  heartbeatPayloadFingerprint,
  heartbeatWorstCaseAgeMs,
  heartbeatWriteDue,
  readHeartbeatState,
  rememberHeartbeatWrite,
  throttledWriteDue,
} from './heartbeatThrottle';

const NOW = 1_700_000_000_000;
const ago = (ms: number) => new Date(NOW - ms);

describe('heartbeat write throttle', () => {
  it('keeps a live host online through one dropped beat (throttle bound to the staleness window)', () => {
    expect(HEARTBEAT_WRITE_THROTTLE_MS).toBeLessThan(AGENT_HOST_STALE_MS);
    expect(heartbeatWorstCaseAgeMs()).toBeLessThan(AGENT_HOST_STALE_MS);
  });

  const stateAgo = (ms: number, fingerprint: string | null = null) => ({ fingerprint, writtenAtMs: NOW - ms });

  it('writes when nothing is remembered or the last write is past the throttle', () => {
    expect(heartbeatWriteDue({ state: null, fingerprint: null, now: NOW })).toBe(true);
    expect(heartbeatWriteDue({ state: stateAgo(HEARTBEAT_WRITE_THROTTLE_MS), fingerprint: null, now: NOW })).toBe(true);
  });

  it('skips a recent liveness-only beat', () => {
    expect(heartbeatWriteDue({ state: stateAgo(60_000), fingerprint: null, now: NOW })).toBe(false);
  });

  it('skips a recent beat whose payload is unchanged, writes a changed one', () => {
    const fp = heartbeatPayloadFingerprint('["chat"]', { machineName: 'box' });
    const changed = heartbeatPayloadFingerprint('["chat"]', { machineName: 'box', tunnelUrl: 'https://t' });
    expect(heartbeatWriteDue({ state: stateAgo(60_000, fp), fingerprint: fp, now: NOW })).toBe(false);
    expect(heartbeatWriteDue({ state: stateAgo(60_000, fp), fingerprint: changed, now: NOW })).toBe(true);
    expect(heartbeatWriteDue({ state: stateAgo(60_000, null), fingerprint: fp, now: NOW })).toBe(true);
  });

  it('the shared rule: unknown or past-throttle writes, a recent write skips unless changed', () => {
    expect(throttledWriteDue({ lastWrittenAtMs: null, throttleMs: 1000, now: NOW })).toBe(true);
    expect(throttledWriteDue({ lastWrittenAtMs: NOW - 1000, throttleMs: 1000, now: NOW })).toBe(true);
    expect(throttledWriteDue({ lastWrittenAtMs: NOW - 999, throttleMs: 1000, now: NOW })).toBe(false);
    expect(throttledWriteDue({ lastWrittenAtMs: NOW - 999, throttleMs: 1000, changed: true, now: NOW })).toBe(true);
  });

  it('fingerprints an empty beat as liveness-only', () => {
    expect(heartbeatPayloadFingerprint(undefined, null)).toBeNull();
    expect(heartbeatPayloadFingerprint('[]', null)).not.toBeNull();
  });

  it('remembers the last write (time + payload) so a beat needs no database read', async () => {
    const fp = heartbeatPayloadFingerprint('["chat"]', { machineName: 'box' });
    expect(await readHeartbeatState(undefined, 42)).toBeNull();
    await rememberHeartbeatWrite(undefined, 42, fp, null, NOW);
    const state = await readHeartbeatState(undefined, 42);
    expect(state).toEqual({ fingerprint: fp, writtenAtMs: NOW });
    // A liveness-only write refreshes the time but keeps the payload fingerprint.
    await rememberHeartbeatWrite(undefined, 42, null, state, NOW + 1000);
    expect(await readHeartbeatState(undefined, 42)).toEqual({ fingerprint: fp, writtenAtMs: NOW + 1000 });
  });
});
