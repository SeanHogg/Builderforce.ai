import { describe, expect, it } from 'vitest';
import { AGENT_HOST_STALE_MS, isAgentHostOnline } from './onlineStatus';

describe('isAgentHostOnline', () => {
  const now = new Date('2026-06-06T12:00:00Z').getTime();
  const fresh = new Date(now - 60 * 1000).toISOString(); // 1 min ago
  const stale = new Date(now - (AGENT_HOST_STALE_MS + 60 * 1000)).toISOString();

  it('is online when connected and heartbeat is fresh', () => {
    expect(isAgentHostOnline({ connectedAt: new Date(now), lastSeenAt: fresh }, now)).toBe(true);
  });

  it('is offline when never connected', () => {
    expect(isAgentHostOnline({ connectedAt: null, lastSeenAt: fresh }, now)).toBe(false);
  });

  it('is offline when connectedAt is stuck but heartbeat went stale (the deleted-host bug)', () => {
    // A host deleted/killed without a clean WS close leaves connectedAt set forever.
    expect(isAgentHostOnline({ connectedAt: new Date(now), lastSeenAt: stale }, now)).toBe(false);
  });

  it('is offline when there is no heartbeat at all', () => {
    expect(isAgentHostOnline({ connectedAt: new Date(now), lastSeenAt: null }, now)).toBe(false);
  });

  it('accepts Date and string lastSeenAt forms', () => {
    expect(isAgentHostOnline({ connectedAt: new Date(now), lastSeenAt: new Date(now - 1000) }, now)).toBe(true);
  });

  it('treats an unparseable lastSeenAt as offline', () => {
    expect(isAgentHostOnline({ connectedAt: new Date(now), lastSeenAt: 'not-a-date' }, now)).toBe(false);
  });
});
