import { describe, expect, it } from 'vitest';
import { AGENT_HOST_STALE_MS } from '../../domain/agentHost/onlineStatus';
import {
  HEARTBEAT_WRITE_THROTTLE_MS,
  heartbeatPayloadFingerprint,
  heartbeatWorstCaseAgeMs,
  heartbeatWriteDue,
  readHeartbeatFingerprint,
  rememberHeartbeatFingerprint,
} from './heartbeatThrottle';

const NOW = 1_700_000_000_000;
const ago = (ms: number) => new Date(NOW - ms);

describe('heartbeat write throttle', () => {
  it('keeps a live host online through one dropped beat (throttle bound to the staleness window)', () => {
    expect(HEARTBEAT_WRITE_THROTTLE_MS).toBeLessThan(AGENT_HOST_STALE_MS);
    expect(heartbeatWorstCaseAgeMs()).toBeLessThan(AGENT_HOST_STALE_MS);
  });

  it('writes when last_seen_at is missing or past the throttle', () => {
    expect(heartbeatWriteDue({ lastSeenAt: null, fingerprint: null, lastFingerprint: null, now: NOW })).toBe(true);
    expect(heartbeatWriteDue({
      lastSeenAt: ago(HEARTBEAT_WRITE_THROTTLE_MS), fingerprint: null, lastFingerprint: null, now: NOW,
    })).toBe(true);
  });

  it('skips a recent liveness-only beat', () => {
    expect(heartbeatWriteDue({ lastSeenAt: ago(60_000), fingerprint: null, lastFingerprint: null, now: NOW })).toBe(false);
  });

  it('skips a recent beat whose payload is unchanged, writes a changed or unknown one', () => {
    const fp = heartbeatPayloadFingerprint('["chat"]', { machineName: 'box' });
    const changed = heartbeatPayloadFingerprint('["chat"]', { machineName: 'box', tunnelUrl: 'https://t' });
    expect(heartbeatWriteDue({ lastSeenAt: ago(60_000), fingerprint: fp, lastFingerprint: fp, now: NOW })).toBe(false);
    expect(heartbeatWriteDue({ lastSeenAt: ago(60_000), fingerprint: changed, lastFingerprint: fp, now: NOW })).toBe(true);
    expect(heartbeatWriteDue({ lastSeenAt: ago(60_000), fingerprint: fp, lastFingerprint: null, now: NOW })).toBe(true);
  });

  it('fingerprints an empty beat as liveness-only', () => {
    expect(heartbeatPayloadFingerprint(undefined, null)).toBeNull();
    expect(heartbeatPayloadFingerprint('[]', null)).not.toBeNull();
  });

  it('remembers the written fingerprint so the next unchanged beat is skippable', async () => {
    const fp = heartbeatPayloadFingerprint('["chat"]', { machineName: 'box' });
    expect(await readHeartbeatFingerprint(undefined, 42)).toBeNull();
    await rememberHeartbeatFingerprint(undefined, 42, fp, null);
    expect(await readHeartbeatFingerprint(undefined, 42)).toBe(fp);
  });
});
